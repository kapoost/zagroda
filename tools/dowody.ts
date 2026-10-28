import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { podgladRoutingu } from '../agent/src/stages/intent.js';

/**
 * Dowody do wbudowania w paczkę gry.
 *
 * Sama gra nie pokazuje tego projektu. Ktoś otworzy link, zobaczy Zamość z góry
 * i pomyśli, że to gra o zbieraniu gałęzi. Ciekawe jest to, że kamienny młot wjechał
 * na main z wytrzymałością 30 przy kilofie 200 — a potem przestał. I to akurat da się
 * pokazać bez żadnego modelu, bo wszystko jest zapisane.
 *
 * Prompt klasyfikacji składa się wyłącznie z treści gry, więc powstaje tutaj z tej
 * samej funkcji, co w pętli — podgląd budujący go po swojemu pokazałby prędzej czy
 * później coś innego, niż model naprawdę dostaje.
 *
 * Dziennik i wynik bramki pochodzą z .agent/, którego nie ma w repozytorium. Gdy ich
 * brak, plik powstaje mimo to, tylko pusty: gra ma się zbudować także u kogoś, kto
 * nigdy nie uruchomił agenta.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PRZYKLAD = 'dodaj kamienny młot, dużo wytrzymalszy od kilofa';

interface WpisDziennika {
  prompt: string;
  kind: string | null;
  title: string | null;
  outcome: string;
  resolvedBy: string | null;
}

function dziennik(): WpisDziennika[] {
  const p = resolve(ROOT, '.agent/journal.jsonl');
  if (!existsSync(p)) return [];
  const wpisy = readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((w) => w.outcome !== 'dry')
    .map((w) => ({
      prompt: String(w.prompt ?? ''),
      kind: (w.kind as string) ?? null,
      title: (w.title as string) ?? null,
      outcome: String(w.outcome ?? ''),
      resolvedBy: (w.resolvedBy as string) ?? null,
    }));
  return wpisy.slice(-20);
}

function bramka(): unknown {
  const p = resolve(ROOT, '.agent/gate.json');
  if (!existsSync(p)) return null;
  const g = JSON.parse(readFileSync(p, 'utf8')) as {
    ok: boolean;
    failed: string | null;
    stages: Array<{ name: string; ok: boolean; ms: number }>;
  };
  return { ok: g.ok, failed: g.failed, stages: g.stages.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms })) };
}

const krok = podgladRoutingu(PRZYKLAD);
const wynik = {
  wygenerowano: new Date().toISOString().slice(0, 10),
  przyklad: PRZYKLAD,
  prompt: {
    system: krok.system,
    user: krok.user,
    gramatykaZnakow: JSON.stringify(krok.schemat).length,
  },
  dziennik: dziennik(),
  bramka: bramka(),
};

const sciezka = resolve(ROOT, 'game/dowody.json');
writeFileSync(sciezka, JSON.stringify(wynik, null, 2) + '\n', 'utf8');
console.log(
  `zapisano game/dowody.json — prompt ${krok.system.length + krok.user.length} znaków, ` +
    `dziennik ${wynik.dziennik.length} wpisów, bramka ${wynik.bramka ? 'z zapisu' : 'brak'}`,
);
