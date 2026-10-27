import { describe, expect, it } from 'vitest';
import { parseEdits } from '../src/stages/applyCode.js';

/**
 * Parser odpowiedzi modelu kodującego. Jedyna warstwa między tekstem z modelu
 * a zapisem na dysk — cicha pomyłka tutaj psuje pliki rdzenia.
 */
describe('parser podmian', () => {
  it('czyta blok SEARCH/REPLACE ze ścieżką nad nim', () => {
    const out = parseEdits(`Oto zmiana:

game/src/core/tick.ts
<<<<<<< SEARCH
const A = 1;
=======
const A = 2;
>>>>>>> REPLACE`);
    expect(out).toEqual([
      { kind: 'replace', path: 'game/src/core/tick.ts', old: 'const A = 1;', next: 'const A = 2;' },
    ]);
  });

  it('czyta kilka bloków naraz', () => {
    const out = parseEdits(`game/src/core/tick.ts
<<<<<<< SEARCH
x
=======
y
>>>>>>> REPLACE

game/src/core/types.ts
<<<<<<< SEARCH
p
=======
q
>>>>>>> REPLACE`);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.path)).toEqual(['game/src/core/tick.ts', 'game/src/core/types.ts']);
  });

  it('znosi ścieżkę w backtickach i z dwukropkiem', () => {
    const out = parseEdits(`\`game/src/core/tick.ts\`:
<<<<<<< SEARCH
a
=======
b
>>>>>>> REPLACE`);
    expect(out[0]).toMatchObject({ path: 'game/src/core/tick.ts' });
  });

  it('zdejmuje ogrodzenie markdownem wokół treści bloku', () => {
    const out = parseEdits(`game/src/core/tick.ts
<<<<<<< SEARCH
\`\`\`typescript
const A = 1;
\`\`\`
=======
\`\`\`typescript
const A = 2;
\`\`\`
>>>>>>> REPLACE`);
    expect(out[0]).toMatchObject({ old: 'const A = 1;', next: 'const A = 2;' });
  });

  it('zachowuje wcięcia i puste linie', () => {
    const out = parseEdits(`a.ts
<<<<<<< SEARCH
  if (x) {
    return 1;
  }
=======
  if (x) {

    return 2;
  }
>>>>>>> REPLACE`);
    expect(out[0]).toMatchObject({ old: '  if (x) {\n    return 1;\n  }', next: '  if (x) {\n\n    return 2;\n  }' });
  });

  it('zgłasza blok bez rozpoznanej ścieżki zamiast go pomijać', () => {
    // Cicho pominięty blok to najgorszy możliwy wynik: patch wygląda na kompletny,
    // a brakuje w nim jednej ze zmian — i może mimo to przejść bramkę.
    const out = parseEdits(`<<<<<<< SEARCH
a
=======
b
>>>>>>> REPLACE`);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('orphan');
  });

  it('zgłasza drugi i trzeci blok, gdy model podał ścieżkę tylko raz', () => {
    const out = parseEdits(`game/src/core/tick.ts
<<<<<<< SEARCH
a
=======
b
>>>>>>> REPLACE
<<<<<<< SEARCH
c
=======
d
>>>>>>> REPLACE`);
    expect(out.map((e) => e.kind)).toEqual(['replace', 'orphan']);
  });

  it('czyta blok FILE dla nowego pliku', () => {
    const out = parseEdits(`<<<FILE game/src/core/nowy.ts>>>
export const x = 1;
<<<END>>>`);
    expect(out).toEqual([{ kind: 'file', path: 'game/src/core/nowy.ts', content: 'export const x = 1;\n' }]);
  });

  it('ignoruje odpowiedź bez bloków', () => {
    expect(parseEdits('Przepraszam, nie mogę tego zrobić.')).toEqual([]);
  });

  it('nie daje się nabrać na cały plik wrzucony zamiast bloku', () => {
    // Tak właśnie zachowywał się Qwen przy moim wymyślonym formacie: brał znacznik
    // podmiany i wsadzał w niego całą treść pliku. Taka odpowiedź ma zostać odrzucona,
    // a nie potraktowana jako nadpisanie.
    const out = parseEdits(`<<<REPLACE game/src/core/tick.ts>>>
\`\`\`typescript
import type { Registry } from '../content/registry.js';
export function tick() {}
\`\`\``);
    expect(out).toEqual([]);
  });
});
