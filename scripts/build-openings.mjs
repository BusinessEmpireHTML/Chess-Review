// Converts the vendored lichess-org/chess-openings TSVs (CC0) into a compact,
// position-keyed lookup at src/data/openings.json. Skips work when up to date.
import { readFileSync, writeFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'data', 'openings');
const out = join(root, 'src', 'data', 'openings.json');
const tsvs = readdirSync(srcDir).filter((f) => f.endsWith('.tsv')).sort();

const newest = Math.max(...tsvs.map((f) => statSync(join(srcDir, f)).mtimeMs), statSync(fileURLToPath(import.meta.url)).mtimeMs);
if (existsSync(out) && statSync(out).mtimeMs >= newest && !process.argv.includes('--force')) {
  console.log('openings.json is up to date');
  process.exit(0);
}

const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
const names = {};
const book = new Set();
let lines = 0;

for (const file of tsvs) {
  const rows = readFileSync(join(srcDir, file), 'utf8').split('\n').slice(1);
  for (const row of rows) {
    if (!row.trim()) continue;
    const [eco, name, pgn] = row.split('\t');
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
    for (const san of sans) {
      chess.move(san);
      book.add(key(chess.fen()));
    }
    const k = key(chess.fen());
    // Keep the first (shortest-listed) name for a position reached by several lines.
    if (!names[k]) names[k] = [eco, name];
    lines++;
  }
}
for (const k of Object.keys(names)) book.delete(k);

writeFileSync(out, JSON.stringify({ names, book: [...book] }));
console.log(`openings.json: ${lines} lines, ${Object.keys(names).length} named positions, ${book.size} other book positions, ${(statSync(out).size / 1024).toFixed(0)} KB`);
