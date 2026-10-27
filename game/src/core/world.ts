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

  const walkable = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && reg.content.biomes[biome[y * size + x]!]!.walkable;

  // NPC lądują na najbliższym przechodnim i wolnym kaflu względem swojego "domu".
  for (const npc of reg.content.npcs) {
    const spot = nearestFree(npc.home.x, npc.home.y, size, walkable, entAt);
    if (!spot) continue;
    entAt[spot.y * size + spot.x] = ents.length + 1;
    ents.push({ kind: 'npc', def: npc.id, x: spot.x, y: spot.y, hp: 1, respawnAt: 0 });
  }

  const start = nearestFree(Math.floor(size / 2), Math.floor(size / 2), size, walkable, entAt);
  const inv: Record<string, number> = {};
  for (const s of reg.content.config.startInventory) inv[s.item] = (inv[s.item] ?? 0) + s.qty;

  return {
    seed,
    size,
    tick: 0,
    biome,
    entAt,
    dachy,
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
