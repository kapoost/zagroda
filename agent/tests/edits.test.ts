import { describe, expect, it } from 'vitest';
import { parseEdits } from '../src/stages/applyCode.js';

/**
 * Parser odpowiedzi modelu kodującego. Jedyna warstwa między tekstem z modelu
 * a zapisem na dysk — cicha pomyłka tutaj psuje pliki rdzenia.
 */
describe('parser podmian', () => {
  it('czyta blok REPLACE', () => {
    const out = parseEdits(`gadanina przed
<<<REPLACE game/src/core/tick.ts>>>
<<<OLD>>>
const A = 1;
<<<NEW>>>
const A = 2;
<<<END>>>
gadanina po`);
    expect(out).toEqual([
      { kind: 'replace', path: 'game/src/core/tick.ts', old: 'const A = 1;', next: 'const A = 2;' },
    ]);
  });

  it('czyta blok FILE', () => {
    const out = parseEdits(`<<<FILE game/src/core/nowy.ts>>>
export const x = 1;
<<<END>>>`);
    expect(out).toEqual([{ kind: 'file', path: 'game/src/core/nowy.ts', content: 'export const x = 1;\n' }]);
  });

  it('czyta kilka bloków naraz', () => {
    const out = parseEdits(`<<<REPLACE a.ts>>>
<<<OLD>>>
x
<<<NEW>>>
y
<<<END>>>
<<<REPLACE b.ts>>>
<<<OLD>>>
p
<<<NEW>>>
q
<<<END>>>`);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('zachowuje wcięcia i puste linie we fragmencie', () => {
    const out = parseEdits(`<<<REPLACE a.ts>>>
<<<OLD>>>
  if (x) {
    return 1;
  }
<<<NEW>>>
  if (x) {

    return 2;
  }
<<<END>>>`);
    expect(out[0]).toMatchObject({ old: '  if (x) {\n    return 1;\n  }', next: '  if (x) {\n\n    return 2;\n  }' });
  });

  it('zdejmuje ogrodzenie markdownem, które model lubi dokleić', () => {
    const out = parseEdits(`<<<FILE a.ts>>>
\`\`\`typescript
export const x = 1;
\`\`\`
<<<END>>>`);
    expect(out[0]).toMatchObject({ content: 'export const x = 1;\n' });
  });

  it('ignoruje odpowiedź bez bloków', () => {
    expect(parseEdits('Przepraszam, nie mogę tego zrobić.')).toEqual([]);
  });

  it('pomija blok REPLACE bez fragmentu do podmiany', () => {
    expect(parseEdits(`<<<REPLACE a.ts>>>
<<<OLD>>>
<<<NEW>>>
coś
<<<END>>>`)).toEqual([]);
  });
});
