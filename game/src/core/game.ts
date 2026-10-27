import { registry } from '../content/load.js';
import type { Registry } from '../content/registry.js';
import { generate } from './world.js';
import { tick } from './tick.js';
import type { Input, State } from './types.js';

/** Fasada rdzenia: jedno miejsce, z którego renderer, testy i symulacja biorą grę. */
export class Game {
  readonly reg: Registry;
  state: State;

  constructor(seed?: number, reg: Registry = registry()) {
    this.reg = reg;
    this.state = generate(reg, seed ?? reg.content.config.seed);
  }

  step(input: Input = {}): State {
    return tick(this.state, input, this.reg);
  }

  /** Wygodne w testach: wykonaj n ticków z tym samym wejściem. */
  steps(n: number, input: Input = {}): State {
    for (let i = 0; i < n; i++) this.step(input);
    return this.state;
  }
}
