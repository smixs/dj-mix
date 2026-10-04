# Changelog

## 1.1.1 — 2026-10-04

- Year column no longer jitters: the column layout is a stylesheet rule that survives Spotify re-rendering rows, and missing cells are restored before the next frame is painted.

## 1.1.0 — 2026-10-04

- "Year" column in every playlist: the release year of each track, right before the duration. Tracks from Spotify's "Recommended" block under a playlist have no year, because they are not in the playlist.

## 1.0.0 — 2026-10-04

- "DJ Mix" in the playlist context menu.
- Key and BPM from Spotify's own Mix data (the same Camelot keys Spotify shows), energy from Spotify audio features.
- Ordering: Camelot-wheel transitions, a two-wave energy arc, BPM steps of 2 or less, no two versions of one track side by side, no artist twice in a row.
- Result saved as a new playlist "DJ Mix — <name>"; the original is never changed.
