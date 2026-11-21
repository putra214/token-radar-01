// Token Radar entry point (Node 22, standard library only, no network).
//
// Reads the sealed snapshot (default /input/snapshot.json, or --input <file|dir>),
// scores it with radar-3 in lib/model.ts, and writes the hand-in into /output
// (or MAKEFUN_OUTPUT_DIR outside the grader):
//   board.json    the ranked board
//   data.js       the same board, compact, for the dashboard to read
//   dashboard/    a copy of this repo's dashboard/
//   screenshots/  a copy of this repo's screenshots/
//   dossier.json  built last by the vendored make.fun library, from the output
//                 itself, so it always matches what is handed in.
//
// The program is deterministic: same snapshot in, same bytes out. The grader
// runs it twice and compares.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

// The scorer's own caps: the text cap shapes the dossier's bytes, the rest refuse.
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of --name <value>, --name=<value>, or the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping dot-names. Returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashFiles.length < 3) fail(`dashboard/ holds ${dashFiles.length} files: hand in index.html plus a stylesheet and a script`);
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const top = board[0]!;
const bottom = board[board.length - 1]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols in, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live comps set aside)\n` +
    `token radar: fitted on ${radar.calibration.comps} live-token comps: median mcap/TVL ${radar.calibration.global_median_multiple}, log-log slope ${radar.calibration.loglog_slope}\n` +
    radar.heldout.folds.map((f) => `token radar: held-out ${f.fold}: median |log error| ${f.median_abs_log_error} (${Math.round(f.within_2x * 100)}% within 2x) vs baseline ${f.baseline_median_abs_log_error} (${Math.round(f.baseline_within_2x * 100)}% within 2x), n=${f.test}\n`).join('') +
    `token radar: implied value $${top.implied_value_usd.toLocaleString('en-US')} (rank 1, ${top.slug}) down to $${bottom.implied_value_usd.toLocaleString('en-US')} (rank ${board.length})\n` +
    `token radar: farm verdicts ${radar.verdict_counts.farm} FARM / ${radar.verdict_counts.thin} THIN / ${radar.verdict_counts.skip} SKIP (EV at assumed share ${radar.farm_assumptions.assumed_share})\n` +
    `token radar: ablation mean A+B median |log error|: ${radar.ablation.rows.map((r) => `${r.variant}=${r.mean_ab}`).join(', ')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
