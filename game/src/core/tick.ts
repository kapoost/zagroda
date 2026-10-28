import type { Registry } from '../content/registry.js';
import { Rng } from './rng.js';
import { DIRS, MAX_LOG, type Entity, type Input, type State } from './types.js';
import { dozwolona } from './wymiana.js';

/**
 * Jedyne miejsce, w którym zmienia się stan gry.
 *
 * Kontrakt: tick(state, input, reg) jest w pełni deterministyczny — ta sama trójka
 * argumentów zawsze daje ten sam wynik. Żadnego Date.now(), żadnego Math.random().
 * Test determinizmu w tests/determinism.test.ts pilnuje tego przy każdej zmianie.
 */

const ENERGY_REGEN_EVERY = 20;
/** Zbieranie po ciemku kosztuje tyle razy więcej sił. Dotyczy wyłącznie zbierania. */
const NIGHT_GATHER_MULTIPLIER = 2;
const RESPAWN_RETRY = 600;
const STATION_RADIUS = 2;

export function idx(state: State, x: number, y: number): number {
  return y * state.size + x;
}

export function inBounds(state: State, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.size && y < state.size;
}

export function entityAt(state: State, x: number, y: number): Entity | null {
  if (!inBounds(state, x, y)) return null;
  const i = state.entAt[idx(state, x, y)]!;
  return i === 0 ? null : state.ents[i - 1]!;
}

export function blocks(reg: Registry, e: Entity): boolean {
  if (e.kind === 'npc') return true;
  if (e.kind === 'resource') return reg.resources.get(e.def)?.blocks ?? true;
  return reg.structures.get(e.def)?.blocks ?? true;
}

export function walkable(state: State, reg: Registry, x: number, y: number): boolean {
  if (!inBounds(state, x, y)) return false;
  if (!reg.content.biomes[state.biome[idx(state, x, y)]!]!.walkable) return false;
  const e = entityAt(state, x, y);
  return !e || !blocks(reg, e);
}

export function facingTile(state: State): { x: number; y: number } {
  const d = DIRS[state.player.facing];
  return { x: state.player.x + d.dx, y: state.player.y + d.dy };
}

export function heldToolKind(state: State, reg: Registry): string {
  const held = state.player.held;
  if (!held) return 'hand';
  return reg.items.get(held)?.tool?.kind ?? 'hand';
}

export function stationAvailable(state: State, reg: Registry, station: string): boolean {
  if (station === 'hand') return true;
  const { x, y } = state.player;
  for (let dy = -STATION_RADIUS; dy <= STATION_RADIUS; dy++) {
    for (let dx = -STATION_RADIUS; dx <= STATION_RADIUS; dx++) {
      const e = entityAt(state, x + dx, y + dy);
      if (e?.kind === 'placed' && reg.structures.get(e.def)?.station === station) return true;
    }
  }
  return false;
}

export function count(state: State, item: string): number {
  return state.player.inv[item] ?? 0;
}

export function give(state: State, item: string, qty: number): void {
  const n = (state.player.inv[item] ?? 0) + qty;
  if (n <= 0) delete state.player.inv[item];
  else state.player.inv[item] = n;
}

function log(state: State, msg: string): void {
  // Powtórzony komunikat pod rząd zalewa dziennik i wypycha z niego to, co ważne.
  if (state.log[state.log.length - 1] === msg) return;
  state.log.push(msg);
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

/**
 * Pobranie sił za czynność.
 *
 * Mnożnik przekazuje wołający, bo to on wie, czy warunki dotyczą jego czynności.
 * Koszt nie może przekroczyć maksimum sił: przy legalnej konfiguracji treści
 * (energyPerAction 12 przy energyMax 20) mnożnik zrobiłby z akcji czynność
 * niewykonalną na zawsze, bez względu na to, ile gracz je i odpoczywa.
 */
function spend(state: State, reg: Registry, multiplier = 1): boolean {
  const cost = Math.min(reg.content.config.energyPerAction * multiplier, reg.content.config.energyMax);
  if (state.player.energy < cost) {
    log(state, 'Brakuje ci sił. Zjedz coś albo odpocznij.');
    return false;
  }
  state.player.energy -= cost;
  return true;
}

/** Zużycie narzędzia; zwraca true, jeśli narzędzie właśnie się rozpadło. */
function wearTool(state: State, reg: Registry): boolean {
  const held = state.player.held;
  if (!held) return false;
  const tool = reg.items.get(held)?.tool;
  if (!tool) return false;
  const w = (state.player.wear[held] ?? 0) + 1;
  if (w >= tool.durability) {
    delete state.player.wear[held];
    give(state, held, -1);
    log(state, `${reg.items.get(held)!.name} rozpada się w rękach.`);
    return true;
  }
  state.player.wear[held] = w;
  return false;
}

function removeEntity(state: State, e: Entity): void {
  state.entAt[idx(state, e.x, e.y)] = 0;
}

function harvest(state: State, reg: Registry, e: Entity, rng: Rng): void {
  const def = reg.resources.get(e.def)!;
  const kind = heldToolKind(state, reg);
  if (def.tool !== kind) {
    const need = reg.content.items.find((i) => i.tool?.kind === def.tool);
    log(state, `Na to potrzeba czegoś mocniejszego${need ? `: ${need.name.toLowerCase()}` : ''}.`);
    return;
  }
  if (!spend(state, reg, isNight(state, reg) ? NIGHT_GATHER_MULTIPLIER : 1)) return;
  const power = state.player.held ? (reg.items.get(state.player.held)?.tool?.power ?? 1) : 1;
  e.hp -= power;
  wearTool(state, reg);
  if (e.hp > 0) return;

  for (const d of def.drops) {
    if (!rng.chance(d.chance)) continue;
    const qty = rng.int(d.min, d.max);
    give(state, d.item, qty);
    log(state, `+${qty} ${reg.items.get(d.item)!.name}`);
  }
  removeEntity(state, e);
  e.respawnAt = def.regrow > 0 ? state.tick + def.regrow : -1;
}

function talk(state: State, reg: Registry, e: Entity, rng: Rng): void {
  const npc = reg.npcs.get(e.def)!;
  const line = npc.dialogues[rng.int(0, npc.dialogues.length - 1)]!;
  log(state, `${npc.name}: ${line}`);
}

/**
 * Zastosowanie wyniku rozmowy. Rdzeń sprawdza wszystko drugi raz, mimo że gramatyka
 * modelu i tak nie pozwala wypisać daru spoza listy — bo to wejście przychodzi z sieci,
 * a nie z klawiatury, i jedyne, co wiemy na pewno, to co stoi w treści gry.
 */
function doRozmowa(state: State, reg: Registry, r: NonNullable<Input['rozmowa']>): void {
  const npc = reg.npcs.get(r.npc);
  if (!npc) return;
  const obok = Object.values(DIRS).some((d) => {
    const e = entityAt(state, state.player.x + d.dx, state.player.y + d.dy);
    return e?.kind === 'npc' && e.def === r.npc;
  });
  if (!obok) {
    log(state, `${npc.name} jest za daleko.`);
    return;
  }
  if (!r.daj || !r.za) return;

  const dar = reg.items.get(r.daj);
  if (!dar || !npc.gives.includes(r.daj)) return;

  // Kurs liczy silnik, nie model i nie przeglądarka. Przychodzi samo "co za co",
  // a "ile" jest przeliczane tu od nowa — więc podrobiony kurs po prostu nie istnieje.
  const oferta = dozwolona(state, reg, r.npc, r.daj, r.za);
  if (!oferta) return;
  const zaplata = reg.items.get(oferta.za)!;
  if ((state.player.inv[oferta.za] ?? 0) < oferta.ile) return;

  give(state, oferta.za, -oferta.ile);
  give(state, r.daj, 1);
  log(state, `${npc.name}: ${dar.name} za ${oferta.ile}× ${zaplata.name}.`);
}

function doCraft(state: State, reg: Registry, recipeId: string): void {
  if (state.craft) {
    log(state, 'Jesteś już czymś zajęty.');
    return;
  }
  const r = reg.recipes.get(recipeId);
  if (!r) return;
  if (!stationAvailable(state, reg, r.station)) {
    log(state, `Potrzebujesz stanowiska w pobliżu: ${r.station}.`);
    return;
  }
  for (const i of r.inputs) {
    if (count(state, i.item) < i.qty) {
      log(state, `Brakuje: ${reg.items.get(i.item)!.name}.`);
      return;
    }
  }
  if (!spend(state, reg)) return;
  for (const i of r.inputs) give(state, i.item, -i.qty);
  state.craft = { recipe: r.id, left: r.ticks };
}

function doPlace(state: State, reg: Registry, itemId: string): void {
  const item = reg.items.get(itemId);
  if (!item?.placeable) return;
  if (count(state, itemId) < 1) return;
  const t = facingTile(state);
  if (!inBounds(state, t.x, t.y)) return;
  if (!reg.content.biomes[state.biome[idx(state, t.x, t.y)]!]!.walkable) {
    log(state, 'Tutaj tego nie postawisz.');
    return;
  }
  if (entityAt(state, t.x, t.y)) {
    log(state, 'Miejsce jest zajęte.');
    return;
  }
  if (!spend(state, reg)) return;
  give(state, itemId, -1);
  state.entAt[idx(state, t.x, t.y)] = state.ents.length + 1;
  state.ents.push({
    kind: 'placed',
    def: item.placeable.structure,
    x: t.x,
    y: t.y,
    hp: 1,
    respawnAt: 0,
    storage: {},
  });
  log(state, `Stawiasz: ${item.name}.`);
}

function doEat(state: State, reg: Registry, itemId: string): void {
  const item = reg.items.get(itemId);
  if (!item?.edible || count(state, itemId) < 1) return;
  give(state, itemId, -1);
  const max = reg.content.config.energyMax;
  state.player.energy = Math.min(max, state.player.energy + item.edible.energy);
  log(state, `Zjadasz: ${item.name}.`);
}

function respawnPass(state: State, reg: Registry): void {
  for (let i = 0; i < state.ents.length; i++) {
    const e = state.ents[i]!;
    if (e.respawnAt <= 0 || state.tick < e.respawnAt) continue;
    if (state.entAt[idx(state, e.x, e.y)] !== 0) {
      e.respawnAt = state.tick + RESPAWN_RETRY;
      continue;
    }
    e.hp = reg.resources.get(e.def)?.hp ?? 1;
    e.respawnAt = 0;
    state.entAt[idx(state, e.x, e.y)] = i + 1;
  }
}

export function tick(state: State, input: Input, reg: Registry): State {
  state.tick++;
  const rng = new Rng(state.rng);

  if (input.hold !== undefined) {
    state.player.held = input.hold && count(state, input.hold) > 0 ? input.hold : null;
  }

  if (state.craft) {
    state.craft.left--;
    if (state.craft.left <= 0) {
      const r = reg.recipes.get(state.craft.recipe)!;
      give(state, r.output.item, r.output.qty);
      log(state, `Gotowe: ${r.name} (+${r.output.qty} ${reg.items.get(r.output.item)!.name})`);
      state.craft = null;
    }
  }

  if (input.face) state.player.facing = input.face;

  if (input.move) {
    state.player.facing = input.move;
    const d = DIRS[input.move];
    const nx = state.player.x + d.dx;
    const ny = state.player.y + d.dy;
    if (walkable(state, reg, nx, ny)) {
      state.player.x = nx;
      state.player.y = ny;
    }
  }

  if (input.act) {
    const t = facingTile(state);
    const e = entityAt(state, t.x, t.y);
    if (!e) log(state, 'Nic tu nie ma.');
    else if (e.kind === 'resource') harvest(state, reg, e, rng);
    else if (e.kind === 'npc') talk(state, reg, e, rng);
    else log(state, `${reg.structures.get(e.def)?.name ?? e.def} stoi na swoim miejscu.`);
  }

  if (input.rozmowa) doRozmowa(state, reg, input.rozmowa);
  if (input.craft) doCraft(state, reg, input.craft);
  if (input.place) doPlace(state, reg, input.place);
  if (input.eat) doEat(state, reg, input.eat);

  // Jedna reguła zamiast trzech rozsianych: ręka nie może trzymać czegoś, czego nie ma.
  // Wytwarzanie zużywa wsad i jako jedyne tego nie pilnowało — fuzz to złapał.
  if (state.player.held !== null && count(state, state.player.held) <= 0) {
    state.player.held = null;
  }

  respawnPass(state, reg);

  if (state.tick % ENERGY_REGEN_EVERY === 0) {
    state.player.energy = Math.min(reg.content.config.energyMax, state.player.energy + 1);
  }

  state.rng = rng.state;
  return state;
}

export function dayOf(state: State, reg: Registry): number {
  return Math.floor(state.tick / reg.content.config.dayTicks) + 1;
}

/** Gracz budzi się rano, nie o północy — stąd przesunięcie zegara względem ticku zero. */
const DAY_OFFSET = 0.32;

/**
 * Granica nocy. Istnieje jako funkcja, a nie jako próg rozsiany po kodzie, bo „noc"
 * to decyzja projektowa gry, a nie rzecz do odgadnięcia z wartości liczbowej.
 * Pokrywa się z przyciemnieniem ekranu w rendererze.
 */
export const NIGHT_FROM = 0.78;
export const NIGHT_TO = 0.24;

export function isNight(state: State, reg: Registry): boolean {
  const t = timeOfDay(state, reg);
  return t >= NIGHT_FROM || t < NIGHT_TO;
}

/** 0 = północ, 0.5 = południe. */
export function timeOfDay(state: State, reg: Registry): number {
  const d = reg.content.config.dayTicks;
  return ((state.tick % d) / d + DAY_OFFSET) % 1;
}
