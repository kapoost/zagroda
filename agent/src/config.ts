import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const CFG = {
  ollamaUrl: process.env.ZU_OLLAMA_URL ?? 'http://127.0.0.1:11434',
  models: {
    /** Polski ↔ struktura: intencja, spec zmiany, nazwy, dialogi, changelog. */
    pl: process.env.ZU_MODEL_PL ?? 'hf.co/speakleash/Bielik-11B-v3.0-Instruct-GGUF:Q5_K_M',
    /** Patche kodu. Prompty do niego idą po angielsku. */
    code: process.env.ZU_MODEL_CODE ?? 'qwen2.5-coder:14b',
    /** Eskalacja, gdy lokalne modele nie dadzą rady. */
    api: process.env.ZU_MODEL_API ?? 'claude-opus-5',
  },
  /** Ile razy próbować na każdym szczeblu drabiny, licząc pierwszą próbę. */
  attempts: { route: 2, ops: 2, code: 3, api: 2 },
  numCtx: 16384,
  timeoutMs: 240_000,
  /** Hybrydowa autonomia: zmiany czysto danych z zieloną bramką wjeżdżają same. */
  autoMergeData: true,
};

/**
 * Polityka zapisu — fundament bezpieczeństwa całej pętli.
 *
 * DENY wygrywa z ALLOW. Agent nie może dotknąć schematów, walidatora, testów ani bramki,
 * bo najprostszą drogą do zielonej bramki byłoby jej rozmontowanie, a nie naprawienie kodu.
 */
export const WRITE_ALLOW = [
  'game/src/core/',
  'game/src/render/',
  'game/src/sim/',
  'game/src/main.ts',
];

export const WRITE_DENY = [
  'game/src/content/schema.ts',
  'game/src/content/registry.ts',
  'game/src/content/load.ts',
  'game/tests/',
  'tools/',
  'agent/',
  'package.json',
  'tsconfig',
  '.github/',
];

export function canWriteCode(rel: string): { ok: boolean; why?: string } {
  const p = rel.replace(/^\.\//, '');
  if (p.includes('..')) return { ok: false, why: 'ścieżka wychodzi z repozytorium' };
  for (const d of WRITE_DENY) {
    if (p.startsWith(d)) return { ok: false, why: `plik objęty zakazem zapisu (${d})` };
  }
  for (const a of WRITE_ALLOW) {
    if (p === a || p.startsWith(a)) return { ok: true };
  }
  return { ok: false, why: 'plik poza dozwoloną powierzchnią zmian kodu' };
}

/** Pliki danych — zapisywane wyłącznie przez deterministyczny applier, nigdy przez model. */
export const DATA_DIR = 'game/content';
