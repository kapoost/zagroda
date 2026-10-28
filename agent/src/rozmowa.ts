import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CFG } from './config.js';
import { unloadModel } from './providers/ollama.js';
import { MODEL_NPC, odciskTresci } from '../../tools/npc-model.js';
import { akcja, kwestia, type Polaczenie } from '../../game/src/rozmowa/klient.js';

export { akcja, kwestia };
export type {
  Oferta,
  Okolica,
  Postac,
  TuraRozmowy,
  Wiadomosc,
} from '../../game/src/rozmowa/prompt.js';

/**
 * Połączenie serwera pętli z Ollamą. Model ma blok świata wpieczony, więc nie
 * wysyłamy go drugi raz — gracz z gołym Bielikiem dośle go z przeglądarki.
 */
export const POLACZENIE: Polaczenie = { url: CFG.ollamaUrl, model: MODEL_NPC };

/**
 * Zywa rozmowa z postacia.
 *
 * Konstrukcja wynika z pomiarow, nie z gustu. Trzy rozstrzygniecia:
 *
 * 1. PROZA BEZ GRAMATYKI. Z gramatyka JSON pierwsza litera kwestii pada po 870 ms,
 *    bo model musi najpierw wypisac {"reply": ". Bez niej po 330 ms. Gracz czyta
 *    w trakcie, wiec liczy sie pierwszy token, nie calosc.
 *
 * 2. DECYZJA OSOBNYM WYWOLANIEM. Wspolne wywolanie JSON na pytanie "Dasz mi sznurek?"
 *    odpowiadalo "action": "brak" cztery razy na cztery. Osobne wywolanie z gramatyka
 *    na samym enumie wybralo dar poprawnie w 1,8 s. Rozdzielenie kwestii od decyzji
 *    poprawilo decyzje - a akcja i tak nie jest pilna, bo pada po kwestii.
 *
 * 3. TEKST NIE DOTYKA STANU. Do rdzenia idzie wylacznie wybrana akcja, jako zwykle
 *    wejscie. Tekst jest prezentacja, tak samo jak renderer.
 *
 * Czwarte rozstrzygniecie jest o pamieci i wyszlo z pomiaru na zywo. Ollama traktuje
 * zagroda-npc i model bazowy jako dwa osobne modele po 8,5 GB, wiec na 24 GB bija sie
 * o miejsce: pierwszy token spadl z 330 ms do 34 SEKUND, bo kazde wywolanie przeladowywalo
 * wagi. Dlatego rozmowy zwalniaja modele agenta, zanim zaczna - i dlatego nie da sie
 * rozmawiac i puszczac agenta rownoczesnie. To nie jest ograniczenie do obejscia,
 * tylko wybor, ktory trzeba podjac swiadomie.
 *
 * Czego tu nie ma i nie bedzie: wyroczni jakosci. Nikt automatycznie nie sprawdzi,
 * czy postac nie wyszla z roli albo nie obiecala czegos, czego nie ma. Mechanicznie
 * da sie sprawdzic tylko to, czy wybrana akcja jest na liscie - i to robi rdzen.
 */

const ROOT = resolve(new URL('../..', import.meta.url).pathname);

/**
 * Limity czasu. Rozmowa idzie do przegladarki strumieniem SSE, wiec zawieszone
 * wywolanie nie konczy sie bledem — konczy sie oknem dialogowym, ktore w nieskonczonosc
 * pokazuje trzy kropki. Osobne progi, bo kwestia moze byc dluga, a decyzja to jeden token.
 */
const LIMIT_KWESTII_MS = 90_000;
const LIMIT_DECYZJI_MS = 30_000;
const BRAK = 'brak';

export function modelAktualny(): { ok: true } | { ok: false; powod: string } {
  let zapis: { model?: string; odcisk?: string };
  try {
    zapis = JSON.parse(readFileSync(resolve(ROOT, '.agent/npc-model.json'), 'utf8'));
  } catch {
    return { ok: false, powod: `modelu rozmow nie ma. Zbuduj go: npm run npc-model` };
  }
  const teraz = odciskTresci();
  if (zapis.odcisk !== teraz) {
    return {
      ok: false,
      powod: `model rozmow jest starszy niz tresc gry (${zapis.odcisk} wobec ${teraz}). Przebuduj: npm run npc-model`,
    };
  }
  return { ok: true };
}

/**
 * Budowa wiadomosci. Kolejnosc nie jest kosmetyczna, tylko wydajnosciowa.
 *
 * Prefiks musi ROSNAC, a nie sie przebudowywac: blok staly siedzi w modelu, zaraz za nim
 * idzie rola postaci (stala przez cala rozmowe), potem historia tura po turze, a dopiero
 * na koncu to, co sie zmienia. Wtedy cache KV trafia w caly poczatek i zostaje do
 * policzenia kilkanascie tokenow zamiast dwoch i pol tysiaca.
 *
 * Pierwsza wersja wkladala role, stan i cala historie do JEDNEJ wiadomosci budowanej od
 * nowa co ture - i cache nie trafial w nic poza blokiem z modelu.
 */
export async function przygotuj(): Promise<void> {
  for (const m of [CFG.models.pl, CFG.models.code]) {
    if (m !== MODEL_NPC) await unloadModel(m);
  }
  // Rozgrzewka: jedno krotkie wywolanie laduje wagi i przerabia blok staly do cache'u.
  // Bez niej pierwsza kwestia w grze trwa blisko pol minuty, kolejne ponad sekunde.
  try {
    await kwestia(
      POLACZENIE,
      { id: 'rozgrzewka', name: 'nikt', gives: [] },
      'nic',
      [],
      'Czesc.',
      [],
      [],
      () => {},
    );
  } catch {
    // Brak Ollamy wychodzi i tak przy pierwszej rozmowie, z sensowniejszym komunikatem.
  }
}
