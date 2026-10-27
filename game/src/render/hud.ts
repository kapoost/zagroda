import type { Registry } from '../content/registry.js';
import { count, dayOf, stationAvailable, timeOfDay } from '../core/tick.js';
import type { State } from '../core/types.js';

/** Panel boczny w DOM — tekst czytelniejszy niż rysowany na canvasie, a HUD nie potrzebuje 60 fps. */

export interface HudRefs {
  clock: HTMLElement;
  energy: HTMLElement;
  held: HTMLElement;
  inventory: HTMLElement;
  recipes: HTMLElement;
  log: HTMLElement;
}

export function inventoryIds(state: State, reg: Registry): string[] {
  return Object.keys(state.player.inv)
    .filter((id) => reg.items.has(id))
    .sort((a, b) => reg.items.get(a)!.name.localeCompare(reg.items.get(b)!.name, 'pl'));
}

/** Receptury wykonalne tu i teraz — numeracja z tej listy odpowiada klawiszom 1-9. */
export function availableRecipes(state: State, reg: Registry) {
  return reg.content.recipes.filter((r) => stationAvailable(state, reg, r.station));
}

const clockText = (state: State, reg: Registry) => {
  const t = timeOfDay(state, reg);
  const minutes = Math.floor(t * 24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `dzień ${dayOf(state, reg)} · ${hh}:${mm}`;
};

export function renderHud(refs: HudRefs, state: State, reg: Registry): void {
  refs.clock.textContent = clockText(state, reg);

  const max = reg.content.config.energyMax;
  const pct = Math.round((state.player.energy / max) * 100);
  refs.energy.innerHTML = `<div class="bar"><span style="width:${pct}%"></span></div><small>siły ${state.player.energy}/${max}</small>`;

  const held = state.player.held ? reg.items.get(state.player.held) : null;
  refs.held.textContent = held ? `w ręce: ${held.name}` : 'w ręce: nic (goła ręka)';

  const ids = inventoryIds(state, reg);
  refs.inventory.innerHTML = ids.length
    ? ids
        .map((id) => {
          const it = reg.items.get(id)!;
          const sel = state.player.held === id ? ' class="sel"' : '';
          return `<li${sel}>${it.name} <b>×${count(state, id)}</b></li>`;
        })
        .join('')
    : '<li class="dim">pusto — zbierz coś z otoczenia</li>';

  const recipes = availableRecipes(state, reg);
  refs.recipes.innerHTML = recipes.length
    ? recipes
        .slice(0, 9)
        .map((r, i) => {
          const can = r.inputs.every((x) => count(state, x.item) >= x.qty);
          const inputs = r.inputs.map((x) => `${x.qty}×${reg.items.get(x.item)!.name}`).join(' + ');
          return `<li class="${can ? 'can' : 'cant'}"><kbd>${i + 1}</kbd> ${r.name} <small>${inputs}</small></li>`;
        })
        .join('')
    : '<li class="dim">brak receptur w zasięgu</li>';

  refs.log.innerHTML = state.log
    .slice(-9)
    .reverse()
    .map((l) => `<li>${l}</li>`)
    .join('');

  if (state.craft) {
    const r = reg.recipes.get(state.craft.recipe)!;
    refs.held.textContent += ` · wytwarzam: ${r.name} (${state.craft.left})`;
  }
}
