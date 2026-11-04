import { describe, expect, it } from 'vitest';
import data from '../src/data/openings.json';
import { createBook, detectBook, type OpeningsData } from '../src/lib/openings';
import { parseGame } from '../src/lib/pgn';

const book = createBook(data as unknown as OpeningsData);

describe('opening book (lichess-org/chess-openings, CC0)', () => {
  it('names the Sicilian', () => {
    const info = detectBook(parseGame('1. e4 c5 *'), book);
    expect(info.opening).toEqual({ eco: 'B20', name: 'Sicilian Defense' });
    expect(info.isBook).toEqual([true, true]);
  });

  it('follows a long main line and names the deepest position', () => {
    const g = parseGame('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *');
    const info = detectBook(g, book);
    expect(info.isBook.every(Boolean)).toBe(true);
    expect(info.opening?.name).toMatch(/^Ruy Lopez/);
  });

  it('recognizes transpositions (position-based, not move-order based)', () => {
    const a = detectBook(parseGame('1. d4 d5 2. Nf3 *'), book);
    const b = detectBook(parseGame('1. Nf3 d5 2. d4 *'), book);
    expect(a.opening).toBeDefined();
    expect(b.opening).toEqual(a.opening);
    expect(b.isBook[2]).toBe(true);
  });

  it('leaves book for good once a move is not in it', () => {
    const info = detectBook(parseGame('1. e4 e5 2. Ke2 Nc6 3. Ke1 *'), book);
    // 2. Ke2 is actually a named line (Bongcloud); 2...Nc6 and 3. Ke1 are not book even if one transposed back.
    expect(info.isBook[0]).toBe(true);
    expect(info.isBook[4]).toBe(false);
    for (let i = info.isBook.indexOf(false); i < info.isBook.length; i++) expect(info.isBook[i]).toBe(false);
  });

  it('stops at the configured max ply', () => {
    const info = detectBook(parseGame('1. e4 e5 2. Nf3 Nc6 *'), book, 2);
    expect(info.isBook).toEqual([true, true, false, false]);
  });
});
