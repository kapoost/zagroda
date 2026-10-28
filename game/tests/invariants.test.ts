import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game.js';
import { Rng } from '../src/core/rng.js';
import { NIGHT_FROM, NIGHT_TO, entityAt, idx, isNight, tick } from '../src/core/tick.js';
import { registry } from '../src/content/load.js';
import { generate } from '../src/core/world.js';
import { oferty } from '../src/core/wymiana.js';
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

  it('oddaje przedmiot za zapłatę, gdy postać stoi obok', () => {
    const { reg, s, npc } = przyPostaci();
    s.player.inv = { galaz: 20 };
    const dar = reg.npcs.get(npc.def)!.gives[0]!;
    tick(s, { rozmowa: { npc: npc.def, daj: dar, za: 'galaz' } }, reg);
    expect(s.player.inv[dar] ?? 0).toBe(1);
    expect(s.player.inv['galaz']).toBeLessThan(20);
  });

  it('nie oddaje nic, gdy postać jest daleko', () => {
    const { reg, s, npc } = przyPostaci();
    s.player.inv = { galaz: 20 };
    const dar = reg.npcs.get(npc.def)!.gives[0]!;
    s.player.x = npc.x + 9;
    tick(s, { rozmowa: { npc: npc.def, daj: dar, za: 'galaz' } }, reg);
    expect(s.player.inv[dar] ?? 0).toBe(0);
    expect(s.player.inv['galaz']).toBe(20);
  });

  it('nie oddaje przedmiotu spoza listy tej postaci', () => {
    const { reg, s, npc } = przyPostaci();
    s.player.inv = { galaz: 20 };
    tick(s, { rozmowa: { npc: npc.def, daj: 'sztabka_zelaza', za: 'galaz' } }, reg);
    expect(s.player.inv['sztabka_zelaza'] ?? 0).toBe(0);
    expect(s.player.inv['galaz']).toBe(20);
  });

  it('nie zna postaci, której nie ma w treści', () => {
    const { reg, s } = przyPostaci();
    const przed = JSON.stringify(s.player.inv);
    tick(s, { rozmowa: { npc: 'nikt_taki', daj: 'jagoda', za: 'galaz' } }, reg);
    expect(JSON.stringify(s.player.inv)).toBe(przed);
  });
});

/**
 * Prawo wymiany. Te testy pilnują czegoś mocniejszego niż poprawność jednej funkcji:
 * sprawdzają, że NIE DA SIĘ obejść kursu przez wejście — ani z modelu, ani z
 * przeglądarki, ani z konsoli. Kurs liczy silnik i tylko silnik.
 *
 * Leżą tutaj, a nie obok wymiany, celowo. game/tests/ jest niezapisywalne dla agenta,
 * więc gdyby kiedykolwiek przepisał tick.ts i rozluźnił warunek, bramka to złapie.
 */
describe('wymiana z postacią', () => {
  const przyPostaci = (inv: Record<string, number> = {}) => {
    const reg = registry();
    const s = generate(reg, 11);
    const npc = s.ents.find((e) => e.kind === 'npc' && reg.npcs.get(e.def)!.gives.length)!;
    s.player.x = npc.x - 1;
    s.player.y = npc.y;
    s.player.inv = { ...inv };
    return { reg, s, npc, def: reg.npcs.get(npc.def)! };
  };
  const wartosc = (reg: ReturnType<typeof registry>, inv: Record<string, number>) =>
    Object.entries(inv).reduce((a, [id, n]) => a + (reg.items.get(id)?.value ?? 0) * n, 0);

  it('pobiera zapłatę policzoną przez silnik, nie przysłaną z zewnątrz', () => {
    const { reg, s, npc, def } = przyPostaci({ galaz: 20 });
    const dar = def.gives[0]!;
    const o = oferty(s, reg, npc.def).find((x) => x.za === 'galaz')!;
    expect(o.ile).toBeGreaterThan(0);
    tick(s, { rozmowa: { npc: npc.def, daj: dar, za: 'galaz' } }, reg);
    expect(s.player.inv[dar] ?? 0).toBe(1);
    expect(s.player.inv['galaz']).toBe(20 - o.ile);
  });

  it('nie da się zapłacić czymś, czego gracz nie ma', () => {
    const { reg, s, npc, def } = przyPostaci({ galaz: 20 });
    const przed = JSON.stringify(s.player.inv);
    tick(s, { rozmowa: { npc: npc.def, daj: def.gives[0]!, za: 'sztabka_zelaza' } }, reg);
    expect(JSON.stringify(s.player.inv)).toBe(przed);
  });

  it('nie da się zapłacić narzędziem', () => {
    const { reg, s, npc, def } = przyPostaci({ siekiera_kamienna: 3 });
    const przed = JSON.stringify(s.player.inv);
    tick(s, { rozmowa: { npc: npc.def, daj: def.gives[0]!, za: 'siekiera_kamienna' } }, reg);
    expect(JSON.stringify(s.player.inv)).toBe(przed);
  });

  /**
   * Regresja. Pierwsza wersja dawała przedmiot za darmo, gdy nie było ANI JEDNEJ
   * wykonalnej oferty — a to jest prawda na stałe dla gracza z jedną gałęzią w ręku,
   * bo na rybę za pięć gałęzi go nie stać, a rybą za rybę się nie płaci. Wychodziły
   * z tego nieskończone ryby: wartość plecaka 1 → 26 w pięciu tickach.
   *
   * Darmowego daru nie ma już wcale. Zbieranie jest darmowe i to ono jest początkiem
   * gry, więc nikt bez niczego nie utknie.
   */
  it('bez zapłaty nie ma daru, nawet gdy nie stać na żadną ofertę', () => {
    const przypadki: Array<Record<string, number>> = [{}, { galaz: 1 }, { galaz: 1, ryba: 3 }];
    for (const inv of przypadki) {
      const { reg, s, npc, def } = przyPostaci(inv);
      const przed = JSON.stringify(s.player.inv);
      for (let i = 0; i < 5; i++) tick(s, { rozmowa: { npc: npc.def, daj: def.gives[0]! } }, reg);
      expect(JSON.stringify(s.player.inv)).toBe(przed);
    }
  });

  it('żadna wymiana nie podnosi wartości plecaka', () => {
    const { reg, s, npc, def } = przyPostaci({ galaz: 40, kamien: 40, jagoda: 10, drewno: 10 });
    const start = wartosc(reg, s.player.inv);
    // Brak "za" też jest wejściem, które ktoś może przysłać — i to właśnie tą ścieżką
    // przeciekały nieskończone ryby, bo fuzz zawsze podawał zapłatę.
    const zaplaty = ['galaz', 'kamien', 'jagoda', 'drewno', 'nie_ma', 'siekiera_kamienna', undefined];
    for (let i = 0; i < 40; i++) {
      for (const daj of [...def.gives, 'sztabka_zelaza', 'nie_ma_takiego']) {
        for (const za of zaplaty) {
          tick(s, { rozmowa: { npc: npc.def, daj, za } }, reg);
        }
      }
    }
    expect(wartosc(reg, s.player.inv)).toBeLessThanOrEqual(start);
  });

  it('nie zna wymiany z postacią, która nic nie daje ani z nieistniejącą', () => {
    const { reg, s, npc } = przyPostaci({ galaz: 20 });
    expect(oferty(s, reg, 'nikt_taki')).toHaveLength(0);
    const przed = JSON.stringify(s.player.inv);
    tick(s, { rozmowa: { npc: 'nikt_taki', daj: 'jagoda', za: 'galaz' } }, reg);
    expect(JSON.stringify(s.player.inv)).toBe(przed);
    expect(npc).toBeTruthy();
  });
});

/**
 * Zasięg zbierania. Kafel przed sobą ma pierwszeństwo zawsze, bo rozmowa i schowek
 * mają działać na to, na co patrzysz. Surowce łapie się z całego otoczenia, ze skosami.
 */
describe('zasięg akcji', () => {
  const pusteOtoczenie = () => {
    const reg = registry();
    const s = generate(reg, 5);
    // Czyścimy osiem kafli dokoła, żeby test mówił o tym, co sam postawi.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const e = entityAt(s, s.player.x + dx, s.player.y + dy);
        if (e) {
          s.entAt[idx(s, e.x, e.y)] = 0;
          e.respawnAt = -1;
        }
      }
    }
    return { reg, s };
  };

  const postawSurowiec = (s: ReturnType<typeof generate>, dx: number, dy: number, def: string) => {
    const x = s.player.x + dx;
    const y = s.player.y + dy;
    s.ents.push({ kind: 'resource', def, x, y, hp: 1, respawnAt: 0 });
    s.entAt[idx(s, x, y)] = s.ents.length;
  };

  it('zbiera surowiec stojący po skosie', () => {
    const { reg, s } = pusteOtoczenie();
    s.player.facing = 'n';
    postawSurowiec(s, 1, 1, 'krzak');
    const przed = Object.values(s.player.inv).reduce((a, n) => a + n, 0);
    tick(s, { act: true }, reg);
    expect(Object.values(s.player.inv).reduce((a, n) => a + n, 0)).toBeGreaterThan(przed);
  });

  it('kafel przed sobą wygrywa z surowcem po skosie', () => {
    const { reg, s } = pusteOtoczenie();
    s.player.facing = 'n';
    postawSurowiec(s, 0, -1, 'kamien_polny');
    postawSurowiec(s, 1, 1, 'krzak');
    tick(s, { act: true }, reg);
    expect(s.player.inv['kamien']).toBeGreaterThan(0);
  });

  it('nie zagaduje postaci stojącej za plecami', () => {
    const { reg, s } = pusteOtoczenie();
    s.player.facing = 'n';
    const npc = s.ents.find((e) => e.kind === 'npc')!;
    s.entAt[idx(s, npc.x, npc.y)] = 0;
    npc.x = s.player.x;
    npc.y = s.player.y + 1;
    s.entAt[idx(s, npc.x, npc.y)] = s.ents.indexOf(npc) + 1;
    const przed = s.log.length;
    tick(s, { act: true }, reg);
    expect(s.log.slice(przed).join(' ')).toContain('Nic tu nie ma');
  });
});

/**
 * Schowki. Pojemność stała w treści od pierwszego dnia i nie robiła nic — skrzynia
 * użyta meldowała, że „stoi na swoim miejscu". Pole, które niczego nie zmienia, jest
 * gorsze od braku pola: model je wypełnia, walidator przyjmuje, bramka świeci na
 * zielono, a gracz dostaje obietnicę bez pokrycia.
 */
describe('schowek', () => {
  const zeSkrzynia = (ile: number) => {
    const reg = registry();
    const s = generate(reg, 13);
    const x = s.player.x;
    const y = s.player.y - 1;
    const stary = entityAt(s, x, y);
    if (stary) s.entAt[idx(s, x, y)] = 0;
    s.ents.push({ kind: 'placed', def: 'skrzynia_drewniana', x, y, hp: 1, respawnAt: 0, storage: {} });
    s.entAt[idx(s, x, y)] = s.ents.length;
    s.player.facing = 'n';
    s.player.inv = { galaz: ile };
    s.player.held = 'galaz';
    return { reg, s, skrzynia: s.ents[s.ents.length - 1]! };
  };

  it('wkłada to, co w ręce, i oddaje z powrotem', () => {
    const { reg, s, skrzynia } = zeSkrzynia(7);
    tick(s, { act: true }, reg);
    expect(skrzynia.storage).toEqual({ galaz: 7 });
    expect(s.player.inv['galaz'] ?? 0).toBe(0);

    tick(s, { act: true }, reg);
    expect(s.player.inv['galaz']).toBe(1);
    expect(skrzynia.storage).toEqual({ galaz: 6 });
  });

  it('nie przyjmuje ponad pojemność z treści', () => {
    const { reg, s, skrzynia } = zeSkrzynia(50);
    const pojemnosc = reg.structures.get('skrzynia_drewniana')!.storage;
    tick(s, { act: true }, reg);
    expect(Object.values(skrzynia.storage!).reduce((a, n) => a + n, 0)).toBe(pojemnosc);
    expect(s.player.inv['galaz']).toBe(50 - pojemnosc);
  });

  it('nic nie ginie ani nie powstaje przy przekładaniu', () => {
    const { reg, s, skrzynia } = zeSkrzynia(9);
    const razem = () =>
      (s.player.inv['galaz'] ?? 0) + (skrzynia.storage?.['galaz'] ?? 0);
    expect(razem()).toBe(9);
    for (let i = 0; i < 30; i++) {
      tick(s, { act: true }, reg);
      tick(s, { hold: s.player.held ? null : 'galaz' }, reg);
      expect(razem()).toBe(9);
    }
  });
});
