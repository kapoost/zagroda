import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CFG, ROOT, WRITE_ALLOW, canWriteCode } from '../config.js';
import { apiComplete } from '../providers/anthropic.js';
import { ollamaChat, unloadModel } from '../providers/ollama.js';

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
const MARK_END = /^<<<END>>>$/;
/** Format SEARCH/REPLACE znany modelom koderskim z treningu — nie wymyślamy własnego. */
const SEARCH_OPEN = /^<{5,9} SEARCH\s*$/;
const SEARCH_SPLIT = /^={5,9}\s*$/;
const SEARCH_CLOSE = /^>{5,9} REPLACE\s*$/;
const FENCE = /^\s*```[a-zA-Z]*\s*$/;

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
5. Change as little as possible. Touch only what the task requires.

OUTPUT FORMAT — use SEARCH/REPLACE blocks. NEVER output a whole file.

Each block is the file path on its own line, then:

game/src/core/tick.ts
<<<<<<< SEARCH
the exact lines to replace, copied character for character from the file above
=======
the replacement lines
>>>>>>> REPLACE

Rules for the SEARCH part:
- Copy it verbatim from the file shown above, including indentation. Do not retype it
  from memory and do not reformat it.
- Keep it SHORT — just the few lines that change, plus enough context to be unique.
- It must match exactly once in the file.

Emit one block per place you change. Several blocks are fine and expected.
Reply with nothing but these blocks: no explanation, no summary, no markdown fences.

To create a NEW file (rare), use instead:
<<<FILE game/src/core/newthing.ts>>>
...complete file content...
<<<END>>>

Only these paths are writable:
${WRITE_ALLOW.join('\n')}`;

export type CodeEdit =
  | { kind: 'file'; path: string; content: string }
  | { kind: 'replace'; path: string; old: string; next: string }
  /** Blok, którego nie dało się przypisać do pliku — musi zostać zgłoszony, nie pominięty. */
  | { kind: 'orphan'; why: string };

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

  /** Ostatnia linia przed blokiem, która wygląda jak ścieżka pliku. */
  const pathBefore = (at: number): string | null => {
    for (let k = at - 1; k >= 0 && k >= at - 4; k--) {
      const cand = lines[k]!.trim().replace(/^[`*#\s]+|[`*:\s]+$/g, '');
      if (/^[\w./-]+\.(ts|tsx|js|json)$/.test(cand)) return cand;
    }
    return null;
  };

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

    if (SEARCH_OPEN.test(line)) {
      const path = pathBefore(i);
      i++;
      const oldBuf: string[] = [];
      while (i < lines.length && !SEARCH_SPLIT.test(lines[i]!.trim())) oldBuf.push(lines[i++]!);
      i++;
      const newBuf: string[] = [];
      while (i < lines.length && !SEARCH_CLOSE.test(lines[i]!.trim())) newBuf.push(lines[i++]!);
      i++;
      if (!oldBuf.length) {
        out.push({ kind: 'orphan', why: 'blok SEARCH/REPLACE bez fragmentu do podmiany' });
      } else if (!path) {
        // Cicho pominięty blok to najgorszy możliwy wynik: patch wygląda na kompletny,
        // a brakuje w nim jednej z trzech zmian.
        out.push({
          kind: 'orphan',
          why:
            'blok SEARCH/REPLACE bez ścieżki pliku bezpośrednio nad nim — powtórz ścieżkę ' +
            `przed KAŻDYM blokiem. Szukany fragment zaczynał się od "${(oldBuf[0] ?? '').trim().slice(0, 50)}"`,
        });
      } else {
        out.push({ kind: 'replace', path, old: trimFences(oldBuf), next: trimFences(newBuf) });
      }
      continue;
    }

    i++;
  }
  return out;
}

/** Model lubi domknąć blok ogrodzeniem markdownu — zdejmujemy je, nie treść. */
function trimFences(buf: string[]): string {
  const copy = [...buf];
  while (copy.length && FENCE.test(copy[0]!)) copy.shift();
  while (copy.length && FENCE.test(copy[copy.length - 1]!)) copy.pop();
  return copy.join('\n');
}

const stripFence = (s: string) => s.replace(/^\s*```[a-z]*\n/, '').replace(/\n```\s*$/, '');

/**
 * Pliki rdzenia podawane modelowi jako kontekst.
 *
 * Listę wskazuje skill wybrany w fazie routingu. To nie jest tylko oszczędność tokenów:
 * model, który widzi trzy pliki zamiast sześciu, rzadziej zmienia coś, o co nikt nie prosił.
 */
function contextFiles(files: string[]): Array<{ path: string; content: string }> {
  return files
    .filter((p) => existsSync(resolve(ROOT, p)))
    .map((p) => ({ path: p, content: readFileSync(resolve(ROOT, p), 'utf8') }));
}

export interface CodeResult {
  ok: boolean;
  written: string[];
  rejected: string[];
  model: string;
}

/**
 * Dopasowanie fragmentu do podmiany.
 *
 * Model odtwarza fragment z pamięci i regularnie myli wcięcie albo spację na końcu
 * linii. Odrzucanie takiej próby jest formalnie poprawne i praktycznie bezużyteczne —
 * zmiana jest dobra, tylko zapisana odrobinę inaczej. Dlatego: najpierw dopasowanie
 * dosłowne, a gdy nie wyjdzie, porównanie linia po linii z pominięciem białych znaków.
 *
 * Tolerancja kończy się na jednoznaczności: dwa pasujące miejsca to nadal błąd, bo
 * zgadywanie, które model miał na myśli, jest gorsze niż poproszenie go o doprecyzowanie.
 */
export function applyReplace(
  current: string,
  oldText: string,
  newText: string,
): { ok: true; next: string } | { ok: false; why: string } {
  const exact = current.split(oldText).length - 1;
  // Funkcja, nie string: w zwykłym replace sekwencje $&, $`, $' i $1 są wzorcami
  // podstawienia, a kod modelu potrafi je zawierać. Efekt byłby cichy i trudny do wykrycia.
  if (exact === 1) return { ok: true, next: current.replace(oldText, () => newText) };
  if (exact > 1) {
    return { ok: false, why: `fragment występuje ${exact} razy — dodaj otaczające linie, żeby był jednoznaczny` };
  }

  const fileLines = current.split('\n');
  const needle = oldText.split('\n').map((l) => l.trim());
  const hits: number[] = [];
  for (let i = 0; i + needle.length <= fileLines.length; i++) {
    let match = true;
    for (let k = 0; k < needle.length; k++) {
      if (fileLines[i + k]!.trim() !== needle[k]) {
        match = false;
        break;
      }
    }
    if (match) hits.push(i);
  }

  if (hits.length === 1) {
    const at = hits[0]!;
    const indentOf = (l: string) => l.match(/^\s*/)![0];
    const shift = indentOf(fileLines[at]!).length - indentOf(oldText.split('\n')[0]!).length;
    const reindented = newText.split('\n').map((l) => {
      if (!l.trim()) return l;
      return shift >= 0 ? ' '.repeat(shift) + l : l.slice(Math.min(-shift, indentOf(l).length));
    });
    const next = [...fileLines.slice(0, at), ...reindented, ...fileLines.slice(at + needle.length)];
    return { ok: true, next: next.join('\n') };
  }
  if (hits.length > 1) {
    return { ok: false, why: `fragment pasuje w ${hits.length} miejscach — dodaj otaczające linie` };
  }

  const first = needle[0] ?? '';
  const near = fileLines.find((l) => first.length > 8 && l.includes(first.slice(0, 12)));
  return {
    ok: false,
    why:
      `fragment nie występuje w pliku. Szukałeś linii zaczynającej się od "${first.slice(0, 60)}"` +
      (near ? `; w pliku jest natomiast: "${near.trim().slice(0, 80)}"` : '') +
      '. Skopiuj fragment dosłownie z kodu podanego wyżej',
  };
}

function applyEdits(edits: CodeEdit[]): CodeResult {
  const written = new Set<string>();
  const rejected: string[] = [];

  for (const e of edits) {
    if (e.kind === 'orphan') {
      rejected.push(e.why);
      continue;
    }
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
    const res = applyReplace(readFileSync(abs, 'utf8'), e.old, e.next);
    if (!res.ok) {
      rejected.push(`${e.path}: ${res.why}`);
      continue;
    }
    writeFileSync(abs, res.next, 'utf8');
    written.add(e.path);
  }

  return { ok: written.size > 0 && rejected.length === 0, written: [...written], rejected, model: '' };
}

export interface CodeTask {
  /** Gotowy brief — wyrenderowany szablon skilla albo wariant awaryjny. */
  brief: string;
  /** Pliki rdzenia wysyłane jako kontekst. */
  files: string[];
}

function buildPrompt(task: CodeTask, feedback: string[]): string {
  const ctx = contextFiles(task.files)
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join('\n\n');
  const fb = feedback.length
    ? `\n\nYOUR PREVIOUS ATTEMPT FAILED THE QUALITY GATE. Fix exactly these problems:\n${feedback.join('\n')}`
    : '';
  return `CURRENT CODE:\n\n${ctx}\n\n${task.brief}${fb}`;
}

/** Jedna próba modelu kodującego. */
export async function patchWithCoder(task: CodeTask, feedback: string[]): Promise<CodeResult> {
  await unloadModel(CFG.models.pl);
  const raw = await ollamaChat({
    model: CFG.models.code,
    system: CODE_SYSTEM,
    user: buildPrompt(task, feedback),
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
export async function patchWithApi(task: CodeTask, feedback: string[]): Promise<CodeResult> {
  const raw = await apiComplete(CODE_SYSTEM, buildPrompt(task, feedback), 48_000);
  const res = applyEdits(parseEdits(raw));
  res.model = CFG.models.api;
  if (!res.ok) {
    throw new Error(res.rejected.length ? res.rejected.join('; ') : 'w odpowiedzi API nie było żadnego bloku REPLACE ani FILE');
  }
  return res;
}
