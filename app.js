import { DEFAULT_RULES, parseScript, midiToNoteName, velocityMatches, resolveVelocity, resolveTarget } from './dsl.js';
import { parseMidiFile } from './midi-file.js';

const $ = s => document.querySelector(s);
const editor=$('#editor'), diagnostics=$('#diagnostics'), parseStatus=$('#parseStatus');
const inputLog=$('#inputLog'), outputLog=$('#outputLog');
const heldNotesEl=$('#heldNotes'), ruleFired=$('#ruleFired');
const STORAGE='pianorules.v1';

const state = {
  midi:null, inputSelection:'all', outputSelection:'', inputChannel:'all', outputChannel:1,
  running:false, rules:[], sequences:new Map(), held:new Set(), heldInputs:new Map(), noteHistory:[], timers:new Set(),
  startedAt:0, likelyEchoes:new Map(), assets:new Map(), chordFire:new Map(),
  sequencePlaying:new Map(), whileStates:new Map(), sequenceTokens:0,
  engineGeneration:0, appliedSource:''
};

function loadPrefs(){
  try { return JSON.parse(localStorage.getItem(STORAGE)||'{}'); } catch { return {}; }
}
const prefs=loadPrefs();
editor.value=prefs.rules || DEFAULT_RULES;
$('#fullscreenPreference').checked=prefs.fullscreen !== false;
$('#echoGuard').checked=prefs.echoGuard !== false;
$('#echoGuardMs').value=prefs.echoGuardMs ?? 100;
state.inputSelection=prefs.inputSelection || 'all';
state.outputSelection=prefs.outputSelection || '';
state.inputChannel=prefs.inputChannel || 'all';
state.outputChannel=prefs.outputChannel || 1;

function savePrefs(){
  localStorage.setItem(STORAGE, JSON.stringify({
    rules:editor.value, fullscreen:$('#fullscreenPreference').checked,
    echoGuard:$('#echoGuard').checked, echoGuardMs:Number($('#echoGuardMs').value)||0,
    inputSelection:state.inputSelection, outputSelection:state.outputSelection,
    inputChannel:state.inputChannel, outputChannel:state.outputChannel,
    inputSignature:getPortSignature(findInput(state.inputSelection)),
    outputSignature:getPortSignature(findOutput(state.outputSelection))
  }));
}
function updateEditorState(){
  if(state.running && editor.value !== state.appliedSource){
    parseStatus.textContent='changes pending · click Apply changes';
    $('#runButton').textContent='Apply changes';
  }
}
editor.addEventListener('input',()=>{savePrefs();updateEditorState();});
['fullscreenPreference','echoGuard','echoGuardMs'].forEach(id=>$('#'+id).addEventListener('change',savePrefs));

for(let i=1;i<=16;i++){
  $('#inputChannel').insertAdjacentHTML('beforeend',`<option value="${i}">${i}</option>`);
  $('#outputChannel').insertAdjacentHTML('beforeend',`<option value="${i}">${i}</option>`);
}
$('#inputChannel').value=state.inputChannel; $('#outputChannel').value=String(state.outputChannel);

function getPortSignature(p){ return p ? `${p.manufacturer||''}|${p.name||''}` : ''; }
function findInput(id){ return id==='all' ? null : state.midi?.inputs.get(id); }
function findOutput(id){ return id==='all' ? null : state.midi?.outputs.get(id); }
function findBySignature(map,sig){ if(!sig)return null; return [...map.values()].find(p=>getPortSignature(p)===sig); }

async function requestMidi(){
  if(!navigator.requestMIDIAccess) throw new Error('This browser does not expose Web MIDI. Use a Web-MIDI-capable desktop browser (Chrome/Edge are the safest choice).');
  state.midi=await navigator.requestMIDIAccess({sysex:false});
  state.midi.onstatechange=()=>refreshPorts();
  refreshPorts(true); loadAssets();
}

function refreshPorts(first=false){
  if(!state.midi)return;
  const inSel=$('#inputSelect'), outSel=$('#outputSelect');
  inSel.innerHTML='<option value="all">All MIDI inputs</option>';
  outSel.innerHTML='<option value="">No MIDI output</option><option value="all">All MIDI outputs</option>';
  for(const p of state.midi.inputs.values()) inSel.add(new Option(`${p.name}${p.manufacturer?` — ${p.manufacturer}`:''}`,p.id));
  for(const p of state.midi.outputs.values()) outSel.add(new Option(`${p.name}${p.manufacturer?` — ${p.manufacturer}`:''}`,p.id));

  if(first){
    if(state.inputSelection!=='all' && !state.midi.inputs.has(state.inputSelection)){
      const p=findBySignature(state.midi.inputs,prefs.inputSignature); if(p) state.inputSelection=p.id; else state.inputSelection='all';
    }
    if(state.outputSelection && state.outputSelection!=='all' && !state.midi.outputs.has(state.outputSelection)){
      const p=findBySignature(state.midi.outputs,prefs.outputSignature); if(p) state.outputSelection=p.id;
    }
    if(!state.outputSelection && state.midi.outputs.size===1) state.outputSelection=[...state.midi.outputs.keys()][0];
  }
  if(![...inSel.options].some(o=>o.value===state.inputSelection)) state.inputSelection='all';
  if(![...outSel.options].some(o=>o.value===state.outputSelection)) state.outputSelection='';
  inSel.value=state.inputSelection; outSel.value=state.outputSelection;
  attachInputListeners(); updateDeviceLabels(); savePrefs();
  $('#midiDot').classList.toggle('on',state.midi.inputs.size>0 || state.midi.outputs.size>0);
  $('#midiFooter').textContent=`${state.midi.inputs.size} input${state.midi.inputs.size===1?'':'s'} · ${state.midi.outputs.size} output${state.midi.outputs.size===1?'':'s'}`;
}

function attachInputListeners(){
  if(!state.midi)return;
  for(const p of state.midi.inputs.values()) p.onmidimessage=null;
  for(const p of state.midi.inputs.values()) if(state.inputSelection==='all'||p.id===state.inputSelection) p.onmidimessage=e=>handleMidi(e,p);
}
function selectedOutputs(){
  if(!state.midi)return [];
  if(state.outputSelection==='all')return [...state.midi.outputs.values()];
  const p=state.midi.outputs.get(state.outputSelection); return p?[p]:[];
}
function updateDeviceLabels(){
  const ins=state.inputSelection==='all'?'all inputs':findInput(state.inputSelection)?.name||'no device';
  const outs=state.outputSelection==='all'?'all outputs':findOutput(state.outputSelection)?.name||'no output';
  $('#inputDeviceLabel').textContent=ins; $('#outputDeviceLabel').textContent=outs;
}

$('#inputSelect').addEventListener('change',e=>{state.inputSelection=e.target.value; attachInputListeners();updateDeviceLabels();savePrefs();});
$('#outputSelect').addEventListener('change',e=>{state.outputSelection=e.target.value;updateDeviceLabels();savePrefs();});
$('#inputChannel').addEventListener('change',e=>{state.inputChannel=e.target.value;savePrefs();});
$('#outputChannel').addEventListener('change',e=>{state.outputChannel=Number(e.target.value);savePrefs();});
$('#refreshMidiButton').addEventListener('click',()=>refreshPorts());

function timeLabel(){
  if(!state.startedAt)return '--:--.---'; const ms=performance.now()-state.startedAt;
  const m=Math.floor(ms/60000), s=Math.floor(ms/1000)%60, x=Math.floor(ms)%1000;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(x).padStart(3,'0')}`;
}
setInterval(()=>$('#clock').textContent=timeLabel(),30);

function log(el,text){
  const row=document.createElement('div'); row.className='log-row';
  row.innerHTML=`<span class="time">${timeLabel()}</span><span></span>`; row.lastElementChild.textContent=text;
  el.prepend(row); while(el.children.length>120)el.lastElementChild.remove();
}
function setHeld(){
  const notes=[...new Set([...state.heldInputs.values()].map(x=>x.note))].sort((a,b)=>a-b);
  state.held=new Set(notes);
  heldNotesEl.innerHTML=notes.map(n=>`<span class="chip">${midiToNoteName(n)}</span>`).join('');
}

function markLikelyEcho(note,channel,phase='on'){
  const key=`${channel}:${note}`, rec=state.likelyEchoes.get(key)||{};
  rec[phase]=performance.now(); state.likelyEchoes.set(key,rec);
}
function isLikelyEcho(note,channel,phase='on'){
  if(!$('#echoGuard').checked)return false;
  const rec=state.likelyEchoes.get(`${channel}:${note}`), t=rec?.[phase]; if(t==null)return false;
  return performance.now()-t <= Number($('#echoGuardMs').value||100);
}

function handleMidi(event,port){
  const [status,d1,d2=0]=event.data, type=status&0xf0, channel=(status&0x0f)+1;
  if(state.inputChannel!=='all' && Number(state.inputChannel)!==channel)return;
  if(type===0x90 && d2>0){
    const echo=isLikelyEcho(d1,channel,'on');
    $('#inputHero').textContent=midiToNoteName(d1); $('#inputVelocity').textContent=`velocity ${d2} · ch ${channel}`;
    log(inputLog,`${midiToNoteName(d1)}  vel ${d2}  ch ${channel}${echo?'  [echo ignored]':''}`);
    if(echo)return;
    const now=performance.now(), ctx={note:d1,velocity:d2,channel,time:now};
    state.heldInputs.set(`${channel}:${d1}`,ctx); setHeld();
    state.noteHistory.push(ctx); state.noteHistory=state.noteHistory.filter(x=>now-x.time<1500);
    if(state.running){ processNote(d1,d2,channel,now); refreshWhileRules(ctx); }
  } else if(type===0x80 || (type===0x90&&d2===0)){
    const echo=isLikelyEcho(d1,channel,'off');
    log(inputLog,`${midiToNoteName(d1)} off  ch ${channel}${echo?'  [echo ignored]':''}`);
    if(echo)return;
    state.heldInputs.delete(`${channel}:${d1}`); setHeld();
    if(state.running)refreshWhileRules();
  } else if(type===0xb0) log(inputLog,`CC ${d1} = ${d2}  ch ${channel}`);
  else log(inputLog,`0x${status.toString(16)} ${d1} ${d2}`);
}

function processNote(note,velocity,channel,now){
  for(const rule of state.rules){
    const tr=rule.trigger;
    if(tr.kind==='note' && (tr.any||tr.note===note) && velocityMatches(tr.velocity,velocity)) fireRule(rule,{note,velocity,channel});
    if(tr.kind==='chord'){
      const recent=state.noteHistory.filter(x=>now-x.time<=tr.within);
      const found=tr.notes.map(n=>[...recent].reverse().find(x=>x.note===n));
      if(found.every(Boolean) && found.every(x=>velocityMatches(tr.velocity,x.velocity))){
        const key=rule.id, last=state.chordFire.get(key)||0;
        if(now-last>tr.within){ state.chordFire.set(key,now); fireRule(rule,{note,velocity,channel,chord:found}); }
      }
    }
  }
}

function whileConditionContext(trigger,preferredCtx=null){
  if(trigger.kind==='whileNote'){
    const candidates=[...state.heldInputs.values()].filter(x=>(trigger.any||x.note===trigger.note) && velocityMatches(trigger.velocity,x.velocity));
    if(!candidates.length)return null;
    if(preferredCtx && candidates.some(x=>x.note===preferredCtx.note&&x.channel===preferredCtx.channel))return preferredCtx;
    return candidates[candidates.length-1];
  }
  if(trigger.kind==='whileSequence'){
    const active=state.sequencePlaying.get(trigger.name);
    return active?.count>0 ? active.ctx : null;
  }
  return null;
}
function whileGuard(ruleId,epoch){
  return ()=>{const ws=state.whileStates.get(ruleId);return !!ws?.active && ws.epoch===epoch;};
}
function refreshWhileRules(preferredCtx=null){
  if(!state.running)return;
  const generation=state.engineGeneration;
  for(const rule of state.rules){
    const tr=rule.trigger;
    if(tr.kind!=='whileNote'&&tr.kind!=='whileSequence')continue;
    const ctx=whileConditionContext(tr,preferredCtx);
    let ws=state.whileStates.get(rule.id);
    if(!ws){ws={active:false,epoch:0,ctx:null};state.whileStates.set(rule.id,ws);}
    if(ctx && !ws.active){
      ws.active=true; ws.epoch++; ws.ctx=ctx;
      const epoch=ws.epoch, guard=whileGuard(rule.id,epoch);
      fireRule(rule,ctx,generation,guard);
      if(tr.every)recurringWhile(rule,tr.every,generation,epoch);
    } else if(ctx && ws.active){
      ws.ctx=ctx;
    } else if(!ctx && ws.active){
      ws.active=false; ws.epoch++; ws.ctx=null;
    }
  }
}
function recurringWhile(rule,interval,generation,epoch){
  const guard=whileGuard(rule.id,epoch);
  schedule(()=>{
    const ws=state.whileStates.get(rule.id); if(!ws?.ctx)return;
    fireRule(rule,ws.ctx,generation,guard);
    recurringWhile(rule,interval,generation,epoch);
  },interval,generation,guard);
}

function beginSequenceState(name,ctx,generation){
  if(!state.running||state.engineGeneration!==generation)return;
  const current=state.sequencePlaying.get(name)||{count:0,ctx}; current.count++; current.ctx=ctx;
  state.sequencePlaying.set(name,current); refreshWhileRules(ctx);
}
function endSequenceState(name,generation){
  if(state.engineGeneration!==generation)return;
  const current=state.sequencePlaying.get(name); if(!current)return;
  current.count=Math.max(0,current.count-1);
  if(current.count===0)state.sequencePlaying.delete(name); else state.sequencePlaying.set(name,current);
  refreshWhileRules();
}

function addTimer(id){state.timers.add(id);return id;}
function schedule(fn,ms,generation=state.engineGeneration,guard=null){
  const id=setTimeout(()=>{
    state.timers.delete(id);
    if(state.running && state.engineGeneration===generation && (!guard||guard())) fn();
  },Math.max(0,ms));
  return addTimer(id);
}
function clearTimers(){for(const id of state.timers)clearTimeout(id); state.timers.clear();}

function startEngine(){
  // Always compile the text that is currently visible in the editor.
  // Invalid edits stop the old engine instead of silently leaving stale rules active.
  const source=editor.value;
  savePrefs();
  const parsed=parseScript(source);
  diagnostics.innerHTML=parsed.errors.map(e=>`<div>${escapeHtml(e)}</div>`).join('');

  // Invalidate every callback belonging to the previous rule set before installing a new one.
  panic(true);
  state.rules=[];
  state.sequences=new Map();

  if(parsed.errors.length){
    parseStatus.textContent=`${parsed.errors.length} error${parsed.errors.length>1?'s':''} · rules stopped`;
    $('#runButton').textContent='Fix & run rules';
    ruleFired.textContent='rules not running — fix the errors above';
    return false;
  }

  state.rules=parsed.rules;
  state.sequences=parsed.sequences;
  state.appliedSource=source;
  state.running=true;
  state.startedAt=performance.now();
  state.noteHistory=[];
  state.chordFire.clear();
  state.sequencePlaying.clear();
  state.whileStates.clear();
  $('#engineStatus').textContent='running';
  $('#engineStatus').className='status running';
  $('#runButton').textContent='Restart rules';
  parseStatus.textContent=`${state.rules.length} rules · ${state.sequences.size} sequences`;
  ruleFired.textContent='new rules applied — waiting for a trigger…';

  const generation=state.engineGeneration;
  for(const rule of state.rules){
    const tr=rule.trigger;
    if(tr.kind==='after') schedule(()=>fireRule(rule,{note:60,velocity:64,channel:state.outputChannel},generation),tr.delay,generation);
    if(tr.kind==='every') recurring(rule,tr.interval,tr.interval,generation);
    if(tr.kind==='everyRandom') recurringRandom(rule,tr.min,tr.max,generation);
  }
  refreshWhileRules();
  return true;
}
function recurring(rule,first,interval,generation=state.engineGeneration){
  schedule(()=>{
    fireRule(rule,{note:60,velocity:64,channel:state.outputChannel},generation);
    recurring(rule,interval,interval,generation);
  },first,generation);
}
function recurringRandom(rule,min,max,generation=state.engineGeneration){
  const delay=min+Math.random()*(max-min);
  schedule(()=>{
    fireRule(rule,{note:60,velocity:64,channel:state.outputChannel},generation);
    recurringRandom(rule,min,max,generation);
  },delay,generation);
}

async function fireRule(rule,ctx,generation=state.engineGeneration,guard=null){
  if(!state.running || state.engineGeneration!==generation || (guard&&!guard())) return;
  ruleFired.textContent=`line ${rule.line}: ${describeTrigger(rule.trigger)}`;
  let cursor=0;
  for(const action of rule.actions){
    if(action.kind==='wait'){cursor+=action.duration;continue;}
    executeAction(action,ctx,cursor,generation,guard);
  }
}
function describeTrigger(t){
  if(t.kind==='note')return t.any?'any note':midiToNoteName(t.note);
  if(t.kind==='chord')return `chord ${t.notes.map(midiToNoteName).join(' ')}`;
  if(t.kind==='after')return `after start ${t.delay}ms`;
  if(t.kind==='every')return `every ${t.interval}ms`;
  if(t.kind==='everyRandom')return `random timer ${t.min}–${t.max}ms`;
  if(t.kind==='whileNote')return `while ${t.any?'any note':midiToNoteName(t.note)} is down${t.every?` · every ${t.every}ms`:''}`;
  if(t.kind==='whileSequence')return `while sequence ${t.name} is playing${t.every?` · every ${t.every}ms`:''}`;
  return t.kind;
}

function noteActionDuration(action){
  let interval=action.every||0, lastStart=action.after||0;
  for(let i=1;i<action.repeat;i++){lastStart+=interval;interval*=action.accelerate||1;}
  return lastStart+(action.duration||0);
}
function sequenceDuration(name,stack=[]){
  if(stack.includes(name))return 0;
  const actions=state.sequences.get(name); if(!actions)return 0;
  let cursor=0,maxEnd=0;
  for(const action of actions){
    if(action.kind==='wait'){cursor+=action.duration;maxEnd=Math.max(maxEnd,cursor);continue;}
    let end=cursor;
    if(action.kind==='notes')end+=noteActionDuration(action);
    else if(action.kind==='sequence')end+=sequenceDuration(action.name,[...stack,name]);
    else end+=1;
    maxEnd=Math.max(maxEnd,end);
  }
  return Math.max(1,maxEnd);
}

function executeAction(action,ctx,baseDelay=0,generation=state.engineGeneration,guard=null){
  if(action.kind==='panic'){schedule(()=>panic(false),baseDelay,generation,guard);return;}
  if(action.kind==='sequence'){
    const actions=state.sequences.get(action.name); if(!actions){log(outputLog,`unknown sequence ${action.name}`);return;}
    const duration=sequenceDuration(action.name);
    schedule(()=>{
      beginSequenceState(action.name,ctx,generation);
      schedule(()=>endSequenceState(action.name,generation),duration,generation);
    },baseDelay,generation,guard);
    let cursor=baseDelay;
    for(const a of actions){if(a.kind==='wait')cursor+=a.duration; else executeAction(a,ctx,cursor,generation,guard);}
    return;
  }
  if(action.kind==='sound'){schedule(()=>playSound(action.source,generation),baseDelay,generation,guard);return;}
  if(action.kind==='midi'){schedule(()=>playMidiAsset(action.source,generation),baseDelay,generation,guard);return;}
  if(action.kind!=='notes')return;

  let interval=action.every||0, elapsed=baseDelay+(action.after||0);
  for(let i=0;i<action.repeat;i++){
    schedule(()=>{
      let targets=action.targets;
      if(action.random) targets=[targets[Math.floor(Math.random()*targets.length)]];
      for(const target of targets){
        const note=resolveTarget(target,ctx.note??60), vel=resolveVelocity(action.velocity,ctx.velocity??64), ch=action.channel||state.outputChannel||1;
        sendNote(note,vel,ch,action.duration);
      }
    },elapsed,generation,guard);
    elapsed += interval; interval *= action.accelerate||1;
  }
}

function sendBytes(bytes,timestamp){ for(const out of selectedOutputs()) out.send(bytes,timestamp); }
function sendNote(note,velocity,channel=1,duration=220){
  const status=0x90+((channel-1)&0x0f), off=0x80+((channel-1)&0x0f);
  markLikelyEcho(note,channel,'on');
  sendBytes([status,note,velocity]);
  $('#outputHero').textContent=midiToNoteName(note); $('#outputVelocity').textContent=`velocity ${velocity} · ch ${channel}`;
  log(outputLog,`${midiToNoteName(note)}  vel ${velocity}  ch ${channel}`);
  const id=setTimeout(()=>{markLikelyEcho(note,channel,'off');sendBytes([off,note,0]); state.timers.delete(id);},Math.max(10,duration)); state.timers.add(id);
}
function panic(stopEngine=true){
  if(stopEngine) state.engineGeneration++;
  clearTimers();
  state.sequencePlaying.clear(); state.whileStates.clear();
  for(let ch=1;ch<=16;ch++){sendBytes([0xb0+(ch-1),123,0]);sendBytes([0xb0+(ch-1),120,0]);}
  if(stopEngine){state.running=false;$('#engineStatus').textContent='stopped';$('#engineStatus').className='status stopped';$('#runButton').textContent='Run rules';}
}

async function openDb(){ return await new Promise((res,rej)=>{const r=indexedDB.open('pianorules-assets',1);r.onupgradeneeded=()=>r.result.createObjectStore('assets',{keyPath:'name'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}); }
async function storeAsset(file){const db=await openDb(), data=await file.arrayBuffer();await new Promise((res,rej)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put({name:file.name,type:file.type||guessType(file.name),data,updated:Date.now()});tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});state.assets.set(file.name,{name:file.name,type:file.type||guessType(file.name),data});log(outputLog,`asset stored: ${file.name}`);}
async function loadAssets(){try{const db=await openDb();const rows=await new Promise((res,rej)=>{const r=db.transaction('assets').objectStore('assets').getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});rows.forEach(x=>state.assets.set(x.name,x));if(rows.length)$('#assetDrop').textContent=`${rows.length} saved asset${rows.length===1?'':'s'} · drop more here`;}catch{}}
function guessType(n){if(/\.mid(i)?$/i.test(n))return'audio/midi';if(/\.wav$/i.test(n))return'audio/wav';if(/\.mp3$/i.test(n))return'audio/mpeg';return'application/octet-stream';}
async function getAsset(source){
  if(state.assets.has(source))return state.assets.get(source);
  const resp=await fetch(source);if(!resp.ok)throw new Error(`Could not load ${source}`);return{name:source,type:resp.headers.get('content-type')||guessType(source),data:await resp.arrayBuffer()};
}
async function playSound(source,generation=state.engineGeneration){try{const a=await getAsset(source);if(!state.running||state.engineGeneration!==generation)return;const blob=new Blob([a.data],{type:a.type}), url=URL.createObjectURL(blob), audio=new Audio(url);audio.addEventListener('ended',()=>URL.revokeObjectURL(url),{once:true});await audio.play();log(outputLog,`sound ${source}`);}catch(e){log(outputLog,`sound error: ${e.message}`);}}
async function playMidiAsset(source,generation=state.engineGeneration){try{const a=await getAsset(source);if(!state.running||state.engineGeneration!==generation)return;const mf=parseMidiFile(a.data);for(const e of mf.events){schedule(()=>{const ch=e.channel||state.outputChannel;const status=(e.status==='on'?0x90:0x80)+((ch-1)&15);markLikelyEcho(e.note,ch,e.status==='on'?'on':'off');sendBytes([status,e.note,e.status==='on'?e.velocity:0]);$('#outputHero').textContent=midiToNoteName(e.note);$('#outputVelocity').textContent=`${e.status==='on'?`velocity ${e.velocity}`:'off'} · ch ${ch}`;log(outputLog,`${midiToNoteName(e.note)} ${e.status==='on'?`vel ${e.velocity}`:'off'}  [${source}]`);},e.time,generation);}log(outputLog,`MIDI ${source} · ${mf.events.length} events`);}catch(e){log(outputLog,`MIDI error: ${e.message}`);}}

const assetDrop=$('#assetDrop');
['dragenter','dragover'].forEach(ev=>assetDrop.addEventListener(ev,e=>{e.preventDefault();assetDrop.classList.add('drag');}));
['dragleave','drop'].forEach(ev=>assetDrop.addEventListener(ev,e=>{e.preventDefault();assetDrop.classList.remove('drag');}));
assetDrop.addEventListener('drop',async e=>{for(const f of e.dataTransfer.files)await storeAsset(f);assetDrop.textContent=`${state.assets.size} saved asset${state.assets.size===1?'':'s'} · drop more here`;});

$('#runButton').addEventListener('click',startEngine); $('#panicButton').addEventListener('click',()=>panic(true));
$('#settingsButton').addEventListener('click',()=>$('#settingsDialog').showModal());
$('#fullscreenButton').addEventListener('click',toggleFullscreen);
async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}}

$('#startButton').addEventListener('click',async()=>{
  $('#startError').textContent='';
  try{
    if($('#fullscreenPreference').checked && !document.fullscreenElement){try{await document.documentElement.requestFullscreen();}catch{}}
    await requestMidi(); $('#startOverlay').classList.add('hidden'); startEngine();
  }catch(e){$('#startError').textContent=e.message;}
});

const EXAMPLES=[
  ['Mirror / transpose',`when any note:\n  play +12 velocity input after 60ms\n  play -12 velocity input*0.7 after 130ms`],
  ['Dynamic trigger',`when note C4 velocity 90..127:\n  play [G4 C5 E5] velocity input*0.8 for 500ms`],
  ['Chord trigger',`when chord [C4 E4 G4] within 150ms:\n  play [D5 F#5 A5] velocity 60 for 350ms`],
  ['Accelerating echo',`when any note:\n  play +4 velocity input*0.75 repeat 9 every 420ms accelerate 0.84 for 90ms`],
  ['While a key is held',`while note C4 down every 180ms:\n  play +7 velocity input*0.6 for 80ms`],
  ['While a sequence plays',`sequence answer:\n  play +12 for 160ms\n  wait 200ms\n  play +7 for 160ms\n  wait 200ms\n  play +3 for 220ms\n\nwhen note D4:\n  play sequence answer\n\nwhile sequence answer playing every 220ms:\n  play -12 velocity 35 for 80ms`],
  ['Autonomous process',`every random 2s..5s:\n  play random [C4 D4 E4 G4 A4] velocity 25..55 for 140ms`],
  ['File playback',`when note F4:\n  play midi "gesture.mid"\n\nwhen note G4:\n  play sound "resonance.wav"`]
];
$('#examplesButton').addEventListener('click',()=>{const list=$('#examplesList');list.innerHTML='';for(const [name,code] of EXAMPLES){const d=document.createElement('div');d.className='example';d.innerHTML=`<h3>${escapeHtml(name)}</h3><pre>${escapeHtml(code)}</pre><button type="button">Append to rules</button>`;d.querySelector('button').onclick=()=>{editor.value=editor.value.trimEnd()+`\n\n${code}\n`;savePrefs();$('#examplesDialog').close();};list.appendChild(d);}$('#examplesDialog').showModal();});

$('#exportButton').addEventListener('click',()=>{const blob=new Blob([editor.value],{type:'text/plain'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='performance.rules';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
$('#importInput').addEventListener('change',async e=>{const f=e.target.files[0];if(f){editor.value=await f.text();savePrefs();startEngine();}e.target.value='';});

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

window.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.fullscreenElement){} if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();startEngine();}});
window.addEventListener('beforeunload',()=>panic(false));
