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

const MARK_FILE = /^<<<FILE\s+(.+?)>>>$/;
const MARK_REPLACE = /^<<<REPLACE\s+(.+?)>>>$/;
const MARK_OLD = /^<<<OLD>>>$/;
const MARK_NEW = /^<<<NEW>>>$/;
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

OUTPUT FORMAT — prefer REPLACE; it is cheaper and safer than rewriting a whole file:

<<<REPLACE game/src/core/tick.ts>>>
<<<OLD>>>
the exact snippet to replace, copied verbatim from the file above
<<<NEW>>>
the replacement
<<<END>>>

The OLD snippet must appear EXACTLY ONCE in the file, copied character for character
including indentation. Include enough surrounding lines to make it unique. Emit several
REPLACE blocks if the change touches several places.

Use the whole-file form only when creating a NEW file:

<<<FILE game/src/core/newthing.ts>>>
...complete file content...
<<<END>>>

Reply with nothing but these blocks. Only these paths are writable:
${WRITE_ALLOW.join('\n')}`;

export type CodeEdit =
  | { kind: 'file'; path: string; content: string }
  | { kind: 'replace'; path: string; old: string; next: string };

/**
 * Protokół tekstowy, nie JSON — i to jest celowe. Model kodujący musiałby escapować cały
 * plik TypeScript w stringu JSON; w praktyce psuje to co drugą odpowiedź.
 *
 * REPLACE jest formą domyślną: podmiana dopasowanego dosłownie fragmentu jest o rząd
 * wielkości tańsza w tokenach od przepisywania pliku i nie daje modelowi okazji, by przy
 * okazji zmienić coś, o co nikt nie prosił. Dopasowanie musi być jednoznaczne — zero albo
 * więcej niż jedno trafienie to błąd, który wraca do modelu.
 */
export function parseEdits(raw: string): CodeEdit[] {
  const out: CodeEdit[] = [];
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();

    const file = line.match(MARK_FILE);
    if (file) {
      const path = file[1]!.trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !MARK_END.test(lines[i]!.trim())) buf.push(lines[i++]!);
      out.push({ kind: 'file', path, content: stripFence(buf.join('\n')) + '\n' });
      i++;
      continue;
    }

    const repl = line.match(MARK_REPLACE);
    if (repl) {
      const path = repl[1]!.trim();
      i++;
      while (i < lines.length && !MARK_OLD.test(lines[i]!.trim())) i++;
      i++;
      const oldBuf: string[] = [];
      while (i < lines.length && !MARK_NEW.test(lines[i]!.trim())) oldBuf.push(lines[i++]!);
      i++;
      const newBuf: string[] = [];
      while (i < lines.length && !MARK_END.test(lines[i]!.trim())) newBuf.push(lines[i++]!);
      i++;
      if (oldBuf.length) {
        out.push({ kind: 'replace', path, old: stripFence(oldBuf.join('\n')), next: stripFence(newBuf.join('\n')) });
      }
      continue;
    }

    i++;
  }
  return out;
}

const stripFence = (s: string) => s.replace(/^\s*```[a-z]*\n/, '').replace(/\n```\s*$/, '');

/** Pliki rdzenia podawane modelowi jako kontekst. */
function contextFiles(): Array<{ path: string; content: string }> {
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

function applyEdits(edits: CodeEdit[]): CodeResult {
  const written = new Set<string>();
  const rejected: string[] = [];

  for (const e of edits) {
    const verdict = canWriteCode(e.path);
    if (!verdict.ok) {
      rejected.push(`${e.path}: ${verdict.why}`);
      continue;
    }
    const abs = resolve(ROOT, e.path);

    if (e.kind === 'file') {
      if (!e.content.trim()) {
        rejected.push(`${e.path}: pusta treść pliku`);
        continue;
      }
      writeFileSync(abs, e.content, 'utf8');
      written.add(e.path);
      continue;
    }

    if (!existsSync(abs)) {
      rejected.push(`${e.path}: plik nie istnieje, więc nie ma czego podmieniać`);
      continue;
    }
    const current = readFileSync(abs, 'utf8');
    const hits = current.split(e.old).length - 1;
    if (hits === 0) {
      rejected.push(
        `${e.path}: fragment do podmiany nie występuje w pliku — skopiuj go dosłownie, ` +
          `ze spacjami wcięć. Pierwsza linia, której szukałeś: "${e.old.split('\n')[0]?.trim()}"`,
      );
      continue;
    }
    if (hits > 1) {
      rejected.push(`${e.path}: fragment do podmiany występuje ${hits} razy — dodaj otaczające linie, żeby był jednoznaczny`);
      continue;
    }
    writeFileSync(abs, current.replace(e.old, e.next), 'utf8');
    written.add(e.path);
  }

  return { ok: written.size > 0 && rejected.length === 0, written: [...written], rejected, model: '' };
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
    numPredict: 4000,
    ctx: 'code',
  });
  const res = applyEdits(parseEdits(raw));
  res.model = CFG.models.code;
  if (!res.ok) {
    throw new Error(
      res.rejected.length ? res.rejected.join('; ') : 'w odpowiedzi nie było żadnego bloku REPLACE ani FILE',
    );
  }
  return res;
}

/** Eskalacja patcha kodu do API. */
export async function patchWithApi(request: string, feedback: string[]): Promise<CodeResult> {
  const raw = await apiComplete(CODE_SYSTEM, buildPrompt(request, feedback), 48_000);
  const res = applyEdits(parseEdits(raw));
  res.model = CFG.models.api;
  if (!res.ok) {
    throw new Error(res.rejected.length ? res.rejected.join('; ') : 'w odpowiedzi API nie było żadnego bloku REPLACE ani FILE');
  }
  return res;
}
