// Copies the Stockfish WASM build(s) from node_modules into public/engine and
// writes public/engine/manifest.json. The lite single-threaded build is always
// included (1.8 MB, works on any static host). Pass --full (or set FULL_ENGINE=1)
// to also ship the full-network single-threaded build (~99 MB; some hosts reject
// files that big).
import './check-node.mjs';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'node_modules', 'stockfish', 'bin');
const out = join(root, 'public', 'engine');
mkdirSync(out, { recursive: true });

const flavors = [
  { id: 'lite', label: 'Stockfish 19 Lite', base: 'stockfish-19-lite-single', sizeMB: 1.8, maxWorkers: 4, hashMB: 32 },
];
const full = { id: 'full', label: 'Stockfish 19 (full network)', base: 'stockfish-19-single', sizeMB: 99, maxWorkers: 2, hashMB: 64 };
const wantFull = process.argv.includes('--full') || process.env.FULL_ENGINE === '1';
if (wantFull) flavors.push(full);
else for (const ext of ['.js', '.wasm']) rmSync(join(out, full.base + ext), { force: true });

for (const f of flavors) {
  for (const ext of ['.js', '.wasm']) {
    const src = join(bin, f.base + ext);
    const dst = join(out, f.base + ext);
    if (!existsSync(src)) throw new Error(`Missing ${src}. Run npm install.`);
    if (existsSync(dst) && statSync(dst).size === statSync(src).size && statSync(dst).mtimeMs >= statSync(src).mtimeMs) continue;
    copyFileSync(src, dst);
  }
}
copyFileSync(join(root, 'node_modules', 'stockfish', 'Copying.txt'), join(out, 'COPYING.txt'));

const manifest = flavors.map(({ base, ...f }) => ({ ...f, file: base + '.js' }));
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('engine:', manifest.map((f) => f.id).join(', '));
