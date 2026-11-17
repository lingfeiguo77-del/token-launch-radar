// main.ts — entrypoint for token-radar-01.
//
// Reads the sealed snapshot, builds the 200-row board with the value model v2
// (lib/model.ts), writes the board and the dashboard data, copies the
// dashboard and the screenshots into the output directory, and writes
// dossier.json with the kit's buildDossier (vendor/makefun-board.ts).
//
// Usage:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// In the grading sandbox the input is /input/snapshot.json and the output
// directory is /output (MAKEFUN_OUTPUT_DIR). The program is deterministic:
// the same input always writes the same bytes (no clock, no randomness, no
// network). The dossier is written only once screenshots exist; before the
// screenshots are taken the run still writes the board, the data and the
// dashboard copy.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard } from './lib/model.ts';
import type { Snapshot } from './lib/model.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inputPath = flag('--input', '/input/snapshot.json');
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const snap = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
const board = buildBoard(snap);

mkdirSync(outDir, { recursive: true });

writeFileSync(
  join(outDir, 'board.json'),
  JSON.stringify({ rows: board.rows, meta: board.meta }, null, 2) + '\n',
);

writeFileSync(
  join(outDir, 'data.js'),
  'window.RADAR_DATA = ' +
    JSON.stringify({ meta: board.meta, rows: board.rows, live: board.live }) +
    ';\n',
);

cpSync(join(ROOT, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });

const shotsSrc = join(ROOT, 'screenshots');
if (existsSync(shotsSrc)) {
  cpSync(shotsSrc, join(outDir, 'screenshots'), { recursive: true });
}

let shotCount = 0;
const shotsOut = join(outDir, 'screenshots');
if (existsSync(shotsOut)) {
  shotCount = readdirSync(shotsOut).filter((n) => !n.startsWith('.')).length;
}

if (shotCount > 0) {
  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, { text_max_bytes: 65536 }),
  );
  console.log(
    `radar: ${board.meta.snapshotProtocols} snapshot protocols | watchlist ${board.meta.watchlist}/${board.meta.watchlist} | board ${board.meta.boardRows} rows (${board.meta.boardRows - board.meta.watchlist} early, ${board.meta.rankShifts} rank shifts vs TVL) | live ${board.meta.liveCount} isolated | screenshots ${shotCount} | dossier written`,
  );
} else {
  console.log(
    `radar: ${board.meta.snapshotProtocols} snapshot protocols | watchlist ${board.meta.watchlist}/${board.meta.watchlist} | board ${board.meta.boardRows} rows (${board.meta.boardRows - board.meta.watchlist} early, ${board.meta.rankShifts} rank shifts vs TVL) | live ${board.meta.liveCount} isolated | no screenshots yet, dossier skipped`,
  );
}
