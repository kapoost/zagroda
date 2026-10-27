import type { Registry } from '../content/registry.js';
import { entityAt, idx, timeOfDay } from '../core/tick.js';
import type { State } from '../core/types.js';

/** Rysowanie świata. Czysta prezentacja — nie wolno tu zmieniać stanu gry. */

/**
 * Mniejszy kafel niż na wyspie: plan Zamościa ma sens dopiero wtedy, gdy widać
 * kilka ulic naraz. Przy 26 px gracz oglądał fragment zabudowy bez kontekstu.
 */
export const TILE = 18;

function nightAlpha(t: number): number {
  // Zmierzch i świt zamiast skokowej zmiany: 0 w południe, maksimum o północy.
  // Uwaga: to krzywa ciągła, a nie odwzorowanie progu isNight() z rdzenia. Przy
  // NIGHT_FROM ekran jest dopiero lekko przyciemniony, więc chwilę po rozpoczęciu
  // nocy gracz płaci nocną stawkę, zanim zobaczy noc.
  const night = Math.cos(t * Math.PI * 2) * 0.5 + 0.5;
  // Noc ma być nastrojowa, nie nieprzejrzysta — przy pełnej ciemności nie dałoby się grać.
  return Math.min(0.42, Math.pow(night, 1.6) * 0.48);
}

export function draw(ctx: CanvasRenderingContext2D, state: State, reg: Registry): void {
  const { width, height } = ctx.canvas;
  const cols = Math.ceil(width / TILE) + 2;
  const rows = Math.ceil(height / TILE) + 2;
  const camX = state.player.x - Math.floor(cols / 2);
  const camY = state.player.y - Math.floor(rows / 2);

  ctx.fillStyle = '#0d1512';
  ctx.fillRect(0, 0, width, height);

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const x = camX + rx;
      const y = camY + ry;
      if (x < 0 || y < 0 || x >= state.size || y >= state.size) continue;
      const px = rx * TILE;
      const py = ry * TILE;
      const biome = reg.content.biomes[state.biome[idx(state, x, y)]!]!;
      ctx.fillStyle = biome.color;
      ctx.fillRect(px, py, TILE, TILE);
      // Delikatny szum, żeby kafle nie wyglądały jak kratka w Excelu.
      if (((x * 7 + y * 13) & 3) === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        ctx.fillRect(px, py, TILE, TILE);
      }

      const e = entityAt(state, x, y);
      if (!e) continue;
      if (e.kind === 'resource') {
        const def = reg.resources.get(e.def);
        if (!def) continue;
        ctx.fillStyle = def.color;
        const full = def.hp > 0 ? e.hp / def.hp : 1;
        const size = TILE * (0.45 + 0.4 * full);
        const off = (TILE - size) / 2;
        ctx.beginPath();
        ctx.roundRect(px + off, py + off, size, size, size * 0.3);
        ctx.fill();
      } else if (e.kind === 'placed') {
        const def = reg.structures.get(e.def);
        if (!def) continue;
        ctx.fillStyle = def.color;
        ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6);
      } else {
        const def = reg.npcs.get(e.def);
        if (!def) continue;
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2, TILE * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(def.name, px + TILE / 2, py - 1);
      }
    }
  }

  // Gracz zawsze w centrum siatki widoku.
  const ppx = (state.player.x - camX) * TILE;
  const ppy = (state.player.y - camY) * TILE;
  ctx.fillStyle = '#f5e9c8';
  ctx.beginPath();
  ctx.arc(ppx + TILE / 2, ppy + TILE / 2, TILE * 0.33, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a1f14';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Wskaźnik kierunku — pokazuje kafel, na który zadziała narzędzie.
  const d = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[state.player.facing]!;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.strokeRect(ppx + d[0]! * TILE + 2, ppy + d[1]! * TILE + 2, TILE - 4, TILE - 4);

  const a = nightAlpha(timeOfDay(state, reg));
  if (a > 0.01) {
    ctx.fillStyle = `rgba(8,14,38,${a})`;
    ctx.fillRect(0, 0, width, height);
    // Pochodnie rozjaśniają okolicę nocą.
    for (const e of state.ents) {
      if (e.kind !== 'placed' || e.respawnAt !== 0) continue;
      if (reg.structures.get(e.def)?.id !== 'pochodnia_stojaca') continue;
      const lx = (e.x - camX) * TILE + TILE / 2;
      const ly = (e.y - camY) * TILE + TILE / 2;
      if (lx < -80 || ly < -80 || lx > width + 80 || ly > height + 80) continue;
      const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, TILE * 3.2);
      grad.addColorStop(0, `rgba(255,204,85,${a * 0.9})`);
      grad.addColorStop(1, 'rgba(255,204,85,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(lx, ly, TILE * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
