import type { Game } from '../core/game.js';
import { count, entityAt, idx, stationAvailable, walkable } from '../core/tick.js';
import { DIRS, type Facing } from '../core/types.js';

/**
 * Bot progresji: zachłanny gracz, który potrafi zdobyć dowolny item.
 *
 * Po co to istnieje: to jest wyrocznia grywalności. Testy schematów mówią, czy treść
 * jest spójna; ten bot mówi, czy gra da się *przejść*. Jeśli agent doda recepturę,
 * której w praktyce nie da się wykonać, bot utknie i bramka zapali się na czerwono.
 */

export interface BotResult {
  ok: boolean;
  ticks: number;
  reason: string;
  trace: string[];
}

const EAT_BELOW = 25;

export class Bot {
  private spent = 0;
  private trace: string[] = [];
  private resolving = new Set<string>();

  constructor(
    private game: Game,
    private budget = 60_000,
  ) {}

  get ticks(): number {
    return this.spent;
  }

  /** Zdobądź `qty` sztuk `item`, rekurencyjnie domykając wszystkie zależności. */
  ensure(item: string, qty = 1): BotResult {
    this.trace = [];
    const ok = this.ensureItem(item, qty);
    return {
      ok,
      ticks: this.spent,
      reason: ok ? 'cel osiągnięty' : this.failReason(item, qty),
      trace: this.trace,
    };
  }

  private failReason(item: string, qty: number): string {
    if (this.spent >= this.budget) return `przekroczony budżet ${this.budget} ticków przy "${item}"`;
    return `nie udało się zdobyć ${qty}× "${item}" (mam ${count(this.game.state, item)})`;
  }

  private step(input: Parameters<Game['step']>[0] = {}): boolean {
    if (this.spent >= this.budget) return false;
    this.spent++;
    this.game.step(input);
    this.maybeEat();
    return true;
  }

  private maybeEat(): void {
    const s = this.game.state;
    if (s.player.energy >= EAT_BELOW) return;
    for (const [id, n] of Object.entries(s.player.inv)) {
      if (n > 0 && this.game.reg.items.get(id)?.edible) {
        this.game.step({ eat: id });
        this.spent++;
        return;
      }
    }
  }

  private ensureItem(item: string, qty: number): boolean {
    const s = this.game.state;
    if (count(s, item) >= qty) return true;
    const key = `${item}:${qty}`;
    if (this.resolving.has(key)) return false;
    this.resolving.add(key);
    try {
      if (this.craftUpTo(item, qty)) return count(s, item) >= qty;
      if (this.harvestUpTo(item, qty)) return count(s, item) >= qty;
      return false;
    } finally {
      this.resolving.delete(key);
    }
  }

  // --- crafting ----------------------------------------------------------

  private craftUpTo(item: string, qty: number): boolean {
    const reg = this.game.reg;
    const recipe = reg.content.recipes.find((r) => r.output.item === item);
    if (!recipe) return false;

    let guard = 0;
    while (count(this.game.state, item) < qty && guard++ < 64) {
      if (!this.ensureStation(recipe.station)) return false;
      for (const i of recipe.inputs) {
        if (!this.ensureItem(i.item, i.qty)) return false;
      }
      // Stacja mogła wymagać odejścia po wsad — wróć w jej pobliże.
      if (!this.ensureStation(recipe.station)) return false;
      this.trace.push(`craft ${recipe.id}`);
      if (!this.step({ craft: recipe.id })) return false;
      let waits = 0;
      while (this.game.state.craft && waits++ <= recipe.ticks + 4) {
        if (!this.step()) return false;
      }
      if (this.game.state.craft) return false;
    }
    return count(this.game.state, item) >= qty;
  }

  private ensureStation(station: string): boolean {
    if (station === 'hand') return true;
    if (stationAvailable(this.game.state, this.game.reg, station)) return true;
    // Najpierw wróć do stanowiska, które już stoi. Bez tego bot buduje drugie, zjadając
    // materiał, po który właśnie poszedł — na ciasnej mapie miejskiej droga po surowce
    // zawsze wyprowadza go poza promień stanowiska i pętla nigdy się nie domyka.
    if (this.goToStation(station)) return true;
    const reg = this.game.reg;
    const structure = reg.content.structures.find((s) => s.station === station);
    if (!structure) return false;
    const placeable = reg.content.items.find((i) => i.placeable?.structure === structure.id);
    if (!placeable) return false;
    if (!this.ensureItem(placeable.id, 1)) return false;
    return this.placeHere(placeable.id);
  }

  private placeHere(itemId: string): boolean {
    const s = this.game.state;
    const reg = this.game.reg;
    const structure = reg.items.get(itemId)?.placeable?.structure;
    const dirs: Facing[] = ['n', 'e', 's', 'w'];
    for (let attempt = 0; attempt < 24; attempt++) {
      for (const f of dirs) {
        const d = DIRS[f]!;
        const tx = s.player.x + d.dx;
        const ty = s.player.y + d.dy;
        if (!walkable(s, reg, tx, ty)) continue;
        if (entityAt(s, tx, ty)) continue;
        // Nie zamuruj się własnym budynkiem. Na ciasnej mapie miejskiej bot potrafił
        // postawić piec na jedynym wolnym sąsiednim kaflu i zostać uwięziony we wnęce
        // między kamienicami — wyglądało to potem jak „surowiec nieosiągalny”.
        if (reg.structures.get(structure ?? '')?.blocks !== false && !this.maWyjscie(tx, ty)) continue;
        if (!this.step({ face: f })) return false;
        if (!this.step({ place: itemId })) return false;
        // Postawienie może się nie udać cicho (woda, zajęty kafel) — weryfikuj wynik.
        if (entityAt(s, tx, ty)?.def === structure) {
          this.trace.push(`place ${itemId}`);
          return true;
        }
      }
      // Nie ma wolnego sąsiada: przesuń się o kafel i spróbuj z nowego miejsca.
      let moved = false;
      for (const f of dirs) {
        const d = DIRS[f]!;
        if (!walkable(s, reg, s.player.x + d.dx, s.player.y + d.dy)) continue;
        if (!this.step({ move: f })) return false;
        moved = true;
        break;
      }
      if (!moved) return false;
    }
    return false;
  }

  // --- zbieranie ---------------------------------------------------------

  private harvestUpTo(item: string, qty: number): boolean {
    const reg = this.game.reg;
    const sources = reg.content.resources.filter((r) => r.drops.some((d) => d.item === item));
    if (!sources.length) return false;

    let guard = 0;
    while (count(this.game.state, item) < qty && guard++ < 400) {
      let progressed = false;
      for (const r of sources) {
        const tool = reg.content.items.find((i) => i.tool?.kind === r.tool);
        if (r.tool !== 'hand') {
          if (!tool || !this.ensureItem(tool.id, 1)) continue;
          if (!this.step({ hold: tool.id })) return false;
        } else if (this.game.state.player.held) {
          if (!this.step({ hold: null })) return false;
        }
        if (this.goHarvest(r.id)) {
          progressed = true;
          break;
        }
      }
      if (!progressed) return false;
    }
    return count(this.game.state, item) >= qty;
  }

  /** Czy po zablokowaniu kafla (bx, by) graczowi zostanie jakiekolwiek wyjście. */
  private maWyjscie(bx: number, by: number): boolean {
    const s = this.game.state;
    return (['n', 'e', 's', 'w'] as Facing[]).some((f) => {
      const d = DIRS[f]!;
      const x = s.player.x + d.dx;
      const y = s.player.y + d.dy;
      if (x === bx && y === by) return false;
      return walkable(s, this.game.reg, x, y);
    });
  }

  /** Wróć pod istniejące stanowisko tego rodzaju, jeśli gdziekolwiek stoi. */
  private goToStation(station: string): boolean {
    const s = this.game.state;
    const reg = this.game.reg;
    const cel = new Uint8Array(s.size * s.size);
    let jest = false;
    for (const e of s.ents) {
      if (e.kind !== 'placed') continue;
      if (reg.structures.get(e.def)?.station !== station) continue;
      cel[e.y * s.size + e.x] = 1;
      jest = true;
    }
    if (!jest) return false;
    const droga = this.pathToTargets(cel);
    if (!droga) return false;
    for (const f of droga.path) if (!this.step({ move: f })) return false;
    return stationAvailable(s, reg, station);
  }

  /** Dojdź do najbliższego OSIĄGALNEGO żywego węzła surowca i wyczerp go. */
  private goHarvest(resourceId: string): boolean {
    const s = this.game.state;
    const found = this.pathToNearestResource(resourceId);
    if (!found) return false;
    for (const f of found.path) if (!this.step({ move: f })) return false;
    this.trace.push(`harvest ${resourceId}`);
    // Celowo `face`, nie `move`: surowce z blocks:false są przechodnie, więc ruch
    // wszedłby na ich kafel i uderzył w to, co stoi dalej.
    if (!this.step({ face: found.face })) return false;
    let guard = 0;
    while (entityAt(s, found.tx, found.ty) && guard++ < 40) {
      if (!this.step({ act: true })) return false;
    }
    return !entityAt(s, found.tx, found.ty);
  }

  private faceFrom(px: number, py: number, tx: number, ty: number): Facing | null {
    for (const f of ['n', 's', 'e', 'w'] as Facing[]) {
      const d = DIRS[f];
      if (px + d.dx === tx && py + d.dy === ty) return f;
    }
    return null;
  }

  /**
   * Jeden BFS po kaflach przechodnich: zwraca drogę do pierwszego kafla sąsiadującego
   * z żywym węzłem danego surowca.
   *
   * Dlaczego nie "najbliższy po Manhattanie": wyspa ma osobne lądy i jeziora. Najbliższy
   * w linii prostej węzeł bywa nieosiągalny, a bot rezygnował zamiast iść do dalszego.
   */
  private pathToNearestResource(
    def: string,
  ): { path: Facing[]; face: Facing; tx: number; ty: number } | null {
    const s = this.game.state;
    const reg = this.game.reg;
    const size = s.size;
    const target = new Uint8Array(size * size);
    let any = false;
    for (const e of s.ents) {
      if (e.kind === 'resource' && e.def === def && e.respawnAt === 0) {
        target[e.y * size + e.x] = 1;
        any = true;
      }
    }
    if (!any) return null;
    return this.pathToTargets(target);
  }

  /** BFS po kaflach przechodnich do pierwszego kafla sąsiadującego z celem. */
  private pathToTargets(target: Uint8Array): { path: Facing[]; face: Facing; tx: number; ty: number } | null {
    const s = this.game.state;
    const reg = this.game.reg;
    const size = s.size;
    const order: Facing[] = ['n', 'e', 's', 'w'];
    const prev = new Int32Array(size * size).fill(-1);
    const from = new Uint8Array(size * size);
    const start = idx(s, s.player.x, s.player.y);
    prev[start] = start;
    const queue = [start];

    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi]!;
      const cx = cur % size;
      const cy = (cur - cx) / size;
      for (let k = 0; k < 4; k++) {
        const d = DIRS[order[k]!]!;
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (target[ny * size + nx]) {
          return { path: this.unwind(prev, from, start, cur, order), face: order[k]!, tx: nx, ty: ny };
        }
      }
      for (let k = 0; k < 4; k++) {
        const d = DIRS[order[k]!]!;
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (!walkable(s, reg, nx, ny)) continue;
        const n = ny * size + nx;
        if (prev[n] !== -1) continue;
        prev[n] = cur;
        from[n] = k;
        queue.push(n);
      }
    }
    return null;
  }

  private unwind(prev: Int32Array, from: Uint8Array, start: number, end: number, order: Facing[]): Facing[] {
    const out: Facing[] = [];
    let cur = end;
    while (cur !== start) {
      out.push(order[from[cur]!]!);
      cur = prev[cur]!;
    }
    return out.reverse();
  }
}
