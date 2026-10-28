import mapa from '../../content/mapa.json';
import type { Registry } from '../content/registry.js';
import { fbm, hash2 } from './rng.js';
import type { Entity, State } from './types.js';

/**
 * Świat nie jest losowany, tylko zaimportowany: kształt Starego Miasta w Zamościu
 * pochodzi z OpenStreetMap (tools/import-osm.ts). Szum zostaje do rozsiewania surowców,
 * bo to one mają się różnić między partiami, a nie plan miasta.
 *
 * Gdyby mapy zabrakło, generator wraca do szumu — dzięki temu zakresy wysokości
 * i wilgotności w biomach nadal mają sens i nadal są sprawdzane przez bramkę.
 */
function rozpakuj(rle: string, dlugosc: number): Uint8Array | null {
  const out = new Uint8Array(dlugosc);
  let i = 0;
  for (const odcinek of rle.split(' ')) {
    const [ile, v] = odcinek.split('x').map(Number);
    for (let k = 0; k < ile!; k++) out[i++] = v!;
  }
  return i === dlugosc ? out : null;
}

function zMapy(reg: Registry, size: number): Uint8Array | null {
  if (mapa.rozmiar !== size) return null;
  const indeks = new Map(reg.content.biomes.map((b, i) => [b.id, i]));
  const out = new Uint8Array(size * size);
  let i = 0;
  for (const odcinek of mapa.kafle.split(' ')) {
    const [ile, nrLegendy] = odcinek.split('x').map(Number);
    const biom = indeks.get(mapa.legenda[nrLegendy!]!);
    if (biom === undefined) return null;
    for (let k = 0; k < ile!; k++) out[i++] = biom;
  }
  return i === out.length ? out : null;
}

/** Generacja świata. Czysta funkcja seeda i treści — ten sam seed daje ten sam świat. */

/** Parametry kształtu wyspy. Strojone pod rozkład biomów — patrz tests/world.test.ts. */
const ELEV_CONTRAST = 2.6;
const ELEV_AMP = 1.18;
const ISLAND_FALLOFF = 0.45;
const MOIST_CONTRAST = 1.8;

export function biomeIndexAt(reg: Registry, x: number, y: number, seed: number, size: number): number {
  const half = size / 2;
  const dx = (x - half) / half;
  const dy = (y - half) / half;
  const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
  // fbm ma małą wariancję (średnia wygładzonych oktaw), więc najpierw rozciągamy kontrast,
  // inaczej cała wyspa byłaby jedną płaską łąką bez gór.
  const stretched = (fbm(x, y, seed, 26, 4) - 0.5) * ELEV_CONTRAST + 0.5;
  const e = clamp01(stretched * ELEV_AMP - d * d * ISLAND_FALLOFF);
  const m = clamp01((fbm(x, y, seed + 9973, 18, 3) - 0.5) * MOIST_CONTRAST + 0.5);

  const biomes = reg.content.biomes;
  let best = -1;
  let bestPrio = -1;
  for (let i = 0; i < biomes.length; i++) {
    const b = biomes[i]!;
    if (e < b.elevation[0] || e >= b.elevation[1]) continue;
    if (m < b.moisture[0] || m >= b.moisture[1]) continue;
    if (b.priority > bestPrio) {
      bestPrio = b.priority;
      best = i;
    }
  }
  // Pokrycie jest wymuszone przez kontrolę BIOME_HOLE, więc tu jesteśmy już bezpieczni.
  return best >= 0 ? best : 0;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 0.999 ? 0.999 : v);

export function generate(reg: Registry, seed: number): State {
  const size = reg.content.config.worldSize;
  let biome = zMapy(reg, size);
  const dachy = (biome && rozpakuj(mapa.dachy, size * size)) || new Uint8Array(size * size);
  /**
   * Złączenie faktu z typologią.
   *
   * Mapa mówi, ile dany budynek ma kondygnacji i czy jest zabytkiem — to są fakty
   * z OSM. Treść gry mówi, jak wygląda budynek takiego rodzaju. Tutaj jedno spotyka
   * drugie, deterministycznie: gdy pasuje kilka archetypów, wybiera je odcień budynku,
   * czyli liczba, która i tak już odróżnia sąsiadów. Żadnego losowania.
   */
  const fasady = new Uint8Array(size * size);
  if (biome) {
    const pieter = rozpakuj(mapa.kondygnacje, size * size);
    const zabytki = rozpakuj(mapa.zabytki, size * size);
    const nrZabudowy = reg.content.biomes.findIndex((b) => b.id === 'kamienica');
    if (pieter && zabytki && nrZabudowy >= 0) {
      const pamiec = new Map<string, number>();
      for (let i = 0; i < fasady.length; i++) {
        if (biome[i] !== nrZabudowy) continue;
        const klucz = `${pieter[i]}:${zabytki[i]}:${dachy[i]}`;
        let wybrana = pamiec.get(klucz);
        if (wybrana === undefined) {
          const pasujace = reg.facadesFor(pieter[i]!, zabytki[i] === 1);
          const f = pasujace[(Math.max(1, dachy[i]!) - 1) % Math.max(1, pasujace.length)];
          wybrana = f ? reg.content.facades.indexOf(f) + 1 : 0;
          pamiec.set(klucz, wybrana);
        }
        fasady[i] = wybrana;
      }
    }
  }
  if (!biome) {
    biome = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        biome[y * size + x] = biomeIndexAt(reg, x, y, seed, size);
      }
    }
  }

  const ents: Entity[] = [];
  const entAt = new Int32Array(size * size);
  const resources = reg.content.resources;

  const przechodni = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && reg.content.biomes[biome![y * size + x]!]!.walkable;

  /**
   * Czy da się stanąć obok. Surowiec bez przechodniego sąsiada jest nieosiągalny —
   * trzcina pośrodku zalewu albo krzak zamknięty kamienicami wygląda w grze jak treść,
   * a zachowuje się jak jej brak. Reguła dotyczy wszystkich biomów, nie tylko wody.
   */
  const dostepny = (x: number, y: number) =>
    przechodni(x - 1, y) || przechodni(x + 1, y) || przechodni(x, y - 1) || przechodni(x, y + 1);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const b = reg.content.biomes[biome[y * size + x]!]!;
      for (let ri = 0; ri < resources.length; ri++) {
        const r = resources[ri]!;
        if (!r.biomes.includes(b.id)) continue;
        if (hash2(x, y, seed + 131 * (ri + 1)) >= r.density) continue;
        if (!dostepny(x, y)) continue;
        entAt[y * size + x] = ents.length + 1;
        ents.push({ kind: 'resource', def: r.id, x, y, hp: r.hp, respawnAt: 0 });
        break;
      }
    }
  }

  /**
   * Gdzie postawić gracza na Rynku.
   *
   * Nie na środku: Rynek Wielki ma sto metrów boku, więc ze środka widać wyłącznie
   * bruk. Nie przy pierzei: wtedy pół kadru to pusty plac. Szukamy NAROŻNIKA — kafla,
   * z którego kamienice widać w dwóch różnych kierunkach naraz. Wtedy pierwszy ekran
   * gry pokazuje dwie pierzeje i róg placu, czyli miejsce, a nie powierzchnię.
   */
  const rynek = (() => {
    const nrRynku = reg.content.biomes.findIndex((b) => b.id === 'rynek');
    const nrZabudowy = reg.content.biomes.findIndex((b) => b.id === 'kamienica');
    if (nrRynku < 0) return null;
    const plac: number[] = [];
    let sx = 0, sy = 0;
    for (let i = 0; i < biome.length; i++) {
      if (biome[i] !== nrRynku) continue;
      plac.push(i);
      sx += i % size; sy += (i / size) | 0;
    }
    if (!plac.length) return null;
    const srodek = { x: Math.round(sx / plac.length), y: Math.round(sy / plac.length) };
    if (nrZabudowy < 0) return srodek;

    const ZASIEG = 7;
    const KIERUNKI = [[0, -1], [0, 1], [1, 0], [-1, 0]] as const;
    let najlepszy: { x: number; y: number } | null = null;
    let najwiecej = 0;
    let najblizej = Infinity;
    for (const i of plac) {
      const x = i % size, y = (i / size) | 0;
      let pierzeji = 0;
      for (const [dx, dy] of KIERUNKI) {
        for (let k = 1; k <= ZASIEG; k++) {
          const nx = x + dx * k, ny = y + dy * k;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) break;
          if (biome[ny * size + nx] === nrZabudowy) { pierzeji++; break; }
        }
      }
      if (pierzeji < 2) continue;
      const d = (x - srodek.x) ** 2 + (y - srodek.y) ** 2;
      if (pierzeji < najwiecej || (pierzeji === najwiecej && d >= najblizej)) continue;
      najwiecej = pierzeji;
      najblizej = d;
      najlepszy = { x, y };
    }
    return najlepszy ?? srodek;
  })();

  const walkable = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && reg.content.biomes[biome[y * size + x]!]!.walkable;

  // NPC lądują na najbliższym przechodnim i wolnym kaflu względem swojego "domu".
  for (const npc of reg.content.npcs) {
    const spot = nearestFree(npc.home.x, npc.home.y, size, walkable, entAt);
    if (!spot) continue;
    entAt[spot.y * size + spot.x] = ents.length + 1;
    ents.push({ kind: 'npc', def: npc.id, x: spot.x, y: spot.y, hp: 1, respawnAt: 0 });
  }

  // Gra zaczyna się na Rynku, bo tak mówi dziennik i bo z Rynku wszystko jest w zasięgu.
  // Środek mapy nim nie jest — kadr OSM obejmuje też przedmieścia i zalew.
  const start = nearestFree(rynek?.x ?? Math.floor(size / 2), rynek?.y ?? Math.floor(size / 2), size, walkable, entAt);
  const inv: Record<string, number> = {};
  for (const s of reg.content.config.startInventory) inv[s.item] = (inv[s.item] ?? 0) + s.qty;

  return {
    seed,
    size,
    tick: 0,
    biome,
    entAt,
    dachy,
    fasady,
    ents,
    player: {
      x: start?.x ?? 1,
      y: start?.y ?? 1,
      facing: 's',
      energy: reg.content.config.energyMax,
      inv,
      wear: {},
      held: null,
    },
    craft: null,
    rng: seed ^ 0x9e3779b9,
    log: ['Budzisz się na Rynku. Nic nie masz. Całe miasto jest do obejścia.'],
  };
}

/** Spirala kwadratowa wokół punktu — deterministyczna kolejność przeszukiwania. */
function nearestFree(
  cx: number,
  cy: number,
  size: number,
  walkable: (x: number, y: number) => boolean,
  entAt: Int32Array,
): { x: number; y: number } | null {
  for (let r = 0; r < size; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!walkable(x, y)) continue;
        if (entAt[y * size + x] !== 0) continue;
        return { x, y };
      }
    }
  }
  return null;
}
