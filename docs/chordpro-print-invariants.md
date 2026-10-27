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


## Experimental V2 pagination (October 2026)

- V2 preview, individual export and setlist export share `PaginatedSongSheet`.
- Automatic pagination keeps a readable font; the two-page choice spreads short
  songs and scales within a readable range. Longer documents may use more pages.
- Measured section heights come from `SongSheet`, not character-count estimates.
- Sections remain intact unless taller than one column, when they continue at
  lyric-line boundaries with a continuation label. Explicit page breaks start a
  new page. Every source section and line stays in order.
- Repeated content in condensed mode says which section to repeat.
- Preview and render documents use fixed Letter page frames with per-page
  numbering, without a one-page outer clipping container.
- Single-column complete output is supported by the pager; it no longer forces
  condensed mode.
- The V1 export remains available as the legacy engine.

## Personal charts (October 2026)

- Notes, target tone, capo and print-format preferences are keyed by musician and
  song, independent of event arrangements and the shared song source.
- Individual chart PDFs may include the signed-in musician's private note.
  Setlist PDFs and ProPresenter lyric exports do not receive that note.
- Supabase persistence uses migration `056_chordpro_personal_preferences.sql`
  with row-level security restricted to `auth.uid() = perfil_id`. Until the
  migration is applied, the print editor keeps a per-account/per-song browser
  copy and labels it as device-only.
