import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

/**
 * Lore jako stały kontekst.
 *
 * Skille mówią modelowi, JAK coś zrobić. Lore mówi, DO JAKIEGO ŚWIATA to ma pasować —
 * i w odróżnieniu od skilla nie jest wybierane, tylko dołączane zawsze. To jedno źródło
 * prawdy: ten sam plik trafia do promptu generującego treść i do nagłówka promptu
 * graficznego, więc kosz wiklinowy i jego ikona opisują tę samą wyspę.
 *
 * Nagłówki i akapity wyjaśniające są obcinane — model dostaje treść, nie dokumentację.
 */

let cache: string | null = null;

export function lore(): string {
  if (cache !== null) return cache;
  const raw = readFileSync(resolve(ROOT, 'docs/LORE.md'), 'utf8');
  const body = raw.slice(raw.indexOf('\n---\n') + 5);
  cache = body
    .split('\n')
    .filter((l) => !l.startsWith('# '))
    .map((l) => l.replace(/^## /, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cache;
}

/** Ile tokenów lore zabiera z okna — przy trzech wywołaniach na rundę warto wiedzieć. */
export const loreTokens = (): number => Math.round(lore().length / 3.2);
