function readVar(data, pos) {
  let value = 0, b;
  do { b = data[pos.i++]; value = (value << 7) | (b & 0x7f); } while (b & 0x80);
  return value;
}
function u16(d,p){ return (d[p]<<8)|d[p+1]; }
function u32(d,p){ return ((d[p]<<24)>>>0)+(d[p+1]<<16)+(d[p+2]<<8)+d[p+3]; }
function text4(d,p){ return String.fromCharCode(...d.slice(p,p+4)); }

export function parseMidiFile(buffer) {
  const d = new Uint8Array(buffer);
  if (text4(d,0) !== 'MThd') throw new Error('Not a Standard MIDI File');
  const headerLen = u32(d,4);
  const format = u16(d,8), ntrks=u16(d,10), division=u16(d,12);
  if (division & 0x8000) throw new Error('SMPTE-time MIDI files are not supported yet');
  const ppq = division;
  let off = 8 + headerLen;
  const events=[], tempos=[{tick:0, us:500000}];

  for (let t=0; t<ntrks; t++) {
    if (text4(d,off) !== 'MTrk') throw new Error(`Missing MTrk chunk ${t+1}`);
    const len=u32(d,off+4), end=off+8+len;
    const p={i:off+8}; let tick=0, running=0;
    while (p.i < end) {
      tick += readVar(d,p);
      let status=d[p.i++];
      if (status < 0x80) { p.i--; status=running; } else if (status < 0xf0) running=status;
      if (status === 0xff) {
        const type=d[p.i++], l=readVar(d,p);
        if (type===0x51 && l===3) {
          const us=(d[p.i]<<16)|(d[p.i+1]<<8)|d[p.i+2]; tempos.push({tick,us});
        }
        p.i += l; continue;
      }
      if (status===0xf0 || status===0xf7) { p.i += readVar(d,p); continue; }
      const hi=status&0xf0, ch=status&0x0f;
      if (hi===0x80 || hi===0x90) {
        const note=d[p.i++], vel=d[p.i++];
        events.push({tick,status:hi===0x90&&vel>0?'on':'off',note,velocity:vel,channel:ch+1});
      } else if (hi===0xa0 || hi===0xb0 || hi===0xe0) p.i+=2;
      else if (hi===0xc0 || hi===0xd0) p.i+=1;
      else throw new Error(`Unsupported MIDI status 0x${status.toString(16)}`);
    }
    off=end;
  }
  tempos.sort((a,b)=>a.tick-b.tick);
  const dedup=[];
  for (const tp of tempos) { if (dedup.length && dedup.at(-1).tick===tp.tick) dedup[dedup.length-1]=tp; else dedup.push(tp); }

  function tickToMs(tick) {
    let ms=0, prevTick=0, us=500000;
    for (const tp of dedup) {
      if (tp.tick > tick) break;
      ms += (tp.tick-prevTick)*us/ppq/1000;
      prevTick=tp.tick; us=tp.us;
    }
    return ms + (tick-prevTick)*us/ppq/1000;
  }
  events.forEach(e=>e.time=tickToMs(e.tick));
  events.sort((a,b)=>a.time-b.time);
  return {format,ppq,events,duration:events.length?events.at(-1).time:0};
}
