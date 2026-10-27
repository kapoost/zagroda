import { describe, expect, it } from 'vitest';
import { applyReplace } from '../src/stages/applyCode.js';

/**
 * Dopasowanie fragmentu do podmiany. Zbyt surowe — każdy patch pada na literówce
 * w białych znakach. Zbyt pobłażliwe — podmienia nie to miejsce i psuje rdzeń po cichu.
 */
const FILE = [
  'function spend(state: State, reg: Registry): boolean {',
  '  const cost = reg.content.config.energyPerAction;',
  '  if (state.player.energy < cost) {',
  '    log(state, "Brakuje ci sił.");',
  '    return false;',
  '  }',
  '  state.player.energy -= cost;',
  '  return true;',
  '}',
].join('\n');

describe('podmiana fragmentu', () => {
  it('dopasowuje dosłownie', () => {
    const r = applyReplace(FILE, '  const cost = reg.content.config.energyPerAction;', '  const cost = computeCost(state, reg);');
    expect(r.ok).toBe(true);
    expect(r.ok && r.next).toContain('computeCost(state, reg)');
  });

  it('wybacza złe wcięcie', () => {
    const r = applyReplace(FILE, 'const cost = reg.content.config.energyPerAction;', 'const cost = computeCost(state, reg);');
    expect(r.ok).toBe(true);
    // wcięcie z pliku ma zostać zachowane, nie z fragmentu podanego przez model
    expect(r.ok && r.next).toContain('\n  const cost = computeCost(state, reg);');
  });

  it('wybacza spacje na końcu linii', () => {
    const r = applyReplace(FILE, '  if (state.player.energy < cost) {   ', '  if (state.player.energy < cost * 2) {');
    expect(r.ok).toBe(true);
    expect(r.ok && r.next).toContain('cost * 2');
  });

  it('dopasowuje blok wielolinijkowy mimo rozjechanych wcięć', () => {
    const r = applyReplace(FILE, ['if (state.player.energy < cost) {', 'log(state, "Brakuje ci sił.");', 'return false;'].join('\n'), ['if (state.player.energy < cost) {', 'log(state, "Nie masz siły.");', 'return false;'].join('\n'));
    expect(r.ok).toBe(true);
    expect(r.ok && r.next).toContain('Nie masz siły.');
    expect(r.ok && r.next).toContain('  if (state.player.energy < cost) {');
  });

  it('odmawia, gdy fragment pasuje w wielu miejscach', () => {
    const dup = 'const x = 1;\nconst x = 1;\n';
    const r = applyReplace(dup, 'const x = 1;', 'const x = 2;');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toContain('razy');
  });

  it('odmawia i podpowiada, gdy fragmentu nie ma', () => {
    const r = applyReplace(FILE, '  const cost = reg.config.energy;', '  const cost = 2;');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toContain('nie występuje');
    // podpowiedź ma wskazać, co jest w pliku naprawdę
    expect(!r.ok && r.why).toContain('const cost =');
  });

  it('nie podmienia niczego, gdy odmawia', () => {
    const r = applyReplace(FILE, 'nie ma takiej linii w ogóle', 'cokolwiek');
    expect(r.ok).toBe(false);
  });
});
