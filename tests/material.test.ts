import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { materialBalance, materialGivenUp, sacrificeSize } from '../src/lib/material';

describe('materialBalance', () => {
  it('is 0 at the start and signed by point of view', () => {
    expect(materialBalance(new Chess(), 'w')).toBe(0);
    const c = new Chess('4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1');
    expect(materialBalance(c, 'w')).toBe(6);
    expect(materialBalance(c, 'b')).toBe(-6);
  });
});

describe('materialGivenUp (capture-only search)', () => {
  it('is 0 for a quiet, safe move', () => {
    expect(materialGivenUp('4k3/8/8/3p4/8/8/8/1Q2K3 w - - 0 1', 'b1b2')).toBe(0);
  });

  it('counts a piece left en prise (queen into a pawn capture)', () => {
    expect(materialGivenUp('4k3/8/8/3p4/8/8/8/1Q2K3 w - - 0 1', 'b1e4')).toBe(9);
  });

  it('is negative when the move wins material outright', () => {
    expect(materialGivenUp('4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1', 'd1d5')).toBe(-3);
  });

  it('is 0 for an even trade that is recaptured', () => {
    expect(materialGivenUp('4k3/8/2p5/3n4/8/5B2/8/4K3 w - - 0 1', 'f3d5')).toBe(0);
  });

  it('counts an exchange sacrifice as 2', () => {
    expect(materialGivenUp('4k3/8/2p5/3n4/8/8/8/3RK3 w - - 0 1', 'd1d5')).toBe(2);
  });

  it('sees the Greek gift (Bxh7+ Kxh7) as a piece for a pawn', () => {
    const fen = 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8';
    expect(materialGivenUp(fen, 'd3h7')).toBe(2);
  });

  it('does not count a checkmating move as giving anything up', () => {
    // Back-rank mate: Ra8#.
    expect(materialGivenUp('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8')).toBeLessThan(0);
  });
});

describe('sacrificeSize (relative to the best material-preserving alternative)', () => {
  it('is 0 when every legal move loses the same material (forced loss, not a sacrifice)', () => {
    // Knight fork: the king must move and the rook falls whatever White does.
    const fen = '4k3/8/8/8/8/8/2n5/R3K3 w - - 0 1';
    expect(materialGivenUp(fen, 'e1d2')).toBe(5);
    expect(sacrificeSize(fen, 'e1d2')).toBe(0);
  });

  it('counts a piece left hanging when it could have been saved', () => {
    expect(sacrificeSize('4k3/8/8/8/2p5/3N4/8/4K3 w - - 0 1', 'e1f2')).toBe(3);
  });

  it('counts the Greek gift as a 2-point sacrifice', () => {
    const fen = 'r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8';
    expect(sacrificeSize(fen, 'd3h7')).toBe(2);
  });

  it('is 0 for moves that win material', () => {
    expect(sacrificeSize('4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1', 'd1d5')).toBe(0);
  });
});
