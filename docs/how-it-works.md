# How DJ Mix orders a playlist

## Data

- **Key and BPM** come from the `AUDIO_ATTRIBUTES_V2` track extension, the same data Spotify uses for the Camelot key and BPM columns in its Mix mode.
- **Energy** (0 to 1) comes from Spotify's internal audio features endpoint. If a track has no Mix key, its key and tempo fall back to the same endpoint.

## Score

The order minimises a sum over positions. For position `i` of `n`:

| Term | Weight | Meaning |
|---|---|---|
| Arc | `1.5 × |energyRank − target(i/(n−1))|` | `target(x) = 0.15 + 0.7x + 0.15·sin(4πx − π/2)`: calm start, wave at ~¼, dip, higher wave at ~¾, short cool-down |
| Key | 0 same key, 0.1 ±1 or relative major/minor, 0.35 +2 boost, 0.4 diagonal, 2.0 off the wheel | transition from the previous track |
| Tempo | `0.15 × max(0, |ΔBPM| − 2)` | small steps only; BPM never drives the arc |
| Repeats | 1.5 same title (another version), 0.5 same main artist | variety |

`energyRank` is the track's energy rank inside the playlist, so the arc works for any genre.

## Search

Simulated annealing: 300,000 random swaps with a cooling temperature, starting from the playlist sorted by energy. It yields to the UI every 20,000 swaps and is deterministic for the same playlist.

## Output

A new playlist `DJ Mix — <name>` at the top of your library. The original playlist is not modified.
