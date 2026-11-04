import { useState } from 'preact/hooks';
import { BOT_LEVELS, botLevel } from '../config/play';
import { load, save } from '../lib/storage';
import type { Color } from '../lib/types';
import type { SavedGame } from './Play';

export type ColorChoice = Color | 'random';

interface Props {
  saved: SavedGame | null;
  onStart: (color: Color, level: number) => void;
  onResume: () => void;
}

export function PlaySetup({ saved, onStart, onResume }: Props) {
  const [color, setColor] = useState<ColorChoice>(() => load<ColorChoice>('playColor', 'w'));
  const [level, setLevel] = useState<number>(() => load('playLevel', 3));
  const info = botLevel(level);

  const start = () => {
    save('playColor', color);
    save('playLevel', level);
    onStart(color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color, level);
  };

  return (
    <div class="play-setup">
      {saved && (
        <div class="resume">
          <span>
            Unfinished game vs <strong>Level {saved.level}</strong> · {Math.ceil(saved.moves.length / 2)} move{saved.moves.length > 2 ? 's' : ''}
          </span>
          <button class="btn btn-primary" onClick={onResume}>
            Resume
          </button>
        </div>
      )}

      <div class="setup-row">
        <span class="setup-label">Play as</span>
        <div class="seg seg-lg" role="radiogroup" aria-label="Your color">
          {(
            [
              ['w', 'White'],
              ['random', 'Random'],
              ['b', 'Black'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} role="radio" aria-checked={color === value} class={color === value ? 'on' : ''} onClick={() => setColor(value)}>
              {value !== 'random' && <span class={`piece-dot piece-dot-${value}`} />}
              {label}
            </button>
          ))}
        </div>
      </div>

      <div class="setup-row">
        <span class="setup-label">Difficulty</span>
        <div class="levels" role="radiogroup" aria-label="Difficulty level">
          {BOT_LEVELS.map((l) => (
            <button
              key={l.level}
              role="radio"
              aria-checked={l.level === level}
              aria-label={`Level ${l.level}, ${l.name}`}
              class={`level ${l.level === level ? 'on' : ''}`}
              style={{ '--lvl': String(l.level) } as Record<string, string>}
              onClick={() => setLevel(l.level)}
            >
              {l.level}
            </button>
          ))}
        </div>
        <p class="level-info">
          <strong>{info.name}</strong> <span class="muted">· {info.blurb}</span>
        </p>
      </div>

      <button class="btn btn-primary btn-lg" onClick={start}>
        {saved ? 'Start a new game' : 'Start game'}
      </button>
    </div>
  );
}
