import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game.js';
import { hashState } from '../src/core/hash.js';
import { Rng } from '../src/core/rng.js';
import type { Facing, Input } from '../src/core/types.js';

/** Skryptowana sekwencja wejść — zawsze ta sama dla danego seeda. */
function scriptedInputs(seed: number, n: number): Input[] {
  const rng = new Rng(seed);
  const dirs: Facing[] = ['n', 'e', 's', 'w'];
  const out: Input[] = [];
  for (let i = 0; i < n; i++) {
    const roll = rng.next();
    if (roll < 0.55) out.push({ move: dirs[rng.int(0, 3)]! });
    else if (roll < 0.9) out.push({ face: dirs[rng.int(0, 3)]!, act: true });
    else out.push({});
  }
  return out;
}

function run(seed: number, inputs: Input[]): string {
  const g = new Game(seed);
  for (const i of inputs) g.step(i);
  return hashState(g.state);
}

describe('determinizm', () => {
  it('ten sam seed i to samo wejście dają ten sam stan', () => {
    const inputs = scriptedInputs(42, 3000);
    expect(run(1337, inputs)).toBe(run(1337, inputs));
  });

  it('inny seed daje inny świat', () => {
    const inputs = scriptedInputs(42, 500);
    expect(run(1337, inputs)).not.toBe(run(1338, inputs));
  });

  it('inne wejście daje inny stan', () => {
    expect(run(1337, scriptedInputs(1, 500))).not.toBe(run(1337, scriptedInputs(2, 500)));
  });

  it('stan po restarcie i odtworzeniu wejścia jest identyczny', () => {
    const inputs = scriptedInputs(7, 1200);
    const a = new Game(1337);
    for (const i of inputs) a.step(i);
    const snapshot = hashState(a.state);

    const b = new Game(1337);
    for (const i of inputs) b.step(i);
    expect(hashState(b.state)).toBe(snapshot);
  });

  it('hash reaguje na zmianę ekwipunku', () => {
    const g = new Game(1337);
    const before = hashState(g.state);
    g.state.player.inv['drewno'] = 1;
    expect(hashState(g.state)).not.toBe(before);
  });
});
