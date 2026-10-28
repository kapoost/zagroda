import { pathToFileURL } from 'node:url';
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
  /** Próba złamania ekonomii wymiany. `po > przed` znaczy, że gdzieś powstała pompa. */
  handel: { wymian: number; przed: number; po: number };
  /** Czy każde zadanie z treści da się w praktyce wykonać. */
  zadania: Array<{ id: string; ok: boolean; ticks: number; reason?: string }>;
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
  // Zadania: bot bierze, spełnia i oddaje. Bez tego kolekcja byłaby kolejnym polem,
  // które schemat przyjmuje, a gra ignoruje.
  const zadania = base.reg.content.zadania.map((z) => {
    const g = new Game(seed);
    const r = new Bot(g, budget).wykonajZadanie(z.id);
    return r.ok ? { id: z.id, ok: true, ticks: r.ticks } : { id: z.id, ok: false, ticks: r.ticks, reason: r.reason };
  });

  // Ekonomia wymiany. Bot zbiera trochę towaru, a potem bierze KAŻDĄ dostępną wymianę,
  // ile się da — nie po to, żeby grać, tylko żeby sprawdzić, czy handel nie tworzy
  // wartości z niczego. Ta kolumna raportu powstała po tym, jak taka pompa przeżyła
  // siedem zielonych etapów bramki, bo symulacja w ogóle nie umiała rozmawiać.
  const rynek = new Game(seed);
  const kupiec = new Bot(rynek, budget);
  kupiec.ensure('galaz', 30);
  kupiec.ensure('kamien', 20);
  const handel = kupiec.wyzyskuj(40);

  const drift = new Game(seed);
  drift.steps(10_000, { move: 'e' });
  return {
    seed,
    entities: base.state.ents.length,
    landShare: Number((land / base.state.biome.length).toFixed(3)),
    milestones,
    handel,
    zadania,
    hashAfter10k: hashState(drift.state),
  };
}

export function runSim(seeds = [1337, 4242]): { ok: boolean; metrics: SimMetrics[] } {
  const metrics = seeds.map((s) => simulate(s));
  // Symulacja przestała być samym raportem: pompa wartości to blokada, nie metryka.
  const ok = metrics.every(
    (m) => m.milestones.every((x) => x.ok) && m.handel.po <= m.handel.przed && m.zadania.every((z) => z.ok),
  );
  return { ok, metrics };
}

// pathToFileURL, nie konkatenacja: ścieżka ze spacją albo polskim znakiem
// jest w URL-u zakodowana procentowo i porównanie wprost zawsze wychodzi fałszywie.
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const { ok, metrics } = runSim();
  for (const m of metrics) {
    console.log(`\nseed ${m.seed} — encji ${m.entities}, ląd ${(m.landShare * 100).toFixed(1)}%, hash ${m.hashAfter10k}`);
    for (const x of m.milestones) {
      console.log(`  ${x.ok ? '✓' : '✗'} ${x.goal.padEnd(20)} ${String(x.ticks).padStart(7)} ticków${x.reason ? '  ← ' + x.reason : ''}`);
    }
    for (const z of m.zadania) {
      console.log(`  ${z.ok ? '✓' : '✗'} ${('zadanie ' + z.id).padEnd(28)} ${String(z.ticks).padStart(7)} ticków${z.reason ? '  ← ' + z.reason : ''}`);
    }
    const h = m.handel;
    console.log(
      `  ${h.po <= h.przed ? '✓' : '✗'} ${'handel'.padEnd(20)} ${String(h.wymian).padStart(7)} wymian` +
        `  wartość ${h.przed} → ${h.po}${h.po > h.przed ? '  ← POMPA WARTOŚCI' : ''}`,
    );
  }
  console.log(ok ? '\nprogresja przechodzi' : '\nPROGRESJA ZABLOKOWANA');
  process.exit(ok ? 0 : 1);
}
