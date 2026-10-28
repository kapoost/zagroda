import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game.js';
import { Bot } from '../src/sim/bot.js';
import { walkable } from '../src/core/tick.js';

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

  /**
   * Zagadana postać mówi wyłącznie to, co stoi w treści: najpierw zlecenia zadań,
   * a gdy ich zabraknie — swoje kwestie. Nic z tego nie powstaje w kodzie, więc każdą
   * linijkę da się wskazać palcem w pliku JSON.
   */
  it('rozmowa z NPC zwraca zlecenie, a po zadaniach kwestię z treści', () => {
    const g = new Game(1337);
    const npc = g.state.ents.find((e) => e.kind === 'npc')!;
    const def = g.reg.npcs.get(npc.def)!;
    const zlecenia = g.reg.content.zadania.filter((z) => z.dawca === def.id);
    g.state.player.x = npc.x;
    g.state.player.y = npc.y - 1;

    for (let i = 0; i < zlecenia.length; i++) {
      g.step({ face: 's', act: true });
      const l = g.state.log.at(-1)!;
      expect(l.startsWith(def.name + ':'), `log: ${l}`).toBe(true);
      expect(zlecenia.some((z) => l.endsWith(z.zlecenie)), `nie jest zleceniem: ${l}`).toBe(true);
    }

    g.step({ face: 's', act: true });
    const last = g.state.log.at(-1)!;
    expect(last.startsWith(def.name + ':'), `log: ${last}`).toBe(true);
    expect(def.dialogues.some((d) => last.endsWith(d)), `nie jest kwestią z treści: ${last}`).toBe(true);
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

/**
 * Zadania. Kolekcja mogła powstać tylko dlatego, że bramka umie o niej coś udowodnić:
 * bot bierze zadanie, spełnia warunek i oddaje. Bez tego byłoby kolejnym polem, które
 * schemat przyjmuje, walidator przepuszcza, a gra ignoruje.
 */
describe('zadania', () => {
  it.each(SEEDS)('seed %i: każde zadanie da się wykonać', (seed) => {
    for (const z of new Game(seed).reg.content.zadania) {
      const g = new Game(seed);
      const r = new Bot(g, BUDGET).wykonajZadanie(z.id);
      expect(r.ok, `"${z.id}" (${z.typ}: ${z.cel}, seed ${seed}): ${r.reason}`).toBe(true);
      expect(g.state.zadania[z.id]).toBe('zrobione');
    }
  });

  /**
   * Nagroda pada raz. Powtarzalne zadanie z nagrodą wartościowszą niż wkład byłoby
   * pompą wartości — tym samym błędem, który przeżył w wymianie siedem zielonych bramek.
   */
  it('nagroda pada tylko raz, choćby gracz wracał', () => {
    const g = new Game(SEEDS[0]!);
    const z = g.reg.content.zadania[0]!;
    const bot = new Bot(g, BUDGET);
    expect(bot.wykonajZadanie(z.id).ok).toBe(true);
    const poPierwszym = g.state.player.inv[z.nagroda.item] ?? 0;
    expect(poPierwszym).toBeGreaterThan(0);

    // Zagadaj dawcę jeszcze pięć razy — wprost, z pominięciem bota.
    const dawca = g.state.ents.find((e) => e.kind === 'npc' && e.def === z.dawca)!;
    g.state.player.x = dawca.x;
    g.state.player.y = dawca.y - 1;
    for (let i = 0; i < 5; i++) g.step({ face: 's', act: true });

    expect(g.state.zadania[z.id]).toBe('zrobione');
    expect(g.state.player.inv[z.nagroda.item] ?? 0).toBe(poPierwszym);
  });
});

/**
 * Osiągalność. Przechodni kafel to za mało — zamknięte podwórze między kamienicami
 * jest przechodnie w środku i nie ma wejścia. Na seedzie 1337 stała w takim podwórzu
 * Hanka, kowalka, od której zależy cały łańcuch żelaza, i nikt tego nie zauważył,
 * bo żelazo zdobywa się bez rozmowy z nią.
 */
describe('osiągalność świata', () => {
  it.each(SEEDS)('seed %i: do każdej postaci da się dojść ze startu', (seed) => {
    const g = new Game(seed);
    const s = g.state;
    const widziane = new Uint8Array(s.size * s.size);
    const kolejka = [s.player.y * s.size + s.player.x];
    widziane[kolejka[0]!] = 1;
    for (let i = 0; i < kolejka.length; i++) {
      const c = kolejka[i]!;
      const cx = c % s.size;
      const cy = (c - cx) / s.size;
      for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= s.size || ny >= s.size) continue;
        const n = ny * s.size + nx;
        if (widziane[n] || !walkable(s, g.reg, nx, ny)) continue;
        widziane[n] = 1;
        kolejka.push(n);
      }
    }
    const odciete = g.reg.content.npcs
      .map((n) => ({ n, e: s.ents.find((x) => x.kind === 'npc' && x.def === n.id) }))
      .filter(({ e }) => {
        if (!e) return true;
        return ![[0, -1], [0, 1], [1, 0], [-1, 0]].some(([dx, dy]) => widziane[(e.y + dy!) * s.size + (e.x + dx!)]);
      })
      .map(({ n }) => n.id);
    expect(odciete, `postacie odcięte od świata: ${odciete.join(', ')}`).toEqual([]);
  });
});
