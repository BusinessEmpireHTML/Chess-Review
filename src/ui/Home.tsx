import { useState } from 'preact/hooks';
import {
  countMoves,
  formatTimeControl,
  monthLabel,
  outcomeFor,
  playerColor,
  type ChessComGame,
  type Outcome,
  type TimeClass,
} from '../lib/chesscom';
import { parseGame, PgnError } from '../lib/pgn';
import type { Color } from '../lib/types';
import type { SavedGame } from './Play';
import { PlaySetup } from './PlaySetup';

export type HomeTab = 'chesscom' | 'pgn' | 'play';

export interface ListState {
  username: string;
  archives: string[];
  /** How many archives (months) have been fetched. */
  loaded: number;
  games: ChessComGame[];
  /** Games skipped because they are variants (chess960 etc.). */
  variants: number;
  loading: boolean;
  error: string | null;
}

export interface Filters {
  time: TimeClass | 'all';
  result: Outcome | 'all';
}

interface Props {
  list: ListState;
  filters: Filters;
  onFilters: (f: Filters) => void;
  initialUsername: string;
  onSearch: (username: string) => void;
  onLoadOlder: () => void;
  onOpenGame: (game: ChessComGame) => void;
  onOpenPgn: (pgn: string) => void;
  tab: HomeTab;
  onTab: (t: HomeTab) => void;
  savedGame: SavedGame | null;
  onPlay: (color: Color, level: number) => void;
  onResume: () => void;
}

const TIME_LABELS: Record<TimeClass, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily' };
const RESULT_LABELS: Record<Outcome, string> = { win: 'Wins', loss: 'Losses', draw: 'Draws' };
const OUTCOME_TEXT: Record<Outcome, string> = { win: 'Won', loss: 'Lost', draw: 'Draw' };

export function TimeIcon({ tc }: { tc: TimeClass }) {
  const paths: Record<TimeClass, string> = {
    bullet: 'M5 15.5c0-3.6 3.4-7.6 8.6-10.3l3.7-1.9-1.4 4C14 12.9 10.2 16.9 6.7 18.8L5 19.7z',
    blitz: 'M13.5 2.5L5 13.5h6l-1.5 8 8.5-11h-6z',
    rapid: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zm-.9 4v5.4l4.3 2.6.9-1.5-3.4-2V7.5z',
    daily: 'M12 6.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM11 1.5h2v3h-2zm0 18h2v3h-2zM1.5 11h3v2h-3zm18 0h3v2h-3z',
  };
  return (
    <svg class={`tc-icon tc-${tc}`} viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d={paths[tc]} fill="currentColor" />
    </svg>
  );
}

function GameCard({ game, username, onOpen }: { game: ChessComGame; username: string; onOpen: () => void }) {
  const color = playerColor(game, username) ?? 'w';
  const me = color === 'w' ? game.white : game.black;
  const opp = color === 'w' ? game.black : game.white;
  const outcome = outcomeFor(game, color);
  const date = new Date(game.endTime * 1000);
  const moves = countMoves(game.pgn);
  return (
    <button type="button" class={`game outcome-${outcome}`} onClick={onOpen}>
      <span class="game-strip" aria-hidden="true" />
      <span class="game-top">
        <span class={`piece-dot piece-dot-${color}`} title={`You played ${color === 'w' ? 'White' : 'Black'}`} />
        <span class="game-vs">vs</span>
        <span class="game-opp">{opp.username}</span>
        <span class="game-opp-rating">{opp.rating || ''}</span>
        <span class={`pill pill-${outcome}`}>{OUTCOME_TEXT[outcome]}</span>
      </span>
      <span class="game-meta">
        <span class="game-tc">
          <TimeIcon tc={game.timeClass} /> {formatTimeControl(game.timeControl)}
        </span>
        <span>{moves} moves</span>
        <span>
          {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
          {game.timeClass !== 'daily' && date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </span>
        <span class="game-me">
          You {me.rating || ''}
          {!game.rated && <em> · unrated</em>}
        </span>
      </span>
    </button>
  );
}

function Chip<T extends string>({ value, current, label, count, onPick }: { value: T; current: T; label: string; count?: number; onPick: (v: T) => void }) {
  return (
    <button type="button" class={`chip ${value === current ? 'on' : ''}`} aria-pressed={value === current} onClick={() => onPick(value)}>
      {label}
      {count !== undefined && <span class="chip-count">{count}</span>}
    </button>
  );
}

export function Home(props: Props) {
  const { list, filters, onFilters, tab, onTab } = props;
  const [input, setInput] = useState(props.initialUsername);
  const [pgn, setPgn] = useState('');
  const [pgnError, setPgnError] = useState<string | null>(null);

  const colorOf = (g: ChessComGame) => playerColor(g, list.username) ?? 'w';
  const byTime = list.games.filter((g) => filters.time === 'all' || g.timeClass === filters.time);
  const shown = byTime.filter((g) => filters.result === 'all' || outcomeFor(g, colorOf(g)) === filters.result);
  const timeCounts = (t: TimeClass) => list.games.filter((g) => g.timeClass === t).length;
  const resultCounts = (r: Outcome) => byTime.filter((g) => outcomeFor(g, colorOf(g)) === r).length;
  const nextMonth = list.archives[list.loaded];
  const lastLoadedMonth = list.loaded > 0 ? monthLabel(list.archives[list.loaded - 1]) : '';

  const submitPgn = () => {
    try {
      const g = parseGame(pgn);
      if (!g.plies.length) throw new PgnError('This PGN has no moves.');
      setPgnError(null);
      props.onOpenPgn(pgn);
    } catch (e) {
      setPgnError((e as Error).message);
    }
  };

  return (
    <div class="home">
      <section class="hero">
        <h1>
          Review any game, <span class="accent">move by move</span>.
        </h1>
        <p class="muted">Stockfish runs in your browser. Nothing is uploaded, no account, no tracking.</p>

        <div class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chesscom'} class={tab === 'chesscom' ? 'on' : ''} onClick={() => onTab('chesscom')}>
            Chess.com username
          </button>
          <button role="tab" aria-selected={tab === 'pgn'} class={tab === 'pgn' ? 'on' : ''} onClick={() => onTab('pgn')}>
            Paste PGN
          </button>
          <button role="tab" aria-selected={tab === 'play'} class={tab === 'play' ? 'on' : ''} onClick={() => onTab('play')}>
            Play Stockfish
          </button>
        </div>

        {tab === 'chesscom' ? (
          <form
            class="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) props.onSearch(input);
            }}
          >
            <span class="search-at" aria-hidden="true">
              @
            </span>
            <input
              value={input}
              onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              placeholder="Chess.com username"
              aria-label="Chess.com username"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              enterkeyhint="search"
            />
            <button class="btn btn-primary" type="submit" disabled={list.loading || !input.trim()}>
              {list.loading && !list.games.length ? 'Loading…' : 'Find games'}
            </button>
          </form>
        ) : tab === 'play' ? (
          <PlaySetup saved={props.savedGame} onStart={props.onPlay} onResume={props.onResume} />
        ) : (
          <div class="pgn-box">
            <textarea
              value={pgn}
              onInput={(e) => setPgn((e.target as HTMLTextAreaElement).value)}
              placeholder={'[Event "Casual game"]\n[White "You"]\n[Black "Opponent"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 …'}
              aria-label="PGN"
              spellcheck={false}
              rows={8}
            />
            {pgnError && <p class="error">{pgnError}</p>}
            <button class="btn btn-primary" onClick={submitPgn} disabled={!pgn.trim()}>
              Analyze PGN
            </button>
          </div>
        )}
      </section>

      {tab === 'chesscom' && (
        <section class="list">
          {list.error && (
            <div class="notice error-notice" role="alert">
              {list.error}
            </div>
          )}

          {list.username && list.games.length > 0 && (
            <div class="filters">
              <div class="chips" role="group" aria-label="Time control">
                <Chip value="all" current={filters.time} label="All" count={list.games.length} onPick={(time) => onFilters({ ...filters, time })} />
                {(Object.keys(TIME_LABELS) as TimeClass[]).map((t) =>
                  timeCounts(t) ? (
                    <Chip key={t} value={t} current={filters.time} label={TIME_LABELS[t]} count={timeCounts(t)} onPick={(time) => onFilters({ ...filters, time })} />
                  ) : null,
                )}
              </div>
              <div class="chips" role="group" aria-label="Result">
                <Chip value="all" current={filters.result} label="Any result" onPick={(result) => onFilters({ ...filters, result })} />
                {(Object.keys(RESULT_LABELS) as Outcome[]).map((r) => (
                  <Chip key={r} value={r} current={filters.result} label={RESULT_LABELS[r]} count={resultCounts(r)} onPick={(result) => onFilters({ ...filters, result })} />
                ))}
              </div>
            </div>
          )}

          {list.username && !list.loading && !list.error && list.loaded > 0 && (
            <p class="list-caption muted">
              {list.games.length} game{list.games.length === 1 ? '' : 's'} for <strong>{list.username}</strong> since {lastLoadedMonth}
              {list.variants > 0 && ` · ${list.variants} variant game${list.variants === 1 ? '' : 's'} hidden`}
            </p>
          )}

          <div class="games">
            {shown.map((g) => (
              <GameCard key={g.url} game={g} username={list.username} onOpen={() => props.onOpenGame(g)} />
            ))}
            {list.loading && Array.from({ length: list.games.length ? 2 : 6 }, (_, i) => <div class="game skeleton" key={'s' + i} />)}
          </div>

          {!list.loading && list.loaded > 0 && shown.length === 0 && (
            <p class="empty muted">
              {list.games.length ? 'No games match these filters in the months loaded so far.' : `No standard games in ${lastLoadedMonth}.`}
            </p>
          )}

          {nextMonth && !list.loading && (
            <button class="btn load-older" onClick={props.onLoadOlder}>
              Load older · {monthLabel(nextMonth)}
            </button>
          )}
          {list.username && !nextMonth && list.loaded > 0 && !list.loading && <p class="empty muted">That's every archived month.</p>}
        </section>
      )}
    </div>
  );
}
