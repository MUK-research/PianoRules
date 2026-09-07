import { DEFAULT_RULES, parseScript, midiToNoteName, velocityMatches, resolveVelocity, resolveTarget, normalizeSectionName } from './dsl.js';
import { parseMidiFile } from './midi-file.js';
import { loadRuleset, rulesetFromLocation, resolveRulesetAssetUrl } from './ruleset-loader.js';

const $=s=>document.querySelector(s);
const editor=$('#editor'), editorHighlight=$('#editorHighlight'), diagnostics=$('#diagnostics'), parseStatus=$('#parseStatus');
const inputLog=$('#inputLog'), outputLog=$('#outputLog');
const heldNotesEl=$('#heldNotes'), ruleFired=$('#ruleFired');
const STORAGE='pianorules.v1';
const nameKey=s=>String(s||'').trim().toLowerCase();

const state={
  midi:null,inputSelection:'all',outputSelection:'',inputChannel:'all',outputChannel:1,
  running:false,rules:[],sequences:new Map(),sections:new Map(),sectionOrder:[],activeSectionName:'',sectionActivatedAt:0,
  held:new Set(),heldInputs:new Map(),noteHistory:[],timers:new Set(),activeAudio:new Set(),
  startedAt:0,likelyEchoes:new Map(),assets:new Map(),remoteAssets:new Map(),assetBaseUrl:'',assetUrls:new Map(),
  chordFire:new Map(),sequencePlaying:new Map(),whileStates:new Map(),
  engineGeneration:0,applyGeneration:0,appliedSource:'',
  rulesetRef:'',rulesetLabel:'',rulesetUrl:'',rulesetBaseUrl:'',rulesetAssetBaseUrl:''
};

function loadPrefs(){try{return JSON.parse(localStorage.getItem(STORAGE)||'{}');}catch{return {};}}
const prefs=loadPrefs();
editor.value=prefs.rules||DEFAULT_RULES;
$('#fullscreenPreference').checked=prefs.fullscreen!==false;
$('#echoGuard').checked=prefs.echoGuard!==false;
$('#echoGuardMs').value=prefs.echoGuardMs??100;
state.inputSelection=prefs.inputSelection||'all';state.outputSelection=prefs.outputSelection||'';
state.inputChannel=prefs.inputChannel||'all';state.outputChannel=prefs.outputChannel||1;

function savePrefs(){
  const previous=loadPrefs();
  localStorage.setItem(STORAGE,JSON.stringify({
    rules:state.rulesetRef?(previous.rules||DEFAULT_RULES):editor.value,fullscreen:$('#fullscreenPreference').checked,echoGuard:$('#echoGuard').checked,
    echoGuardMs:Number($('#echoGuardMs').value)||0,inputSelection:state.inputSelection,outputSelection:state.outputSelection,
    inputChannel:state.inputChannel,outputChannel:state.outputChannel,inputSignature:getPortSignature(findInput(state.inputSelection)),
    outputSignature:getPortSignature(findOutput(state.outputSelection))
  }));
}
function updateEditorState(){
  syncEditorHighlight();
  if(state.running&&editor.value!==state.appliedSource){parseStatus.textContent='changes pending · click Apply changes';$('#runButton').textContent='Apply changes';}
}
editor.addEventListener('input',()=>{savePrefs();updateEditorState();});
editor.addEventListener('scroll',syncEditorScroll);
['fullscreenPreference','echoGuard','echoGuardMs'].forEach(id=>$('#'+id).addEventListener('change',savePrefs));

for(let i=1;i<=16;i++){$('#inputChannel').insertAdjacentHTML('beforeend',`<option value="${i}">${i}</option>`);$('#outputChannel').insertAdjacentHTML('beforeend',`<option value="${i}">${i}</option>`);}
$('#inputChannel').value=state.inputChannel;$('#outputChannel').value=String(state.outputChannel);

function getPortSignature(p){return p?`${p.manufacturer||''}|${p.name||''}`:'';}
function findInput(id){return id==='all'?null:state.midi?.inputs.get(id);}
function findOutput(id){return id==='all'?null:state.midi?.outputs.get(id);}
function findBySignature(map,sig){if(!sig)return null;return[...map.values()].find(p=>getPortSignature(p)===sig);}

async function requestMidi(){
  if(!navigator.requestMIDIAccess)throw new Error('This browser does not expose Web MIDI. Use a Web-MIDI-capable desktop browser (Chrome/Edge are the safest choice).');
  state.midi=await navigator.requestMIDIAccess({sysex:false});state.midi.onstatechange=()=>refreshPorts();refreshPorts(true);await loadAssets();
}
function refreshPorts(first=false){
  if(!state.midi)return;
  const inSel=$('#inputSelect'),outSel=$('#outputSelect');
  inSel.innerHTML='<option value="all">All MIDI inputs</option>';outSel.innerHTML='<option value="">No MIDI output</option><option value="all">All MIDI outputs</option>';
  for(const p of state.midi.inputs.values())inSel.add(new Option(`${p.name}${p.manufacturer?` — ${p.manufacturer}`:''}`,p.id));
  for(const p of state.midi.outputs.values())outSel.add(new Option(`${p.name}${p.manufacturer?` — ${p.manufacturer}`:''}`,p.id));
  if(first){
    if(state.inputSelection!=='all'&&!state.midi.inputs.has(state.inputSelection)){const p=findBySignature(state.midi.inputs,prefs.inputSignature);state.inputSelection=p?p.id:'all';}
    if(state.outputSelection&&state.outputSelection!=='all'&&!state.midi.outputs.has(state.outputSelection)){const p=findBySignature(state.midi.outputs,prefs.outputSignature);if(p)state.outputSelection=p.id;}
    if(!state.outputSelection&&state.midi.outputs.size===1)state.outputSelection=[...state.midi.outputs.keys()][0];
  }
  if(![...inSel.options].some(o=>o.value===state.inputSelection))state.inputSelection='all';
  if(![...outSel.options].some(o=>o.value===state.outputSelection))state.outputSelection='';
  inSel.value=state.inputSelection;outSel.value=state.outputSelection;attachInputListeners();updateDeviceLabels();savePrefs();
  $('#midiDot').classList.toggle('on',state.midi.inputs.size>0||state.midi.outputs.size>0);
  $('#midiFooter').textContent=`${state.midi.inputs.size} input${state.midi.inputs.size===1?'':'s'} · ${state.midi.outputs.size} output${state.midi.outputs.size===1?'':'s'}`;
}
function attachInputListeners(){if(!state.midi)return;for(const p of state.midi.inputs.values())p.onmidimessage=null;for(const p of state.midi.inputs.values())if(state.inputSelection==='all'||p.id===state.inputSelection)p.onmidimessage=e=>handleMidi(e,p);}
function selectedOutputs(){if(!state.midi)return[];if(state.outputSelection==='all')return[...state.midi.outputs.values()];const p=state.midi.outputs.get(state.outputSelection);return p?[p]:[];}
function updateDeviceLabels(){const ins=state.inputSelection==='all'?'all inputs':findInput(state.inputSelection)?.name||'no device';const outs=state.outputSelection==='all'?'all outputs':findOutput(state.outputSelection)?.name||'no output';$('#inputDeviceLabel').textContent=ins;$('#outputDeviceLabel').textContent=outs;}
$('#inputSelect').addEventListener('change',e=>{state.inputSelection=e.target.value;attachInputListeners();updateDeviceLabels();savePrefs();});
$('#outputSelect').addEventListener('change',e=>{state.outputSelection=e.target.value;updateDeviceLabels();savePrefs();});
$('#inputChannel').addEventListener('change',e=>{state.inputChannel=e.target.value;savePrefs();});
$('#outputChannel').addEventListener('change',e=>{state.outputChannel=Number(e.target.value);savePrefs();});
$('#refreshMidiButton').addEventListener('click',()=>refreshPorts());

function timeLabel(){if(!state.startedAt)return'--:--.---';const ms=performance.now()-state.startedAt,m=Math.floor(ms/60000),s=Math.floor(ms/1000)%60,x=Math.floor(ms)%1000;return`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(x).padStart(3,'0')}`;}
setInterval(()=>$('#clock').textContent=timeLabel(),30);
function log(el,text){const row=document.createElement('div');row.className='log-row';row.innerHTML=`<span class="time">${timeLabel()}</span><span></span>`;row.lastElementChild.textContent=text;el.prepend(row);while(el.children.length>120)el.lastElementChild.remove();}
function setHeld(){const notes=[...new Set([...state.heldInputs.values()].map(x=>x.note))].sort((a,b)=>a-b);state.held=new Set(notes);heldNotesEl.innerHTML=notes.map(n=>`<span class="chip">${midiToNoteName(n)}</span>`).join('');}
function markLikelyEcho(note,channel,phase='on'){const key=`${channel}:${note}`,rec=state.likelyEchoes.get(key)||{};rec[phase]=performance.now();state.likelyEchoes.set(key,rec);}
function isLikelyEcho(note,channel,phase='on'){if(!$('#echoGuard').checked)return false;const rec=state.likelyEchoes.get(`${channel}:${note}`),t=rec?.[phase];return t!=null&&performance.now()-t<=Number($('#echoGuardMs').value||100);}

function handleMidi(event,port){
  const[status,d1,d2=0]=event.data,type=status&0xf0,channel=(status&0x0f)+1;if(state.inputChannel!=='all'&&Number(state.inputChannel)!==channel)return;
  if(type===0x90&&d2>0){
    const echo=isLikelyEcho(d1,channel,'on');$('#inputHero').textContent=midiToNoteName(d1);$('#inputVelocity').textContent=`velocity ${d2} · ch ${channel}`;log(inputLog,`${midiToNoteName(d1)}  vel ${d2}  ch ${channel}${echo?'  [echo ignored]':''}`);if(echo)return;
    const now=performance.now(),ctx={note:d1,velocity:d2,channel,time:now};state.heldInputs.set(`${channel}:${d1}`,ctx);setHeld();state.noteHistory.push(ctx);state.noteHistory=state.noteHistory.filter(x=>now-x.time<1500);
    if(state.running){processNote(d1,d2,channel,now);refreshWhileRules(ctx);}
  }else if(type===0x80||(type===0x90&&d2===0)){
    const echo=isLikelyEcho(d1,channel,'off');log(inputLog,`${midiToNoteName(d1)} off  ch ${channel}${echo?'  [echo ignored]':''}`);if(echo)return;state.heldInputs.delete(`${channel}:${d1}`);setHeld();if(state.running)refreshWhileRules();
  }else if(type===0xb0)log(inputLog,`CC ${d1} = ${d2}  ch ${channel}`);else log(inputLog,`0x${status.toString(16)} ${d1} ${d2}`);
}
function processNote(note,velocity,channel,now){
  for(const rule of state.rules){
    const tr=rule.trigger;if(tr.kind==='note'&&(tr.any||tr.note===note)&&velocityMatches(tr.velocity,velocity))fireRule(rule,{note,velocity,channel});
    if(tr.kind==='chord'){const recent=state.noteHistory.filter(x=>now-x.time<=tr.within),found=tr.notes.map(n=>[...recent].reverse().find(x=>x.note===n));if(found.every(Boolean)&&found.every(x=>velocityMatches(tr.velocity,x.velocity))){const last=state.chordFire.get(rule.id)||0;if(now-last>tr.within){state.chordFire.set(rule.id,now);fireRule(rule,{note,velocity,channel,chord:found});}}}
  }
}

function whileConditionContext(trigger,preferredCtx=null){
  if(trigger.kind==='whileNote'){
    const candidates=[...state.heldInputs.values()].filter(x=>x.time>=state.sectionActivatedAt&&(trigger.any||x.note===trigger.note)&&velocityMatches(trigger.velocity,x.velocity));
    if(!candidates.length)return null;if(preferredCtx&&preferredCtx.time>=state.sectionActivatedAt&&candidates.some(x=>x.note===preferredCtx.note&&x.channel===preferredCtx.channel))return preferredCtx;return candidates[candidates.length-1];
  }
  if(trigger.kind==='whileSequence'){const active=state.sequencePlaying.get(nameKey(trigger.name));return active?.count>0?active.ctx:null;}
  return null;
}
function whileGuard(ruleId,epoch){return()=>{const ws=state.whileStates.get(ruleId);return!!ws?.active&&ws.epoch===epoch;};}
function refreshWhileRules(preferredCtx=null){
  if(!state.running)return;const generation=state.engineGeneration;
  for(const rule of state.rules){const tr=rule.trigger;if(tr.kind!=='whileNote'&&tr.kind!=='whileSequence')continue;const ctx=whileConditionContext(tr,preferredCtx);let ws=state.whileStates.get(rule.id);if(!ws){ws={active:false,epoch:0,ctx:null};state.whileStates.set(rule.id,ws);}
    if(ctx&&!ws.active){ws.active=true;ws.epoch++;ws.ctx=ctx;const epoch=ws.epoch,guard=whileGuard(rule.id,epoch);fireRule(rule,ctx,generation,guard);if(tr.every)recurringWhile(rule,tr.every,generation,epoch);}
    else if(ctx&&ws.active)ws.ctx=ctx;else if(!ctx&&ws.active){ws.active=false;ws.epoch++;ws.ctx=null;}
  }
}
function recurringWhile(rule,interval,generation,epoch){const guard=whileGuard(rule.id,epoch);schedule(()=>{const ws=state.whileStates.get(rule.id);if(!ws?.ctx)return;fireRule(rule,ws.ctx,generation,guard);recurringWhile(rule,interval,generation,epoch);},interval,generation,guard);}
function beginSequenceState(name,ctx,generation){if(!state.running||state.engineGeneration!==generation)return;const key=nameKey(name),current=state.sequencePlaying.get(key)||{count:0,ctx};current.count++;current.ctx=ctx;state.sequencePlaying.set(key,current);refreshWhileRules(ctx);}
function endSequenceState(name,generation){if(state.engineGeneration!==generation)return;const key=nameKey(name),current=state.sequencePlaying.get(key);if(!current)return;current.count=Math.max(0,current.count-1);if(current.count===0)state.sequencePlaying.delete(key);else state.sequencePlaying.set(key,current);refreshWhileRules();}

function addTimer(id){state.timers.add(id);return id;}
function schedule(fn,ms,generation=state.engineGeneration,guard=null){const id=setTimeout(()=>{state.timers.delete(id);if(state.running&&state.engineGeneration===generation&&(!guard||guard()))fn();},Math.max(0,ms));return addTimer(id);}
function clearTimers(){for(const id of state.timers)clearTimeout(id);state.timers.clear();}
function stopActiveAudio(){for(const a of state.activeAudio){try{a.pause();a.currentTime=0;}catch{}}state.activeAudio.clear();}
function sendAllNotesOff(){for(let ch=1;ch<=16;ch++){sendBytes([0xb0+(ch-1),123,0]);sendBytes([0xb0+(ch-1),120,0]);}}

function findSection(name){return state.sections.get(normalizeSectionName(name));}
function activateSection(name,reason=''){
  const section=findSection(name);if(!section){log(outputLog,`unknown section ${name}`);return false;}
  // A section change is a hard reset of musical processes, but not of MIDI configuration or the editor.
  state.engineGeneration++;clearTimers();stopActiveAudio();sendAllNotesOff();state.sequencePlaying.clear();state.whileStates.clear();state.noteHistory=[];state.chordFire.clear();
  state.activeSectionName=section.name;state.rules=section.rules;state.sequences=new Map([...section.sequences.entries()].map(([key,seq])=>[key,seq.actions]));
  state.startedAt=performance.now();state.sectionActivatedAt=state.startedAt;updateActiveSectionUI();
  const generation=state.engineGeneration;
  for(const rule of state.rules){const tr=rule.trigger;if(tr.kind==='after')schedule(()=>fireRule(rule,{note:60,velocity:64,channel:state.outputChannel},generation),tr.delay,generation);if(tr.kind==='every')recurring(rule,tr.interval,tr.interval,generation);if(tr.kind==='everyRandom')recurringRandom(rule,tr.min,tr.max,generation);}
  refreshWhileRules();
  parseStatus.textContent=`${section.name} · ${state.rules.length} rules · ${state.sequences.size} sequences`;
  ruleFired.textContent=`section “${section.name}” active — waiting for a trigger…`;
  if(reason)log(outputLog,`section → ${section.name}${reason?`  [${reason}]`:''}`);
  return true;
}
function updateActiveSectionUI(){const label=state.activeSectionName||'—';$('#activeSectionBadge').textContent=`section ${label}`;syncEditorHighlight();}

async function startEngine(preferredSection=''){
  const source=editor.value,applyGeneration=++state.applyGeneration;savePrefs();const parsed=parseScript(source);
  diagnostics.innerHTML=parsed.errors.map(e=>`<div>${escapeHtml(e)}</div>`).join('');panic(true);state.rules=[];state.sequences=new Map();state.sections=new Map();state.sectionOrder=[];state.activeSectionName='';state.remoteAssets.clear();
  if(parsed.errors.length){parseStatus.textContent=`${parsed.errors.length} error${parsed.errors.length>1?'s':''} · rules stopped`;$('#runButton').textContent='Fix & run rules';ruleFired.textContent='rules not running — fix the errors above';updateActiveSectionUI();return false;}

  const runButton=$('#runButton');runButton.disabled=true;runButton.textContent='Loading assets…';parseStatus.textContent='preloading referenced assets…';
  const assetErrors=await preloadReferencedAssets(parsed,state.rulesetBaseUrl);
  if(applyGeneration!==state.applyGeneration)return false;
  runButton.disabled=false;
  if(assetErrors.length){
    diagnostics.innerHTML=assetErrors.map(e=>`<div>${escapeHtml(e)}</div>`).join('');
    parseStatus.textContent=`${assetErrors.length} asset error${assetErrors.length>1?'s':''} · rules stopped`;runButton.textContent='Retry assets & run';ruleFired.textContent='rules not running — referenced assets are not ready';updateActiveSectionUI();return false;
  }

  state.sections=parsed.sections;state.sectionOrder=parsed.sectionOrder;state.assetBaseUrl=parsed.assetBaseUrl||'';state.assetUrls=new Map(parsed.assetUrls);state.appliedSource=source;state.running=true;
  $('#engineStatus').textContent='running';$('#engineStatus').className='status running';runButton.textContent='Restart rules';
  const first=preferredSection&&findSection(preferredSection)?findSection(preferredSection).name:(state.sectionOrder[0]||'Main');
  activateSection(first);
  return true;
}
function recurring(rule,first,interval,generation=state.engineGeneration){schedule(()=>{fireRule(rule,{note:60,velocity:64,channel:state.outputChannel},generation);recurring(rule,interval,interval,generation);},first,generation);}
function recurringRandom(rule,min,max,generation=state.engineGeneration){const delay=min+Math.random()*(max-min);schedule(()=>{fireRule(rule,{note:60,velocity:64,channel:state.outputChannel},generation);recurringRandom(rule,min,max,generation);},delay,generation);}

async function fireRule(rule,ctx,generation=state.engineGeneration,guard=null){if(!state.running||state.engineGeneration!==generation||(guard&&!guard()))return;ruleFired.textContent=`${state.activeSectionName} · line ${rule.line}: ${describeTrigger(rule.trigger)}`;let cursor=0;for(const action of rule.actions){if(action.kind==='wait'){cursor+=action.duration;continue;}executeAction(action,ctx,cursor,generation,guard);}}
function describeTrigger(t){if(t.kind==='note')return t.any?'any note':midiToNoteName(t.note);if(t.kind==='chord')return`chord ${t.notes.map(midiToNoteName).join(' ')}`;if(t.kind==='after')return`after start ${t.delay}ms`;if(t.kind==='every')return`every ${t.interval}ms`;if(t.kind==='everyRandom')return`random timer ${t.min}–${t.max}ms`;if(t.kind==='whileNote')return`while ${t.any?'any note':midiToNoteName(t.note)} is down${t.every?` · every ${t.every}ms`:''}`;if(t.kind==='whileSequence')return`while sequence ${t.name} is playing${t.every?` · every ${t.every}ms`:''}`;return t.kind;}
function noteActionDuration(action){let interval=action.every||0,lastStart=action.after||0;for(let i=1;i<action.repeat;i++){lastStart+=interval;interval*=action.accelerate||1;}return lastStart+(action.duration||0);}
function sequenceDuration(name,stack=[]){const key=nameKey(name);if(stack.includes(key))return 0;const actions=state.sequences.get(key);if(!actions)return 0;let cursor=0,maxEnd=0;for(const action of actions){if(action.kind==='wait'){cursor+=action.duration;maxEnd=Math.max(maxEnd,cursor);continue;}let end=cursor;if(action.kind==='notes')end+=noteActionDuration(action);else if(action.kind==='sequence')end+=sequenceDuration(action.name,[...stack,key]);else end+=1;maxEnd=Math.max(maxEnd,end);}return Math.max(1,maxEnd);}

function executeAction(action,ctx,baseDelay=0,generation=state.engineGeneration,guard=null){
  if(action.kind==='panic'){schedule(()=>panic(false),baseDelay,generation,guard);return;}
  if(action.kind==='section'){schedule(()=>activateSection(action.name,`line ${action.line}`),baseDelay,generation,guard);return;}
  if(action.kind==='sequence'){
    const actions=state.sequences.get(nameKey(action.name));if(!actions){log(outputLog,`unknown sequence ${action.name}`);return;}const duration=sequenceDuration(action.name);
    schedule(()=>{beginSequenceState(action.name,ctx,generation);schedule(()=>endSequenceState(action.name,generation),duration,generation);},baseDelay,generation,guard);
    let cursor=baseDelay;for(const a of actions){if(a.kind==='wait')cursor+=a.duration;else executeAction(a,ctx,cursor,generation,guard);}return;
  }
  if(action.kind==='sound'){schedule(()=>playSound(action.source,generation),baseDelay,generation,guard);return;}
  if(action.kind==='midi'){schedule(()=>playMidiAsset(action.source,generation),baseDelay,generation,guard);return;}
  if(action.kind!=='notes')return;
  let interval=action.every||0,elapsed=baseDelay+(action.after||0);
  for(let i=0;i<action.repeat;i++){schedule(()=>{let targets=action.targets;if(action.random)targets=[targets[Math.floor(Math.random()*targets.length)]];for(const target of targets){const note=resolveTarget(target,ctx.note??60),vel=resolveVelocity(action.velocity,ctx.velocity??64),ch=action.channel||state.outputChannel||1;sendNote(note,vel,ch,action.duration);}},elapsed,generation,guard);elapsed+=interval;interval*=action.accelerate||1;}
}

function sendBytes(bytes,timestamp){for(const out of selectedOutputs())out.send(bytes,timestamp);}
function sendNote(note,velocity,channel=1,duration=220){const status=0x90+((channel-1)&15),off=0x80+((channel-1)&15);markLikelyEcho(note,channel,'on');sendBytes([status,note,velocity]);$('#outputHero').textContent=midiToNoteName(note);$('#outputVelocity').textContent=`velocity ${velocity} · ch ${channel}`;log(outputLog,`${midiToNoteName(note)}  vel ${velocity}  ch ${channel}`);const id=setTimeout(()=>{markLikelyEcho(note,channel,'off');sendBytes([off,note,0]);state.timers.delete(id);},Math.max(10,duration));state.timers.add(id);}
function panic(stopEngine=true){if(stopEngine)state.engineGeneration++;clearTimers();stopActiveAudio();state.sequencePlaying.clear();state.whileStates.clear();sendAllNotesOff();if(stopEngine){state.running=false;state.activeSectionName='';$('#engineStatus').textContent='stopped';$('#engineStatus').className='status stopped';$('#runButton').textContent='Run rules';updateActiveSectionUI();}}

async function openDb(){return await new Promise((res,rej)=>{const r=indexedDB.open('pianorules-assets',1);r.onupgradeneeded=()=>r.result.createObjectStore('assets',{keyPath:'name'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function storeAsset(file){const db=await openDb(),data=await file.arrayBuffer();await new Promise((res,rej)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put({name:file.name,type:file.type||guessType(file.name),data,updated:Date.now()});tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});state.assets.set(file.name,{name:file.name,type:file.type||guessType(file.name),data});log(outputLog,`asset stored: ${file.name}`);}
async function loadAssets(){try{const db=await openDb(),rows=await new Promise((res,rej)=>{const r=db.transaction('assets').objectStore('assets').getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});rows.forEach(x=>state.assets.set(x.name,x));if(rows.length)$('#assetDrop').textContent=`${rows.length} saved local asset${rows.length===1?'':'s'} · drop more here`;}catch{}}
function guessType(n){if(/\.mid(i)?(?:$|[?#])/i.test(n))return'audio/midi';if(/\.wav(?:$|[?#])/i.test(n))return'audio/wav';if(/\.mp3(?:$|[?#])/i.test(n))return'audio/mpeg';if(/\.m4a(?:$|[?#])/i.test(n))return'audio/mp4';if(/\.ogg(?:$|[?#])/i.test(n))return'audio/ogg';return'application/octet-stream';}
function isAbsoluteUrl(value){try{const u=new URL(value,location.href);return /^https?:$/i.test(u.protocol)&&/^[a-z][a-z0-9+.-]*:/i.test(String(value));}catch{return false;}}
function resolveRemoteAssetUrl(source,parsed,rulesBaseUrl=''){return resolveRulesetAssetUrl(source,parsed,rulesBaseUrl,location.href);}

function collectReferencedAssets(parsed){
  const refs=new Set();
  const scan=actions=>{for(const action of actions){if(action.kind==='sound'||action.kind==='midi')refs.add(action.source);}};
  for(const section of parsed.sections.values()){for(const rule of section.rules)scan(rule.actions);for(const seq of section.sequences.values())scan(seq.actions);}
  return [...refs];
}
async function fetchAsset(url, name) {
  const resp = await fetch(url, { cache: 'no-cache' });

  if (!resp.ok)
    throw new Error(`${resp.status} ${resp.statusText}`);

  return {
    name,
    type: resp.headers.get('content-type') || guessType(name || url),
    data: await resp.arrayBuffer(),
    url
  };
}
async function preloadReferencedAssets(parsed,rulesBaseUrl=''){
  state.remoteAssets.clear();const refs=collectReferencedAssets(parsed),errors=[];let loaded=0;
  for(const source of refs){
    const url=resolveRemoteAssetUrl(source,parsed,rulesBaseUrl);
    if(url){
      try{const asset=await fetchAsset(url,source);state.remoteAssets.set(source,asset);loaded++;log(outputLog,`asset ready: ${source}`);}
      catch(e){errors.push(`Could not preload “${source}” from ${url}: ${e.message}. Check that the file exists in the deployed GitHub Pages version
and that capitalization matches exactly.`);}
      continue;
    }
    if(state.assets.has(source)){loaded++;continue;}
    errors.push(`Asset “${source}” is referenced but is neither stored locally nor resolvable from an assets declaration.`);
  }
  if(refs.length)$('#assetDrop').textContent=`${loaded}/${refs.length} referenced assets ready · drop local files here`;
  return errors;
}
async function getAsset(source){
  if(state.remoteAssets.has(source))return state.remoteAssets.get(source);
  if(state.assets.has(source))return state.assets.get(source);
  // Direct URLs remain usable even when an action was introduced programmatically.
  if(isAbsoluteUrl(source))return await fetchAsset(source,source);
  throw new Error(`Asset “${source}” was not preloaded`);
}
async function playSound(source,generation=state.engineGeneration){try{const a=await getAsset(source);if(!state.running||state.engineGeneration!==generation)return;const blob=new Blob([a.data],{type:a.type}),url=URL.createObjectURL(blob),audio=new Audio(url);state.activeAudio.add(audio);const done=()=>{state.activeAudio.delete(audio);URL.revokeObjectURL(url);};audio.addEventListener('ended',done,{once:true});audio.addEventListener('error',done,{once:true});await audio.play();log(outputLog,`sound ${source}`);}catch(e){log(outputLog,`sound error: ${e.message}`);}}
async function playMidiAsset(source,generation=state.engineGeneration){try{const a=await getAsset(source);if(!state.running||state.engineGeneration!==generation)return;const mf=parseMidiFile(a.data);for(const e of mf.events){schedule(()=>{const ch=e.channel||state.outputChannel,status=(e.status==='on'?0x90:0x80)+((ch-1)&15);markLikelyEcho(e.note,ch,e.status==='on'?'on':'off');sendBytes([status,e.note,e.status==='on'?e.velocity:0]);$('#outputHero').textContent=midiToNoteName(e.note);$('#outputVelocity').textContent=`${e.status==='on'?`velocity ${e.velocity}`:'off'} · ch ${ch}`;log(outputLog,`${midiToNoteName(e.note)} ${e.status==='on'?`vel ${e.velocity}`:'off'}  [${source}]`);},e.time,generation);}log(outputLog,`MIDI ${source} · ${mf.events.length} events`);}catch(e){log(outputLog,`MIDI error: ${e.message}`);}}


function clearRulesetContext(){
  state.rulesetRef='';state.rulesetLabel='';state.rulesetUrl='';state.rulesetBaseUrl='';state.rulesetAssetBaseUrl='';
  const badge=$('#rulesetBadge');if(badge){badge.hidden=true;badge.textContent='';badge.removeAttribute('title');}
  document.title='PianoRules — browser MIDI rule engine';
}
function showRulesetContext(info){
  state.rulesetRef=info.ref;state.rulesetLabel=info.label;state.rulesetUrl=info.url;state.rulesetBaseUrl=info.baseUrl;state.rulesetAssetBaseUrl=info.assetBaseUrl;
  const badge=$('#rulesetBadge');if(badge){badge.hidden=false;badge.textContent=info.label;badge.title=info.url;}
  document.title=`PianoRules — ${info.label}`;
}
async function initializeRulesetFromQuery(){
  const ref=rulesetFromLocation();if(!ref)return;
  const startButton=$('#startButton');startButton.disabled=true;startButton.textContent='LOADING RULESET…';
  $('#startError').textContent='';parseStatus.textContent='loading shared ruleset…';
  try{
    const info=await loadRuleset(ref,{appUrl:location.href});
    showRulesetContext(info);editor.value=info.source;state.appliedSource='';
    syncEditorHighlight();updateActiveSectionUI();
    parseStatus.textContent=`loaded ${info.label} · ready to start`;
    ruleFired.textContent=`ruleset “${info.label}” loaded — press Start Performance`;
  }catch(error){
    clearRulesetContext();
    const message=`Ruleset could not be loaded: ${error.message}`;
    $('#startError').textContent=message;diagnostics.innerHTML=`<div>${escapeHtml(message)}</div>`;parseStatus.textContent='ruleset load failed · local rules kept';
  }finally{startButton.disabled=false;startButton.textContent='START PERFORMANCE';}
}

const assetDrop=$('#assetDrop');['dragenter','dragover'].forEach(ev=>assetDrop.addEventListener(ev,e=>{e.preventDefault();assetDrop.classList.add('drag');}));['dragleave','drop'].forEach(ev=>assetDrop.addEventListener(ev,e=>{e.preventDefault();assetDrop.classList.remove('drag');}));assetDrop.addEventListener('drop',async e=>{for(const f of e.dataTransfer.files)await storeAsset(f);assetDrop.textContent=`${state.assets.size} saved asset${state.assets.size===1?'':'s'} · drop more here`;});

$('#runButton').addEventListener('click',()=>{void startEngine();});$('#panicButton').addEventListener('click',()=>panic(true));$('#settingsButton').addEventListener('click',()=>$('#settingsDialog').showModal());$('#fullscreenButton').addEventListener('click',toggleFullscreen);
async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}}
$('#startButton').addEventListener('click',async()=>{$('#startError').textContent='';try{if($('#fullscreenPreference').checked&&!document.fullscreenElement){try{await document.documentElement.requestFullscreen();}catch{}}await requestMidi();$('#startOverlay').classList.add('hidden');await startEngine();}catch(e){$('#startError').textContent=e.message;}});

const EXAMPLES=[
 ['Mirror / transpose',`when any note:\n  play +12 velocity input after 60ms\n  play -12 velocity input*0.7 after 130ms`],
 ['Dynamic trigger',`when note C4 velocity 90..127:\n  play [G4 C5 E5] velocity input*0.8 for 500ms`],
 ['Chord trigger',`when chord [C4 E4 G4] within 150ms:\n  play [D5 F#5 A5] velocity 60 for 350ms`],
 ['Accelerating echo',`when any note:\n  play +4 velocity input*0.75 repeat 9 every 420ms accelerate 0.84 for 90ms`],
 ['While any key is held',`while any note down every 160ms:\n  play +7 velocity input*0.4 for 70ms`],
 ['While a sequence plays',`sequence answer:\n  play +12 for 160ms\n  wait 200ms\n  play +7 for 160ms\n\nwhen note D4:\n  play sequence answer\n\nwhile sequence answer playing every 220ms:\n  play -12 velocity 35 for 80ms`],
 ['Section change',`when note C7:\n  go to section Next Section`],
 ['Autonomous process',`every random 2s..5s:\n  play random [C4 D4 E4 G4 A4] velocity 25..55 for 140ms`],
 ['File playback',`when note F4:\n  play midi "gesture.mid"\n\nwhen note G4:\n  play sound "resonance.wav"`]
];
function insertExample(code){
  const src=editor.value,lines=src.split('\n'),headers=[];lines.forEach((line,i)=>{const m=line.match(/^\s*section\s+(.+):\s*$/i);if(m)headers.push({i,name:m[1].trim()});});
  if(!headers.length){editor.value=src.trimEnd()+`\n\n${code}\n`;return;}
  const activeKey=normalizeSectionName(state.activeSectionName||headers[0].name);let idx=headers.findIndex(h=>normalizeSectionName(h.name)===activeKey);if(idx<0)idx=0;const insertAt=idx+1<headers.length?headers[idx+1].i:lines.length;const indented=code.split('\n').map(l=>l?'  '+l:'').join('\n');lines.splice(insertAt,0,'',indented,'');editor.value=lines.join('\n');
}
$('#examplesButton').addEventListener('click',()=>{const list=$('#examplesList');list.innerHTML='';for(const[name,code]of EXAMPLES){const d=document.createElement('div');d.className='example';d.innerHTML=`<h3>${escapeHtml(name)}</h3><pre>${escapeHtml(code)}</pre><button type="button">Add to current section</button>`;d.querySelector('button').onclick=()=>{insertExample(code);savePrefs();updateEditorState();$('#examplesDialog').close();};list.appendChild(d);}$('#examplesDialog').showModal();});
$('#exportButton').addEventListener('click',()=>{const blob=new Blob([editor.value],{type:'text/plain'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='performance.rules';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});
$('#importInput').addEventListener('change',async e=>{const f=e.target.files[0];if(f){clearRulesetContext();editor.value=await f.text();savePrefs();syncEditorHighlight();await startEngine();}e.target.value='';});

function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function sectionRanges(source){
  const lines=source.replace(/\r/g,'').split('\n'),heads=[];lines.forEach((line,i)=>{const m=line.match(/^\s*section\s+(.+):\s*(?:#.*)?$/i);if(m)heads.push({start:i,name:m[1].trim()});});
  if(!heads.length)return{lines,ranges:[{start:0,end:lines.length-1,name:'Main'}]};
  return{lines,ranges:heads.map((h,i)=>({...h,end:(heads[i+1]?.start??lines.length)-1}))};
}
function syncEditorHighlight(){
  if(!editorHighlight)return;const{lines,ranges}=sectionRanges(editor.value),active=normalizeSectionName(state.activeSectionName||ranges[0]?.name||'Main');
  const activeRange=ranges.find(r=>normalizeSectionName(r.name)===active)||null;
  editorHighlight.innerHTML=lines.map((line,i)=>{const range=ranges.find(r=>i>=r.start&&i<=r.end),isActive=!!activeRange&&i>=activeRange.start&&i<=activeRange.end,isHeader=/^\s*section\s+.+:\s*(?:#.*)?$/i.test(line);return`<span class="editor-line${isActive?' active-section':''}${isHeader?' section-header':''}" data-section="${range?escapeHtml(range.name):''}">${line?escapeHtml(line):'&nbsp;'}</span>`;}).join('');
  syncEditorScroll();
}
async function activateSectionFromEditorClick(){
  const before=editor.value.slice(0,editor.selectionStart),line=Math.max(0,before.split('\n').length-1);
  const {ranges}=sectionRanges(editor.value),range=ranges.find(r=>line>=r.start&&line<=r.end);if(!range)return;
  const target=range.name,pending=editor.value!==state.appliedSource;
  if(state.running&&!pending&&normalizeSectionName(target)===normalizeSectionName(state.activeSectionName))return;
  if(!state.running||pending){await startEngine(target);return;}
  activateSection(target,'editor click');
}
editor.addEventListener('click',()=>{void activateSectionFromEditorClick();});

function syncEditorScroll(){if(!editorHighlight)return;editorHighlight.scrollTop=editor.scrollTop;editorHighlight.scrollLeft=editor.scrollLeft;}

window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();void startEngine();}});window.addEventListener('beforeunload',()=>panic(false));
syncEditorHighlight();updateActiveSectionUI();
void initializeRulesetFromQuery();
