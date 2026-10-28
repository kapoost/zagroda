import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Klasa, którą kod włącza, musi mieć regułę w arkuszu.
 *
 * Ten test powstał po błędzie, którego bramka nie miała jak złapać: okno rozmowy
 * zdejmowało klasę „widoczne", żeby się schować, a dla tej klasy nie było ANI JEDNEJ
 * reguły CSS. Esc działał, stan się zmieniał, testy przechodziły — a przezroczyste tło
 * dalej zasłaniało całą grę. Nazwa klasy jest cichym kontraktem między kodem a stylem
 * i tylko tutaj da się go sprawdzić bez przeglądarki.
 */
const ROOT = resolve(import.meta.dirname, '..');

function pliki(kat: string, out: string[] = []): string[] {
  for (const n of readdirSync(kat)) {
    const p = resolve(kat, n);
    if (statSync(p).isDirectory()) pliki(p, out);
    else if (n.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('kontrakt kodu ze stylem', () => {
  it('każda klasa przełączana z kodu ma regułę w index.html', () => {
    const style = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    const brakujace: string[] = [];
    for (const plik of pliki(resolve(ROOT, 'src'))) {
      const tresc = readFileSync(plik, 'utf8');
      for (const m of tresc.matchAll(/classList\.(?:add|remove|toggle)\('([a-z0-9-]+)'/g)) {
        const klasa = m[1]!;
        if (!style.includes(`.${klasa}`)) brakujace.push(`${klasa} (${plik.slice(ROOT.length + 1)})`);
      }
    }
    expect(brakujace, `klasy bez reguły w arkuszu: ${brakujace.join(', ')}`).toEqual([]);
  });
});
