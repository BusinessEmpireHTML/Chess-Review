# Ply: chess game review in the browser

Type a Chess.com username, pick a game, and get a move-by-move Stockfish review with
Chess.com-style classifications, Lichess-method accuracy, an eval graph, and arrows.
No accounts, no backend, no database, no analytics. The only network calls go to
`api.chess.com` (enforced with a Content-Security-Policy in `index.html`).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest unit tests
npm run build        # static site in dist/
npm run preview      # serve dist/ locally at http://localhost:4173
```

`dist/` is plain static files and works on any static host, including under a sub-path,
with no special headers. Browsers block Web Workers and WASM on `file://`, so to open the
build locally, serve it (`npm run preview`, or `python3 -m http.server -d dist`) rather
than double-clicking `index.html`.

### Optional: the full-strength engine

```bash
npm run build:full
```

This also ships Stockfish 19 with the full neural network (a ~99 MB `.wasm`) and adds an
engine picker to the review screen. It is opt-in because some hosts reject single files
that large (for example, Cloudflare Pages caps files at 25 MiB). The default build ships
only the 1.8 MB "lite" network.

## How it works

- **Engine:** the `stockfish` npm package (v19, by nmrugg), bundled locally from
  `node_modules` into `public/engine/`. The app runs the single-threaded WASM build as a
  **pool of 2–4 Web Workers**, each searching a different position. That uses several
  cores without `SharedArrayBuffer`, so it needs no COOP/COEP headers. Every position is
  searched with MultiPV 2 at the chosen depth (Fast 12 / Standard 16 / Deep 20), and moves
  fill in as they finish. The position you're looking at jumps to the front of the queue.
- **Cache:** raw engine output is stored in IndexedDB, keyed by game URL (or a PGN
  fingerprint), engine, and depth. Classifications are recomputed from it on every load,
  so editing the thresholds re-grades cached games instantly.
- **Openings:** the CC0 [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings)
  TSVs are vendored in `data/openings/` and compiled into a position-keyed lookup at build
  time. Transpositions still count as book. The lookup loads lazily as its own chunk.

## Tuning classifications

Every threshold lives in **`src/config/classification.ts`**. EPL is the drop in expected
points (win% / 100, from the mover's view) of the played move compared with the best move.

| Class | Rule (defaults) |
| --- | --- |
| Book | Still in a known opening line (position-based, max 40 plies) |
| Brilliant | Best or ≤ 0.02 EPL, **and** a sacrifice of ≥ 2 points, **and** mover's win% < 90 before, **and** ≥ 40 after |
| Great | The engine's top move, **and** the second-best move loses ≥ 0.10 EP |
| Best | The engine's top move (or an exact tie, or any move that checkmates) |
| Excellent / Good / Inaccuracy / Mistake | EPL ≤ 0.02 / 0.05 / 0.10 / 0.20 |
| Blunder | EPL > 0.20 |
| Miss | The opponent's previous move was a Mistake or Blunder, and this move's EPL is ≥ 0.10 |

Three refinements go beyond the base rules. The first two are switches in the config file.
- `great.excludeRecaptures` (on): a plain recapture on the square just captured on is shown
  as Best, not Great.
- `miss.keepBlunderIfWorseThanBefore` (on): if a move both fails to punish an error *and*
  leaves you worse off than before that error, it keeps its Mistake/Blunder label.
- **Sacrifices** are measured by a capture-only search, relative to the most
  material-preserving legal alternative. So a forced loss (escaping a fork) is not a
  "sacrifice", but leaving a piece hanging when it could have been saved is.

**Accuracy** follows Lichess (`src/lib/accuracy.ts`): per-move accuracy, then the average
of a volatility-weighted mean and a harmonic mean. Lichess's source adds a +1 "uncertainty
bonus" to each move. It is off by default here to match the stated formula; set
`ACCURACY.uncertaintyBonus = 1` to match lichess.org exactly.

## Project layout

```
scripts/        copy-engine.mjs (Stockfish → public/engine), build-openings.mjs (TSV → JSON)
data/openings/  vendored lichess chess-openings TSVs (CC0)
src/config/     classification.ts: all thresholds
src/lib/        winprob, accuracy, material (sacrifice search), classify, review,
                explain, openings, pgn, chesscom (API client), cache (IndexedDB), storage
src/engine/     uci.ts (UCI parser), engine.ts (worker wrapper), pool.ts (worker pool)
src/ui/         Preact components: App, Home, Review, Board (chessground), EvalBar,
                EvalGraph, MoveList, Badge, useAnalysis
tests/          Vitest suites (classification, accuracy, mate edge cases, UCI, API, cache)
```

## Chess.com API

Uses the public, no-auth endpoints `/pub/player/{user}/games/archives` and the monthly
archive URLs it returns. Months load one at a time (Chess.com asks for serial requests).
Variant games (chess960 etc.) are hidden. The response parsing is defensive and covered
by tests against the documented shape. Those fixtures were not captured from the live API,
because the build sandbox couldn't reach it.

## Keyboard

`←` / `→` step through moves · `Home` / `End` jump to the start or end · `F` flips the board.

## Licenses

App code: GPL-3.0-or-later (it bundles Stockfish and chessground, both GPL-3.0).
Openings dataset: CC0. Fonts: Manrope and JetBrains Mono (OFL), bundled via Fontsource.
