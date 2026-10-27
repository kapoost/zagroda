import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../config.js';

/**
 * Uruchomienie bramki.
 *
 * Świadomie podproces, nie import: pliki treści są importowane statycznie przez moduł gry,
 * więc w tym samym procesie zobaczylibyśmy wersję z przed zmiany. Osobny proces zawsze
 * czyta aktualny stan dysku.
 */

export interface GateStage {
  name: string;
  ok: boolean;
  ms: number;
  output: string;
}

export interface GateResult {
  ok: boolean;
  failed: string | null;
  stages: GateStage[];
  metrics?: unknown;
}

export function runGate(): GateResult {
  const r = spawnSync('npm', ['run', '--silent', 'gate'], { cwd: ROOT, encoding: 'utf8', env: process.env });
  const path = resolve(ROOT, '.agent/gate.json');
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as GateResult;
    } catch {
      /* spadamy do wariantu awaryjnego */
    }
  }
  return {
    ok: r.status === 0,
    failed: r.status === 0 ? null : 'bramka',
    stages: [{ name: 'bramka', ok: r.status === 0, ms: 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-4000) }],
  };
}

/** Komunikat zwrotny dla modelu — tylko to, co faktycznie pękło. */
export function gateFeedback(res: GateResult): string[] {
  return res.stages.filter((s) => !s.ok).map((s) => `[${s.name}]\n${s.output}`);
}

export function gateSummary(res: GateResult): string {
  return res.stages.map((s) => `${s.ok ? '✓' : '✗'} ${s.name} (${s.ms}ms)`).join('  ');
}
