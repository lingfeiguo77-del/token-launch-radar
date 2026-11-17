// Token Launch Radar v2 入口程序（Node 22 标准库 only，完全确定性输出）。
//
// 读取密封快照 /input/snapshot.json（或 --input 指定路径），调用 lib/model.ts 生成：
//   - /output/board.json   （200 行无 token 记录协议排名 + 四因子分项 + 5 步可执行 Farm 计划）
//   - /output/data.js      （离线仪表盘数据载荷 window.RADAR）
//   - /output/dashboard/   （零网络请求纯静态深色终端网页）
//   - /output/screenshots/ （3 张真实渲染页面截图）
//   - /output/dossier.json （由官方 vendor/makefun-board.ts 构建，供评审与 gate 校验）
//
// 本地验证命令：
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODEL_V2,
  MODEL_VERSION,
  buildRadarPayload,
  parseSnapshot,
  serializeDataScript,
  validateBoard,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const DOSSIER_CAPS = {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const PLAIN_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** 解析 --key value 或 --key=value 参数 */
function readCliArg(flag: string, fallback: string): string {
  const exactIdx = process.argv.indexOf(`--${flag}`);
  if (exactIdx >= 0 && exactIdx + 1 < process.argv.length) {
    return process.argv[exactIdx + 1]!;
  }
  const prefix = `--${flag}=`;
  const matched = process.argv.find((arg) => arg.startsWith(prefix));
  return matched !== undefined ? matched.slice(prefix.length) : fallback;
}

/** 确定性地复制目录中的常规文件（按文件名码点排序，跳过点开头隐藏项） */
function copyDirectoryDeterministic(srcDir: string, destDir: string, recursive: boolean): string[] {
  if (!existsSync(srcDir)) return [];
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const copied: string[] = [];

  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const srcPath = join(srcDir, name);
    const destPath = join(destDir, name);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      if (recursive) {
        const sub = copyDirectoryDeterministic(srcPath, destPath, true);
        for (const item of sub) copied.push(`${name}/${item}`);
      }
      continue;
    }
    if (!st.isFile()) continue;
    if (!PLAIN_NAME_RE.test(name)) {
      throw new Error(`invalid file name for gate compliance: ${srcPath}`);
    }
    copyFileSync(srcPath, destPath);
    copied.push(name);
  }
  return copied;
}

function main(): void {
  const inputArg = readCliArg('input', '/input');
  const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(snapshotPath)) {
    process.stderr.write(`radar-v2: missing snapshot at ${snapshotPath}\n`);
    process.exit(2);
  }

  const outDir = readCliArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const { board, payload } = buildRadarPayload(snapshot, MODEL_V2);

  const issue = validateBoard(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`radar-v2: board failed pre-gate validation: ${issue}\n`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const boardDocument = {
    model_version: MODEL_VERSION,
    as_of: snapshot.as_of,
    formula:
      'implied = max(1, round(tvl_usd * 0.25 * asymmetric_growth * maturity * multichain))',
    rows: board,
  };
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify(boardDocument)}\n`);
  writeFileSync(join(outDir, 'data.js'), serializeDataScript(payload));

  const dashFiles = copyDirectoryDeterministic(join(ROOT_DIR, 'dashboard'), join(outDir, 'dashboard'), true);
  if (!dashFiles.includes('index.html')) {
    process.stderr.write('radar-v2: dashboard/index.html is missing\n');
    process.exit(1);
  }

  const shotFiles = copyDirectoryDeterministic(join(ROOT_DIR, 'screenshots'), join(outDir, 'screenshots'), false);
  if (shotFiles.length < 3 || shotFiles.length > 4) {
    process.stderr.write(`radar-v2: screenshots/ must hold 3..4 images, found ${shotFiles.length}\n`);
    process.exit(1);
  }

  const dossierBytes = buildDossier(outDir, DOSSIER_CAPS);
  if (dossierBytes.length > 1_572_864) {
    process.stderr.write(`radar-v2: dossier.json is ${dossierBytes.length} bytes, exceeding 1.5 MiB gate cap\n`);
    process.exit(1);
  }
  writeFileSync(join(outDir, 'dossier.json'), dossierBytes);

  process.stdout.write(
    `radar-v2: ${snapshot.protocols.length} snapshot protocols | ` +
      `watchlist ${payload.watchlist_size}/${payload.watchlist_size} | ` +
      `board ${board.length} rows (${payload.early_size} early, ${payload.divergence_count} rank shifts vs TVL) | ` +
      `live ${payload.live_size} isolated | ` +
      `dashboard ${dashFiles.length} files | screenshots ${shotFiles.length} | dossier ${dossierBytes.length} bytes\n`,
  );
}

main();
