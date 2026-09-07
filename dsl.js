export const DEFAULT_RULES = `# PianoRules — one piece can contain several independent sections.
# Only one section runs at a time. The first section is active by default.
# Optional remote asset folder:
# assets from "./assets/"

section Opening:
  when any note:
    play +4 velocity input after 120ms

  # Hold any key to sustain a generative process.
  while any note down every 160ms:
    play +7 velocity input*0.45 for 70ms

  # A trigger can move the piece to another section.
  when note C7:
    go to section Echoes

section Echoes:
  when any note velocity 45..127:
    play +4 velocity input*0.75 repeat 7 every 360ms accelerate 0.82 for 100ms

  every random 3s..7s:
    play random [C5 D5 E5 G5 A5] velocity 25..50 for 140ms

  sequence answer:
    play +12 velocity input*0.8 for 130ms
    wait 160ms
    play +7 velocity input*0.7 for 130ms
    wait 160ms
    play +3 velocity input*0.6 for 180ms

  when note D4:
    play sequence answer

  while sequence answer playing every 300ms:
    play -12 velocity 35 for 100ms

  when note C1:
    go to section Opening

# Drop files onto the bottom bar, then refer to them by filename:
#   when note F4:
#     play midi "gesture.mid"
#     play sound "resonance.wav"
`;

const NOTE_BASE = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

export function noteNameToMidi(value) {
  if (typeof value === 'number') return clamp(Math.round(value), 0, 127);
  const s = String(value).trim();
  if (/^\d{1,3}$/.test(s)) return clamp(Number(s), 0, 127);
  const m = s.match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!m) throw new Error(`Invalid note “${value}”`);
  let pc = NOTE_BASE[m[1].toUpperCase()];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  const octave = Number(m[3]);
  return clamp((octave + 1) * 12 + pc, 0, 127);
}

export function midiToNoteName(n) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  n = clamp(Math.round(n), 0, 127);
  return `${names[n % 12]}${Math.floor(n / 12) - 1}`;
}

export function parseTime(s) {
  const m = String(s).trim().match(/^([\d.]+)\s*(ms|s)$/i);
  if (!m) throw new Error(`Invalid time “${s}”; use e.g. 250ms or 2.5s`);
  return Number(m[1]) * (m[2].toLowerCase() === 's' ? 1000 : 1);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function stripQuotes(s) { return s?.replace(/^(['"])(.*)\1$/, '$2'); }
function splitList(s) { return s.trim().replace(/^\[/,'').replace(/\]$/,'').split(/[\s,]+/).filter(Boolean); }
function sectionKey(name){ return String(name).trim().toLowerCase(); }
function indentation(raw){
  const lead=raw.match(/^[\t ]*/)?.[0]||'';
  return [...lead].reduce((n,c)=>n+(c==='\t'?2:1),0);
}

function parseVelocitySpec(text) {
  if (!text) return null;
  const s = text.trim();
  if (s === 'input') return { type:'input', factor:1 };
  let m = s.match(/^input\*([\d.]+)$/);
  if (m) return { type:'input', factor:Number(m[1]) };
  m = s.match(/^(\d+)\.\.(\d+)$/);
  if (m) return { type:'range', min:Number(m[1]), max:Number(m[2]) };
  if (/^\d+$/.test(s)) return { type:'fixed', value:Number(s) };
  throw new Error(`Invalid velocity “${text}”`);
}

function parseTarget(raw) {
  const s = raw.trim();
  if (/^[+-]\d+$/.test(s)) return { type:'relative', semitones:Number(s) };
  return { type:'absolute', note:noteNameToMidi(s) };
}
function parseTargets(raw) { return splitList(raw).map(parseTarget); }
function parseWhileEvery(value) { return value ? parseTime(value) : null; }

function parseTrigger(header, lineNo) {
  // Keep the while grammar deliberately explicit. These forms are checked first
  // so "while any note down every 160ms" cannot be swallowed by a more general rule.
  let m = header.match(/^while\s+any\s+note\s+down\s+every\s+(\S+)$/i);
  if (m) return { kind:'whileNote', any:true, velocity:null, every:parseWhileEvery(m[1]), line:lineNo };

  m = header.match(/^while\s+any\s+note\s+down\s+velocity\s+(\S+)\s+every\s+(\S+)$/i);
  if (m) return { kind:'whileNote', any:true, velocity:parseVelocitySpec(m[1]), every:parseWhileEvery(m[2]), line:lineNo };

  m = header.match(/^while\s+any\s+note\s+down(?:\s+velocity\s+(\S+))?$/i);
  if (m) return { kind:'whileNote', any:true, velocity:parseVelocitySpec(m[1]), every:null, line:lineNo };

  m = header.match(/^while\s+note\s+(\S+)\s+down\s+every\s+(\S+)$/i);
  if (m) return { kind:'whileNote', any:false, note:noteNameToMidi(m[1]), velocity:null, every:parseWhileEvery(m[2]), line:lineNo };

  m = header.match(/^while\s+note\s+(\S+)\s+down\s+velocity\s+(\S+)\s+every\s+(\S+)$/i);
  if (m) return { kind:'whileNote', any:false, note:noteNameToMidi(m[1]), velocity:parseVelocitySpec(m[2]), every:parseWhileEvery(m[3]), line:lineNo };

  m = header.match(/^while\s+note\s+(\S+)\s+down(?:\s+velocity\s+(\S+))?$/i);
  if (m) return { kind:'whileNote', any:false, note:noteNameToMidi(m[1]), velocity:parseVelocitySpec(m[2]), every:null, line:lineNo };

  m = header.match(/^while\s+sequence\s+(.+?)\s+playing(?:\s+every\s+(\S+))?$/i);
  if (m) return { kind:'whileSequence', name:m[1].trim(), every:parseWhileEvery(m[2]), line:lineNo };

  m = header.match(/^when\s+any\s+note(?:\s+velocity\s+(\S+))?$/i);
  if (m) return { kind:'note', any:true, velocity:parseVelocitySpec(m[1]), line:lineNo };

  m = header.match(/^when\s+note\s+(\S+)(?:\s+velocity\s+(\S+))?$/i);
  if (m) return { kind:'note', any:false, note:noteNameToMidi(m[1]), velocity:parseVelocitySpec(m[2]), line:lineNo };

  m = header.match(/^when\s+chord\s+(\[[^\]]+\])(?:\s+within\s+(\S+))?(?:\s+velocity\s+(\S+))?$/i);
  if (m) return {
    kind:'chord', notes:splitList(m[1]).map(noteNameToMidi).sort((a,b)=>a-b),
    within:m[2]?parseTime(m[2]):180, velocity:parseVelocitySpec(m[3]), line:lineNo
  };

  m = header.match(/^after\s+start\s+(\S+)$/i);
  if (m) return { kind:'after', delay:parseTime(m[1]), line:lineNo };

  m = header.match(/^every\s+random\s+(\S+)\.\.(\S+)$/i);
  if (m) return { kind:'everyRandom', min:parseTime(m[1]), max:parseTime(m[2]), line:lineNo };

  m = header.match(/^every\s+(\S+)$/i);
  if (m) return { kind:'every', interval:parseTime(m[1]), line:lineNo };

  throw new Error(`Line ${lineNo}: I don't understand trigger “${header}”`);
}

function parseAction(text, lineNo) {
  const trimmed = text.trim();
  if (/^wait\s+/i.test(trimmed)) return { kind:'wait', duration:parseTime(trimmed.replace(/^wait\s+/i,'')), line:lineNo };
  if (/^stop\s+all$/i.test(trimmed)) return { kind:'panic', line:lineNo };

  let m = trimmed.match(/^(?:go|switch)\s+to\s+section\s+(.+)$/i);
  if (m) return { kind:'section', name:stripQuotes(m[1].trim()), line:lineNo };

  m = trimmed.match(/^play\s+sequence\s+(.+)$/i);
  if (m) return { kind:'sequence', name:stripQuotes(m[1].trim()), line:lineNo };

  m = trimmed.match(/^play\s+(midi|sound)\s+((?:"[^"]+")|(?:'[^']+')|\S+)$/i);
  if (m) return { kind:m[1].toLowerCase(), source:stripQuotes(m[2]), line:lineNo };

  if (!/^play\s+/i.test(trimmed)) throw new Error(`Line ${lineNo}: action must begin with play, wait, go to section, or stop all`);

  let rest = trimmed.replace(/^play\s+/i, '');
  const action = {kind:'notes',targets:[],random:false,velocity:null,after:0,duration:220,repeat:1,every:0,accelerate:1,channel:null,line:lineNo};
  if (/^random\s+/i.test(rest)) { action.random=true; rest=rest.replace(/^random\s+/i,''); }

  if (rest.startsWith('[')) {
    const end=rest.indexOf(']');
    if (end<0) throw new Error(`Line ${lineNo}: missing ]`);
    action.targets=parseTargets(rest.slice(0,end+1)); rest=rest.slice(end+1).trim();
  } else {
    const first=rest.match(/^(\S+)/)?.[1];
    if (!first) throw new Error(`Line ${lineNo}: missing note to play`);
    action.targets=[parseTarget(first)]; rest=rest.slice(first.length).trim();
  }

  const tokenRe=/^(velocity|after|for|repeat|every|accelerate|channel)\s+(\S+)(?:\s+|$)/i;
  while(rest){
    const mm=rest.match(tokenRe);
    if(!mm) throw new Error(`Line ${lineNo}: I don't understand “${rest}”`);
    const key=mm[1].toLowerCase(),val=mm[2];
    if(key==='velocity')action.velocity=parseVelocitySpec(val);
    if(key==='after')action.after=parseTime(val);
    if(key==='for')action.duration=parseTime(val);
    if(key==='repeat')action.repeat=Math.max(1,Math.floor(Number(val)));
    if(key==='every')action.every=parseTime(val);
    if(key==='accelerate')action.accelerate=Number(val);
    if(key==='channel')action.channel=clamp(Number(val),1,16);
    rest=rest.slice(mm[0].length).trim();
  }
  return action;
}

function createSection(name,line,implicit=false){
  return { name, key:sectionKey(name), line, implicit, rules:[], sequences:new Map() };
}

export function parseScript(source) {
  const errors=[];
  const lines=source.replace(/\r/g,'').split('\n');
  // Section headers define the hierarchy themselves. Their own indentation and the
  // indentation of rule headers beneath them are intentionally forgiving.
  const explicitSections=lines.some(raw=>/^\s*section\s+.+:\s*(?:#.*)?$/i.test(raw));
  const sections=new Map();
  const sectionOrder=[];
  const assetUrls=new Map();
  let assetBaseUrl='';
  let currentSection=null, currentBlock=null, currentBlockIndent=-1;

  function addSection(name,line,implicit=false){
    const clean=name.trim();
    if(!clean){errors.push(`Line ${line}: section needs a name`);return null;}
    const key=sectionKey(clean);
    if(sections.has(key)){errors.push(`Line ${line}: duplicate section “${clean}”`);return sections.get(key);}
    const section=createSection(clean,line,implicit); sections.set(key,section); sectionOrder.push(clean); return section;
  }

  if(!explicitSections) currentSection=addSection('Main',1,true);

  for(let i=0;i<lines.length;i++){
    const lineNo=i+1,raw=lines[i];
    if(!raw.trim()||raw.trimStart().startsWith('#'))continue;
    const withoutComment=raw.replace(/\s+#.*$/,'').trimEnd();
    if(!withoutComment.trim())continue;
    const indent=indentation(withoutComment),text=withoutComment.trim();

    try{
      // Global asset declarations may appear before or between sections.
      let am=text.match(/^assets\s+from\s+((?:"[^"]+")|(?:'[^']+')|\S+)$/i);
      if(am){
        assetBaseUrl=stripQuotes(am[1]);
        continue;
      }
      am=text.match(/^asset\s+((?:"[^"]+")|(?:'[^']+')|\S+)\s+from\s+((?:"[^"]+")|(?:'[^']+')|\S+)$/i);
      if(am){
        const name=stripQuotes(am[1]),url=stripQuotes(am[2]);
        if(assetUrls.has(name))throw new Error(`Line ${lineNo}: duplicate asset declaration for “${name}”`);
        assetUrls.set(name,url);
        continue;
      }

      // A line beginning with "section" is always a section header, regardless of indentation.
      const sectionMatch=text.match(/^section\s+(.+):$/i);
      if(sectionMatch){
        if(!explicitSections)throw new Error(`Line ${lineNo}: internal section parsing error`);
        currentSection=addSection(sectionMatch[1],lineNo,false); currentBlock=null; currentBlockIndent=-1; continue;
      }

      if(explicitSections&&!currentSection)throw new Error(`Line ${lineNo}: add a section header before this rule`);
      if(!currentSection)throw new Error(`Line ${lineNo}: add a rule or section header before this action`);

      const isHeader=text.endsWith(':');
      const header=isHeader?text.slice(0,-1).trim():null;

      // Any colon-ended non-section line is a rule/sequence header. This lets users write
      // either indented or flush-left rules inside a section; only action indentation matters.
      if(isHeader){
        const seq=header.match(/^sequence\s+(.+)$/i);
        if(seq){
          const name=seq[1].trim();
          currentBlock={type:'sequence',name,actions:[],line:lineNo};
          currentSection.sequences.set(sectionKey(name),{name,actions:currentBlock.actions,line:lineNo});
        }else{
          currentBlock={type:'rule',trigger:parseTrigger(header,lineNo),actions:[],line:lineNo,id:`${currentSection.key}:L${lineNo}`};
          currentSection.rules.push(currentBlock);
        }
        currentBlockIndent=indent; continue;
      }

      if(!currentBlock)throw new Error(`Line ${lineNo}: action has no trigger or sequence above it`);
      if(indent<=currentBlockIndent)throw new Error(`Line ${lineNo}: actions must be indented beneath their trigger or sequence`);
      currentBlock.actions.push(parseAction(text,lineNo));
    }catch(err){errors.push(err.message);}
  }

  for(const section of sections.values()){
    for(const rule of section.rules) if(!rule.actions.length) errors.push(`Line ${rule.line}: rule has no actions`);
    for(const seq of section.sequences.values()) if(!seq.actions.length) errors.push(`Line ${seq.line}: sequence “${seq.name}” has no actions`);

    for(const rule of section.rules){
      if(rule.trigger.kind==='whileSequence' && !section.sequences.has(sectionKey(rule.trigger.name)))
        errors.push(`Line ${rule.line}: sequence “${rule.trigger.name}” does not exist in section “${section.name}”`);
      for(const action of rule.actions) validateAction(action,section,sections,errors);
    }
    for(const seq of section.sequences.values()) for(const action of seq.actions) validateAction(action,section,sections,errors);
  }

  const first=sectionOrder.length?sections.get(sectionKey(sectionOrder[0])):createSection('Main',1,true);
  return {
    sections, sectionOrder, hasExplicitSections:explicitSections, errors,
    assetBaseUrl, assetUrls,
    // Backward-compatible aliases for older callers.
    rules:first.rules, sequences:new Map([...first.sequences.values()].map(s=>[s.name,s.actions]))
  };
}

function validateAction(action,section,sections,errors){
  if(action.kind==='sequence' && !section.sequences.has(sectionKey(action.name)))
    errors.push(`Line ${action.line}: sequence “${action.name}” does not exist in section “${section.name}”`);
  if(action.kind==='section' && !sections.has(sectionKey(action.name)))
    errors.push(`Line ${action.line}: section “${action.name}” does not exist`);
}

export function velocityMatches(spec, velocity) {
  if (!spec) return true;
  if (spec.type === 'range') return velocity >= spec.min && velocity <= spec.max;
  if (spec.type === 'fixed') return velocity === spec.value;
  return true;
}
export function resolveVelocity(spec, inputVelocity=64) {
  if (!spec) return clamp(Math.round(inputVelocity),1,127);
  if (spec.type==='input')return clamp(Math.round(inputVelocity*spec.factor),1,127);
  if (spec.type==='fixed')return clamp(spec.value,1,127);
  if (spec.type==='range')return Math.floor(spec.min+Math.random()*(spec.max-spec.min+1));
  return 64;
}
export function resolveTarget(target, baseNote=60) {
  return target.type==='relative'?clamp(baseNote+target.semitones,0,127):target.note;
}
export function normalizeSectionName(name){ return sectionKey(name); }
