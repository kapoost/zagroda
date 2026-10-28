import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from '../agent/src/config.js';
import { odciskTresci } from './npc-model.js';

/**
 * Launcher. Jedno polecenie zamiast trzech i kontrola wstepna zamiast zgadywania.
 *
 * Powstal z rachunku bledow jednego dnia pracy: polowa zmarnowanego czasu poszla nie
 * na kod, tylko na stan srodowiska, ktorego nikt nie sprawdzal. Serwer petli chodzil
 * w starej wersji i nie mial endpointu, ktorego szukalem. Model rozmow byl zbudowany
 * na starszej tresci. Dwa modele po 8,5 GB bily sie o pamiec i pierwszy token spadal
 * z 330 ms do 34 sekund. Zadna z tych rzeczy nie zglasza sie sama — kazda objawia sie
 * jako "cos dziwnie nie dziala".
 *
 * Dlatego kontrola wstepna jest OSTRZEGAWCZA, nie blokujaca: gra ma wstac nawet bez
 * Ollamy (wtedy postacie mowia gotowymi kwestiami, a pracownia nie dziala), ale masz
 * od razu wiedziec, czego brakuje i jakim poleceniem to naprawic.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT_GRY = 5181;
const PORT_PETLI = Number(process.env.ZU_PORT ?? 5182);

const ZIELONY = '\x1b[32m', ZOLTY = '\x1b[33m', SZARY = '\x1b[90m', JASNY = '\x1b[1m', KONIEC = '\x1b[0m';
const ptak = (s: string) => `${ZIELONY}✓${KONIEC} ${s}`;
const uwaga = (s: string) => `${ZOLTY}!${KONIEC} ${s}`;

async function wolnyPort(port: number): Promise<boolean> {
  return new Promise((gotowe) => {
    const s = createServer();
    s.once('error', () => gotowe(false));
    s.once('listening', () => s.close(() => gotowe(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function modeleOllamy(): Promise<string[] | null> {
  try {
    const r = await fetch(`${CFG.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const d = (await r.json()) as { models?: Array<{ name: string }> };
    return (d.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

async function kontrolaWstepna(): Promise<string[]> {
  const linie: string[] = [];
  const modele = await modeleOllamy();

  if (modele === null) {
    linie.push(uwaga(`Ollama nie odpowiada pod ${CFG.ollamaUrl}`));
    linie.push(`${SZARY}   gra zadziała, ale postacie będą mówić gotowymi kwestiami,${KONIEC}`);
    linie.push(`${SZARY}   a pracownia nie przyjmie zgłoszeń. Uruchom: ollama serve${KONIEC}`);
  } else {
    const bez = (s: string) => s.replace(/:latest$/, '');
    const ma = (m: string) => modele.some((h) => bez(h) === bez(m));
    linie.push(ptak(`Ollama odpowiada, modeli: ${modele.length}`));
    for (const [opis, model] of [['polski', CFG.models.pl], ['koder', CFG.models.code]] as const) {
      if (ma(model)) linie.push(ptak(`${opis}: ${bez(model)}`));
      else linie.push(uwaga(`${opis}: brak ${bez(model)} — ollama pull ${model}`));
    }

    if (!ma('zagroda-npc')) {
      linie.push(uwaga('model rozmów nie zbudowany — npm run npc-model'));
    } else {
      try {
        const zapis = JSON.parse(readFileSync(resolve(ROOT, '.agent/npc-model.json'), 'utf8')) as { odcisk?: string };
        const teraz = odciskTresci();
        if (zapis.odcisk === teraz) linie.push(ptak(`model rozmów zgodny z treścią (${teraz})`));
        else linie.push(uwaga(`model rozmów starszy niż treść (${zapis.odcisk} ≠ ${teraz}) — npm run npc-model`));
      } catch {
        linie.push(uwaga('model rozmów bez odcisku treści — npm run npc-model'));
      }
    }
  }

  for (const [nazwa, port] of [['gra', PORT_GRY], ['pętla', PORT_PETLI]] as const) {
    if (!(await wolnyPort(port))) {
      linie.push(uwaga(`port ${port} (${nazwa}) jest zajęty — zamknij poprzedni start albo: lsof -ti:${port} | xargs kill`));
    }
  }
  return linie;
}

function uruchom(nazwa: string, kolor: string, polecenie: string, args: string[]): ChildProcess {
  const p = spawn(polecenie, args, { cwd: ROOT, env: process.env });
  const prefiks = `${kolor}${nazwa.padEnd(5)}${KONIEC} ${SZARY}│${KONIEC} `;
  const pisz = (buf: Buffer) => {
    for (const l of buf.toString().split('\n')) if (l.trim()) process.stdout.write(prefiks + l + '\n');
  };
  p.stdout?.on('data', pisz);
  p.stderr?.on('data', pisz);
  return p;
}

async function main(): Promise<void> {
  console.log(`\n${JASNY}Zagroda${KONIEC} ${SZARY}— gra, którą rozwija lokalny model${KONIEC}\n`);
  for (const l of await kontrolaWstepna()) console.log('  ' + l);

  const dzieci = [
    uruchom('gra', '\x1b[32m', 'npm', ['run', 'dev', '-w', 'game']),
    uruchom('pętla', '\x1b[33m', 'npm', ['run', 'serve', '-w', 'agent']),
  ];

  console.log(
    [
      '',
      `  ${JASNY}gra:${KONIEC}        http://localhost:${PORT_GRY}`,
      `  ${JASNY}pętla:${KONIEC}      http://127.0.0.1:${PORT_PETLI}`,
      '',
      `  ${SZARY}T${KONIEC} rozmowa z postacią    ${SZARY}P${KONIEC} pracownia: zgłoś zmianę w grze`,
      `  ${SZARY}npm run zu -- --prompt "opis"${KONIEC}  pokaż prompt, który dostanie model`,
      '',
    ].join('\n'),
  );

  const zamknij = () => {
    for (const d of dzieci) d.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', zamknij);
  process.on('SIGTERM', zamknij);
  for (const d of dzieci) d.on('exit', (kod) => { if (kod) zamknij(); });
}

void main();
