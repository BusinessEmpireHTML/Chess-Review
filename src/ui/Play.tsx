import { Chess } from 'chess.js';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { BOT_MIN_THINK_MS, botLevel } from '../config/play';
import { getInteractiveEngine } from '../engine/interactive';
import type { EngineFlavor } from '../engine/pool';
import { pickBotMove } from '../lib/botpick';
import { isPromotion, legalDests, legalUcis, replay } from '../lib/explore';
import { appendUserMove, botName, buildPlayPgn, describeResult, detectResult, resignation } from '../lib/play';
import { gameFingerprint, parseGame, type Ply } from '../lib/pgn';
import { save } from '../lib/storage';
import type { Color } from '../lib/types';
import { Board } from './Board';
import { MoveList } from './MoveList';
import type { GameSource } from './Review';
import { isTyping } from './theme';

/** A game against the bot, as saved in localStorage after every move. */
export interface SavedGame {
  color: Color;
  level: number;
  moves: string[];
  resigned: boolean;
  startedAt: number;
}

export const SAVED_GAME_KEY = 'playGame';
const START = new Chess().fen();

interface Props {
  initial: SavedGame;
  flavor: EngineFlavor;
  onReview: (source: GameSource) => void;
  onNewGame: () => void;
}

function pliesOf(chess: Chess): Ply[] {
  return chess.history({ verbose: true }).map((m, i) => ({
    index: i,
    moveNumber: Math.floor(i / 2) + 1,
    color: m.color,
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ''),
    from: m.from,
    to: m.to,
    piece: m.piece,
    captured: m.captured,
    promotion: m.promotion,
    fenBefore: m.before,
    fenAfter: m.after,
  }));
}

export function Play({ initial, flavor, onReview, onNewGame }: Props) {
  const [moves, setMoves] = useState<string[]>(initial.moves);
  const [resigned, setResigned] = useState(initial.resigned);
  const [thinking, setThinking] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>(initial.color === 'w' ? 'white' : 'black');
  const level = botLevel(initial.level);
  const you = initial.color;

  const chess = useMemo(() => replay(START, moves), [moves]);
  const plies = useMemo(() => pliesOf(chess), [chess]);
  const fen = chess.fen();
  const turn = chess.turn();
  const result = resigned ? resignation(you) : detectResult(chess);
  const last = plies[plies.length - 1];

  useEffect(() => {
    save(SAVED_GAME_KEY, { ...initial, moves, resigned } satisfies SavedGame);
  }, [moves, resigned]);

  // Stockfish's turn.
  useEffect(() => {
    if (result || turn === you) {
      setThinking(false);
      return;
    }
    let live = true;
    const started = performance.now();
    setThinking(true);
    setError(null);
    getInteractiveEngine(flavor)
      .search({ startFen: START, moves, depth: level.depth, multiPv: level.multiPv })
      .then(async (res) => {
        if (!live || !res) return;
        const uci = pickBotMove(res.lines, level, legalUcis(fen), Math.random);
        const wait = BOT_MIN_THINK_MS - (performance.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (live) setMoves((m) => [...m, uci]);
      })
      .catch((e: Error) => live && setError(`Stockfish stopped: ${e.message}`))
      .finally(() => live && setThinking(false));
    return () => {
      live = false;
      getInteractiveEngine(flavor).cancel();
    };
  }, [moves, resigned]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      if (e.key === 'f' || e.key === 'F') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const yourMoveIndexes = moves.map((_, i) => i).filter((i) => (i % 2 === 0 ? 'w' : 'b') === you);
  const canTakeBack = !resigned && yourMoveIndexes.length > 0;
  const takeBack = () => {
    const lastYours = yourMoveIndexes[yourMoveIndexes.length - 1];
    if (lastYours === undefined) return;
    getInteractiveEngine(flavor).cancel();
    setThinking(false);
    setMoves(moves.slice(0, lastYours));
  };

  const review = () => {
    const pgn = buildPlayPgn({ moves, userColor: you, level, result });
    const date = new Date(initial.startedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    onReview({
      id: gameFingerprint(parseGame(pgn)),
      pgn,
      white: { name: you === 'w' ? 'You' : botName(level) },
      black: { name: you === 'b' ? 'You' : botName(level) },
      userColor: you,
      subtitle: `vs Stockfish · Level ${level.level} (${level.name}) · ${date}`,
    });
  };

  const yourTurn = !result && turn === you && !thinking;
  const boardColor = you === 'w' ? 'white' : 'black';
  const outcome = result ? (result.winner === null ? 'draw' : result.winner === you ? 'win' : 'loss') : null;

  const opponent = (
    <div class={`play-player play-bot ${thinking ? 'is-thinking' : ''}`}>
      <span class="bot-avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect x="4" y="7" width="16" height="12" rx="4" fill="currentColor" opacity="0.9" />
          <circle cx="9.5" cy="13" r="1.6" fill="#14171c" />
          <circle cx="14.5" cy="13" r="1.6" fill="#14171c" />
          <path d="M12 3.5v3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </span>
      <div class="player-id">
        <span class="player-name">Stockfish</span>
        <span class="player-rating">
          Level {level.level} · {level.name}
        </span>
      </div>
      <span class="thinking-dots" aria-hidden={!thinking}>
        <i />
        <i />
        <i />
      </span>
    </div>
  );

  const youBar = (
    <div class="play-player play-you">
      <span class={`you-avatar piece-dot-${you}`} aria-hidden="true" />
      <div class="player-id">
        <span class="player-name">You</span>
        <span class="player-rating">Playing {you === 'w' ? 'White' : 'Black'}</span>
      </div>
    </div>
  );
  const userAtBottom = orientation === boardColor;

  return (
    <div class="play">
      <section class="board-col">
        {userAtBottom ? opponent : youBar}
        <div class="board-row">
          <Board
            fen={fen}
            orientation={orientation}
            lastMove={last ? [last.from, last.to] : undefined}
            arrows={[]}
            inCheck={!!last && /[+#]$/.test(last.san)}
            plyKey={moves.length}
            movable={{
              color: yourTurn ? boardColor : undefined,
              dests: yourTurn ? legalDests(fen) : new Map(),
              isPromotion: (from, to) => isPromotion(fen, from, to),
              onMove: (uci) => {
                if (!resigned) setMoves((m) => appendUserMove(m, uci, you));
              },
            }}
          />
        </div>
        {userAtBottom ? youBar : opponent}
      </section>

      <section class="side">
        <div class={`card play-status ${outcome ? 'outcome-' + outcome : ''}`} aria-live="polite">
          {result ? (
            <>
              <span class="play-result">{outcome === 'win' ? 'You won!' : outcome === 'loss' ? 'Stockfish won' : 'Draw'}</span>
              <span class="muted">
                {describeResult(result, you)} · {result.result.replace('1/2-1/2', '½–½')}
              </span>
              <div class="play-actions">
                <button class="btn btn-primary" onClick={review}>
                  Review this game
                </button>
                <button class="btn" onClick={onNewGame}>
                  New game
                </button>
              </div>
            </>
          ) : (
            <>
              <span class="play-result">{thinking ? 'Stockfish is thinking…' : turn === you ? 'Your move' : 'Waiting…'}</span>
              <span class="muted">
                You play {you === 'w' ? 'White' : 'Black'} · Level {level.level} ({level.name})
              </span>
              {error && <p class="error">{error}</p>}
            </>
          )}
        </div>

        <div class="card moves-card">
          <MoveList plies={plies} moves={[]} current={plies.length} onSelect={() => undefined} badges={false} />
          {!plies.length && <p class="muted play-empty">{you === 'w' ? 'You move first. Good luck!' : 'Stockfish moves first…'}</p>}
        </div>

        <div class="play-buttons">
          <button class="btn" onClick={takeBack} disabled={!canTakeBack} title="Undo your last move and Stockfish's reply">
            Take back
          </button>
          {!result &&
            (confirmResign ? (
              <button
                class="btn btn-danger"
                onClick={() => {
                  setResigned(true);
                  setConfirmResign(false);
                }}
                onBlur={() => setConfirmResign(false)}
              >
                Confirm resign
              </button>
            ) : (
              <button class="btn" onClick={() => setConfirmResign(true)} disabled={!moves.length}>
                Resign
              </button>
            ))}
          <button class="btn" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Flip board (F)">
            Flip
          </button>
          {!result && (
            <button class="btn btn-ghost" onClick={onNewGame}>
              New game
            </button>
          )}
        </div>
        {!result && moves.length > 0 && (
          <button class="btn btn-ghost play-review-now" onClick={review}>
            Review the game so far
          </button>
        )}
      </section>
    </div>
  );
}
