import type { State } from './types.js';

/**
 * Stabilny odcisk stanu gry. Dwie symulacje z tym samym seedem i tym samym wejściem
 * muszą dać identyczny hash — na tym stoi test determinizmu i cały sens "nie popsuć gry".
 */
export function hashState(state: State): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (n >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (n >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const mixStr = (s: string) => {
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };

  mix(state.tick);
  mix(state.seed);
  mix(state.rng);
  mix(state.player.x);
  mix(state.player.y);
  mix(state.player.energy);
  mixStr(state.player.facing);
  mixStr(state.player.held ?? '-');

  for (const k of Object.keys(state.player.inv).sort()) {
    mixStr(k);
    mix(state.player.inv[k]!);
  }
  for (const k of Object.keys(state.player.wear).sort()) {
    mixStr(k);
    mix(state.player.wear[k]!);
  }
  if (state.craft) {
    mixStr(state.craft.recipe);
    mix(state.craft.left);
  }
  for (let i = 0; i < state.ents.length; i++) {
    const e = state.ents[i]!;
    mixStr(e.def);
    mix(e.x);
    mix(e.y);
    mix(e.hp);
    mix(e.respawnAt + 2);
  }
  for (let i = 0; i < state.biome.length; i++) mix(state.biome[i]!);

  return (h >>> 0).toString(16).padStart(8, '0');
}
