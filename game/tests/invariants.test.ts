import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game.js';
import { Rng } from '../src/core/rng.js';
import { NIGHT_FROM, NIGHT_TO, idx, isNight, tick } from '../src/core/tick.js';
import { registry } from '../src/content/load.js';
import { generate } from '../src/core/world.js';
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

describe('doba', () => {
  it('noc obejmuje północ i nie obejmuje południa', () => {
    const g = new Game(1337);
    const d = g.reg.content.config.dayTicks;
    const at = (t: number) => {
      g.state.tick = Math.round(((t - 0.32 + 1) % 1) * d);
      return isNight(g.state, g.reg);
    };
    expect(at(0.0), 'północ').toBe(true);
    expect(at(0.1), '02:24').toBe(true);
    expect(at(0.5), 'południe').toBe(false);
    expect(at(0.6), '14:24').toBe(false);
    expect(at(0.85), '20:24').toBe(true);
  });

  it('granice nocy są spójne z tym, co widzi gracz', () => {
    // Renderer przyciemnia ekran własną krzywą; jeśli rozjedzie się z definicją nocy,
    // gracz zobaczy dzień i zapłaci nocną stawkę — albo odwrotnie.
    expect(NIGHT_FROM).toBeGreaterThan(0.5);
    expect(NIGHT_TO).toBeLessThan(0.5);
  });
});

describe('koszt czynności', () => {
  const atTime = (g: Game, frac: number) => {
    g.state.tick = Math.round(((frac - 0.32 + 1) % 1) * g.reg.content.config.dayTicks);
  };
  const hitNearestBush = (g: Game) => {
    const t = g.state.ents.find((e) => e.kind === 'resource' && e.def === 'krzak' && e.respawnAt === 0)!;
    g.state.player.x = t.x;
    g.state.player.y = t.y - 1;
    const before = g.state.player.energy;
    g.step({ face: 's', act: true });
    return before - g.state.player.energy;
  };

  it('zbieranie w nocy kosztuje dwa razy więcej niż w dzień', () => {
    const day = new Game(1337);
    atTime(day, 0.5);
    const night = new Game(1337);
    atTime(night, 0.0);
    expect(hitNearestBush(night)).toBe(hitNearestBush(day) * 2);
  });

  it('nocna stawka nie dotyczy wytwarzania ani stawiania', () => {
    // Prośba brzmiała "zbieranie w nocy", a spend() jest wspólne dla trzech czynności.
    const g = new Game(1337);
    atTime(g, 0.0);
    g.state.player.inv = { wlokno: 2, pochodnia: 1 };
    const beforeCraft = g.state.player.energy;
    g.step({ craft: 'r_sznurek' });
    expect(beforeCraft - g.state.player.energy).toBe(g.reg.content.config.energyPerAction);
  });

  it('koszt nigdy nie przekracza maksimum sił', () => {
    // Schemat dopuszcza energyPerAction 12 przy energyMax 20; bez ograniczenia
    // nocna stawka 24 zablokowałaby zbieranie na zawsze.
    const g = new Game(1337);
    atTime(g, 0.0);
    (g.reg.content.config as { energyPerAction: number }).energyPerAction = 12;
    (g.reg.content.config as { energyMax: number }).energyMax = 20;
    g.state.player.energy = 20;
    expect(hitNearestBush(g)).toBeLessThanOrEqual(20);
    (g.reg.content.config as { energyPerAction: number }).energyPerAction = 1;
    (g.reg.content.config as { energyMax: number }).energyMax = 100;
  });
});

/**
 * Rozmowa jest prezentacją, ale jej WYNIK wchodzi do rdzenia jak każde inne wejście.
 * Te testy pilnują, że przychodzi wyłącznie tą drogą i że rdzeń nie wierzy na słowo:
 * sprawdza odległość i listę darów drugi raz, mimo gramatyki po stronie modelu.
 */
describe('wynik rozmowy', () => {
  const przyPostaci = () => {
    const reg = registry();
    const s = generate(reg, 7);
    const npc = s.ents.find((e) => e.kind === 'npc')!;
    s.player.x = npc.x - 1;
    s.player.y = npc.y;
    return { reg, s, npc };
  };

  it('daje przedmiot z listy, gdy postać stoi obok', () => {
    const { reg, s, npc } = przyPostaci();
    const dar = reg.npcs.get(npc.def)!.gives[0]!;
    const przed = s.player.inv[dar] ?? 0;
    tick(s, { rozmowa: { npc: npc.def, daj: dar } }, reg);
    expect(s.player.inv[dar] ?? 0).toBe(przed + 1);
  });

  it('nie daje nic, gdy postać jest daleko', () => {
    const { reg, s, npc } = przyPostaci();
    const dar = reg.npcs.get(npc.def)!.gives[0]!;
    s.player.x = npc.x + 9;
    const przed = s.player.inv[dar] ?? 0;
    tick(s, { rozmowa: { npc: npc.def, daj: dar } }, reg);
    expect(s.player.inv[dar] ?? 0).toBe(przed);
  });

  it('nie daje przedmiotu spoza listy tej postaci', () => {
    const { reg, s, npc } = przyPostaci();
    const przed = s.player.inv['sztabka_zelaza'] ?? 0;
    tick(s, { rozmowa: { npc: npc.def, daj: 'sztabka_zelaza' } }, reg);
    expect(s.player.inv['sztabka_zelaza'] ?? 0).toBe(przed);
  });

  it('nie zna postaci, której nie ma w treści', () => {
    const { reg, s } = przyPostaci();
    const przed = JSON.stringify(s.player.inv);
    tick(s, { rozmowa: { npc: 'nikt_taki', daj: 'jagoda' } }, reg);
    expect(JSON.stringify(s.player.inv)).toBe(przed);
  });
});
