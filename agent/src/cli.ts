import { CFG } from './config.js';
import { apiReady } from './providers/anthropic.js';
import { ollamaModels } from './providers/ollama.js';
import { run } from './pipeline.js';
import { podgladOps, podgladRoutingu, routeRequest, type Krok } from './stages/intent.js';

const HELP = `zu — Bielik rozwija grę "Zagroda"

  npm run zu -- "opis zmiany po polsku"

Opcje:
  --dry           tylko klasyfikacja, bez zapisu i bez gałęzi
  --no-merge      nie scalaj do main nawet przy czystej zmianie danych
  --dane | --kod  wymuś rodzaj zmiany (pomiń klasyfikację)
  --status        pokaż konfigurację i dostępność modeli
  --prompt        pokaż DOKŁADNY prompt, który dostanie model, i nic nie zmieniaj
  -h, --help      ta pomoc

Przykłady:
  npm run zu -- "dodaj drewnianą wędkę ulepszoną o haczyk z żelaza, łowi szybciej"
  npm run zu -- "jagody powinny dawać mniej energii, bo są teraz za mocne"
  npm run zu -- "dodaj mechanikę uprawiania pola: motyka spulchnia ziemię, sadzisz nasiona"
`;

async function status(): Promise<void> {
  const have = await ollamaModels();
  const base = (s: string) => s.replace(/:latest$/, '');
  const mark = (m: string) => (have.some((h) => base(h) === base(m)) ? '✓' : '✗ brak — ollama pull ' + m);
  console.log(`Ollama:     ${CFG.ollamaUrl}${have.length ? '' : '  (nie odpowiada)'}`);
  console.log(`polski:     ${CFG.models.pl}  ${mark(CFG.models.pl)}`);
  console.log(`kod:        ${CFG.models.code}  ${mark(CFG.models.code)}`);
  console.log(`API:        ${CFG.models.api}  ${apiReady() ? '✓ klucz ustawiony' : '✗ brak ANTHROPIC_API_KEY (eskalacja wyłączona)'}`);
  console.log(`auto-merge: ${CFG.autoMergeData ? 'zmiany danych wjeżdżają do main same' : 'wyłączony'}`);
}

/**
 * Podgląd promptu.
 *
 * Składa go ta sama funkcja, która składa go naprawdę — podgląd budujący prompt po
 * swojemu prędzej czy później pokazałby coś innego, niż model dostaje, i przestałby
 * być narzędziem diagnozy.
 *
 * Krok routingu da się pokazać bez modelu. Kroki operacji zależą od tego, które
 * kolekcje wybrał routing, więc po nie trzeba raz zapytać Bielika — stąd jedno
 * wywołanie, zanim pojawi się reszta.
 */
function wypiszKrok(k: Krok): void {
  const znakow = k.system.length + k.user.length;
  const linia = (etykieta: string, tresc: string) => {
    console.log(`\n\x1b[1m── ${etykieta} ── ${tresc.length} znaków ──\x1b[0m`);
    console.log(tresc);
  };
  console.log(`\n\x1b[7m  ${k.nazwa.toUpperCase()}  \x1b[0m  \x1b[90m~${Math.round(znakow / 3.3)} tokenów\x1b[0m`);
  linia('SYSTEM', k.system);
  linia('UŻYTKOWNIK', k.user);
  const g = JSON.stringify(k.schemat);
  console.log(`\n\x1b[1m── GRAMATYKA ── ${g.length} znaków ──\x1b[0m`);
  console.log(g.length > 1200 ? g.slice(0, 1200) + ' …' : g);
}

async function podglad(prompt: string): Promise<void> {
  wypiszKrok(podgladRoutingu(prompt));

  console.log('\n\x1b[90mpytam Bielika o klasyfikację, żeby wiedzieć, które kolekcje wchodzą…\x1b[0m');
  const { route } = await routeRequest(prompt);
  console.log(
    `\x1b[90m→ ${route.kind}: ${route.title} · kolekcje: ${route.collections.join(', ') || '—'}` +
      `${route.checks.length ? ' · warunki: ' + route.checks.join(' · ') : ''}\x1b[0m`,
  );
  if (route.kind !== 'dane') {
    console.log('\n\x1b[90mZmiana kodu: dalej nie ma promptu operacji — jest brief dla kodera ze skilla.\x1b[0m');
    return;
  }
  for (const k of podgladOps(route, prompt)) wypiszKrok(k);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP);
    return;
  }
  if (argv.includes('--status')) {
    await status();
    return;
  }

  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const prompt = argv.filter((a) => !a.startsWith('-')).join(' ').trim();
  if (!prompt) {
    console.error('Podaj opis zmiany. Pomoc: npm run zu -- --help');
    process.exit(2);
  }

  if (flags.has('--prompt')) {
    await podglad(prompt);
    return;
  }

  const res = await run({
    prompt,
    dryRun: flags.has('--dry'),
    noMerge: flags.has('--no-merge'),
    forceKind: flags.has('--kod') ? 'kod' : flags.has('--dane') ? 'dane' : undefined,
    log: (m) => console.log('  ' + m),
  });

  console.log('');
  console.log(`wynik: ${res.outcome}${res.title ? ` — ${res.title}` : ''}`);
  if (res.changes.length) console.log(res.changes.map((c) => '  ' + c).join('\n'));
  if (res.note) console.log(`  ${res.note}`);
  const ok = res.outcome === 'merged' || res.outcome === 'branch' || res.outcome === 'dry';
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nbłąd: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
