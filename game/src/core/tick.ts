import type { Registry } from '../content/registry.js';
import type { Zadanie } from '../content/schema.js';
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

/** Zapisz, że gracz stanął pod zabytkiem. Jedno spojrzenie w siatkę, bez liczenia odległości. */
function odnotujMiejsce(state: State): void {
  const nr = state.bliskoMiejsca[idx(state, state.player.x, state.player.y)];
  if (!nr) return;
  const nazwa = state.miejsca[nr - 1]?.nazwa;
  if (nazwa && !state.odwiedzone.includes(nazwa)) state.odwiedzone.push(nazwa);
}

export function facingTile(state: State): { x: number; y: number } {
  const d = DIRS[state.player.facing];
  return { x: state.player.x + d.dx, y: state.player.y + d.dy };
}

/**
 * Osiem kafli dokoła gracza, zawsze w TEJ kolejności.
 *
 * Kolejność jest częścią reguły, nie szczegółem zapisu: rdzeń jest deterministyczny,
 * więc gdyby zależała od czegokolwiek poza tą tablicą, dwa przebiegi z tym samym
 * seedem mogłyby zebrać dwa różne krzaki.
 */
const DOKOLA: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
  { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 },
];

/**
 * Na czym zadziała spacja.
 *
 * Kafel przed sobą ma pierwszeństwo zawsze — dzięki temu rozmowa, schowek i warsztat
 * zachowują się przewidywalnie: używasz tego, na co patrzysz. Dopiero gdy przed nami
 * nic nie ma, szukamy SUROWCA w całym otoczeniu, łącznie ze skosami.
 *
 * Rozszerzenie dotyczy wyłącznie surowców i to celowo. Gdyby obejmowało wszystko,
 * gracz zagadywałby postać stojącą za plecami i otwierał skrzynię, której nie widzi.
 */
export function celAkcji(state: State): { x: number; y: number } {
  const przed = facingTile(state);
  if (entityAt(state, przed.x, przed.y)) return przed;
  for (const d of DOKOLA) {
    const x = state.player.x + d.dx;
    const y = state.player.y + d.dy;
    const e = entityAt(state, x, y);
    if (e?.kind === 'resource') return { x, y };
  }
  return przed;
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

/**
 * Dołóż do plecaka i powiedz, ile faktycznie weszło.
 *
 * Limit `stack` stał w treści od pierwszego dnia i nie znaczył nic — można było nosić
 * dziewięćdziesiąt siekier, mimo że schemat mówi „jedna". Teraz znaczy, ale zwracamy
 * liczbę zamiast po cichu obcinać: przedmiot, który przepadł bez słowa, jest gorszy
 * niż odmowa, bo gracz dowiaduje się o nim dopiero przy recepturze, która nie wychodzi.
 *
 * Ujemne qty to zabieranie i limitu nie dotyczy.
 */
export function give(state: State, reg: Registry, item: string, qty: number): number {
  if (qty < 0) {
    const n = (state.player.inv[item] ?? 0) + qty;
    if (n <= 0) delete state.player.inv[item];
    else state.player.inv[item] = n;
    return qty;
  }
  const ile = Math.min(qty, miejsceNa(state, reg, item));
  if (ile <= 0) return 0;
  state.player.inv[item] = (state.player.inv[item] ?? 0) + ile;
  return ile;
}

/** Ile jeszcze sztuk tego przedmiotu zmieści się w plecaku. */
export function miejsceNa(state: State, reg: Registry, item: string): number {
  const limit = reg.items.get(item)?.stack ?? Infinity;
  return Math.max(0, limit - (state.player.inv[item] ?? 0));
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
    give(state, reg, held, -1);
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
    give(state, reg, d.item, qty);
    log(state, `+${qty} ${reg.items.get(d.item)!.name}`);
  }
  removeEntity(state, e);
  e.respawnAt = def.regrow > 0 ? state.tick + def.regrow : -1;
}

/** Czy warunek zadania jest już spełniony. Każdy rodzaj da się sprawdzić w jednym tiku. */
export function warunekSpelniony(state: State, reg: Registry, z: Zadanie): boolean {
  if (z.typ === 'miec') return count(state, z.cel) >= z.ile;
  if (z.typ === 'postawic') {
    return state.ents.some((e) => e.kind === 'placed' && e.def === z.cel && e.respawnAt === 0);
  }
  return state.odwiedzone.includes(z.cel);
}

/**
 * Rozmowa z postacią: najpierw sprawy, potem pogawędka.
 *
 * Zadania nie dostały ani własnego klawisza, ani własnego okna — wchodzą tą samą
 * spacją, co wszystko inne. Postać oddaje to, co ma do oddania, bierze to, co ma wziąć,
 * a gdy nic z tego, mówi swoje. Mniej ruchomych części znaczy mniej miejsc, w których
 * stan gry może się rozjechać z tym, co widać na ekranie.
 */
function talk(state: State, reg: Registry, e: Entity, rng: Rng): void {
  const npc = reg.npcs.get(e.def)!;
  // Kolejność po id, bo ta sama rozmowa ma dawać ten sam wynik w każdym przebiegu.
  const moje = reg.content.zadania.filter((z) => z.dawca === npc.id).sort((a, b) => a.id.localeCompare(b.id));

  const doOddania = moje.find((z) => state.zadania[z.id] === 'wziete' && warunekSpelniony(state, reg, z));
  if (doOddania) {
    if (doOddania.typ === 'miec') give(state, reg, doOddania.cel, -doOddania.ile);
    const weszlo = give(state, reg, doOddania.nagroda.item, doOddania.nagroda.qty);
    state.zadania[doOddania.id] = 'zrobione';
    log(state, `${npc.name}: ${doOddania.podziekowanie}`);
    const nagroda = reg.items.get(doOddania.nagroda.item)?.name ?? doOddania.nagroda.item;
    log(state, weszlo > 0 ? `Nagroda: ${weszlo}× ${nagroda}.` : `Nagroda przepadła — nie masz miejsca na ${nagroda}.`);
    return;
  }

  const doWziecia = moje.find((z) => !state.zadania[z.id]);
  if (doWziecia) {
    state.zadania[doWziecia.id] = 'wziete';
    log(state, `${npc.name}: ${doWziecia.zlecenie}`);
    return;
  }

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

  give(state, reg, oferta.za, -oferta.ile);
  give(state, reg, r.daj, 1);
  log(state, `${npc.name}: ${dar.name} za ${oferta.ile}× ${zaplata.name}.`);
}

/** Ile rzeczy leży w schowku. Pojemność liczy się w sztukach, nie w rodzajach. */
export function wSchowku(e: Entity): number {
  return Object.values(e.storage ?? {}).reduce((a, n) => a + n, 0);
}

/**
 * Użycie schowka.
 *
 * Skrzynia miała pojemność w treści od pierwszego dnia i nie robiła z nią NIC — użyta
 * meldowała tylko, że „stoi na swoim miejscu". Pole w schemacie, które niczego nie
 * zmienia, jest gorsze od braku pola: model je wypełnia, walidator przyjmuje, bramka
 * świeci na zielono, a gracz dostaje obietnicę bez pokrycia.
 *
 * Reguła jest jedna i bez interfejsu: trzymasz coś w ręce — wkładasz, ile się zmieści.
 * Masz wolne ręce — wyjmujesz jedną rzecz, zawsze pierwszą po identyfikatorze, bo
 * kolejność musi być ta sama w każdym przebiegu.
 */
function doSchowek(state: State, reg: Registry, e: Entity): void {
  const def = reg.structures.get(e.def)!;
  e.storage ??= {};
  const trzymane = state.player.held;

  if (trzymane) {
    const mam = count(state, trzymane);
    const miejsce = def.storage - wSchowku(e);
    const ile = Math.min(mam, miejsce);
    if (ile <= 0) {
      log(state, `${def.name} jest pełna.`);
      return;
    }
    give(state, reg, trzymane, -ile);
    e.storage[trzymane] = (e.storage[trzymane] ?? 0) + ile;
    log(state, `Do ${def.name.toLowerCase()}: ${ile}× ${reg.items.get(trzymane)?.name ?? trzymane}.`);
    return;
  }

  const co = Object.keys(e.storage).filter((k) => (e.storage![k] ?? 0) > 0).sort()[0];
  if (!co) {
    log(state, `${def.name} jest pusta.`);
    return;
  }
  e.storage[co] = (e.storage[co] ?? 0) - 1;
  if (e.storage[co]! <= 0) delete e.storage[co];
  give(state, reg, co, 1);
  log(state, `Z ${def.name.toLowerCase()}: 1× ${reg.items.get(co)?.name ?? co}.`);
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
  for (const i of r.inputs) give(state, reg, i.item, -i.qty);
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
  give(state, reg, itemId, -1);
  state.entAt[idx(state, t.x, t.y)] = state.ents.length + 1;
  const def = reg.structures.get(item.placeable.structure);
  state.ents.push({
    kind: 'placed',
    def: item.placeable.structure,
    // Pusty schowek od razu przy stawianiu: struktura albo coś mieści, albo nie,
    // i widać to po stanie, a nie po zaglądaniu do treści przy każdym użyciu.
    ...(def?.storage ? { storage: {} as Record<string, number> } : {}),
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
  give(state, reg, itemId, -1);
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
      give(state, reg, r.output.item, r.output.qty);
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
      odnotujMiejsce(state);
    }
  }

  if (input.act) {
    const t = celAkcji(state);
    const e = entityAt(state, t.x, t.y);
    if (!e) log(state, 'Nic tu nie ma.');
    else if (e.kind === 'resource') harvest(state, reg, e, rng);
    else if (e.kind === 'npc') talk(state, reg, e, rng);
    else if (reg.structures.get(e.def)?.storage) doSchowek(state, reg, e);
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
