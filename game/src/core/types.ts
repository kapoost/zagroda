export type Facing = 'n' | 's' | 'e' | 'w';

export const DIRS: Record<Facing, { dx: number; dy: number }> = {
  n: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  e: { dx: 1, dy: 0 },
  w: { dx: -1, dy: 0 },
};

export type EntKind = 'resource' | 'placed' | 'npc';

export interface Entity {
  kind: EntKind;
  /** id definicji z treści: resources[].id, structures[].id albo npcs[].id */
  def: string;
  x: number;
  y: number;
  hp: number;
  /** tick, w którym surowiec odrośnie; 0 = żywy */
  respawnAt: number;
  storage?: Record<string, number>;
}

export interface Player {
  x: number;
  y: number;
  facing: Facing;
  energy: number;
  inv: Record<string, number>;
  /** zużycie narzędzi: itemId -> ile punktów wytrzymałości zużyto */
  wear: Record<string, number>;
  /** aktualnie trzymany item (narzędzie lub do postawienia) */
  held: string | null;
}

export interface CraftJob {
  recipe: string;
  left: number;
}

export interface State {
  seed: number;
  size: number;
  tick: number;
  /** indeksy do content.biomes w kolejności pliku */
  biome: Uint8Array;
  /** kafel -> (indeks encji + 1); 0 = pusto */
  entAt: Int32Array;
  /** Odcień dachu per kafel, 0 = nie budynek. Pozwala odróżnić sąsiadujące kamienice. */
  dachy: Uint8Array;
  /** Archetyp fasady per kafel: indeks w content.facades + 1, zero gdy to nie budynek. */
  fasady: Uint8Array;
  /** Nazwane zabytki z OSM. Fakty o okolicy, nie treść do wymyślania. */
  miejsca: ReadonlyArray<{ nazwa: string; x: number; y: number }>;
  ents: Entity[];
  player: Player;
  craft: CraftJob | null;
  rng: number;
  log: string[];
}

export interface Input {
  move?: Facing;
  /** Obróć się bez ruchu. Potrzebne, by użyć narzędzia na kaflu, po którym można chodzić. */
  face?: Facing;
  /** użyj trzymanego narzędzia na kaflu przed sobą */
  act?: boolean;
  craft?: string;
  place?: string;
  hold?: string | null;
  eat?: string;
  /**
   * Wynik żywej rozmowy z postacią: KTÓRĄ akcję wybrała, nigdy co powiedziała.
   *
   * Tekst jest prezentacją i nie ma prawa wejść do rdzenia. Sam wybór akcji jest
   * niedeterministyczny — ale wejście już takie jest, bo po drugiej stronie siedzi
   * człowiek. Test determinizmu odtwarza ustaloną sekwencję wejść, więc dopóki akcja
   * przychodzi TĄ drogą, a nie bokiem, hash stanu dalej zgadza się co do bitu.
   */
  rozmowa?: { npc: string; daj?: string; za?: string };
}

export const MAX_LOG = 64;
