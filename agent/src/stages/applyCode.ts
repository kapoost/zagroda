import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CFG, ROOT, WRITE_ALLOW, canWriteCode } from '../config.js';
import { apiComplete } from '../providers/anthropic.js';
import { ollamaChat } from '../providers/ollama.js';

/**
 * Patche kodu.
 *
 * Protokół jest tekstowy, nie JSON — i to jest celowe. Model kodujący musiałby escapować
 * cały plik TypeScript w stringu JSON; w praktyce psuje to co drugą odpowiedź. Znaczniki
 * plików są odporne na cudzysłowy, backslashe i wielolinijkowe stringi.
 *
 * Ścieżki są filtrowane przez canWriteCode() — model nie dotknie schematów, testów ani bramki.
 */

const MARK_START = /^<<<FILE\s+(.+?)>>>$/;
const MARK_END = /^<<<END>>>$/;

const CODE_SYSTEM = `You are a senior TypeScript engineer working on a deterministic 2D open-world
crafting game. The game core is a pure reducer: tick(state, input, registry) -> state.

HARD CONSTRAINTS:
1. Determinism is sacred. Never use Math.random(), Date.now(), or any ambient state inside
   the core. Randomness comes only from the Rng class seeded from state.rng.
2. Content lives in JSON validated by Zod schemas you MUST NOT change. If a feature needs a
   new content field, say so in a comment instead of editing the schema.
3. Do not touch tests, schemas, the registry, or the quality gate. You cannot see them and
   you cannot write them.
4. Keep the existing code style: explicit types, no default exports, comments only where they
   explain a non-obvious constraint.
5. Return COMPLETE file contents, never diffs or fragments.

OUTPUT FORMAT — reply with nothing else:
<<<FILE path/to/file.ts>>>
...complete file content...
<<<END>>>

You may emit several file blocks. Only these paths are writable:
${WRITE_ALLOW.join('\n')}`;

export interface CodePatch {
  path: string;
  content: string;
}

export function parseFileBlocks(raw: string): CodePatch[] {
  const out: CodePatch[] = [];
  let path: string | null = null;
  let buf: string[] = [];
  for (const line of raw.split('\n')) {
    const start = line.trim().match(MARK_START);
    if (start && path === null) {
      path = start[1]!.trim();
      buf = [];
      continue;
    }
    if (path !== null && MARK_END.test(line.trim())) {
      out.push({ path, content: buf.join('\n').replace(/^\s*```[a-z]*\n/, '').replace(/\n```\s*$/, '') + '\n' });
      path = null;
      continue;
    }
    if (path !== null) buf.push(line);
  }
  return out;
}

/** Pliki rdzenia podawane modelowi jako kontekst. */
function contextFiles(): CodePatch[] {
  const wanted = [
    'game/src/core/types.ts',
    'game/src/core/tick.ts',
    'game/src/core/world.ts',
    'game/src/core/game.ts',
    'game/src/core/rng.ts',
    'game/src/content/schema.ts',
  ];
  return wanted
    .filter((p) => existsSync(resolve(ROOT, p)))
    .map((p) => ({ path: p, content: readFileSync(resolve(ROOT, p), 'utf8') }));
}

export interface CodeResult {
  ok: boolean;
  written: string[];
  rejected: string[];
  model: string;
}

function applyPatches(patches: CodePatch[]): CodeResult {
  const written: string[] = [];
  const rejected: string[] = [];
  for (const p of patches) {
    const verdict = canWriteCode(p.path);
    if (!verdict.ok) {
      rejected.push(`${p.path}: ${verdict.why}`);
      continue;
    }
    if (!p.content.trim()) {
      rejected.push(`${p.path}: pusta treść pliku`);
      continue;
    }
    writeFileSync(resolve(ROOT, p.path), p.content, 'utf8');
    written.push(p.path);
  }
  return { ok: written.length > 0, written, rejected, model: '' };
}

function buildPrompt(request: string, feedback: string[]): string {
  const ctx = contextFiles()
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join('\n\n');
  const fb = feedback.length
    ? `\n\nYOUR PREVIOUS ATTEMPT FAILED THE QUALITY GATE. Fix exactly these problems:\n${feedback.join('\n')}`
    : '';
  return `CURRENT CODE:\n\n${ctx}\n\nTASK:\n${request}${fb}`;
}

/** Jedna próba modelu kodującego. */
export async function patchWithCoder(request: string, feedback: string[]): Promise<CodeResult> {
  const raw = await ollamaChat({
    model: CFG.models.code,
    system: CODE_SYSTEM,
    user: buildPrompt(request, feedback),
    temperature: feedback.length ? 0.3 : 0.1,
    numPredict: 12_000,
    ctx: 'code',
  });
  const res = applyPatches(parseFileBlocks(raw));
  res.model = CFG.models.code;
  if (!res.ok) {
    throw new Error(
      res.rejected.length ? `model nie dostarczył zapisywalnego pliku: ${res.rejected.join('; ')}` : 'brak bloków plików w odpowiedzi',
    );
  }
  return res;
}

/** Eskalacja patcha kodu do API. */
export async function patchWithApi(request: string, feedback: string[]): Promise<CodeResult> {
  const raw = await apiComplete(CODE_SYSTEM, buildPrompt(request, feedback), 48_000);
  const res = applyPatches(parseFileBlocks(raw));
  res.model = CFG.models.api;
  if (!res.ok) {
    throw new Error(
      res.rejected.length ? `API nie dostarczyło zapisywalnego pliku: ${res.rejected.join('; ')}` : 'brak bloków plików w odpowiedzi API',
    );
  }
  return res;
}
