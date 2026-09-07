# PianoRules — Musical Grammar

PianoRules is a small browser-based language for creating relationships between a pianist and a MIDI-capable piano. The central idea is simple:

```text
trigger:
  action
```

A **trigger** describes *when* something should happen. An **action** describes *what* PianoRules should do in response.

The language is intentionally musical rather than technical: notes, chords, dynamics, time, repetitions, sequences, and relationships to what the performer just played.

> After editing the rules in the browser, press **Apply changes** or **⌘/Ctrl+Enter**. You do not need to reload the page.

---

## 1. Event triggers: `when`

### Any note

```text
when any note:
  play +12
```

Every played note triggers the action. `+12` means one octave above the triggering note.

### A specific note

```text
when note C4:
  play G4
```

Notes can be written as note names such as `C4`, `F#3`, `Bb5`, or as MIDI note numbers from `0` to `127`.

### Dynamic ranges

```text
when note C4 velocity 80..127:
  play [C5 E5 G5] velocity 70
```

The rule fires only when C4 is played with a velocity between 80 and 127.

You can use the same idea with any note:

```text
when any note velocity 1..40:
  play +7 velocity 25
```

This makes dynamics part of the form: soft playing and strong playing can open different behaviours.

### Chords / combinations

```text
when chord [C4 E4 G4] within 180ms:
  play [D5 F#5 A5] velocity 60
```

The notes in the chord may arrive in any order, as long as they occur within the time window.

This is useful for:

- harmonic gates;
- secret combinations;
- triggering a process from a recognisable sonority;
- distinguishing single-note gestures from chordal gestures.

---

## 2. State triggers: `while`

`while` is different from `when`.

- `when` reacts to an event.
- `while` remains active for as long as a musical state remains true.

A while-rule fires once when the state begins. If you add `every ...`, its body is repeated for as long as the state remains true. Delayed or repeated events belonging to that rule are suppressed as soon as the state ends.

### While a specific key is held

```text
while note C4 down:
  play +7 velocity input*0.6 for 100ms
```

The action starts when C4 goes down and remains bound to that held-note state.

For a genuinely continuous process, add an interval:

```text
while note C4 down every 180ms:
  play +7 velocity input*0.6 for 80ms
```

Hold C4 and a repeating fifth appears. Release C4 and the process stops.

### While any key is held

```text
while any note down every 120ms:
  play +12 velocity input*0.45 for 60ms
```

The relative note follows the most recently relevant held note.

You can also restrict this by dynamics:

```text
while any note down velocity 90..127 every 100ms:
  play -12 velocity 35 for 50ms
```

This creates a process that exists only while strongly played notes are physically held.

### While a named sequence is playing

```text
sequence answer:
  play +12 velocity input*0.8 for 130ms
  wait 160ms
  play +7 velocity input*0.7 for 130ms
  wait 160ms
  play +3 velocity input*0.6 for 180ms

when note D4:
  play sequence answer

while sequence answer playing every 220ms:
  play -12 velocity 35 for 80ms
```

The second process exists only while `answer` is active.

A sequence's playing time is derived from its waits, note durations, repetitions and nested PianoRules sequences. For sound or MIDI-file actions, use explicit `wait` statements if you want the sequence timeline to remain active for a particular length of time.

This makes it possible to build processes that accompany, shadow, interrupt, or transform other processes.

---

## 3. Time triggers

### After the beginning

```text
after start 8s:
  play [C3 G3 C4] velocity 48 for 700ms
```

The clock begins whenever the rules are started or restarted.

This is useful for formal cues that should occur without an instrumental trigger.

### Regular autonomous events

```text
every 3s:
  play C5 velocity 40 for 100ms
```

### Random autonomous events

```text
every random 2s..5s:
  play random [C4 D4 E4 G4 A4] velocity 25..55 for 140ms
```

The interval is newly chosen after every event.

This is useful for creating environments rather than fixed accompaniments.

---

---

# Sections and musical form

A PianoRules piece can contain several **sections**. Sections are independent rule sets: only one section is active at a time.

The first section in the file is active when the rules start.

```text
section Opening:
  when any note:
    play +7 velocity input*0.5

  when note C7:
    go to section Echoes

section Echoes:
  every random 2s..5s:
    play random [C4 E4 G4 B4] velocity 25..50

  when note C1:
    go to section Opening
```

A section change can therefore be triggered by exactly the same kinds of musical events that trigger other actions: a particular note, a chord, a dynamic region, a timer, a `while` process, or a named sequence.

### What happens when a section changes?

Changing section is a formal reset. PianoRules:

- stops the previous section's timers and repetitions;
- cancels its active named sequences and `while` processes;
- sends all-notes-off / all-sound-off safety messages to MIDI outputs;
- stops audio files that PianoRules started;
- resets the section clock, so `after start ...` is measured from the moment the new section begins;
- activates only the rules and sequences belonging to the new section.

Notes that were already physically held before the section change do **not** automatically open a new `while ... down` process in the new section. Play a new note after the change to begin a new held-note state.

The currently active section is shown beside the editor title, and its code is visually emphasized in the editor.

### Sections do not have to be sequential

They can form a line:

```text
Opening → Middle → Ending
```

but they can just as easily form a branching or circular structure:

```text
Calm → Dense → Calm
  ↘       ↓
    Solo ←
```

This makes sections useful for open forms, performer choice, improvisational navigation, game-like structures, and pieces in which the piano itself decides where the form goes next.

### Backward compatibility

A rules file with no `section ...:` headings still works. PianoRules treats it as one implicit section called `Main`.

# Actions

## 4. Play notes

### Absolute notes

```text
when note C4:
  play G5
```

### Chords

```text
when note C4:
  play [C5 E5 G5]
```

### Relative notes

```text
when any note:
  play +4
```

Relative intervals are measured in semitones from the note that triggered the rule.

Examples:

- `+12` — octave above
- `-12` — octave below
- `+7` — perfect fifth above
- `+4` — major third above
- `+3` — minor third above
- `-1` — semitone below

Relative actions are especially useful when you want an algorithm to preserve a relationship rather than produce a fixed pitch.

---

## 5. Velocity

### Fixed velocity

```text
play C5 velocity 70
```

### Copy the performer's velocity

```text
play +12 velocity input
```

### Scale the performer's velocity

```text
play +7 velocity input*0.6
```

### Random velocity in a range

```text
play C5 velocity 30..65
```

This lets the generated piano behave as a dynamic reflection rather than merely an on/off machine.

---

## 6. Timing an action

### Delay

```text
play +7 after 300ms
```

### Note duration

```text
play C5 for 800ms
```

### Repeat

```text
play +4 repeat 8 every 250ms
```

### Accelerate

```text
play +4 repeat 10 every 400ms accelerate 0.84
```

Each new interval is multiplied by `0.84`, so the process accelerates.

For deceleration, use a factor larger than 1:

```text
play -7 repeat 8 every 120ms accelerate 1.18
```

Despite the keyword `accelerate`, values above 1 produce progressively longer intervals.

### Output channel

```text
play C5 channel 2
```

This overrides the global MIDI output channel for that action.

---

## 7. Random pitch choices

```text
play random [C4 D4 E4 G4 A4] velocity 30..60
```

One pitch is selected from the list each time the action runs.

This can be combined with autonomous timing:

```text
every random 1.5s..4s:
  play random [C5 D5 E5 G5 A5] velocity 20..50 for 120ms
```

---

## 8. Named sequences

A sequence is a reusable group of actions.

```text
sequence answer:
  play +12 for 120ms
  wait 180ms
  play +7 for 120ms
  wait 180ms
  play +3 for 180ms
```

Trigger it elsewhere:

```text
when note D4:
  play sequence answer
```

Sequences can be treated as small musical objects: motives, responses, textures, cadences, interruptions, or algorithmic characters.

### `wait`

`wait` moves the cursor forward inside a rule or sequence:

```text
sequence pulse:
  play C5 for 80ms
  wait 200ms
  play G5 for 80ms
```

Without `wait`, multiple actions can begin from the same local time point.

---

## 9. MIDI and audio files

```text
when note F4:
  play midi "gesture.mid"

when note G4:
  play sound "resonance.wav"
```

To use a local asset:

1. Open PianoRules.
2. Drag the MIDI or audio file onto the asset area at the bottom of the page.
3. Refer to it by its filename in the rule.
4. The browser stores the asset locally for later visits on the same machine/browser.

### Shared PianoRules file library

A communal Google Drive folder is available here:

<https://drive.google.com/drive/folders/13X9AR03kODoQFeSk52oS9WSVNPSqHkpw?usp=sharing>

The intended workflow is:

1. download an interesting `.mid`, `.wav`, `.mp3`, or other shared asset;
2. drag it into PianoRules;
3. copy or write a rule that uses it;
4. modify the rule and make the material your own.

The shared folder is best understood as a pool of materials, examples and performance resources rather than as part of the runtime itself.

---

## 10. Stop everything

```text
when note C0:
  stop all
```

`stop all` sends an emergency stop / all-notes-off style action.

The interface also contains a dedicated **Panic** button.

---

# Musical exploration

The grammar becomes interesting when rules are combined. Here are some starting points.

## Shadow

```text
when any note:
  play +12 velocity input*0.5 after 400ms
```

A quieter delayed double follows the performer.

## Sustained machine

```text
while any note down every 160ms:
  play +7 velocity input*0.4 for 70ms
```

The pianist literally holds the generative process open with the keyboard.

## Dynamic bifurcation

```text
when any note velocity 1..60:
  play +12 velocity 25 after 500ms

when any note velocity 90..127:
  play -12 velocity input*0.8 repeat 5 every 120ms
```

Soft and strong playing lead into different musical worlds.

## Harmonic password

```text
when chord [C4 E4 G4] within 160ms:
  play sequence answer
```

A particular sonority opens a larger process.

## Process accompanying process

```text
sequence answer:
  play +12 for 120ms
  wait 200ms
  play +7 for 120ms
  wait 200ms
  play +3 for 200ms

when note D4:
  play sequence answer

while sequence answer playing every 150ms:
  play random [-12 -7 +5] velocity 30..50 for 60ms
```

Relative pitches can also appear inside a random list, so the companion process remains related to the note that launched the sequence.

## Accelerating response

```text
when any note:
  play +4 velocity input*0.7 repeat 9 every 420ms accelerate 0.84 for 90ms
```

A single note starts a process with its own changing temporal energy.

## Autonomous partner

```text
every random 3s..9s:
  play random [C3 D3 F3 G3 A3] velocity 20..45 for 180ms
```

The instrument acquires a degree of independence from the performer.

---

# Grammar reference

## Triggers

```text
when any note:
when any note velocity 40..100:
when note C4:
when note C4 velocity 80..127:
when chord [C4 E4 G4] within 180ms:
when chord [C4 E4 G4] within 180ms velocity 70..127:

after start 8s:
every 3s:
every random 2s..5s:

while note C4 down:
while note C4 down every 180ms:
while note C4 down velocity 80..127 every 180ms:
while any note down:
while any note down velocity 80..127 every 120ms:
while sequence answer playing:
while sequence answer playing every 220ms:
```

## Actions

```text
play C5
play +7
play [C5 E5 G5]
play random [C4 D4 E4 G4 A4]

play +12 velocity input
play +12 velocity input*0.7
play C5 velocity 70
play C5 velocity 30..60

play C5 after 300ms
play C5 for 500ms
play C5 repeat 8 every 200ms
play +4 repeat 10 every 400ms accelerate 0.84
play C5 channel 2

play sequence answer
go to section Echoes
play midi "gesture.mid"
play sound "resonance.wav"
wait 250ms
stop all
```

Most modifiers can be combined on the same `play` line.

---

## A useful compositional principle

Try to think of PianoRules less as *automatic accompaniment* and more as a way of defining **relationships**:

- a note can cast a shadow;
- a chord can open a process;
- a held key can sustain a machine;
- dynamics can switch between behaviours;
- a sequence can awaken another sequence;
- time can act independently of the performer;
- randomisation can give the instrument partial autonomy.

The most interesting rules are often not the most complicated ones. A very small rule can change how a performer listens, waits, phrases, or chooses what to play next.


---

# Credits

**PianoRules** was created by **Adrián Artacho**, composer and educator at the [Music and Arts University of the City of Vienna (MUK)](https://muk.ac.at/studienangebot/lehrende/details/adrian-artacho.html).

The project is conceived as an open environment for performer–algorithm interaction, experimentation, teaching, and shared musical materials.
