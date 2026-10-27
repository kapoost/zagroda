import { Game } from './core/game.js';
import type { Facing, Input } from './core/types.js';
import { draw } from './render/canvas.js';
import { availableRecipes, inventoryIds, renderHud, type HudRefs } from './render/hud.js';
import { pracowniaOtwarta, przelacz, zamknij as zamknijPracownie } from './ui/pracownia.js';

/** Spięcie rdzenia z przeglądarką: pętla o stałym kroku, wejście z klawiatury, rysowanie. */

const TICK_MS = 95;

const game = new Game();
const canvas = document.getElementById('world') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const refs: HudRefs = {
  clock: document.getElementById('clock')!,
  energy: document.getElementById('energy')!,
  held: document.getElementById('held')!,
  inventory: document.getElementById('inventory')!,
  recipes: document.getElementById('recipes')!,
  log: document.getElementById('log')!,
};

function resize(): void {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener('resize', resize);
resize();

const held = new Set<string>();
/** Akcje jednorazowe: odpalają się na wciśnięcie, nie na auto-powtarzanie klawisza. */
let pending: Input = {};

const DIRS: Record<string, Facing> = {
  KeyW: 'n', ArrowUp: 'n',
  KeyS: 's', ArrowDown: 's',
  KeyA: 'w', ArrowLeft: 'w',
  KeyD: 'e', ArrowRight: 'e',
};

function cycleHeld(step: number): void {
  const ids = inventoryIds(game.state, game.reg);
  if (!ids.length) {
    pending.hold = null;
    return;
  }
  const cur = game.state.player.held;
  const i = cur ? ids.indexOf(cur) : -1;
  const next = ids[(i + step + ids.length * 2) % ids.length]!;
  pending.hold = i === -1 && step < 0 ? ids[ids.length - 1]! : next;
}

window.addEventListener('keydown', (e) => {
  // Pracownia przejmuje klawiaturę w całości: gracz pisze tam zdania, a nie steruje postacią.
  if (pracowniaOtwarta()) {
    if (e.code === 'Escape') zamknijPracownie();
    return;
  }
  if (e.code === 'KeyP') {
    przelacz();
    e.preventDefault();
    return;
  }
  if (e.repeat) {
    if (DIRS[e.code]) held.add(e.code);
    return;
  }
  const dir = DIRS[e.code];
  if (dir) {
    held.add(e.code);
    // Krótkie stuknięcie bywa krótsze niż tick — zapamiętaj ruch, żeby żadne nie przepadło.
    pending.move = dir;
    e.preventDefault();
    return;
  }
  switch (e.code) {
    case 'Space':
      pending.act = true;
      e.preventDefault();
      break;
    case 'KeyE':
      cycleHeld(1);
      break;
    case 'KeyQ':
      cycleHeld(-1);
      break;
    case 'KeyG':
      if (game.state.player.held) pending.place = game.state.player.held;
      break;
    case 'KeyF':
      if (game.state.player.held) pending.eat = game.state.player.held;
      break;
    default: {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 9) {
        const r = availableRecipes(game.state, game.reg)[n - 1];
        if (r) pending.craft = r.id;
      }
    }
  }
});

window.addEventListener('keyup', (e) => {
  held.delete(e.code);
});
window.addEventListener('blur', () => held.clear());

// Uchwyt deweloperski: w trybie dev pozwala obejrzeć stan i przestawić zegar bez
// czekania czterech minut na zmianę doby. W buildzie produkcyjnym nie istnieje.
if (import.meta.env.DEV) {
  (window as unknown as { zagroda: unknown }).zagroda = game;
}

let acc = 0;
let prev = performance.now();

function frame(now: number): void {
  acc += now - prev;
  prev = now;
  let steps = 0;
  while (acc >= TICK_MS && steps < 4) {
    acc -= TICK_MS;
    steps++;
    const input: Input = { ...pending };
    pending = {};
    if (!input.move) {
      for (const code of held) {
        const d = DIRS[code];
        if (d) {
          input.move = d;
          break;
        }
      }
    }
    game.step(input);
  }
  draw(ctx, game.state, game.reg);
  renderHud(refs, game.state, game.reg);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
