import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CFG } from '../agent/src/config.js';
import { odciskTresci } from './npc-model.js';

/**
 * Instalator.
 *
 * Launcher (`npm start`) DIAGNOZUJE: mówi, czego brakuje. Ten plik NAPRAWIA — i to
 * jest cały podział między nimi. Powstał z tego samego rachunku błędów, co kontrola
 * wstępna: żeby uruchomić całość, trzeba przejść siedem kroków, a każdy potrafi się
 * nie udać inaczej i żaden nie zgłasza się sam.
 *
 * Dwie zasady, od których nie odstępuje:
 *
 * 1. NIC DROGIEGO BEZ PYTANIA. Modele to siedemnaście gigabajtów pobierania. Żaden
 *    nie zacznie się ściągać, dopóki ktoś nie odpowie "tak" — a rozmiar stoi w pytaniu,
 *    nie w dokumentacji.
 * 2. MODEL KODUJĄCY JEST OPCJONALNY i trzeba to powiedzieć głośno. Do grania i do
 *    zmian w treści wystarczy Bielik; dziewięć gigabajtów Qwena potrzebne jest dopiero
 *    wtedy, gdy ktoś chce, żeby model ruszał kod. Bez tego zdania ludzie odbijają się
 *    od pobierania, którego wcale nie potrzebują.
 *
 * Wolno go uruchamiać wielokrotnie: każdy krok sprawdza, czy nie jest już zrobiony.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_NODE = 22;

const ZIELONY = '\x1b[32m', ZOLTY = '\x1b[33m', CZERWONY = '\x1b[31m', SZARY = '\x1b[90m';
const JASNY = '\x1b[1m', KONIEC = '\x1b[0m';
const ok = (s: string) => console.log(`  ${ZIELONY}✓${KONIEC} ${s}`);
const uwaga = (s: string) => console.log(`  ${ZOLTY}!${KONIEC} ${s}`);
const zle = (s: string) => console.log(`  ${CZERWONY}✗${KONIEC} ${s}`);
const szept = (s: string) => console.log(`    ${SZARY}${s}${KONIEC}`);

const ZGODA_Z_GORY = process.argv.includes('--tak');
/**
 * Czy jest kogo pytać.
 *
 * Bez terminala (potok, CI, nohup) pytanie nie ma gdzie się pojawić, a readline
 * sypie się przy drugim z rzędu — instalator wywalał się wtedy stosem zamiast
 * powiedzieć, co zrobić. Brak terminala znaczy więc "nie" na wszystko: nikomu nie
 * ściąga się ośmiu gigabajtów przez przypadek, a polecenia i tak zostają wypisane.
 */
const INTERAKTYWNY = Boolean(process.stdin.isTTY) && !ZGODA_Z_GORY;
const rl = INTERAKTYWNY ? createInterface({ input: process.stdin, output: process.stdout }) : null;

async function zapytaj(pytanie: string): Promise<boolean> {
  if (ZGODA_Z_GORY) return true;
  if (!rl) {
    console.log(`  ${SZARY}? ${pytanie} — brak terminala, więc pomijam${KONIEC}`);
    return false;
  }
  try {
    const odp = (await rl.question(`  ${JASNY}?${KONIEC} ${pytanie} [t/N] `)).trim().toLowerCase();
    return odp === 't' || odp === 'tak' || odp === 'y' || odp === 'yes';
  } catch {
    // Wejście zamknięte w trakcie — traktujemy jak odmowę, nie jak awarię.
    return false;
  }
}

/** Uruchom i pokaż wyjście na żywo — pobieranie modelu trwa i ma być widać, że idzie. */
function uruchom(polecenie: string, args: string[]): Promise<boolean> {
  return new Promise((gotowe) => {
    const p = spawn(polecenie, args, { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (kod) => gotowe(kod === 0));
    p.on('error', () => gotowe(false));
  });
}

const jest = (polecenie: string) => spawnSync('which', [polecenie], { encoding: 'utf8' }).status === 0;

async function modeleOllamy(): Promise<string[] | null> {
  try {
    const r = await fetch(`${CFG.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const d = (await r.json()) as { models?: Array<{ name: string }> };
    return (d.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`\n${JASNY}Zagroda — instalacja${KONIEC}\n`);

  // --- 1. Node ------------------------------------------------------------
  const wersja = Number(process.versions.node.split('.')[0]);
  if (wersja < MIN_NODE) {
    zle(`Node ${process.versions.node} — potrzebny ${MIN_NODE} lub nowszy`);
    szept('https://nodejs.org albo: brew install node');
    rl?.close();
    process.exit(1);
  }
  ok(`Node ${process.versions.node}`);

  // --- 2. zależności ------------------------------------------------------
  if (existsSync(resolve(ROOT, 'node_modules'))) {
    ok('zależności zainstalowane');
  } else {
    console.log(`\n  ${JASNY}Instaluję zależności${KONIEC}`);
    if (!(await uruchom('npm', ['install']))) {
      zle('npm install się nie powiódł');
      rl?.close();
      process.exit(1);
    }
    ok('zależności zainstalowane');
  }

  // Od tego miejsca gra już działa. Mówimy to od razu, zanim padnie slowo "model".
  console.log(`\n  ${ZIELONY}Tyle wystarczy, żeby grać:${KONIEC} npm run dev → http://localhost:5181`);
  console.log(`  ${SZARY}Reszta dotyczy rozmów z postaciami i zgłaszania zmian modelowi.${KONIEC}\n`);

  // --- 3. Ollama ----------------------------------------------------------
  let modele = await modeleOllamy();
  if (modele === null) {
    if (jest('ollama')) {
      uwaga('Ollama jest zainstalowana, ale nie odpowiada');
      szept('uruchom w osobnym oknie: ollama serve');
    } else {
      uwaga('nie ma Ollamy — bez niej postacie mówią gotowymi kwestiami, a pracownia nie działa');
      szept(process.platform === 'darwin' ? 'brew install ollama' : 'curl -fsSL https://ollama.com/install.sh | sh');
      szept('potem uruchom instalator jeszcze raz');
    }
    podsumuj(false, false);
    rl?.close();
    return;
  }
  ok(`Ollama odpowiada (${modele.length} modeli)`);

  // --- 4. modele ----------------------------------------------------------
  const bez = (s: string) => s.replace(/:latest$/, '');
  const ma = (m: string) => modele!.some((h) => bez(h) === bez(m));

  const doPobrania: Array<{ model: string; opis: string; gb: string; konieczny: boolean }> = [
    { model: CFG.models.pl, opis: 'Bielik — rozmowy po polsku i zgłaszanie zmian', gb: '8,5 GB', konieczny: true },
    { model: CFG.models.code, opis: 'Qwen Coder — tylko gdy model ma ruszać KOD gry', gb: '9 GB', konieczny: false },
  ];

  for (const m of doPobrania) {
    if (ma(m.model)) {
      ok(`${m.opis.split(' —')[0]}: jest`);
      continue;
    }
    console.log('');
    uwaga(`brakuje: ${m.opis}`);
    if (!m.konieczny) szept('to pobranie możesz spokojnie pominąć i wrócić do niego później');
    if (await zapytaj(`Pobrać teraz? (${m.gb})`)) {
      if (!(await uruchom('ollama', ['pull', m.model]))) zle(`pobieranie ${bez(m.model)} się nie powiodło`);
    } else {
      szept(`później: ollama pull ${m.model}`);
    }
  }

  modele = (await modeleOllamy()) ?? [];
  const maBielika = modele.some((h) => bez(h) === bez(CFG.models.pl));
  const maKodera = modele.some((h) => bez(h) === bez(CFG.models.code));

  // --- 5. model rozmów ----------------------------------------------------
  if (maBielika) {
    const zapis = existsSync(resolve(ROOT, '.agent/npc-model.json'))
      ? (JSON.parse(readFileSync(resolve(ROOT, '.agent/npc-model.json'), 'utf8')) as { odcisk?: string })
      : {};
    if (zapis.odcisk === odciskTresci() && modele.some((h) => bez(h) === 'zagroda-npc')) {
      ok('model rozmów zgodny z treścią');
    } else {
      console.log(`\n  ${JASNY}Buduję model rozmów${KONIEC} ${SZARY}(wpieka lore i receptury — bez pobierania)${KONIEC}`);
      if (!(await uruchom('npm', ['run', 'npc-model']))) zle('budowanie modelu rozmów się nie powiodło');
    }
  }

  podsumuj(maBielika, maKodera);
  rl?.close();
}

function podsumuj(maBielika: boolean, maKodera: boolean): void {
  console.log(`\n${JASNY}Co teraz działa${KONIEC}`);
  console.log(`  ${ZIELONY}✓${KONIEC} gra, zadania, wymiana, kwestie postaci`);
  console.log(`  ${maBielika ? ZIELONY + '✓' : SZARY + '–'}${KONIEC} rozmowy po polsku (klawisz T)`);
  console.log(`  ${maBielika ? ZIELONY + '✓' : SZARY + '–'}${KONIEC} zgłaszanie zmian w treści (klawisz P)`);
  console.log(`  ${maKodera ? ZIELONY + '✓' : SZARY + '–'}${KONIEC} zmiany w kodzie gry przez model`);
  console.log(
    maBielika
      ? `\n  Uruchom: ${JASNY}npm start${KONIEC}\n`
      : `\n  Uruchom: ${JASNY}npm run dev${KONIEC} ${SZARY}— albo npm start, gdy dojdzie model${KONIEC}\n`,
  );
}

void main();
