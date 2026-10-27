import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawContent } from '../game/src/content/load.js';
import { formatIssues, validateContent } from '../game/src/content/registry.js';
import { runSim } from './sim.js';

/**
 * Bramka jakości — jedyne wejście do oceny "czy ta zmiana psuje grę".
 *
 * Kolejność etapów jest celowa: najtańsze i najbardziej czytelne błędy pierwsze.
 * Model dostaje wtedy komunikat o wiszącej referencji po 50 ms, a nie po czterech
 * sekundach testów. Fail-fast skraca pętlę poprawek.
 *
 * Ten plik jest NIEZAPISYWALNY dla agenta — inaczej najprostszą drogą do zielonej
 * bramki byłoby jej rozmontowanie.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEEDBACK_LIMIT = 4000;

export interface StageResult {
  name: string;
  ok: boolean;
  ms: number;
  output: string;
}

export interface GateResult {
  ok: boolean;
  failed: string | null;
  stages: StageResult[];
  metrics?: unknown;
}

const tail = (s: string, n = FEEDBACK_LIMIT) =>
  s.length <= n ? s.trim() : '…(obcięte)…\n' + s.slice(-n).trim();

function sh(cmd: string, args: string[]): { ok: boolean; output: string } {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: process.env });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.error) return { ok: false, output: `nie udało się uruchomić ${cmd}: ${r.error.message}` };
  return { ok: r.status === 0, output: out };
}

function stageContent(): { ok: boolean; output: string } {
  const r = validateContent(rawContent);
  if (r.ok) {
    const c = r.registry.content;
    return {
      ok: true,
      output: `treść spójna: ${c.items.length} itemów, ${c.recipes.length} receptur, ${c.resources.length} surowców, ${c.biomes.length} biomów, ${c.npcs.length} NPC`,
    };
  }
  return { ok: false, output: `treść niespójna:\n${formatIssues(r.issues)}` };
}

function stageSim(): { ok: boolean; output: string; metrics: unknown } {
  const { ok, metrics } = runSim();
  const lines = metrics.map(
    (m) =>
      `seed ${m.seed}: ` +
      m.milestones.map((x) => `${x.goal}=${x.ok ? x.ticks + 't' : 'BLOKADA(' + x.reason + ')'}`).join(', '),
  );
  return { ok, output: lines.join('\n'), metrics };
}

export function runGate(): GateResult {
  const stages: StageResult[] = [];
  let metrics: unknown;

  const defs: Array<{ name: string; run: () => { ok: boolean; output: string; metrics?: unknown } }> = [
    { name: 'tresc', run: stageContent },
    { name: 'typy', run: () => sh('node_modules/.bin/tsc', ['-p', 'game/tsconfig.json', '--noEmit']) },
    { name: 'typy-agent', run: () => sh('node_modules/.bin/tsc', ['-p', 'agent/tsconfig.json', '--noEmit']) },
    { name: 'testy', run: () => sh('node_modules/.bin/vitest', ['run', '--root', 'game']) },
    { name: 'testy-agent', run: () => sh('node_modules/.bin/vitest', ['run', '--root', 'agent']) },
    { name: 'symulacja', run: stageSim },
  ];

  for (const d of defs) {
    const t0 = Date.now();
    const r = d.run();
    if (r.metrics !== undefined) metrics = r.metrics;
    stages.push({ name: d.name, ok: r.ok, ms: Date.now() - t0, output: tail(r.output) });
    if (!r.ok) break;
  }

  const failed = stages.find((s) => !s.ok)?.name ?? null;
  return { ok: !failed, failed, stages, metrics };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runGate();
  for (const s of res.stages) {
    console.log(`${s.ok ? '✓' : '✗'} ${s.name.padEnd(12)} ${String(s.ms).padStart(6)}ms`);
    if (!s.ok) console.log(s.output.split('\n').map((l) => '    ' + l).join('\n'));
  }
  mkdirSync(resolve(ROOT, '.agent'), { recursive: true });
  writeFileSync(resolve(ROOT, '.agent/gate.json'), JSON.stringify(res, null, 2));
  console.log(res.ok ? '\nBRAMKA ZIELONA' : `\nBRAMKA CZERWONA — etap: ${res.failed}`);
  process.exit(res.ok ? 0 : 1);
}
