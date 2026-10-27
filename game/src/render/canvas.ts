import type { Registry } from '../content/registry.js';
import { entityAt, idx, timeOfDay } from '../core/tick.js';
import type { State } from '../core/types.js';

/**
 * Rysowanie świata w skali starych GTA: kafel to trzy metry, człowiek zajmuje pół kafla,
 * kamienica kilka, ulica dwa do czterech.
 *
 * Dwie zasady decydują o tym, czy obraz czyta się jako miasto, czy jako konfetti:
 * zabudowa musi być zwartą bryłą z krawędzią tylko na zewnątrz, a surowce muszą być
 * drobne i ciche. Rysowanie każdego kafla osobno, z przerwami i w pełnym nasyceniu,
 * zamienia plan miasta w szachownicę.
 */

export const TILE = 16;

const ZABUDOWA = 'kamienica';

/** Odcienie dachów. Zamojski Rynek żyje z tego, że każda pierzeja jest inna. */
const DACHY = ['#9a6b3f', '#a8795a', '#8c6b57', '#b08968', '#7d6a58', '#a35f4a', '#8f7b63', '#6f6257'];

/** Jak duży znak rysować dla danego surowca — ułamek kafla. */
const WIELKOSC: Record<string, number> = { drzewo: 0.8, zloze_zelaza: 0.55, lowisko: 0.6 };
const DOMYSLNA = 0.42;

function nightAlpha(t: number): number {
  const night = Math.cos(t * Math.PI * 2) * 0.5 + 0.5;
  // Noc ma być nastrojowa, nie nieprzejrzysta — przy pełnej ciemności nie dałoby się grać.
  return Math.min(0.42, Math.pow(night, 1.6) * 0.48);
}

function przyciemnij(hex: string, ile: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.round(v * (1 - ile)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function draw(ctx: CanvasRenderingContext2D, state: State, reg: Registry): void {
  const { width, height } = ctx.canvas;
  const cols = Math.ceil(width / TILE) + 2;
  const rows = Math.ceil(height / TILE) + 2;
  const camX = state.player.x - Math.floor(cols / 2);
  const camY = state.player.y - Math.floor(rows / 2);

  const biomAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= state.size || y >= state.size
      ? null
      : reg.content.biomes[state.biome[idx(state, x, y)]!]!;
  const zabudowa = (x: number, y: number) => biomAt(x, y)?.id === ZABUDOWA;
  const dach = (x: number, y: number) =>
    x < 0 || y < 0 || x >= state.size || y >= state.size ? 0 : state.dachy[idx(state, x, y)]!;
  const kolorDachu = (x: number, y: number) => DACHY[(dach(x, y) - 1 + DACHY.length) % DACHY.length]!;
  /** Krawędź rysujemy tam, gdzie kończy się TEN budynek — nie cała zabudowa. */
  const inny = (x: number, y: number, ten: number) => !zabudowa(x, y) || dach(x, y) !== ten;

  ctx.fillStyle = '#10140f';
  ctx.fillRect(0, 0, width, height);

  // ── 1. teren, bez szumu i bez przerw ────────────────────────────────────
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const b = biomAt(camX + rx, camY + ry);
      if (!b) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(rx * TILE, ry * TILE, TILE, TILE);
    }
  }

  // ── 2. zabudowa jako bryła: krawędź tylko tam, gdzie kończy się budynek ──
  ctx.lineWidth = 1;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const x = camX + rx;
      const y = camY + ry;
      if (!zabudowa(x, y)) continue;
      const px = rx * TILE;
      const py = ry * TILE;
      const ten = dach(x, y);
      const kolor = kolorDachu(x, y);
      ctx.fillStyle = kolor;
      ctx.fillRect(px, py, TILE, TILE);
      // Dach jaśnieje od północy — jedno źródło światła dla całego miasta.
      if (inny(x, y - 1, ten)) {
        ctx.fillStyle = przyciemnij(kolor, -0.14);
        ctx.fillRect(px, py, TILE, Math.max(2, TILE * 0.25));
      }
      ctx.strokeStyle = przyciemnij(kolor, 0.48);
      ctx.beginPath();
      if (inny(x, y - 1, ten)) { ctx.moveTo(px, py + 0.5); ctx.lineTo(px + TILE, py + 0.5); }
      if (inny(x, y + 1, ten)) { ctx.moveTo(px, py + TILE - 0.5); ctx.lineTo(px + TILE, py + TILE - 0.5); }
      if (inny(x - 1, y, ten)) { ctx.moveTo(px + 0.5, py); ctx.lineTo(px + 0.5, py + TILE); }
      if (inny(x + 1, y, ten)) { ctx.moveTo(px + TILE - 0.5, py); ctx.lineTo(px + TILE - 0.5, py + TILE); }
      ctx.stroke();
    }
  }

  // ── 3. encje ────────────────────────────────────────────────────────────
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const x = camX + rx;
      const y = camY + ry;
      const e = entityAt(state, x, y);
      if (!e) continue;
      const px = rx * TILE;
      const py = ry * TILE;

      if (e.kind === 'resource') {
        const def = reg.resources.get(e.def);
        if (!def) continue;
        const pelnia = def.hp > 0 ? e.hp / def.hp : 1;
        const u = (WIELKOSC[e.def] ?? DOMYSLNA) * (0.65 + 0.35 * pelnia);
        const s = TILE * u;
        const o = (TILE - s) / 2;
        ctx.fillStyle = przyciemnij(def.color, 0.18);
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2 + s * 0.12, s / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(px + TILE / 2, py + TILE / 2 - s * 0.06, s / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'placed') {
        const def = reg.structures.get(e.def);
        if (!def) continue;
        ctx.fillStyle = def.color;
        ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        ctx.strokeStyle = przyciemnij(def.color, 0.45);
        ctx.strokeRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
      } else {
        const def = reg.npcs.get(e.def);
        if (!def) continue;
        rysujPostac(ctx, px, py, def.color);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(def.name, px + TILE / 2, py - 2);
      }
    }
  }

  // ── 4. gracz ────────────────────────────────────────────────────────────
  const ppx = (state.player.x - camX) * TILE;
  const ppy = (state.player.y - camY) * TILE;
  rysujPostac(ctx, ppx, ppy, '#f5e9c8');
  const d = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[state.player.facing]!;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ppx + d[0]! * TILE + 1.5, ppy + d[1]! * TILE + 1.5, TILE - 3, TILE - 3);

  // ── 5. noc ──────────────────────────────────────────────────────────────
  const a = nightAlpha(timeOfDay(state, reg));
  if (a > 0.01) {
    ctx.fillStyle = `rgba(8,14,38,${a})`;
    ctx.fillRect(0, 0, width, height);
    for (const e of state.ents) {
      if (e.kind !== 'placed' || e.respawnAt !== 0) continue;
      if (e.def !== 'pochodnia_stojaca') continue;
      const lx = (e.x - camX) * TILE + TILE / 2;
      const ly = (e.y - camY) * TILE + TILE / 2;
      if (lx < -120 || ly < -120 || lx > width + 120 || ly > height + 120) continue;
      const r = TILE * 5;
      const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
      grad.addColorStop(0, `rgba(255,204,85,${a * 0.95})`);
      grad.addColorStop(1, 'rgba(255,204,85,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Człowiek zajmuje pół kafla: przy trzech metrach na kafel to realne półtora metra. */
function rysujPostac(ctx: CanvasRenderingContext2D, px: number, py: number, kolor: string): void {
  const s = TILE * 0.5;
  const cx = px + TILE / 2;
  const cy = py + TILE / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.45, s * 0.52, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = kolor;
  ctx.beginPath();
  ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(28,24,18,0.75)';
  ctx.lineWidth = 1;
  ctx.stroke();
}
