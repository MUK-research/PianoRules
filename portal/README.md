# PianoRules · portal presentation

This folder is the project-owned presentation layer for the [Performance Research Lab portal](https://muk-research.github.io/PORTAL/).

Edit `metadata.json` for the description, credits, tags and links; `preview.svg` for the schematic thumbnail; and `index.html` for the silent chord/pattern sketch. These are not a second MIDI engine or measured performance data. The full app opens through the normal project link.

Published endpoint: https://muk-research.github.io/PianoRules/portal/metadata.json

The central registry contains only an id and this manifest URL, not a duplicate description. Relative paths resolve beside the JSON file. Reloading the portal picks up changes after this repository's Pages deployment/cache updates.

The mini-view is self-contained and works inside `sandbox="allow-scripts"` without same-origin access. It requests no microphone, MIDI, audio, tracking or storage. It sends `prl:ready` and `prl:resize` with the supplied `prlToken`, and validates the parent window/token before accepting `prl:visibility`. Animation pauses when hidden or disabled by the parent. The descriptions summarize the main README; existing project credits and licences still apply.
