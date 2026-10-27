import { z } from 'zod';
import { CFG } from '../config.js';
import { digest } from '../contentIo.js';
import { apiComplete, apiReady } from '../providers/anthropic.js';
import { lastCallSeconds, ollamaChat } from '../providers/ollama.js';
import { skillMenu } from '../skills.js';
import {
  RouteSchema,
  VOCAB,
  buildOpsSchema,
  jsonSchemaOf,
  stripNulls,
  tightenForGrammar,
  type Collection,
  type Route,
} from '../spec.js';

/** Polski opis zmiany → maszynowa specyfikacja. To jedyne miejsce, gdzie Bielik pracuje na polszczyźnie. */

const ROUTE_SYSTEM = `Jesteś projektantem gry "Zagroda" — otwarty świat z wytwarzaniem przedmiotów.
Dostajesz opis zmiany po polsku i klasyfikujesz go. Odpowiadasz WYŁĄCZNIE obiektem JSON.

Pola:
- kind: "dane" jeśli zmianę da się wyrazić jako nowe/zmienione wpisy w treści gry
  (przedmioty, receptury, surowce, budynki, NPC, biomy, parametry świata).
  "kod" jeśli wymaga nowej MECHANIKI — czegoś, czego obecne struktury danych nie opisują
  (np. uprawy, pory roku wpływające na rozgrywkę, handel, walka, nowy rodzaj akcji gracza).
- collections: które kolekcje trzeba ruszyć (pusta lista przy "kod").
  Pamiętaj o zależnościach: przedmiot, który się stawia, potrzebuje też wpisu w
  "structures"; przedmiot, który się wytwarza, potrzebuje wpisu w "recipes";
  nowy surowiec do zbierania to "resources".
- title: krótki tytuł zmiany po polsku, bez kropki
- summary_pl: 2-3 zdania, co dokładnie się zmieni i dlaczego
- removes_content: true TYLKO jeśli gracz wprost prosi o usunięcie czegoś, co już jest w grze.
  Dodanie nowej rzeczy to zawsze false.
- modifies_existing: true TYLKO jeśli zmiana dotyka wpisów, które już są w grze
  (np. "osłab jagody", "zmień cenę skrzyni"). Dodanie nowej rzeczy to zawsze false.
- code_request_en: PO ANGIELSKU, techniczny opis zmiany w kodzie; puste przy "dane"
- observable_pl: jedno zdanie po polsku — co gracz zauważy, gdy zmiana zadziała
- skill_id: przy "kod" wybierz z listy poniżej ten rodzaj zmiany, który pasuje najlepiej;
  wpisz "brak", jeśli żaden naprawdę nie pasuje. Przy "dane" zawsze "brak".

Zasada: wybieraj "dane", kiedy tylko to możliwe. Nowa broń, surowiec, potrawa, budynek
czy postać to zawsze "dane".`;

const OPS_SYSTEM = `Jesteś projektantem gry "Zagroda". Tworzysz wpisy treści gry jako JSON.
Odpowiadasz WYŁĄCZNIE obiektem JSON zgodnym ze schematem.

TWARDE REGUŁY (ich złamanie powoduje odrzucenie zmiany):
1. Identyfikatory: małe litery, cyfry, podkreślenia. Nazwy i opisy po polsku.
2. Każda referencja musi wskazywać na ISTNIEJĄCY wpis z listy poniżej albo na wpis,
   który dodajesz w tej samej odpowiedzi.
3. Każdy nowy przedmiot musi być ZDOBYWALNY: albo wypada z surowca, albo ma recepturę,
   której wsad jest zdobywalny. Przedmiot bez drogi zdobycia zostanie odrzucony.
4. Ekonomia: wartość wyjścia receptury nie może przekroczyć 4× wartości wsadu.
5. Receptury nie mogą tworzyć cyklu (A→B i B→A).
6. Nowy surowiec musi wymagać narzędzia, które da się zdobyć.
7. Wartości liczbowe mieszczą się w granicach schematu — nie próbuj ich obejść.
8. Jeden pomysł = JEDEN przedmiot. Nie twórz wariantów ani duplikatów tej samej rzeczy.
9. Zmieniaj istniejące wpisy (patch_*) WYŁĄCZNIE wtedy, gdy zadanie tego wprost wymaga.
   Domyślnie tylko DODAJESZ nowe wpisy.
10. Przedmiot, który się stawia w świecie, wymaga pary: wpisu w "structures" oraz pola
   "placeable" w przedmiocie wskazującego na id tej struktury.
11. Każdy nowy przedmiot potrzebuje receptury albo wypadania z surowca — inaczej jest
   nieosiągalny i zmiana zostanie odrzucona.
12. POLA, KTÓRE NIE DOTYCZĄ DANEJ RZECZY, USTAW NA null. Schemat wymaga obecności klucza,
   ale wartością ma być null. Skrzynia nie jest narzędziem ("tool": null) ani jedzeniem
   ("edible": null). Siekiera nie jest budynkiem ("placeable": null). Przedmiot nie może
   pełnić dwóch ról naraz — taka zmiana zostanie odrzucona.
13. "hand" oznacza gołe ręce, czyli BRAK narzędzia. Żaden przedmiot nie ma "kind": "hand".

PRZYKŁAD dobrze zbudowanej odpowiedzi dla zadania "dodaj plecioną matę do spania":
{
  "add_items": [
    { "id": "mata_sloma", "name": "Mata słomiana", "desc": "Plecione posłanie.",
      "tags": ["budynek"], "value": 6, "stack": 10,
      "tool": null, "edible": null,
      "placeable": { "structure": "poslanie_slomiane" } }
  ],
  "add_structures": [
    { "id": "poslanie_slomiane", "name": "Posłanie", "desc": "Miejsce na odpoczynek.",
      "color": "#c8b06a", "blocks": false }
  ],
  "add_recipes": [
    { "id": "r_mata_sloma", "name": "Mata słomiana", "station": "workbench",
      "inputs": [{ "item": "siano", "qty": 4 }, { "item": "sznurek", "qty": 1 }],
      "output": { "item": "mata_sloma", "qty": 1 }, "ticks": 10 }
  ]
}
Zwróć uwagę: jeden przedmiot, jedna struktura, jedna receptura ze wsadu, który
już istnieje w grze. Wartość wyjścia (6) mieści się w 4× wartości wsadu (4×1 + 1×3 = 7).
Mata jest budynkiem, więc "tool" i "edible" są nullem — nie wymyślaj dla nich wartości.`;

function vocabBlock(): string {
  return `RODZAJE NARZĘDZI: ${VOCAB.tools.join(', ')}\nSTACJE: ${VOCAB.stations.join(', ')}`;
}

function routeUser(prompt: string): string {
  return [
    vocabBlock(),
    '',
    'RODZAJE ZMIAN W KODZIE (skill_id):',
    skillMenu(),
    '',
    'OBECNA TREŚĆ GRY:',
    digest(),
    '',
    'OPIS ZMIANY OD GRACZA:',
    prompt,
  ].join('\n');
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('w odpowiedzi nie ma obiektu JSON');
  return JSON.parse(body.slice(start, end + 1));
}

export interface StageAttempt {
  stage: string;
  model: string;
  ok: boolean;
  note?: string;
}

export interface RouteResult {
  route: Route;
  attempts: StageAttempt[];
  resolvedBy: 'bielik' | 'api';
}

export async function routeRequest(prompt: string): Promise<RouteResult> {
  const attempts: StageAttempt[] = [];
  const user = routeUser(prompt);
  const schema = tightenForGrammar(jsonSchemaOf(RouteSchema));

  for (let i = 0; i < CFG.attempts.route; i++) {
    try {
      const raw = await ollamaChat({
        model: CFG.models.pl,
        system: ROUTE_SYSTEM,
        user,
        schema,
        temperature: 0.1,
        numPredict: 700,
      });
      const route = RouteSchema.parse(stripNulls(extractJson(raw)));
      attempts.push({ stage: 'routing', model: CFG.models.pl, ok: true });
      return { route, attempts, resolvedBy: 'bielik' };
    } catch (e) {
      attempts.push({ stage: 'routing', model: CFG.models.pl, ok: false, note: String(e).slice(0, 200) });
    }
  }

  const raw = await apiComplete(
    ROUTE_SYSTEM + `\n\nZwróć wyłącznie JSON zgodny z tym schematem:\n${JSON.stringify(schema)}`,
    user,
    4000,
  );
  const route = RouteSchema.parse(stripNulls(extractJson(raw)));
  attempts.push({ stage: 'routing', model: CFG.models.api, ok: true });
  return { route, attempts, resolvedBy: 'api' };
}

export interface OpsResult {
  ops: Record<string, unknown>;
  attempts: StageAttempt[];
  resolvedBy: 'bielik' | 'api';
}

/** Druga faza: operacje na danych, ze schematem zawężonym do wybranych kolekcji. */
/**
 * Dopełnienie kolekcji o zależności.
 *
 * Model regularnie wybiera samo "items" dla przedmiotu, który trzeba jeszcze wytworzyć
 * i postawić. Bez wpisu w recipes przedmiot byłby nieosiągalny, bez structures wisiałaby
 * referencja — i bramka odrzuciłaby zmianę, której schemat nawet nie pozwalał naprawić.
 */
export function widenCollections(cols: Collection[]): Collection[] {
  const chosen = cols.length ? cols : (['items'] as Collection[]);
  const must = new Set<Collection>();
  if (chosen.some((c) => c === 'items' || c === 'resources' || c === 'structures')) {
    must.add('items');
    must.add('recipes');
    must.add('structures');
  }
  // Zależności idą pierwsze, bo to one decydują, czy zmiana da się w ogóle naprawić.
  // Wcześniej limit obcinał koniec listy, czyli dokładnie to, co funkcja przed chwilą
  // dołożyła — i pętla poprawek nie miała czym naprawić bramki.
  const out: Collection[] = [...must];
  for (const c of chosen) {
    if (out.length >= MAX_COLLECTIONS) break;
    if (!out.includes(c)) out.push(c);
  }
  return out.slice(0, MAX_COLLECTIONS);
}

/** Ile kolekcji maksymalnie — każda to osobne wywołanie modelu, więc limit to budżet czasu. */
const MAX_COLLECTIONS = 5;

/** Kolejność ma znaczenie: struktury przed przedmiotami, przedmioty przed recepturami. */
const ORDER: Collection[] = ['structures', 'biomes', 'resources', 'items', 'recipes', 'npcs', 'config'];

function alreadyProposed(ops: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(ops)) {
    if (!key.startsWith('add_') || !Array.isArray(value) || !value.length) continue;
    const ids = (value as Array<{ id?: string; name?: string }>)
      .map((x) => `${x.id}${x.name ? ` ("${x.name}")` : ''}`)
      .join(', ');
    lines.push(`  ${key.slice(4)}: ${ids}`);
  }
  return lines.length ? `\n\nW TEJ SAMEJ ZMIANIE DODAŁEŚ JUŻ:\n${lines.join('\n')}\nMożesz się do tego odwoływać.` : '';
}

const FOCUS: Record<Collection, string> = {
  structures: 'Dodaj budynki/stanowiska, jeśli zmiana ich wymaga (np. coś, co gracz stawia w świecie). Jeśli nie — zwróć pustą tablicę.',
  biomes: 'Dodaj biomy, jeśli zmiana ich wymaga. Zwykle nie wymaga — zwróć wtedy pustą tablicę.',
  resources: 'Dodaj surowce do zbierania w świecie, jeśli zmiana ich wymaga. Jeśli nie — pusta tablica.',
  items: 'Dodaj przedmioty. Przedmiot stawiany w świecie wskazuje polem "placeable" na id struktury.',
  recipes: 'Dodaj receptury, żeby nowe przedmioty dało się wytworzyć. Wsad musi istnieć w grze albo być dodany w tej zmianie.',
  npcs: 'Dodaj postacie, jeśli zmiana ich wymaga. Jeśli nie — pusta tablica.',
  config: 'Zmień parametry świata tylko jeśli zmiana tego wprost wymaga.',
};

/**
 * Faza operacji, kolekcja po kolekcji.
 *
 * Jedno wywołanie na całość wyglądało na oczywiste rozwiązanie i było pułapką: koszt
 * dekodowania pod gramatyką rośnie superliniowo z jej rozmiarem. Pomiar na tym sprzęcie:
 * jedna kolekcja 33 s, trzy kolekcje naraz — kilkanaście minut bez końca w zasięgu wzroku.
 *
 * Rozbicie na osobne wywołania daje trzy rzeczy naraz: przewidywalny czas (suma, nie iloczyn),
 * mniejszą gramatykę na wywołanie i prostsze zadanie dla modelu — a to ostatnie podnosi
 * także trafność merytoryczną, nie tylko tempo.
 */
export async function proposeOps(
  route: Route,
  prompt: string,
  feedback: string[] = [],
  /** Pomiń model lokalny — używane na ostatnim szczeblu drabiny, gdy Bielik już raz nie trafił semantycznie. */
  preferApi = false,
): Promise<OpsResult> {
  const cols = widenCollections(route.collections);
  const ordered = ORDER.filter((c) => cols.includes(c));
  const attempts: StageAttempt[] = [];
  const ops: Record<string, unknown> = {};
  let usedApi = false;

  const header = [
    vocabBlock(),
    '',
    'OBECNA TREŚĆ GRY:',
    digest(),
    '',
    `ZADANIE: ${route.title}`,
    route.summary_pl,
    '',
    `ORYGINALNY OPIS OD GRACZA:\n${prompt}`,
  ].join('\n');

  for (const [i, col] of ordered.entries()) {
    const subSchema = buildOpsSchema([col], route.removes_content && i === 0, route.modifies_existing);
    const schema = tightenForGrammar(jsonSchemaOf(subSchema));
    const base =
      `${header}${alreadyProposed(ops)}\n\nTEN KROK DOTYCZY WYŁĄCZNIE: ${col}\n${FOCUS[col]}` +
      (feedback.length ? `\n\nPOPRZEDNIA PRÓBA ZOSTAŁA ODRZUCONA. Napraw dokładnie te błędy:\n${feedback.join('\n')}` : '');

    let done = false;
    for (let attempt = 0; attempt < (preferApi ? 0 : CFG.attempts.ops) && !done; attempt++) {
      try {
        const raw = await ollamaChat({
          model: CFG.models.pl,
          system: OPS_SYSTEM,
          user: base,
          schema,
          temperature: attempt === 0 ? 0.2 : 0.4,
          numPredict: 1200,
        });
        Object.assign(ops, subSchema.parse(stripNulls(extractJson(raw))));
        attempts.push({ stage: `operacje:${col}`, model: CFG.models.pl, ok: true, note: `${lastCallSeconds}s` });
        done = true;
      } catch (e) {
        attempts.push({ stage: `operacje:${col}`, model: CFG.models.pl, ok: false, note: String(e).slice(0, 160) });
      }
    }

    if (!done) {
      if (!apiReady()) continue;
      const raw = await apiComplete(
        OPS_SYSTEM + `\n\nZwróć wyłącznie JSON zgodny z tym schematem:\n${JSON.stringify(schema)}`,
        base,
        8000,
      );
      Object.assign(ops, subSchema.parse(stripNulls(extractJson(raw))));
      attempts.push({ stage: `operacje:${col}`, model: CFG.models.api, ok: true });
      usedApi = true;
    }
  }

  return { ops, attempts, resolvedBy: usedApi ? 'api' : 'bielik' };
}

export const _test = { extractJson, RouteSchema: RouteSchema as z.ZodTypeAny };
