import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getInteractiveEngine } from '../engine/interactive';
import type { EngineFlavor } from '../engine/pool';
import { gradeMove, lineMove, replay, terminalState, type LineMove } from '../lib/explore';
import { sideToMove, type ParsedGame } from '../lib/pgn';
import type { MoveReport } from '../lib/review';
import { load, save } from '../lib/storage';
import type { Color, PositionEval } from '../lib/types';

/** A side line branching off the real game after `basePly` moves. */
export interface ExploreState {
  basePly: number;
  moves: LineMove[];
  /** How many of `moves` are shown on the board (0 = the branch point). */
  cursor: number;
}

interface Args {
  game: ParsedGame | null;
  /** Main-game analysis, reused for the branch point when available. */
  gameEvals: (PositionEval | undefined)[];
  depth: number;
  flavor: EngineFlavor;
  ply: number;
  setPly: (p: number) => void;
}

const REPLY_DELAY_MS = 350;

export function useExplore({ game, gameEvals, depth, flavor, ply, setPly }: Args) {
  const [state, setState] = useState<ExploreState | null>(null);
  const [replies, setRepliesState] = useState<boolean>(() => load('exploreReplies', true));
  const [evalMap, setEvalMap] = useState<Map<string, PositionEval>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const requested = useRef<string | null>(null);

  useEffect(() => {
    setState(null);
    setEvalMap(new Map());
  }, [game]);
  useEffect(() => setEvalMap(new Map()), [depth, flavor.id]);

  const active = !!(state && game);
  const fenAt = (s: ExploreState, cursor: number) => (cursor === 0 ? game!.fens[s.basePly] : s.moves[cursor - 1].fenAfter);
  const historyAt = (s: ExploreState, cursor: number) => [
    ...game!.plies.slice(0, s.basePly).map((p) => p.uci),
    ...s.moves.slice(0, cursor).map((m) => m.uci),
  ];

  /** Terminal state of every position in the line (needs full history for repetition). */
  const terminals = useMemo(() => {
    if (!state || !game) return [];
    return state.moves.map((_, i) => terminalState(replay(game.startFen, historyAt(state, i + 1))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.moves, game]);

  const evalAt = (s: ExploreState, cursor: number): PositionEval | undefined => {
    const terminal = cursor > 0 ? terminals[cursor - 1] : undefined;
    if (terminal) return { lines: [], terminal, depth: 0 };
    const fen = fenAt(s, cursor);
    return (cursor === 0 ? gameEvals[s.basePly] : undefined) ?? evalMap.get(fen);
  };

  const userColor: Color = state && game ? sideToMove(game.fens[state.basePly]) : 'w';
  const fen = state && game ? fenAt(state, state.cursor) : null;
  const currentEval = state && game ? evalAt(state, state.cursor) : undefined;
  const terminal = state && state.cursor > 0 ? terminals[state.cursor - 1] : undefined;

  /** Index of the latest move the user played at or before the cursor. */
  const lastUserIndex = useMemo(() => {
    if (!state) return -1;
    for (let k = state.cursor - 1; k >= 0; k--) if (!state.moves[k].byEngine) return k;
    return -1;
  }, [state]);

  // Positions to search, most important first: what's on the board, then
  // what's needed to grade the user's latest move.
  const needed = useMemo(() => {
    if (!state || !game) return [];
    const order = [state.cursor];
    if (lastUserIndex >= 0) order.push(lastUserIndex + 1, lastUserIndex);
    return order.filter((c, i) => order.indexOf(c) === i && !evalAt(state, c));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, evalMap, gameEvals, terminals, lastUserIndex]);

  useEffect(() => {
    if (!state || !game || !needed.length) {
      requested.current = null;
      return;
    }
    const cursor = needed[0];
    const target = fenAt(state, cursor);
    if (requested.current === target) return;
    requested.current = target;
    const engine = getInteractiveEngine(flavor);
    engine
      .search({ startFen: game.startFen, moves: historyAt(state, cursor), depth, multiPv: 2 })
      .then((result) => {
        if (requested.current === target) requested.current = null;
        if (result) setEvalMap((m) => new Map(m).set(target, result));
      })
      .catch((e: Error) => {
        requested.current = null;
        setError(e.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needed, flavor.id, depth]);

  // Stockfish answers for the other side at the end of the line.
  const engineToMove =
    !!state && !!fen && replies && !terminal && state.cursor === state.moves.length && sideToMove(fen) !== userColor;
  useEffect(() => {
    if (!engineToMove || !state || !fen) return;
    const best = currentEval?.lines[0]?.move;
    if (!best) return;
    const timer = setTimeout(() => {
      const m = lineMove(fen, best, true);
      if (m) setState((s) => (s && s.cursor === s.moves.length ? { ...s, moves: [...s.moves, m], cursor: s.cursor + 1 } : s));
    }, REPLY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [engineToMove, currentEval, fen]);

  // Leaving: drop whatever the interactive engine is doing.
  useEffect(() => {
    if (!state) getInteractiveEngine(flavor).cancel();
  }, [!state]);
  useEffect(() => () => getInteractiveEngine(flavor).cancel(), []);

  /** Grades for every user move in the line whose evaluations are ready. */
  const grades = useMemo<(MoveReport | null)[]>(() => {
    if (!state || !game) return [];
    return state.moves.map((m, k) => {
      if (m.byEngine) return null;
      const before = evalAt(state, k);
      const after = evalAt(state, k + 1);
      if (!before || !after) return null;
      const prev = k > 0 ? state.moves[k - 1] : game.plies[state.basePly - 1];
      return gradeMove(before, after, m, prev);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.moves, evalMap, gameEvals, terminals]);

  const thinking = active && !terminal && (!currentEval || engineToMove);

  /** A move made on the board, from either the real game or the side line. */
  const play = (uci: string) => {
    if (!game) return;
    if (!state) {
      if (game.plies[ply]?.uci === uci) return setPly(ply + 1); // the move actually played: just step forward
      const m = lineMove(game.fens[ply], uci);
      if (m) setState({ basePly: ply, moves: [m], cursor: 1 });
      return;
    }
    if (state.cursor === 0 && game.plies[state.basePly]?.uci === uci) {
      setState(null);
      return setPly(state.basePly + 1);
    }
    const m = lineMove(fenAt(state, state.cursor), uci);
    if (m) setState({ ...state, moves: [...state.moves.slice(0, state.cursor), m], cursor: state.cursor + 1 });
  };

  const exit = () => {
    if (state) setPly(state.basePly);
    setState(null);
  };

  return {
    active,
    state,
    userColor,
    fen,
    currentEval,
    terminal,
    grades,
    lastUserIndex,
    thinking,
    engineToMove,
    replies,
    error,
    setReplies: (v: boolean) => {
      setRepliesState(v);
      save('exploreReplies', v);
    },
    play,
    exit,
    goTo: (cursor: number) => setState((s) => (s ? { ...s, cursor: Math.max(0, Math.min(s.moves.length, cursor)) } : s)),
    back: () => {
      if (!state) return;
      if (state.cursor > 0) setState({ ...state, cursor: state.cursor - 1 });
      else {
        setState(null);
        setPly(Math.max(0, state.basePly - 1));
      }
    },
    forward: () => setState((s) => (s && s.cursor < s.moves.length ? { ...s, cursor: s.cursor + 1 } : s)),
    /** Who may move on the board right now. */
    movableColor: ((): 'white' | 'black' | undefined => {
      if (!game) return undefined;
      const toMove = sideToMove(fen ?? game.fens[ply]);
      const asBoard = toMove === 'w' ? 'white' : 'black';
      if (!state) return asBoard;
      if (terminal) return undefined;
      if (replies && toMove !== userColor) return undefined;
      return asBoard;
    })(),
  };
}

export type Explore = ReturnType<typeof useExplore>;
