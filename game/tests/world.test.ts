import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game.js';
import { idx, walkable } from '../src/core/tick.js';

const SEEDS = [1337, 7, 99, 20260, 555];

describe('generacja świata', () => {
  it.each(SEEDS)('seed %i daje grywalną wyspę', (seed) => {
    const g = new Game(seed);
    const s = g.state;
    const counts = new Map<string, number>();
    for (let i = 0; i < s.biome.length; i++) {
      const id = g.reg.content.biomes[s.biome[i]!]!.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = s.biome.length;
    const land = [...counts.entries()]
      .filter(([id]) => g.reg.biomes.get(id)!.walkable)
      .reduce((a, [, n]) => a + n, 0);

    // Wyspa, nie ocean i nie kontynent.
    expect(land / total).toBeGreaterThan(0.25);
    expect(land / total).toBeLessThan(0.85);
    // Każdy biom z treści musi faktycznie wystąpić, inaczej jego surowce są martwe.
    for (const b of g.reg.content.biomes) expect(counts.get(b.id) ?? 0).toBeGreaterThan(0);
  });

  it.each(SEEDS)('seed %i: każdy surowiec ma gdzie się pojawić', (seed) => {
    const g = new Game(seed);
    const spawned = new Set(g.state.ents.filter((e) => e.kind === 'resource').map((e) => e.def));
    for (const r of g.reg.content.resources) expect(spawned.has(r.id), `brak ${r.id}`).toBe(true);
  });

  it.each(SEEDS)('seed %i: gracz i NPC stoją na przechodnich kaflach', (seed) => {
    const g = new Game(seed);
    const s = g.state;
    expect(g.reg.content.biomes[s.biome[idx(s, s.player.x, s.player.y)]!]!.walkable).toBe(true);
    for (const e of s.ents.filter((x) => x.kind === 'npc')) {
      expect(g.reg.content.biomes[s.biome[idx(s, e.x, e.y)]!]!.walkable, `NPC ${e.def}`).toBe(true);
    }
  });

  it('gracz startuje na kaflu, z którego da się wyjść', () => {
    const g = new Game();
    const s = g.state;
    const out = (['n', 's', 'e', 'w'] as const).some((f) => {
      const d = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[f]!;
      return walkable(s, g.reg, s.player.x + d[0]!, s.player.y + d[1]!);
    });
    expect(out).toBe(true);
  });
});
