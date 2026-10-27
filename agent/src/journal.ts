import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';

/** Dziennik prób. Bez niego nie da się odpowiedzieć na pytanie "czy Bielik się uczy, czy tylko zgaduje". */

export interface JournalEntry {
  at: string;
  prompt: string;
  kind?: string;
  title?: string;
  branch?: string;
  /** który szczebel drabiny ostatecznie dostarczył zmianę */
  resolvedBy?: 'bielik' | 'coder' | 'api' | null;
  attempts: Array<{ stage: string; model: string; ok: boolean; note?: string }>;
  gate?: { ok: boolean; failed: string | null };
  outcome: 'merged' | 'branch' | 'abandoned' | 'dry' | 'error';
  error?: string;
}

export function record(entry: JournalEntry): void {
  const dir = resolve(ROOT, '.agent');
  mkdirSync(dir, { recursive: true });
  appendFileSync(resolve(dir, 'journal.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
}
