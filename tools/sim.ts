import { Game } from '../game/src/core/game.js';
import { hashState } from '../game/src/core/hash.js';
import { Bot } from '../game/src/sim/bot.js';

/**
 * Headless symulacja: mierzy, ile ticków zajmuje dojście do kamieni milowych.
 *
 * To nie jest test (nie ma asercji) — to raport metryk, który trafia do changeloga
 * i pozwala zobaczyć, czy zmiana nie wydłużyła progresji dwukrotnie.
 */

export interface SimMetrics {
  seed: number;
  entities: number;
  landShare: number;
  milestones: Array<{ goal: string; ok: boolean; ticks: number; reason?: string }>;
  hashAfter10k: string;
}

const MILESTONES = ['siekiera_kamienna', 'stol_warsztatowy', 'deska', 'wedka', 'sztabka_zelaza', 'pieczona_ryba'];

export function simulate(seed: number, budget = 150_000): SimMetrics {
  const base = new Game(seed);
  let land = 0;
  for (let i = 0; i < base.state.biome.length; i++) {
    if (base.reg.content.biomes[base.state.biome[i]!]!.walkable) land++;
  }
  const milestones = MILESTONES.map((goal) => {
    const g = new Game(seed);
    const r = new Bot(g, budget).ensure(goal, 1);
    return r.ok ? { goal, ok: true, ticks: r.ticks } : { goal, ok: false, ticks: r.ticks, reason: r.reason };
  });
  const drift = new Game(seed);
  drift.steps(10_000, { move: 'e' });
  return {
    seed,
    entities: base.state.ents.length,
    landShare: Number((land / base.state.biome.length).toFixed(3)),
    milestones,
    hashAfter10k: hashState(drift.state),
  };
}

export function runSim(seeds = [1337, 4242]): { ok: boolean; metrics: SimMetrics[] } {
  const metrics = seeds.map((s) => simulate(s));
  return { ok: metrics.every((m) => m.milestones.every((x) => x.ok)), metrics };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { ok, metrics } = runSim();
  for (const m of metrics) {
    console.log(`\nseed ${m.seed} — encji ${m.entities}, ląd ${(m.landShare * 100).toFixed(1)}%, hash ${m.hashAfter10k}`);
    for (const x of m.milestones) {
      console.log(`  ${x.ok ? '✓' : '✗'} ${x.goal.padEnd(20)} ${String(x.ticks).padStart(7)} ticków${x.reason ? '  ← ' + x.reason : ''}`);
    }
  }
  console.log(ok ? '\nprogresja przechodzi' : '\nPROGRESJA ZABLOKOWANA');
  process.exit(ok ? 0 : 1);
}
