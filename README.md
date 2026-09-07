# PianoRules

A static, browser-based MIDI rule engine for performer–player-piano interaction. It is designed for GitHub Pages and does not require a server.

## Editing rules while playing

You can edit the rule text during a performance. As soon as the editor differs from the running rules, the top button changes to **Apply changes**. Click it (or press **Cmd+Enter** on macOS / **Ctrl+Enter** on Windows/Linux) to stop the previous rule set, parse the current editor contents, and immediately start the new rules. Timed and random processes are restarted from that moment.

If the edited script contains a syntax error, PianoRules stops the previous rule engine rather than silently continuing with stale rules. Fix the error and press **Fix & run rules**.

## What it does

- Receives MIDI note input through the Web MIDI API.
- Sends generated MIDI back to a selected output (e.g. a Yamaha Disklavier).
- Shows live input and output monitors.
- Lets performers edit a deliberately human-readable musical rule language in the browser.
- Remembers the rule script, MIDI device selection, channels, fullscreen preference and feedback-guard settings in `localStorage`.
- Supports note, velocity, chord, elapsed-time, periodic and randomized triggers.
- Supports absolute notes, relative intervals, chords, repetitions, accelerating/decelerating repetitions, named sequences, MIDI-file playback and audio-file playback.
- Dragging `.mid`, `.wav`, `.mp3`, etc. onto the bottom bar stores them in IndexedDB for later visits on the same browser/device.
- Includes MIDI-feedback protection for setups where generated Disklavier notes return through MIDI input.

## Deploy on GitHub Pages

1. Create a repository, for example `pianorules`.
2. Put these files at the repository root.
3. Commit and push them to GitHub.
4. In **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
5. Open the resulting `https://<username>.github.io/<repo>/` URL in a Web-MIDI-capable desktop browser.

GitHub Pages is HTTPS, which is required by Web MIDI.

## First launch

Press **START PERFORMANCE**. The click is intentionally used to request MIDI permission and enter fullscreen, because browsers require user interaction for these privileged actions.

Open **MIDI** to choose input/output ports and channels. If more than one MIDI output exists, PianoRules deliberately starts with no output selected; choose the Disklavier/Clavinova explicitly. Settings are remembered for future visits. PianoRules first remembers the browser's MIDI port ID and also saves manufacturer/name as a fallback if an ID changes.

## Rule language

### Note trigger

```text
when note C4:
  play E4
```

### Any note + relative interval

```text
when any note:
  play +4 velocity input
```

`+4` means four semitones above the note that triggered the rule. `-12` means an octave below.

### Velocity range

```text
when note C4 velocity 80..127:
  play [C5 E5 G5] velocity 70 for 500ms
```

### Chord / combination trigger

```text
when chord [C4 E4 G4] within 180ms:
  play [D5 F#5 A5]
```

The notes may arrive in any order inside the specified time window.

### Repetition and acceleration

```text
when any note:
  play +4 repeat 8 every 300ms accelerate 0.85 for 100ms
```

Intervals get multiplied by `0.85` after each repetition, so the response accelerates. Values above `1` decelerate.

### After the start of the performance

```text
after start 10s:
  play [C3 G3 C4] velocity 45
```

The performance clock starts when **Run rules** is pressed.

### Regular / random autonomous triggers

```text
every 4s:
  play C5 velocity 35

every random 2s..6s:
  play random [C4 D4 E4 G4 A4] velocity 25..55
```

### Named sequence

```text
sequence answer:
  play +12 for 120ms
  wait 180ms
  play +7 for 120ms
  wait 180ms
  play +3 for 180ms

when note D4:
  play sequence answer
```

Relative notes inside a sequence use the original triggering note as their reference.

### MIDI and audio assets

Drop a MIDI/audio file onto the bottom bar once. It is stored locally in the browser and can then be triggered by filename:

```text
when note F4:
  play midi "gesture.mid"

when note G4:
  play sound "resonance.wav"
```

Files committed alongside the webpage can also be referenced by relative URL (for example `sounds/resonance.wav`) without dropping them first.

## Important browser notes

- Web MIDI requires HTTPS (or localhost).
- Browser support is not universal. Chromium-based desktop browsers are the most predictable target for a performance machine.
- A webpage cannot silently force itself into fullscreen on load. A user gesture is required; therefore PianoRules combines MIDI activation/fullscreen with its initial START button.
- A normal webpage cannot access arbitrary local filesystem paths such as `/Users/name/Desktop/sound.wav`. Drop the file into PianoRules (stored in IndexedDB) or place it in the GitHub Pages repository.

## Disklavier / player-piano safety

Start with modest velocities and keep **MIDI feedback guard** enabled until routing is verified. The **Panic** button sends MIDI All Notes Off / All Sound Off on all 16 channels.

The prototype deliberately separates musical rules from device routing, so the same score/rule script can move between a Clavinova, controller keyboard, Disklavier, software instrument, or virtual MIDI port.
