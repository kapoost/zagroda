import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
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
  const path = resolve(ROOT, '.agent/gate.json');
  // Kasujemy przed uruchomieniem: czytanie nieświeżego wyniku to najgorszy możliwy błąd
  // w tym miejscu — agent uznałby zepsutą grę za sprawną.
  rmSync(path, { force: true });
  const r = spawnSync('npm', ['run', '--silent', 'gate'], { cwd: ROOT, encoding: 'utf8', env: process.env });
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as GateResult;
    } catch {
      /* spadamy do wariantu awaryjnego */
    }
  }
  // Brak pliku wyniku oznacza, że bramka nie doszła do końca — to awaria, nie przepustka.
  // Traktowanie kodu wyjścia 0 jako zielonego światła pozwoliłoby zacommitować zmianę,
  // której nikt nie sprawdził.
  return {
    ok: false,
    failed: 'bramka-nie-odpowiedziala',
    stages: [
      {
        name: 'bramka-nie-odpowiedziala',
        ok: false,
        ms: 0,
        output:
          `Bramka zakończyła się kodem ${r.status} i nie zapisała .agent/gate.json.\n` +
          `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-3500),
      },
    ],
  };
}

/** Komunikat zwrotny dla modelu — tylko to, co faktycznie pękło. */
export function gateFeedback(res: GateResult): string[] {
  return res.stages.filter((s) => !s.ok).map((s) => `[${s.name}]\n${s.output}`);
}

export function gateSummary(res: GateResult): string {
  return res.stages.map((s) => `${s.ok ? '✓' : '✗'} ${s.name} (${s.ms}ms)`).join('  ');
}
