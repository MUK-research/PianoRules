# [PianoRules](https://muk-research.github.io/PianoRules/)

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
- Supports note, velocity, chord, elapsed-time, periodic, randomized, and state-based `while` triggers.
- Supports independent performance **sections** with trigger-driven section changes; only one section runs at a time. Section-rule indentation is forgiving, and clicking a section in the editor activates it for rehearsal.
- Supports absolute notes, relative intervals, chords, repetitions, accelerating/decelerating repetitions, named sequences, MIDI-file playback and audio-file playback.
- Dragging `.mid`, `.wav`, `.mp3`, etc. onto the bottom bar stores them in IndexedDB for later visits on the same browser/device.
- Remote assets can be declared in the `.rules` file and are preloaded before the rule engine starts, so playback never begins with an on-demand network download.
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

## [Documentation](https://muk-research.github.io/PianoRules/docs/) and [shared library](https://drive.google.com/drive/folders/13X9AR03kODoQFeSk52oS9WSVNPSqHkpw)

The performer-facing musical grammar is documented in [`docs/README.md`](docs/README.md). When the repository is deployed from its root on GitHub Pages, the formatted documentation is available at `/docs/` and is linked from the PianoRules toolbar.

The shared community file library is:

<https://drive.google.com/drive/folders/13X9AR03kODoQFeSk52oS9WSVNPSqHkpw?usp=sharing>

The shared Drive folder remains a convenient communal library: download an asset, drag it into PianoRules, and reference it by filename in a rule.

For **automatic runtime preloading**, use a same-origin or CORS-enabled static host (for example an `assets/` folder in the PianoRules GitHub Pages repository). A Google Drive folder is not a normal web directory, and Drive's public download endpoints are not reliably fetchable from browser JavaScript because of CORS restrictions.

## Shareable piece links with `?ruleset=`

PianoRules can load a complete piece directly from the page URL. This makes one link enough to open a particular score, preload its assets, and prepare it for performance.

### Piece in the built-in `Library/`

Use this repository layout:

```text
Library/
  Cage/
    Cage.rules
    assets/
      prepared-piano.mid
      radio.wav
```

Then share:

```text
https://<username>.github.io/<pianorules-repo>/?ruleset=Cage
```

The short name `Cage` resolves to `Library/Cage/Cage.rules`. If the rules file does not declare `assets from ...`, PianoRules automatically treats `Library/Cage/assets/` as its asset folder.

### Piece in another GitHub repository

A repository can be self-contained:

```text
Rule-Gamelan/
  Gamelan.rules
  assets/
    gong.wav
    pattern.mid
```

Share the PianoRules page with the repository URL as the `ruleset` value. URL-encoding the value is safest:

```text
?ruleset=https%3A%2F%2Fgithub.com%2FAdrianArtacho%2FRule-Gamelan
```

For a GitHub repository URL, PianoRules derives the piece name from the repository (`Rule-Gamelan` → `Gamelan`) and looks for `Gamelan.rules` in `main`, then `master`. A repository named simply `Gamelan` also resolves to `Gamelan.rules`.

You can alternatively pass an exact GitHub `blob/.../*.rules` URL.

### Direct `.rules` file elsewhere

Any public, CORS-accessible direct `.rules` URL can be used:

```text
?ruleset=https%3A%2F%2Fexample.org%2Fpieces%2FClouds%2FClouds.rules
```

Relative asset declarations are resolved relative to the loaded `.rules` file. With no explicit declaration, PianoRules defaults to an `assets/` folder beside that file.

A URL-loaded piece is displayed in the editor before **START PERFORMANCE**. It still passes through the normal PianoRules parser and asset-preload stage; remote repositories cannot inject JavaScript into PianoRules.

## Rule language

### Sections

A piece can contain several independent rule sets. The first section is active by default:

```text
section Opening:
  when any note:
    play +7

  when note C7:
    go to section Echoes

section Echoes:
  every 2s:
    play random [C4 E4 G4]

  when note C1:
    go to section Opening
```

Changing section resets the previous section's timers, repetitions, named sequences, `while` states and generated sounding notes, then starts the new section with a fresh local clock. Existing files without section headers remain valid and are treated as one implicit `Main` section.

The active section is shown in the editor header and visually emphasized in the code window.

### Forgiving section indentation

`section ...:` is a structural header, so PianoRules does **not** require rule headers beneath it to be indented. These are equivalent:

```text
section Opening:
  when any note:
    play +7
```

```text
section Opening:
when any note:
  play +7
```

Actions still need to be indented beneath their own trigger or sequence.

### Clicking sections during rehearsal

Click anywhere inside an inactive section in the editor to make it the active section. If the editor contains unapplied changes, PianoRules applies the current code first and then activates the clicked section. This makes it easy to rehearse or develop one formal region without adding a temporary trigger.

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

### While a key is held

```text
while note C4 down every 180ms:
  play +7 velocity input*0.6 for 80ms
```

The rule activates when C4 goes down. With `every 180ms`, the body is repeated while C4 remains held; release the key and future actions belonging to that while-state stop.

You can also use any held note and a dynamic condition:

```text
while any note down velocity 80..127 every 120ms:
  play +12 velocity input*0.45 for 60ms
```

### While a sequence is playing

```text
sequence answer:
  play +12 for 130ms
  wait 160ms
  play +7 for 130ms
  wait 160ms
  play +3 for 180ms

when note D4:
  play sequence answer

while sequence answer playing every 220ms:
  play -12 velocity 35 for 80ms
```

The sequence-playing state is derived from PianoRules waits, note durations, repetitions, and nested sequences.

### MIDI and audio assets

Drop a MIDI/audio file onto the bottom bar once. It is stored locally in the browser and can then be triggered by filename:

```text
when note F4:
  play midi "gesture.mid"

when note G4:
  play sound "resonance.wav"
```

#### Remote asset folder

A rules file can declare a base URL near the beginning:

```text
assets from "./assets/"
```

Then any referenced relative file is resolved against that folder:

```text
when note F4:
  play midi "gesture.mid"

when note G4:
  play sound "resonance.wav"
```

On **Run rules / Apply changes**, PianoRules scans the complete piece and preloads every referenced MIDI/audio asset before the engine starts.

An absolute web folder works too:

```text
assets from "https://example.org/my-piece-assets/"
```

The host must allow browser/CORS access.

#### One-off remote files

Override a single filename with an explicit URL:

```text
asset "special.wav" from "https://example.org/files/special.wav"
```

The action still uses the short musical name:

```text
play sound "special.wav"
```

Direct URLs may also be used as the action source, although named assets make scores easier to read.

For the most dependable GitHub Pages setup, put performance assets in an `assets/` folder inside the repository and write:

```text
assets from "./assets/"
```

A public Google Drive **folder** is useful as a communal download library, but it cannot reliably serve this filename-based runtime role: the folder is not a raw directory and Drive download endpoints commonly block cross-origin browser `fetch`.

## Important browser notes

- Web MIDI requires HTTPS (or localhost).
- Browser support is not universal. Chromium-based desktop browsers are the most predictable target for a performance machine.
- A webpage cannot silently force itself into fullscreen on load. A user gesture is required; therefore PianoRules combines MIDI activation/fullscreen with its initial START button.
- A normal webpage cannot access arbitrary local filesystem paths such as `/Users/name/Desktop/sound.wav`. Drop the file into PianoRules (stored in IndexedDB) or place it in the GitHub Pages repository.

## Disklavier / player-piano safety

Start with modest velocities and keep **MIDI feedback guard** enabled until routing is verified. The **Panic** button sends MIDI All Notes Off / All Sound Off on all 16 channels.

The prototype deliberately separates musical rules from device routing, so the same score/rule script can move between a Clavinova, controller keyboard, Disklavier, software instrument, or virtual MIDI port.

## Author

PianoRules was created by **Adrián Artacho**, composer and educator at the [Music and Arts University of the City of Vienna (MUK)](https://muk.ac.at/studienangebot/lehrende/details/adrian-artacho.html).
