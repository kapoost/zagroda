import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Budowa modelu Ollamy do zywych rozmow z postaciami.
 *
 * Trzy rzeczy, ktore daje wpieczenie bloku systemowego w Modelfile, a ktorych nie da
 * trzymanie go w kodzie wywolujacego:
 *
 * 1. NIE DA SIE GO POMINAC. To gwarancja tej samej klasy co WRITE_DENY - nie
 *    dyscyplina, tylko konstrukcja. Gra nie odpali Zofii bez lore i bez receptur.
 * 2. UKLAD PROMPTU JEST ZAMROZONY. Blok staly idzie zawsze pierwszy i nigdy sie nie
 *    przestawia, wiec cache KV trafia. Zmierzone: pierwsza litera kwestii po 321 ms
 *    przy trafionym cache i po 6048 ms, gdy blok sie przebuduje. Dziewietnascie razy -
 *    to najwieksza pojedyncza dzwignia w calym tym mechanizmie i jest czysto ukladowa.
 * 3. RECEPTURY SA PRAWDZIWE. Model pytany o nie bez tego bloku wymysla krzemien, miech
 *    i szlifowanie. Z blokiem podaje skladniki co do sztuki.
 *
 * Czego to nie daje: pewnosci, ze postac nie sklamie. Szablon pilnuje, gdzie co stoi,
 * gramatyka pilnuje, co moze pasc, prawdy nie pilnuje nic. Dlatego liczby wyswietla
 * interfejs z rejestru obok kwestii, a nie postac w zdaniu.
 *
 * Uruchamiaj po KAZDEJ zmianie tresci - inaczej postac zacznie opowiadac o grze,
 * ktorej juz nie ma. Pilnuje tego odcisk tresci zapisany obok: rozmowa.ts odmawia
 * pracy, gdy model jest starszy niz content.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BAZA = process.env.ZU_MODEL_PL ?? 'hf.co/speakleash/Bielik-11B-v3.0-Instruct-GGUF:Q5_K_M';
export const MODEL_NPC = 'zagroda-npc';

const czytaj = (plik: string) => readFileSync(resolve(ROOT, plik), 'utf8');
const lista = (plik: string) => JSON.parse(czytaj(`game/content/${plik}.json`)) as any[];

/** Odcisk tresci, ktora weszla do bloku systemowego. Zmieni sie - model jest do przebudowy. */
export function odciskTresci(): string {
  const zrodla = ['items', 'recipes', 'resources', 'npcs'].map((p) => czytaj(`game/content/${p}.json`)).join(' ');
  const lore = czytaj('docs/LORE.md');
  let h = 0x811c9dc5;
  for (const s of [zrodla, lore]) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

export function blokSystemowy(): string {
  const items = lista('items');
  const recipes = lista('recipes');
  const resources = lista('resources');
  const nazwa = (id: string) => items.find((i) => i.id === id)?.name ?? id;

  return [
    czytaj('docs/LORE.md').trim(),
    '',
    'Jestes jedna z postaci gry "Zagroda" i rozmawiasz z graczem. Zasady rozmowy:',
    '',
    '- Odpowiadasz JEDNYM albo DWOMA zdaniami. Nigdy dluzej.',
    '- Mowisz po polsku, w pierwszej osobie, tonem swojej postaci.',
    '- Nie wychodzisz z roli, nie opisujesz siebie z zewnatrz, nie piszesz didaskaliow.',
    '- Nie wymyslasz niczego, czego nie ma ponizej. Gdy nie wiesz, mowisz wprost, ze nie wiesz.',
    '- Nie obiecujesz graczowi rzeczy, ktorych nie ma na Twojej liscie darow.',
    '',
    'RECEPTURY - to sa WSZYSTKIE sposoby wytwarzania, jakie w tej grze istnieja:',
    ...recipes.map(
      (r) => `  ${nazwa(r.output.item)} (przy: ${r.station}) = ${r.inputs.map((i: any) => `${i.qty}x ${nazwa(i.item)}`).join(' + ')}`,
    ),
    '',
    'SKAD BIORA SIE SUROWCE:',
    ...resources.map(
      (r) => `  ${r.name} - rosnie na: ${r.biomes.join(', ')}; zbierasz: ${r.tool === 'hand' ? 'reka' : r.tool}; daje: ${r.drops.map((d: any) => nazwa(d.item)).join(', ')}`,
    ),
  ].join('\n');
}

/**
 * Szablon ChatML - dokladnie taki, jak stockowy u Bielika, i to nie jest lenistwo.
 *
 * Pierwsza wersja dokladala osobny blok {{ if .System }}...{{ .System }}, zeby miec
 * pewnosc, ze wpieczony SYSTEM na pewno trafi do promptu. Efekt byl odwrotny: Ollama
 * SAMA wklada SYSTEM do .Messages, wiec blok renderowal sie DWA RAZY i prompt puchl
 * do pelnego okna kontekstu. Zmierzone: 4096 tokenow promptu przy pytaniu o dlugosci
 * pieciu slow i 44 sekundy na samo przetworzenie, zamiast 419 ms.
 *
 * Wniosek jest ten sam, co przy formacie podmian w agencie: nie wymyslaj wlasnego
 * formatu tam, gdzie standard juz dziala.
 */
const SZABLON = [
  '{{- range .Messages }}<|im_start|>{{ .Role }}',
  '{{ .Content }}<|im_end|>',
  '{{ end }}<|im_start|>assistant',
  '',
].join('\n');

function zbuduj(): void {
  const odcisk = odciskTresci();
  const cudzyslow = '"'.repeat(3);
  const modelfile = [
    `FROM ${BAZA}`,
    '',
    '# Generowane przez tools/npc-model.ts - nie edytuj recznie.',
    `# odcisk tresci: ${odcisk}`,
    '',
    `TEMPLATE ${cudzyslow}${SZABLON}${cudzyslow}`,
    '',
    `SYSTEM ${cudzyslow}${blokSystemowy().split(cudzyslow).join('"" "')}${cudzyslow}`,
    '',
    'PARAMETER temperature 0.6',
    'PARAMETER num_ctx 4096',
    'PARAMETER num_predict 90',
    'PARAMETER stop "<|im_end|>"',
    'PARAMETER stop "<|im_start|>"',
  ].join('\n');

  mkdirSync(resolve(ROOT, '.agent'), { recursive: true });
  const sciezka = resolve(ROOT, '.agent/zagroda-npc.Modelfile');
  writeFileSync(sciezka, modelfile + '\n', 'utf8');
  writeFileSync(
    resolve(ROOT, '.agent/npc-model.json'),
    JSON.stringify({ model: MODEL_NPC, odcisk }, null, 2) + '\n',
    'utf8',
  );

  execFileSync('ollama', ['create', MODEL_NPC, '-f', sciezka], { stdio: 'inherit' });
  console.log(`\nmodel "${MODEL_NPC}" gotowy, odcisk tresci ${odcisk}, blok systemowy ${blokSystemowy().length} znakow`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) zbuduj();
