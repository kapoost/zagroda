import { describe, expect, it } from 'vitest';
import { canWriteCode } from '../src/config.js';

/**
 * Granica bezpieczeństwa całej pętli: czego model NIE może nadpisać.
 *
 * Reguła jest jedna — najprostsza droga do zielonej bramki ma prowadzić przez naprawienie
 * kodu, nigdy przez rozmontowanie tego, co sprawdza. Bez tych testów granica jest
 * komentarzem, a nie granicą.
 */
describe('polityka zapisu', () => {
  it.each([
    'game/src/core/tick.ts',
    'game/src/core/world.ts',
    'game/src/render/canvas.ts',
    'game/src/main.ts',
  ])('pozwala pisać do %s', (p) => {
    expect(canWriteCode(p).ok).toBe(true);
  });

  it.each([
    ['game/src/content/schema.ts', 'schemat treści'],
    ['game/src/content/registry.ts', 'walidator spójności'],
    ['game/tests/content.test.ts', 'testy gry'],
    ['game/src/sim/bot.ts', 'bot progresji — wyrocznia grywalności'],
    ['tools/gate.ts', 'sama bramka'],
    ['agent/src/pipeline.ts', 'pętla agenta'],
    ['agent/skills/koszt-akcji.md', 'skille'],
    ['package.json', 'manifest'],
    ['tsconfig.base.json', 'konfiguracja typów'],
    ['.github/workflows/ci.yml', 'CI'],
  ])('zabrania pisać do %s (%s)', (p) => {
    expect(canWriteCode(p).ok).toBe(false);
  });

  it.each([
    'game/content/items.json',
    'game/src/core/../content/schema.ts',
    '../poza-repo.ts',
    '/etc/passwd',
    'game/src/core/../../tests/content.test.ts',
  ])('zabrania ścieżki %s', (p) => {
    expect(canWriteCode(p).ok).toBe(false);
  });

  it('zakaz wygrywa z pozwoleniem, nie odwrotnie', () => {
    // sim leży pod game/src, które samo w sobie wygląda niewinnie
    expect(canWriteCode('game/src/sim/bot.ts').ok).toBe(false);
    expect(canWriteCode('game/src/core/tick.ts').ok).toBe(true);
  });

  it('odmowa niesie powód', () => {
    const v = canWriteCode('game/tests/content.test.ts');
    expect(v.ok).toBe(false);
    expect(v.why).toBeTruthy();
  });
});
