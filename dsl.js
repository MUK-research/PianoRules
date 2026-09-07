export const DEFAULT_RULES = `# PianoRules — write what should happen musically.
# Notes may be C4, F#3, Bb5, or MIDI numbers (0–127).
# +4 means four semitones above the note that triggered the rule.

when any note:
  play +4 velocity input after 120ms

when note C4 velocity 80..127:
  play [C5 E5 G5] velocity 72 for 300ms

when chord [C4 E4 G4] within 180ms:
  play [C5 G5] velocity input

# An accelerating echo: a major third above what you play.
when any note velocity 45..127:
  play +4 velocity input*0.75 repeat 7 every 360ms accelerate 0.82 for 100ms

# Time-based rules begin when you press “Run rules”.
after start 8s:
  play [C3 G3 C4] velocity 48 for 700ms

every random 6s..11s:
  play random [C5 D5 E5 G5 A5] velocity 35..60 for 160ms

# While-rules stay active only while their condition remains true.
while note C4 down every 180ms:
  play +7 velocity input*0.6 for 80ms

# Named sequences can be reused.
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

# Drop files onto the bottom bar, then refer to them by filename:
# when note F4:
#   play midi "gesture.mid"
#   play sound "resonance.wav"
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

function parseTargets(raw) {
  return splitList(raw).map(parseTarget);
}

function parseWhileEvery(value) {
  return value ? parseTime(value) : null;
}

function parseTrigger(header, lineNo) {
  let m = header.match(/^while\s+any\s+note\s+down(?:\s+velocity\s+(\S+))?(?:\s+every\s+(\S+))?$/i);
  if (m) return { kind:'whileNote', any:true, velocity:parseVelocitySpec(m[1]), every:parseWhileEvery(m[2]), line:lineNo };

  m = header.match(/^while\s+note\s+(\S+)\s+down(?:\s+velocity\s+(\S+))?(?:\s+every\s+(\S+))?$/i);
  if (m) return { kind:'whileNote', any:false, note:noteNameToMidi(m[1]), velocity:parseVelocitySpec(m[2]), every:parseWhileEvery(m[3]), line:lineNo };

  m = header.match(/^while\s+sequence\s+([\w.-]+)\s+playing(?:\s+every\s+(\S+))?$/i);
  if (m) return { kind:'whileSequence', name:m[1], every:parseWhileEvery(m[2]), line:lineNo };

  m = header.match(/^when\s+any\s+note(?:\s+velocity\s+(\S+))?$/i);
  if (m) return { kind:'note', any:true, velocity:parseVelocitySpec(m[1]), line:lineNo };

  m = header.match(/^when\s+note\s+(\S+)(?:\s+velocity\s+(\S+))?$/i);
  if (m) return { kind:'note', any:false, note:noteNameToMidi(m[1]), velocity:parseVelocitySpec(m[2]), line:lineNo };

  m = header.match(/^when\s+chord\s+(\[[^\]]+\])(?:\s+within\s+(\S+))?(?:\s+velocity\s+(\S+))?$/i);
  if (m) return {
    kind:'chord',
    notes:splitList(m[1]).map(noteNameToMidi).sort((a,b)=>a-b),
    within: m[2] ? parseTime(m[2]) : 180,
    velocity:parseVelocitySpec(m[3]),
    line:lineNo
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
  if (/^wait\s+/i.test(trimmed)) {
    return { kind:'wait', duration:parseTime(trimmed.replace(/^wait\s+/i,'')), line:lineNo };
  }
  if (/^stop\s+all$/i.test(trimmed)) return { kind:'panic', line:lineNo };

  let m = trimmed.match(/^play\s+sequence\s+([\w.-]+)$/i);
  if (m) return { kind:'sequence', name:m[1], line:lineNo };

  m = trimmed.match(/^play\s+(midi|sound)\s+((?:"[^"]+")|(?:'[^']+')|\S+)$/i);
  if (m) return { kind:m[1].toLowerCase(), source:stripQuotes(m[2]), line:lineNo };

  if (!/^play\s+/i.test(trimmed)) throw new Error(`Line ${lineNo}: action must begin with play, wait, or stop all`);

  let rest = trimmed.replace(/^play\s+/i, '');
  const action = {
    kind:'notes', targets:[], random:false, velocity:null, after:0, duration:220,
    repeat:1, every:0, accelerate:1, channel:null, line:lineNo
  };

  if (/^random\s+/i.test(rest)) { action.random = true; rest = rest.replace(/^random\s+/i,''); }

  let targetText;
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    if (end < 0) throw new Error(`Line ${lineNo}: missing ]`);
    targetText = rest.slice(0, end + 1);
    rest = rest.slice(end + 1).trim();
    action.targets = parseTargets(targetText);
  } else {
    const first = rest.match(/^(\S+)/)?.[1];
    if (!first) throw new Error(`Line ${lineNo}: missing note to play`);
    action.targets = [parseTarget(first)];
    rest = rest.slice(first.length).trim();
  }

  const tokenRe = /^(velocity|after|for|repeat|every|accelerate|channel)\s+(\S+)(?:\s+|$)/i;
  while (rest) {
    const mm = rest.match(tokenRe);
    if (!mm) throw new Error(`Line ${lineNo}: I don't understand “${rest}”`);
    const key = mm[1].toLowerCase(), val = mm[2];
    if (key === 'velocity') action.velocity = parseVelocitySpec(val);
    if (key === 'after') action.after = parseTime(val);
    if (key === 'for') action.duration = parseTime(val);
    if (key === 'repeat') action.repeat = Math.max(1, Math.floor(Number(val)));
    if (key === 'every') action.every = parseTime(val);
    if (key === 'accelerate') action.accelerate = Number(val);
    if (key === 'channel') action.channel = clamp(Number(val), 1, 16);
    rest = rest.slice(mm[0].length).trim();
  }
  return action;
}

export function parseScript(source) {
  const rules = [];
  const sequences = new Map();
  const errors = [];
  const lines = source.replace(/\r/g,'').split('\n');
  let current = null;

  for (let i=0; i<lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const withoutComment = raw.replace(/\s+#.*$/, '').trimEnd();
    if (!withoutComment.trim()) continue;
    const indented = /^\s+/.test(withoutComment);
    const text = withoutComment.trim();

    try {
      if (!indented) {
        if (!text.endsWith(':')) throw new Error(`Line ${lineNo}: a trigger or sequence header must end with :`);
        const header = text.slice(0,-1).trim();
        const seq = header.match(/^sequence\s+([\w.-]+)$/i);
        if (seq) {
          current = { type:'sequence', name:seq[1], actions:[], line:lineNo };
          sequences.set(seq[1], current.actions);
        } else {
          current = { type:'rule', trigger:parseTrigger(header, lineNo), actions:[], line:lineNo, id:`L${lineNo}` };
          rules.push(current);
        }
      } else {
        if (!current) throw new Error(`Line ${lineNo}: action has no trigger or sequence above it`);
        current.actions.push(parseAction(text, lineNo));
      }
    } catch (err) { errors.push(err.message); }
  }

  for (const rule of rules) {
    if (!rule.actions.length) errors.push(`Line ${rule.line}: rule has no actions`);
  }
  return { rules, sequences, errors };
}

export function velocityMatches(spec, velocity) {
  if (!spec) return true;
  if (spec.type === 'range') return velocity >= spec.min && velocity <= spec.max;
  if (spec.type === 'fixed') return velocity === spec.value;
  return true;
}

export function resolveVelocity(spec, inputVelocity=64) {
  if (!spec) return clamp(Math.round(inputVelocity), 1, 127);
  if (spec.type === 'input') return clamp(Math.round(inputVelocity * spec.factor), 1, 127);
  if (spec.type === 'fixed') return clamp(spec.value, 1, 127);
  if (spec.type === 'range') return Math.floor(spec.min + Math.random() * (spec.max - spec.min + 1));
  return 64;
}

export function resolveTarget(target, baseNote=60) {
  return target.type === 'relative' ? clamp(baseNote + target.semitones, 0, 127) : target.note;
}
