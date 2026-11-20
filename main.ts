// Entry point for the token launch radar (Node standard library only).
//
// Reads the sealed snapshot, writes the ranked board and dashboard data,
// copies the dashboard and screenshots into the output folder, and writes
// the dossier through the vendor builder. Output is deterministic: the
// same input always produces the same bytes. Existing output folders are
// reused and files are overwritten in place; nothing is deleted.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar } from './lib/model.ts';
import type { SnapshotData } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

function flagValue(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  const eq = process.argv.find((a) => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  return fallback;
}

function copyTree(src: string, dest: string): string[] {
  if (!existsSync(src)) return [];
  mkdirSync(dest, { recursive: true });
  const names = readdirSync(src).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const copied: string[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const from = join(src, name);
    const to = join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) {
      for (const inner of copyTree(from, to)) copied.push(name + '/' + inner);
    } else if (st.isFile()) {
      copyFileSync(from, to);
      copied.push(name);
    }
  }
  return copied;
}

const inputPath = flagValue('--input', '/input/snapshot.json');
const outDir = flagValue('--output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = JSON.parse(readFileSync(inputPath, 'utf8')) as SnapshotData;
const payload = buildRadar(snapshot);

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'board.json'),
  JSON.stringify({ meta: payload.meta, rows: payload.rows }, null, 2) + '\n',
);
writeFileSync(
  join(outDir, 'data.js'),
  'window.RADAR_DATA = ' + JSON.stringify(payload) + ';\n',
);
const dashFiles = copyTree(join(ROOT, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyTree(join(ROOT, 'screenshots'), join(outDir, 'screenshots'));

if (shotFiles.length >= 3) {
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log(
    'radar-clean: ' + String(payload.meta.total_protocols) + ' protocols | watchlist ' +
    String(payload.meta.watchlist_size) + '/' + String(payload.meta.watchlist_size) +
    ' | board ' + String(payload.meta.board_rows) + ' rows (' + String(payload.meta.early_size) +
    ' early, ' + String(payload.meta.rank_shifts) + ' rank shifts vs TVL, avg ' +
    String(payload.meta.avg_rank_shift) + ', max ' + String(payload.meta.max_rank_shift) +
    ') | live ' + String(payload.meta.live_size) + ' isolated | dashboard ' +
    String(dashFiles.length) + ' files | screenshots ' + String(shotFiles.length) +
    ' | dossier ' + String(dossier.length) + ' bytes',
  );
} else {
  console.log('radar-clean: board written, screenshots missing so dossier skipped (' + String(shotFiles.length) + ' found)');
}
