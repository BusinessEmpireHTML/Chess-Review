import { useEffect, useRef, useState } from 'preact/hooks';
import { ANALYSIS_PRESETS, type AnalysisPreset } from '../config/classification';
import { LITE_ENGINE, loadEngineFlavors, type EngineFlavor } from '../engine/pool';
import {
  ChessComError,
  fetchArchives,
  fetchMonth,
  formatTimeControl,
  isValidUsername,
  normalizeUsername,
  playerColor,
  type ChessComGame,
} from '../lib/chesscom';
import { replay } from '../lib/explore';
import { gameFingerprint, parseGame } from '../lib/pgn';
import { detectResult } from '../lib/play';
import { load, save } from '../lib/storage';
import { Home, type Filters, type HomeTab, type ListState } from './Home';
import { Play, SAVED_GAME_KEY, type SavedGame } from './Play';
import { Review, type GameSource } from './Review';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** The saved bot game, if it is still in progress (and not corrupt). */
function unfinishedGame(): SavedGame | null {
  const g = load<SavedGame | null>(SAVED_GAME_KEY, null);
  try {
    if (!g || g.resigned || !Array.isArray(g.moves) || !g.moves.length) return null;
    return detectResult(replay(START_FEN, g.moves)) ? null : g;
  } catch {
    return null;
  }
}

const EMPTY_LIST: ListState = { username: '', archives: [], loaded: 0, games: [], variants: 0, loading: false, error: null };

function sourceFromChessCom(g: ChessComGame, username: string): GameSource {
  const date = new Date(g.endTime * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return {
    id: g.url,
    url: g.url,
    pgn: g.pgn,
    white: { name: g.white.username, rating: g.white.rating },
    black: { name: g.black.username, rating: g.black.rating },
    userColor: playerColor(g, username) ?? undefined,
    subtitle: `${g.timeClass[0].toUpperCase() + g.timeClass.slice(1)} · ${formatTimeControl(g.timeControl)} · ${date}${g.rated ? '' : ' · unrated'}`,
  };
}

function sourceFromPgn(pgn: string, rememberedUser: string): GameSource {
  const game = parseGame(pgn);
  const h = game.headers;
  const white = h.White && h.White !== '?' ? h.White : 'White';
  const black = h.Black && h.Black !== '?' ? h.Black : 'Black';
  const u = rememberedUser.toLowerCase();
  return {
    id: h.Link || gameFingerprint(game),
    url: h.Link?.startsWith('https://www.chess.com/') ? h.Link : undefined,
    pgn,
    white: { name: white, rating: Number(h.WhiteElo) || undefined },
    black: { name: black, rating: Number(h.BlackElo) || undefined },
    userColor: u && black.toLowerCase() === u ? 'b' : u && white.toLowerCase() === u ? 'w' : undefined,
    subtitle: [h.Event && h.Event !== '?' ? h.Event : '', h.Date && !h.Date.includes('?') ? h.Date : ''].filter(Boolean).join(' · ') || 'Pasted PGN',
  };
}

export function App() {
  const [list, setList] = useState<ListState>(EMPTY_LIST);
  const [filters, setFilters] = useState<Filters>({ time: 'all', result: 'all' });
  const [tab, setTab] = useState<HomeTab>(() => (location.hash === '#play' ? 'play' : 'chesscom'));
  const [source, setSource] = useState<GameSource | null>(null);
  const [play, setPlay] = useState<SavedGame | null>(() => (location.hash === '#play' ? unfinishedGame() : null));
  const [preset, setPreset] = useState<AnalysisPreset>(() => {
    const p = load<string>('preset', 'standard');
    return p in ANALYSIS_PRESETS ? (p as AnalysisPreset) : 'standard';
  });
  const [flavors, setFlavors] = useState<EngineFlavor[]>([LITE_ENGINE]);
  const [flavorId, setFlavorId] = useState<string>(() => load('engine', LITE_ENGINE.id));
  const lastUser = useRef(load<string>('lastUsername', ''));
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef(list);
  listRef.current = list;

  const flavor = flavors.find((f) => f.id === flavorId) ?? flavors[0];

  useEffect(() => {
    loadEngineFlavors().then(setFlavors);
  }, []);

  // The back button leaves a review or a game. A refresh during a bot game resumes it.
  useEffect(() => {
    const onPop = () => {
      if (location.hash !== '#review') setSource(null);
      if (location.hash !== '#play') setPlay(null);
    };
    window.addEventListener('popstate', onPop);
    if (location.hash === '#review' || (location.hash === '#play' && !play)) history.replaceState(null, '', location.pathname + location.search);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Fetch archive months one at a time until at least one standard game shows up (max 3 empty months). */
  const loadMonths = async (state: ListState, signal: AbortSignal) => {
    let s = { ...state };
    let tries = 0;
    const before = s.games.length;
    while (s.loaded < s.archives.length && tries < 3) {
      const month = await fetchMonth(s.archives[s.loaded], signal);
      const standard = month.filter((g) => g.rules === 'chess');
      s = { ...s, loaded: s.loaded + 1, games: [...s.games, ...standard], variants: s.variants + month.length - standard.length };
      tries++;
      if (s.games.length > before) break;
    }
    return s;
  };

  const search = async (raw: string) => {
    const username = normalizeUsername(raw);
    if (!isValidUsername(username)) {
      setList({ ...EMPTY_LIST, error: 'That does not look like a Chess.com username.' });
      return;
    }
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    lastUser.current = username;
    save('lastUsername', username);
    setFilters({ time: 'all', result: 'all' });
    setList({ ...EMPTY_LIST, username, loading: true });
    try {
      const archives = await fetchArchives(username, ctl.signal);
      if (!archives.length) {
        setList({ ...EMPTY_LIST, username, error: `${username} has no archived games yet.` });
        return;
      }
      const loaded = await loadMonths({ ...EMPTY_LIST, username, archives, loading: true }, ctl.signal);
      if (!ctl.signal.aborted) setList({ ...loaded, loading: false });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setList({ ...EMPTY_LIST, username, error: e instanceof ChessComError ? e.message : `Something went wrong: ${(e as Error).message}` });
    }
  };

  const loadOlder = async () => {
    const ctl = (abort.current = new AbortController());
    const current = listRef.current;
    setList({ ...current, loading: true, error: null });
    try {
      const next = await loadMonths(current, ctl.signal);
      if (!ctl.signal.aborted) setList({ ...next, loading: false });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setList({ ...listRef.current, loading: false, error: e instanceof ChessComError ? e.message : (e as Error).message });
    }
  };

  useEffect(() => {
    if (lastUser.current) search(lastUser.current);
  }, []);

  const open = (s: GameSource) => {
    setSource(s);
    history.pushState(null, '', '#review');
    window.scrollTo(0, 0);
  };

  const back = () => {
    if (location.hash === '#review' || location.hash === '#play') history.back();
    else {
      setSource(null);
      setPlay(null);
    }
  };

  const startPlay = (g: SavedGame) => {
    save(SAVED_GAME_KEY, g);
    setTab('play'); // so Back from the game (or its review) lands on the Play tab
    setPlay(g);
    history.pushState(null, '', '#play');
    window.scrollTo(0, 0);
  };

  return (
    <div class="app">
      <header class="topbar">
        <button class="brand" onClick={() => (source || play) && back()} aria-label="Ply home">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <rect x="2" y="2" width="28" height="28" rx="8" class="brand-tile" />
            <path d="M9 22.5h14M11 22.5l1.6-7.5h6.8l1.6 7.5M12.4 15c-1.4-1-2-2.4-2-3.7 0-2.6 2.5-4.3 5.6-4.3s5.6 1.7 5.6 4.3c0 1.3-.6 2.7-2 3.7" class="brand-mark" />
          </svg>
          <span class="brand-name">Ply</span>
          <span class="brand-tag">game review</span>
        </button>
        <span class="topbar-note">Runs locally · Stockfish 19</span>
      </header>

      <main>
        {source ? (
          <Review
            key={source.id}
            source={source}
            preset={preset}
            onPreset={(p) => {
              setPreset(p);
              save('preset', p);
            }}
            flavors={flavors}
            flavor={flavor}
            onFlavor={(f) => {
              setFlavorId(f.id);
              save('engine', f.id);
            }}
            onBack={back}
          />
        ) : play ? (
          <Play
            key={play.startedAt}
            initial={play}
            flavor={flavor}
            onReview={(s) => {
              setPlay(null);
              setSource(s);
              history.replaceState(null, '', '#review');
              window.scrollTo(0, 0);
            }}
            onNewGame={() => {
              setTab('play');
              back();
            }}
          />
        ) : (
          <Home
            list={list}
            filters={filters}
            onFilters={setFilters}
            initialUsername={lastUser.current}
            onSearch={search}
            onLoadOlder={loadOlder}
            onOpenGame={(g) => open(sourceFromChessCom(g, list.username))}
            onOpenPgn={(pgn) => open(sourceFromPgn(pgn, lastUser.current))}
            tab={tab}
            onTab={setTab}
            savedGame={tab === 'play' ? unfinishedGame() : null}
            onPlay={(color, level) => startPlay({ color, level, moves: [], resigned: false, startedAt: Date.now() })}
            onResume={() => {
              const g = unfinishedGame();
              if (g) startPlay(g);
            }}
          />
        )}
      </main>

      <footer class="footer muted">
        Engine: <a href="https://github.com/nmrugg/stockfish.js">Stockfish.js</a> (GPL-3.0) · Openings:{' '}
        <a href="https://github.com/lichess-org/chess-openings">lichess-org/chess-openings</a> (CC0) · Games: Chess.com public API
      </footer>
    </div>
  );
}
