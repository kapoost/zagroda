import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game.js';
import { Rng } from '../src/core/rng.js';
import { idx } from '../src/core/tick.js';
import { MAX_LOG, type Facing, type Input } from '../src/core/types.js';

/**
 * Inwarianty rdzenia. Dowolne wejście, dowolny seed — te zdania muszą zostać prawdziwe.
 * To jest siatka bezpieczeństwa dla patchy kodu generowanych przez model.
 */

const SEEDS = [1337, 2, 777, 31337];
const TICKS = 4000;

function fuzz(g: Game, seed: number, ticks: number): void {
  const rng = new Rng(seed);
  const dirs: Facing[] = ['n', 'e', 's', 'w'];
  const items = g.reg.content.items.map((i) => i.id);
  const recipes = g.reg.content.recipes.map((r) => r.id);
  for (let i = 0; i < ticks; i++) {
    const roll = rng.next();
    let input: Input = {};
    if (roll < 0.4) input = { move: dirs[rng.int(0, 3)]! };
    else if (roll < 0.7) input = { face: dirs[rng.int(0, 3)]!, act: true };
    else if (roll < 0.8) input = { craft: recipes[rng.int(0, recipes.length - 1)]! };
    else if (roll < 0.88) input = { place: items[rng.int(0, items.length - 1)]! };
    else if (roll < 0.94) input = { hold: items[rng.int(0, items.length - 1)]! };
    else input = { eat: items[rng.int(0, items.length - 1)]! };
    g.step(input);
    check(g, i);
  }
}

function check(g: Game, step: number): void {
  const s = g.state;
  const cfg = g.reg.content.config;
  const at = `seed=${s.seed} tick=${s.tick} krok=${step}`;

  for (const [item, n] of Object.entries(s.player.inv)) {
    expect(n, `ujemny lub zerowy stan "${item}" w ekwipunku (${at})`).toBeGreaterThan(0);
    expect(g.reg.items.has(item), `nieznany item "${item}" w ekwipunku (${at})`).toBe(true);
  }
  expect(s.player.energy, `energia poza zakresem (${at})`).toBeGreaterThanOrEqual(0);
  expect(s.player.energy).toBeLessThanOrEqual(cfg.energyMax);

  expect(s.player.x).toBeGreaterThanOrEqual(0);
  expect(s.player.y).toBeGreaterThanOrEqual(0);
  expect(s.player.x).toBeLessThan(s.size);
  expect(s.player.y).toBeLessThan(s.size);
  expect(
    g.reg.content.biomes[s.biome[idx(s, s.player.x, s.player.y)]!]!.walkable,
    `gracz stoi na nieprzechodnim kaflu (${at})`,
  ).toBe(true);

  if (s.player.held !== null) {
    expect((s.player.inv[s.player.held] ?? 0), `trzyma item, którego nie ma (${at})`).toBeGreaterThan(0);
  }
  if (s.craft) {
    expect(g.reg.recipes.has(s.craft.recipe), `nieznana receptura w toku (${at})`).toBe(true);
    expect(s.craft.left).toBeGreaterThan(0);
  }
  expect(s.log.length, `log rośnie bez ograniczenia (${at})`).toBeLessThanOrEqual(MAX_LOG);
}

describe('inwarianty rdzenia', () => {
  it.each(SEEDS)('seed %i przetrzymuje losowe wejście', (seed) => {
    const g = new Game(seed);
    fuzz(g, seed ^ 0x5bf0, TICKS);
  });

  it('indeks kafli zgadza się z listą encji', () => {
    const g = new Game(1337);
    fuzz(g, 11, 1500);
    const s = g.state;
    let live = 0;
    for (let i = 0; i < s.entAt.length; i++) {
      const e = s.entAt[i]!;
      if (e === 0) continue;
      live++;
      const ent = s.ents[e - 1];
      expect(ent, `indeks wskazuje na nieistniejącą encję przy kaflu ${i}`).toBeDefined();
      expect(idx(s, ent!.x, ent!.y), 'encja nie stoi tam, gdzie wskazuje indeks').toBe(i);
    }
    expect(live).toBeGreaterThan(0);
    for (const e of s.ents) {
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThan(s.size);
      expect(e.y).toBeLessThan(s.size);
    }
  });

  it('crafting nie tworzy itemów z niczego', () => {
    const g = new Game(1337);
    const r = g.reg.content.recipes.find((x) => x.id === 'r_sznurek')!;
    g.state.player.inv = { wlokno: 2 };
    g.step({ craft: r.id });
    expect(g.state.player.inv['wlokno']).toBeUndefined();
    g.steps(r.ticks + 1);
    expect(g.state.player.inv['sznurek']).toBe(1);
  });

  it('nie da się wykonać receptury bez wsadu', () => {
    const g = new Game(1337);
    g.state.player.inv = {};
    g.step({ craft: 'r_sznurek' });
    expect(g.state.craft).toBeNull();
    expect(g.state.player.inv['sznurek']).toBeUndefined();
  });

  it('budżet czasu: 20 tysięcy ticków poniżej 2 sekund', () => {
    const g = new Game(1337);
    const t0 = Date.now();
    g.steps(20_000, { move: 'e' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
