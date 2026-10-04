# Changelog

## 1.2.0 — 2026-10-04

- Click the "Year" header to sort your playlist by release year: first click oldest first, second click newest first. Spotify has no year sort for playlists, so DJ Mix reorders the playlist itself, one block per year; added dates and the order inside each year are kept. The view switches to Custom order. Only playlists you can edit.

## 1.1.2 — 2026-10-04

- Year column stays in its place in Mix-mode playlists: when Spotify re-renders a row and inserts its cells after the year cell, the year cell moves back right before the duration.

## 1.1.1 — 2026-10-04

- Year column no longer jitters: the column layout is a stylesheet rule that survives Spotify re-rendering rows, and missing cells are restored before the next frame is painted.

## 1.1.0 — 2026-10-04

- "Year" column in every playlist: the release year of each track, right before the duration. Tracks from Spotify's "Recommended" block under a playlist have no year, because they are not in the playlist.

## 1.0.0 — 2026-10-04

- "DJ Mix" in the playlist context menu.
- Key and BPM from Spotify's own Mix data (the same Camelot keys Spotify shows), energy from Spotify audio features.
- Ordering: Camelot-wheel transitions, a two-wave energy arc, BPM steps of 2 or less, no two versions of one track side by side, no artist twice in a row.
- Result saved as a new playlist "DJ Mix — <name>"; the original is never changed.
