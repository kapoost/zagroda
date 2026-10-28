import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game.js';
import { Bot } from '../src/sim/bot.js';

/**
 * Wyrocznia grywalności.
 *
 * Testy treści mówią, czy dane są spójne. Ten test mówi, czy gra da się *zagrać*:
 * bot startuje z pustym ekwipunkiem i musi dojść do każdego kamienia milowego.
 * Jeśli agent doda recepturę, której w praktyce nie da się wykonać, albo zepsuje
 * mechanikę zbierania, to pęknie tutaj — nawet jeśli schematy są zielone.
 */

const SEEDS = [1337, 4242, 909];
const MILESTONES = ['siekiera_kamienna', 'stol_warsztatowy', 'deska', 'wedka', 'sztabka_zelaza'];
const BUDGET = 150_000;

describe('progresja', () => {
  it.each(SEEDS)('seed %i: bot dochodzi do kamieni milowych', (seed) => {
    for (const goal of MILESTONES) {
      const g = new Game(seed);
      const r = new Bot(g, BUDGET).ensure(goal, 1);
      expect(r.ok, `cel "${goal}" (seed ${seed}): ${r.reason}\nkroki: ${r.trace.slice(-8).join(' → ')}`).toBe(true);
    }
  });

  it('każdy item z treści jest zdobywalny w praktyce, nie tylko na papierze', () => {
    const reg = new Game(1337).reg;
    const failures: string[] = [];
    for (const item of reg.content.items) {
      const g = new Game(1337);
      const r = new Bot(g, BUDGET).ensure(item.id, 1);
      if (!r.ok) failures.push(`${item.id}: ${r.reason}`);
    }
    expect(failures, `nieosiągalne itemy:\n${failures.join('\n')}`).toEqual([]);
  });

  it('każda receptura daje się wykonać', () => {
    const reg = new Game(1337).reg;
    const failures: string[] = [];
    for (const r of reg.content.recipes) {
      const g = new Game(1337);
      const res = new Bot(g, BUDGET).ensure(r.output.item, r.output.qty);
      if (!res.ok) failures.push(`${r.id}: ${res.reason}`);
    }
    expect(failures, `niewykonalne receptury:\n${failures.join('\n')}`).toEqual([]);
  });

  it('rozmowa z NPC zwraca kwestię z treści', () => {
    const g = new Game(1337);
    const npc = g.state.ents.find((e) => e.kind === 'npc')!;
    const def = g.reg.npcs.get(npc.def)!;
    // Stań obok i zagadaj.
    g.state.player.x = npc.x;
    g.state.player.y = npc.y - 1;
    g.step({ face: 's', act: true });
    const last = g.state.log.at(-1)!;
    expect(last.startsWith(def.name + ':'), `log: ${last}`).toBe(true);
    expect(def.dialogues.some((d) => last.endsWith(d))).toBe(true);
  });
});

/**
 * Ekonomia wymiany.
 *
 * Bot handluje nie po to, żeby grać lepiej, tylko żeby mieć czym zepsuć. Dopóki nie
 * umiał rozmawiać, cała ekonomia dialogu była dla symulacji niewidzialna — i przeżyła
 * w niej pompa wartości: gracz z jedną gałęzią dostawał nieskończenie wiele ryb przy
 * siedmiu zielonych etapach bramki.
 *
 * Drugi test jest równie ważny jak pierwszy: wyrocznia, która nic nie robi, przechodzi
 * zawsze. Gdyby ktoś odebrał postaciom listy darów, „brak pompy" byłoby prawdą pustą.
 */
describe('ekonomia wymiany', () => {
  const nahandluj = (seed: number) => {
    const g = new Game(seed);
    const bot = new Bot(g, BUDGET);
    bot.ensure('galaz', 30);
    bot.ensure('kamien', 20);
    return bot.wyzyskuj(40);
  };

  it.each(SEEDS)('seed %i: żaden ciąg wymian nie tworzy wartości', (seed) => {
    const w = nahandluj(seed);
    expect(w.po, `wartość plecaka urosła z ${w.przed} do ${w.po} po ${w.wymian} wymianach`).toBeLessThanOrEqual(
      w.przed,
    );
  });

  it('bot naprawdę handluje, więc test powyżej nie przechodzi pusty', () => {
    const w = nahandluj(SEEDS[0]!);
    expect(w.wymian, 'bot nie zawarł ani jednej wymiany — wyrocznia ekonomii jest martwa').toBeGreaterThan(5);
  });
});
