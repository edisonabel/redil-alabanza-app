# ChordPro print invariants

This document captures the current behavior we must preserve while the new
parser, resolver and pager are built in parallel.

## Existing behavior that must keep working

- `ChordProPrintWorkspace` controls transposition, capo, render mode, density,
  song map and section divider toggles.
- `setDensityMode()` keeps `density` and `styleMode` in sync.
- `SongSheetLine` remains the source of truth for chord + lyric line rendering.
- `buildChordGuide()` remains the source of truth for chord positioning inside
  one parsed line.
- `SongSheet` still supports:
  - `chords-lyrics`
  - `lyrics-only`
  - `chords-only`
  - `1` column
  - `2` columns
  - `completo`
  - `condensado`
- The current `SongSheet` path stays active until the new pipeline is validated.

## Current known defects we are intentionally fixing

- Empty references like `CORO`, `PUENTE 2`, `FINAL` are dropped by the legacy
  parser.
- `condensado` still collapses by marker family instead of real repetition.
- Preview and print still assume a single page and clip overflow aggressively.

## Migration rules

- Do not remove the legacy parser until the semantic parser is validated.
- Do not replace `SongSheet` with a pager until multi-page rendering is stable.
- Do not remove print CSS until the new print path is working in Chrome and iOS.
- New code must enter in parallel and stay opt-in until verified.

