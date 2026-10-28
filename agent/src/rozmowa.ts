import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CFG } from './config.js';
import { unloadModel } from './providers/ollama.js';
import { MODEL_NPC, odciskTresci } from '../../tools/npc-model.js';

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
const BRAK = 'brak';

export interface Postac {
  id: string;
  name: string;
  gives: string[];
}

/**
 * Oferta policzona przez silnik gry. Przychodzi z przegladarki i jest NIEZAUFANA —
 * tu sluzy tylko do tego, zeby model mial z czego wybierac i co powiedziec. Rdzen
 * i tak przelicza kurs od nowa przy stosowaniu wyniku.
 */
export interface Oferta {
  daj: string;
  za: string;
  ile: number;
  darNazwa: string;
  zaNazwa: string;
}

const kluczOferty = (o: Oferta) => `${o.daj}|${o.za}`;

export interface TuraRozmowy {
  rola: 'gracz' | 'postac';
  tekst: string;
}

/**
 * Czy model jest zgodny z trescia, ktora jest teraz w repozytorium.
 *
 * Fail-closed i to celowo: model zbudowany na starszej tresci opowiada o grze, ktorej
 * juz nie ma - podaje receptury sprzed zmiany, wymienia przedmioty, ktore zniknely.
 * To jest dokladnie ten rodzaj bledu, ktory niczego nie wywraca i dlatego potrafi
 * przezyc dlugo. Lepiej odmowic rozmowy, niz klamac gracza w zywe oczy.
 */
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
export type Wiadomosc = { role: string; content: string };

function wiadomosci(
  postac: Postac,
  stanGracza: string,
  historia: TuraRozmowy[],
  odGracza: string,
  oferty: Oferta[],
): Wiadomosc[] {
  const dary = postac.gives.length
    ? `Mozesz dac graczowi wylacznie: ${postac.gives.join(', ')}. Nic poza tym.`
    : 'Nie masz nic do oddania.';

  /**
   * Cennik liczy silnik gry i podajemy go modelowi DOSLOWNIE, zeby jego zdanie
   * zgadzalo sie z tym, co za chwile zrobi rdzen.
   *
   * Idzie na SAM KONIEC, tuz przed kwestia gracza, i ma to dwa powody. Pierwszy:
   * cennik zalezy od zawartosci plecaka, wiec w staлym poczatku promptu psulby cache
   * przy kazdej zmianie ekwipunku. Drugi: ostatnie miejsce przed generowaniem jest
   * najmocniejsze — gdy cennik stal na poczatku, Bartek wycenial rybe na "piec galezi
   * albo osiem kamieni", biorac piatke z cennika, a osemke ze stanu plecaka gracza.
   */
  const cennik = oferty.length
    ? [
        'CENNIK (policzony, nie do negocjacji — podawaj dokladnie te liczby):',
        ...oferty.map((o) => `  ${o.darNazwa} = ${o.ile}x ${o.zaNazwa}`),
      ]
    : ['Gracz nie ma teraz czym zaplacic, wiec nic mu nie oddajesz. Powiedz to wprost.'];

  return [
    { role: 'user', content: `Jestes: ${postac.name}. ${dary}` },
    { role: 'assistant', content: 'Rozumiem. Jestem soba i mowie krotko.' },
    ...historia.map((t) => ({ role: t.rola === 'gracz' ? 'user' : 'assistant', content: t.tekst })),
    { role: 'user', content: [...cennik, '', `[gracz ma: ${stanGracza}]`, odGracza].join('\n') },
  ];
}

async function strumien(
  model: string,
  wiadomosci: Array<{ role: string; content: string }>,
  opcje: Record<string, unknown>,
  format: unknown | null,
  naTekst?: (fragment: string) => void,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    stream: true,
    keep_alive: '30m',
    messages: wiadomosci,
    options: opcje,
  };
  if (format) body.format = format;

  const odp = await fetch(`${CFG.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!odp.ok || !odp.body) throw new Error(`Ollama odpowiedziala ${odp.status}`);

  const dec = new TextDecoder();
  let bufor = '';
  let caly = '';
  for await (const kawalek of odp.body as unknown as AsyncIterable<Uint8Array>) {
    bufor += dec.decode(kawalek, { stream: true });
    const linie = bufor.split('\n');
    bufor = linie.pop() ?? '';
    for (const l of linie) {
      if (!l.trim()) continue;
      const j = JSON.parse(l) as { message?: { content?: string } };
      const f = j.message?.content;
      if (!f) continue;
      caly += f;
      naTekst?.(f);
    }
  }
  return caly;
}

/**
 * Zwolnienie modeli agenta. Bez tego kazde wywolanie przeladowuje wagi i rozmowa
 * przestaje byc rozmowa: 34 sekundy zamiast 330 milisekund.
 */
export async function przygotuj(): Promise<void> {
  for (const m of [CFG.models.pl, CFG.models.code]) {
    if (m !== MODEL_NPC) await unloadModel(m);
  }
  // Rozgrzewka: jedno krotkie wywolanie laduje wagi i przerabia blok staly do cache'u.
  // Bez niej pierwsza kwestia w grze trwa blisko pol minuty, kolejne ponad sekunde.
  try {
    await strumien(MODEL_NPC, [{ role: 'user', content: 'Czesc.' }], { temperature: 0, num_ctx: 4096, num_predict: 1 }, null);
  } catch {
    // Brak Ollamy wychodzi i tak przy pierwszej rozmowie, z sensowniejszym komunikatem.
  }
}

/** Kwestia postaci. Leci strumieniem, bo pierwszy token pada po ~330 ms i to on gra. */
export async function kwestia(
  postac: Postac,
  stanGracza: string,
  historia: TuraRozmowy[],
  odGracza: string,
  oferty: Oferta[],
  naTekst: (fragment: string) => void,
): Promise<{ tekst: string; watek: Wiadomosc[] }> {
  const watek = wiadomosci(postac, stanGracza, historia, odGracza, oferty);
  const tekst = await strumien(
    MODEL_NPC,
    watek,
    { temperature: 0.6, num_ctx: 4096, num_predict: 150 },
    null,
    naTekst,
  );
  return { tekst: tekst.trim(), watek: [...watek, { role: 'assistant', content: tekst.trim() }] };
}

/**
 * Co postac ROBI. Gramatyka zawezona do listy darow tej postaci plus "brak",
 * wiec model fizycznie nie wypisze nic innego. Rdzen i tak sprawdza to drugi raz.
 */
/**
 * Co postac ROBI. Pytanie dwustopniowe i oba kroki maja gramatyke.
 *
 * Wczesniej pytalismy, czy postac "wreczyla" przedmiot, i probowalismy to wyczytac
 * z prozy filtrem na czasowniki. To gonienie ogona: "Wezme w zamian" przechodzilo
 * jako dar, a "Tutaj, masz jedna" juz nie. Kategoria byla zla — model nigdy nie mowil
 * "dalem", tylko "dam X za Y". Teraz pytamy o to, co faktycznie mowi, a kazda opcja
 * w odpowiedzi pochodzi z silnika, wiec nie ma czego zgadywac.
 */
export async function akcja(postac: Postac, watek: Wiadomosc[], oferty: Oferta[]): Promise<Oferta | null> {
  if (!oferty.length) return null;

  const pytaj = async (tresc: string, mozliwosci: string[]) =>
    (
      await strumien(
        MODEL_NPC,
        [...watek, { role: 'user', content: tresc }],
        { temperature: 0, num_ctx: 4096, num_predict: 12 },
        { type: 'string', enum: mozliwosci },
        undefined,
      )
    )
      .trim()
      .replace(/^"|"$/g, '');

  // Krok 1: rozstrzygniecie, bez zadnej nazwy przedmiotu w tresci pytania.
  // Gramatyka zawezona do listy ofert kusi wybraniem czegokolwiek z niej; pytanie
  // dwustanowe tej pokusy nie ma, bo w jego mozliwosciach nie ma zadnego przedmiotu.
  const czy = await pytaj(
    [
      '[pytanie spoza rozmowy, odpowiadasz jako Ty sama]',
      'Czy w swojej ostatniej wypowiedzi dochodzi do wymiany TU I TERAZ:',
      'gracz oddaje Ci zaplate, a Ty oddajesz mu przedmiot?',
      'Sama propozycja, warunek, odmowa albo wyliczenie cen to NIE jest wymiana.',
      'Odpowiedz: tak albo nie.',
    ].join('\n'),
    ['nie', 'tak'],
  );
  if (czy !== 'tak') return null;

  // Krok 2: dopiero teraz pada lista — i sa na niej wylacznie wymiany policzone
  // przez silnik, wiec model nie ma jak wymyslic ani przedmiotu, ani ceny.
  const klucze = oferty.map(kluczOferty);
  const wybor = await pytaj(
    [
      '[pytanie spoza rozmowy]',
      'Ktora dokladnie wymiana doszla do skutku? Odpowiedz samym identyfikatorem.',
      ...oferty.map((o) => `- ${kluczOferty(o)} = ${o.darNazwa} za ${o.ile}x ${o.zaNazwa}`),
    ].join('\n'),
    klucze,
  );
  return oferty.find((o) => kluczOferty(o) === wybor) ?? null;
}
