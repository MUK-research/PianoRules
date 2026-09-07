# PianoRules Library

A short share link such as `?ruleset=Cage` resolves by convention to:

```text
Library/Cage/Cage.rules
```

and, unless the rules file declares another asset base, its referenced assets are resolved from:

```text
Library/Cage/assets/
```

Example layout:

```text
Library/
  Cage/
    Cage.rules
    assets/
      sound.wav
      gesture.mid
```
