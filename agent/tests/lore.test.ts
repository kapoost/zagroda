import { describe, expect, it } from 'vitest';
import { lore, loreTokens } from '../src/lore.js';

/**
 * Lore wchodzi do każdego wywołania modelu, więc jego kształt jest kontraktem:
 * za długie zjada okno, a puste albo okrojone cicho znosi spójność świata.
 */
describe('lore', () => {
  const tekst = lore();

  it('niesie realną treść, nie sam nagłówek', () => {
    expect(tekst.length).toBeGreaterThan(800);
  });

  it('mieści się w rozsądnym budżecie okna', () => {
    // Trzy wywołania na rundę przy oknie 16 384 — powyżej tysiąca tokenów lore
    // zaczyna wypierać skrót treści gry, który jest ważniejszy.
    expect(loreTokens()).toBeLessThan(1000);
  });

  it('zawiera to, na czym modelowi najczęściej się myli', () => {
    for (const fraza of ['Zofia', 'Bartek', 'Hanka', 'trzcina', 'Czego w tym świecie nie ma']) {
      expect(tekst, `brakuje: ${fraza}`).toContain(fraza);
    }
  });

  it('nie przenosi nagłówków ani ozdobników markdownu', () => {
    expect(tekst).not.toContain('## ');
    expect(tekst).not.toContain('# Lore');
  });

  it('jest cache’owane — ten sam obiekt przy kolejnym wywołaniu', () => {
    expect(lore()).toBe(tekst);
  });
});
