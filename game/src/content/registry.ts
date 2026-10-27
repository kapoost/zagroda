import {
  ContentSchema,
  STATIONS,
  type Biome,
  type Content,
  type Item,
  type Npc,
  type Recipe,
  type Resource,
  type Station,
  type Structure,
  type ToolKind,
} from './schema.js';

/**
 * Walidacja treści + kontrole integralności.
 *
 * Schemat Zod sprawdza KSZTAŁT jednego wpisu. Ten plik sprawdza SPÓJNOŚĆ całości:
 * czy referencje się rozwiązują, czy graf receptur jest acykliczny, czy każdy item
 * jest w ogóle osiągalny w rozgrywce, i czy nie da się zrobić pętli nieskończonego zysku.
 *
 * NIEZAPISYWALNY dla agenta.
 */

/** Crafting może podnieść wartość wsadu najwyżej tyle razy. */
const VALUE_MULT = 4;

export interface Issue {
  code: string;
  msg: string;
  where?: string;
}

export interface Registry {
  content: Content;
  items: Map<string, Item>;
  structures: Map<string, Structure>;
  resources: Map<string, Resource>;
  recipes: Map<string, Recipe>;
  biomes: Map<string, Biome>;
  npcs: Map<string, Npc>;
  /** Biomy posortowane malejąco po priorytecie — kolejność rozstrzygania w worldgenie. */
  biomeOrder: Biome[];
  /** Itemy osiągalne w rozgrywce, wyliczone punktem stałym. */
  obtainable: Set<string>;
}

export type ValidateResult =
  | { ok: true; registry: Registry; issues: [] }
  | { ok: false; issues: Issue[] };

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

export function validateContent(raw: unknown): ValidateResult {
  const parsed = ContentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        code: 'SCHEMA',
        msg: i.message,
        where: i.path.join('.'),
      })),
    };
  }
  const c = parsed.data;
  const issues: Issue[] = [];
  const err = (code: string, msg: string, where?: string) => issues.push({ code, msg, where });

  // --- 1. unikalność identyfikatorów ---------------------------------------
  const collections: Array<[string, Array<{ id: string }>]> = [
    ['items', c.items],
    ['structures', c.structures],
    ['resources', c.resources],
    ['recipes', c.recipes],
    ['biomes', c.biomes],
    ['npcs', c.npcs],
  ];
  for (const [name, xs] of collections) {
    const seen = new Set<string>();
    for (const x of xs) {
      if (seen.has(x.id)) err('DUP_ID', `zduplikowane id "${x.id}"`, name);
      seen.add(x.id);
    }
  }

  const items = byId(c.items);
  const structures = byId(c.structures);
  const resources = byId(c.resources);
  const recipes = byId(c.recipes);
  const biomes = byId(c.biomes);
  const npcs = byId(c.npcs);

  // --- 2. referencje ------------------------------------------------------
  /**
   * Komunikat błędu jest tu interfejsem użytkownika — czyta go model, który ma zmianę
   * poprawić. Samo "nie ma itemu X" nie niesie informacji, której potrzebuje: najczęstsza
   * pomyłka to podanie id surowca zamiast id przedmiotu, który z niego wypada. Dlatego
   * walidator sprawdza, czym ten identyfikator w rzeczywistości jest, i mówi to wprost.
   */
  const needItem = (id: string, where: string) => {
    if (items.has(id)) return;
    const res = resources.get(id);
    if (res) {
      const drops = res.drops.map((d) => d.item).join(', ');
      err(
        'REF_ITEM',
        `"${id}" to surowiec rosnący w świecie, nie przedmiot. Użyj tego, co z niego wypada: ${drops}`,
        where,
      );
      return;
    }
    if (structures.has(id)) {
      const holder = c.items.find((i) => i.placeable?.structure === id);
      err(
        'REF_ITEM',
        `"${id}" to struktura stawiana w świecie, nie przedmiot${holder ? `. Przedmiot, który ją stawia, to "${holder.id}"` : ''}`,
        where,
      );
      return;
    }
    if (recipes.has(id)) {
      err('REF_ITEM', `"${id}" to receptura, nie przedmiot. Podaj id przedmiotu, który produkuje`, where);
      return;
    }
    err('REF_ITEM', `nie ma itemu "${id}"`, where);
  };
  for (const it of c.items) {
    if (it.placeable && !structures.has(it.placeable.structure)) {
      err('REF_STRUCTURE', `nie ma struktury "${it.placeable.structure}"`, `items.${it.id}`);
    }
    // Spójność ról. Model, który musi wypełnić każde pole schematu, chętnie dopisuje
    // przedmiotowi wszystkie naraz — i powstaje kosz, który jest narzędziem i jedzeniem.
    // Pola nieużywane mają być nullem; te kontrole wymuszają to po stronie treści.
    if (it.placeable && it.tool) {
      err('ROLA', 'przedmiot stawiany w świecie nie może być jednocześnie narzędziem', `items.${it.id}`);
    }
    if (it.placeable && it.edible) {
      err('ROLA', 'przedmiotu stawianego w świecie nie da się zjeść', `items.${it.id}`);
    }
    if (it.tool && it.edible) {
      err('ROLA', 'narzędzie nie jest jednocześnie jedzeniem', `items.${it.id}`);
    }
  }
  for (const r of c.resources) {
    for (const b of r.biomes) {
      if (!biomes.has(b)) err('REF_BIOME', `nie ma biomu "${b}"`, `resources.${r.id}`);
    }
    for (const d of r.drops) needItem(d.item, `resources.${r.id}.drops`);
  }
  for (const r of c.recipes) {
    for (const i of r.inputs) needItem(i.item, `recipes.${r.id}.inputs`);
    needItem(r.output.item, `recipes.${r.id}.output`);
    const dupInput = new Set<string>();
    for (const i of r.inputs) {
      if (dupInput.has(i.item)) err('DUP_INPUT', `wsad "${i.item}" powtórzony`, `recipes.${r.id}`);
      dupInput.add(i.item);
    }
    if (r.inputs.some((i) => i.item === r.output.item)) {
      err('SELF_RECIPE', `receptura produkuje własny wsad`, `recipes.${r.id}`);
    }
  }
  for (const n of c.npcs) {
    for (const l of n.likes) needItem(l, `npcs.${n.id}.likes`);
    if (n.home.x >= c.config.worldSize || n.home.y >= c.config.worldSize) {
      err('NPC_OOB', `dom NPC poza światem`, `npcs.${n.id}`);
    }
  }
  for (const s of c.config.startInventory) needItem(s.item, 'config.startInventory');

  // --- 3. pokrycie przestrzeni biomów ------------------------------------
  // Worldgen mapuje (wysokość, wilgotność) na biom. Dziura w pokryciu = kafel bez biomu.
  const GRID = 20;
  const holes: string[] = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const e = (i + 0.5) / GRID;
      const m = (j + 0.5) / GRID;
      const hit = c.biomes.some(
        (b) => e >= b.elevation[0] && e < b.elevation[1] && m >= b.moisture[0] && m < b.moisture[1],
      );
      if (!hit && holes.length < 5) holes.push(`(h=${e.toFixed(2)}, w=${m.toFixed(2)})`);
    }
  }
  if (holes.length) {
    err('BIOME_HOLE', `przestrzeń biomów nie jest pokryta, np. ${holes.join(', ')}`, 'biomes');
  }
  if (!c.biomes.some((b) => b.walkable)) {
    err('NO_WALKABLE', 'żaden biom nie jest przechodni', 'biomes');
  }

  // --- 4. acykliczność grafu receptur ------------------------------------
  const deps = new Map<string, Set<string>>();
  for (const r of c.recipes) {
    const set = deps.get(r.output.item) ?? new Set<string>();
    for (const i of r.inputs) set.add(i.item);
    deps.set(r.output.item, set);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const mark = new Map<string, number>();
  const stack: string[] = [];
  const visit = (id: string): boolean => {
    const s = mark.get(id) ?? WHITE;
    if (s === GREY) {
      err('RECIPE_CYCLE', `cykl w recepturach: ${[...stack, id].join(' → ')}`, 'recipes');
      return false;
    }
    if (s === BLACK) return true;
    mark.set(id, GREY);
    stack.push(id);
    for (const d of deps.get(id) ?? []) if (!visit(d)) break;
    stack.pop();
    mark.set(id, BLACK);
    return true;
  };
  for (const id of deps.keys()) visit(id);

  // --- 5. ekonomia: crafting nie może być drukarką pieniędzy -------------
  for (const r of c.recipes) {
    const inVal = r.inputs.reduce((a, i) => a + (items.get(i.item)?.value ?? 0) * i.qty, 0);
    const outVal = (items.get(r.output.item)?.value ?? 0) * r.output.qty;
    if (inVal > 0 && outVal > inVal * VALUE_MULT) {
      err(
        'ECON',
        `wartość wyjścia ${outVal} przekracza ${VALUE_MULT}× wartość wsadu ${inVal}`,
        `recipes.${r.id}`,
      );
    }
  }

  // --- 5b. granice względne: drabinka narzędzi musi iść w jedną stronę ---
  //
  // Granice bezwzględne ze schematu (durability 10..5000) przepuszczają narzędzie,
  // które kosztuje więcej od poprzednika i jest od niego gorsze. Tak przeszedł młot
  // "dużo wytrzymalszy od kilofa" z wytrzymałością 30 przy kilofie 200, a potem
  // żelazna kosa "wyraźnie mocniejsza" — mocniejsza owszem, ale ośmiokrotnie
  // bardziej krucha od zwykłej. Każda liczba z osobna mieściła się w zakresie.
  //
  // Stąd reguła ostrzejsza niż "lepsze w czymkolwiek": droższe narzędzie tego samego
  // rodzaju nie może być gorsze w ŻADNEJ osi. Ulepszenie to ulepszenie, a nie wymiana
  // jednej cechy na drugą — na to są różne rodzaje narzędzi, nie różne poziomy.
  const narzedzia = c.items.filter((i) => i.tool);
  const wsadRecepturyNa = new Map<string, number>();
  for (const r of c.recipes) {
    const wartosc = r.inputs.reduce((a, i) => a + (items.get(i.item)?.value ?? 0) * i.qty, 0);
    const dotad = wsadRecepturyNa.get(r.output.item);
    if (dotad === undefined || wartosc < dotad) wsadRecepturyNa.set(r.output.item, wartosc);
  }
  for (const a of narzedzia) {
    for (const b of narzedzia) {
      if (a.id === b.id || a.tool!.kind !== b.tool!.kind) continue;
      if (a.value <= b.value) continue;
      const gorszaSila = a.tool!.power < b.tool!.power;
      const gorszaWytrzymalosc = a.tool!.durability < b.tool!.durability;
      if (gorszaSila || gorszaWytrzymalosc) {
        err(
          'DOMINACJA',
          `kosztuje więcej niż "${b.id}" (${a.value} do ${b.value}), a jest od niego gorsze: ` +
            `siła ${a.tool!.power} do ${b.tool!.power}, wytrzymałość ${a.tool!.durability} do ${b.tool!.durability}. ` +
            `Droższe narzędzie tego samego rodzaju nie może być gorsze w żadnej z tych dwóch rzeczy`,
          `items.${a.id}`,
        );
        continue;
      }
      // Lepsze narzędzie musi też kosztować więcej w wytwarzaniu, inaczej poprzednik
      // przestaje mieć sens: nikt nie zrobi gorszej rzeczy za tę samą cenę.
      const wsadA = wsadRecepturyNa.get(a.id);
      const wsadB = wsadRecepturyNa.get(b.id);
      if (wsadA !== undefined && wsadB !== undefined && wsadA <= wsadB) {
        err(
          'KOSZT_POSTEPU',
          `jest lepsze od "${b.id}", a kosztuje tyle samo albo mniej (wsad wart ${wsadA} do ${wsadB}) — ` +
            `po takiej zmianie nikt już nie wytworzy "${b.id}". Podnieś wsad receptury`,
          `recipes → items.${a.id}`,
        );
      }
    }
  }

  // --- 5c. struktura, której nic nie stawia, jest martwa ------------------
  // Odpowiednik kontroli BEZ_ZASTOSOWANIA, tylko dla struktur. Model dopisał kiedyś
  // "stanowisko rybackie" przy okazji żelaznej wędki: poprawne, spójne i niewidoczne
  // dla gracza, bo żaden przedmiot go nie stawiał.
  const stawiane = new Set(c.items.flatMap((i) => (i.placeable ? [i.placeable.structure] : [])));
  for (const st of c.structures) {
    if (stawiane.has(st.id)) continue;
    err(
      'STRUKTURA_SIEROTA',
      `żaden przedmiot nie stawia tej struktury, więc gracz jej nigdy nie zobaczy. ` +
        `Dodaj przedmiot z "placeable" wskazującym na "${st.id}" albo usuń strukturę`,
      `structures.${st.id}`,
    );
  }

  // Twarde błędy referencyjne unieważniają analizę osiągalności.
  if (issues.length) return { ok: false, issues };

  // --- 6. osiągalność: punkt stały po narzędziach i stacjach -------------
  const obtainable = new Set<string>(c.config.startInventory.map((s) => s.item));
  const toolsOf = (): Set<ToolKind> => {
    const t = new Set<ToolKind>(['hand']);
    for (const id of obtainable) {
      const k = items.get(id)?.tool?.kind;
      if (k) t.add(k);
    }
    return t;
  };
  const stationsOf = (): Set<Station> => {
    const s = new Set<Station>(['hand']);
    for (const id of obtainable) {
      const st = items.get(id)?.placeable?.structure;
      const station = st ? structures.get(st)?.station : undefined;
      if (station) s.add(station);
    }
    return s;
  };
  const harvestable = new Set<string>();
  const craftable = new Set<string>();
  for (let pass = 0; pass < 64; pass++) {
    const before = obtainable.size;
    const tools = toolsOf();
    const stations = stationsOf();
    for (const r of c.resources) {
      if (!tools.has(r.tool)) continue;
      harvestable.add(r.id);
      for (const d of r.drops) obtainable.add(d.item);
    }
    for (const r of c.recipes) {
      if (!stations.has(r.station)) continue;
      if (!r.inputs.every((i) => obtainable.has(i.item))) continue;
      craftable.add(r.id);
      obtainable.add(r.output.item);
    }
    if (obtainable.size === before) break;
  }

  for (const it of c.items) {
    if (!obtainable.has(it.id)) {
      err('UNREACHABLE_ITEM', `item "${it.id}" jest nieosiągalny w rozgrywce`, `items.${it.id}`);
    }
  }
  for (const r of c.resources) {
    if (!harvestable.has(r.id)) {
      err(
        'UNREACHABLE_RESOURCE',
        `surowiec "${r.id}" wymaga narzędzia "${r.tool}", którego nie da się zdobyć`,
        `resources.${r.id}`,
      );
    }
  }
  /**
   * Przedmiot bez zastosowania.
   *
   * Długoterminowy tryb awarii tego projektu: model dokłada przez miesiące przedmioty,
   * które przechodzą każdą pojedynczą kontrolę i do niczego nie służą. Każdy z osobna
   * jest nieszkodliwy; sto takich zamienia grę w śmietnik. Przedmiot musi mieć rolę
   * (narzędzie, jedzenie, coś stawianego) albo być zużywany przez jakąś recepturę.
   */
  const usedAsInput = new Set(c.recipes.flatMap((r) => r.inputs.map((i) => i.item)));
  for (const it of c.items) {
    if (it.tool || it.edible || it.placeable || usedAsInput.has(it.id)) continue;
    err(
      'BEZ_ZASTOSOWANIA',
      `przedmiot "${it.id}" do niczego nie służy: nie jest narzędziem, jedzeniem ani czymś, ` +
        'co się stawia, i żadna receptura go nie zużywa. Nadaj mu rolę albo dodaj recepturę, ' +
        'która go używa',
      `items.${it.id}`,
    );
  }

  for (const r of c.recipes) {
    if (!craftable.has(r.id)) {
      err(
        'UNREACHABLE_RECIPE',
        `receptura "${r.id}" nigdy nie jest wykonalna (stacja "${r.station}" lub wsad poza zasięgiem)`,
        `recipes.${r.id}`,
      );
    }
  }
  for (const st of new Set(c.recipes.map((r) => r.station))) {
    if (st === 'hand') continue;
    const provided = c.structures.some((s) => s.station === st);
    if (!provided) err('NO_STATION', `żadna struktura nie daje stacji "${st}"`, 'structures');
  }
  for (const s of c.structures) {
    if (s.station && !STATIONS.includes(s.station)) {
      err('BAD_STATION', `nieznana stacja "${s.station}"`, `structures.${s.id}`);
    }
  }

  if (issues.length) return { ok: false, issues };

  const biomeOrder = [...c.biomes].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return {
    ok: true,
    issues: [],
    registry: { content: c, items, structures, resources, recipes, biomes, npcs, biomeOrder, obtainable },
  };
}

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `  [${i.code}] ${i.where ? i.where + ': ' : ''}${i.msg}`).join('\n');
}
