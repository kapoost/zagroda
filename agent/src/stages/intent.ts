import { z } from 'zod';
import { CFG } from '../config.js';
import { digest } from '../contentIo.js';
import { apiComplete } from '../providers/anthropic.js';
import { ollamaChat } from '../providers/ollama.js';
import { RouteSchema, VOCAB, buildOpsSchema, jsonSchemaOf, type Collection, type Route } from '../spec.js';

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
- code_request_en: PO ANGIELSKU, techniczny opis zmiany w kodzie; puste przy "dane"

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
   nieosiągalny i zmiana zostanie odrzucona.`;

function vocabBlock(): string {
  return `RODZAJE NARZĘDZI: ${VOCAB.tools.join(', ')}\nSTACJE: ${VOCAB.stations.join(', ')}`;
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
  const user = `${vocabBlock()}\n\nOBECNA TREŚĆ GRY:\n${digest()}\n\nOPIS ZMIANY OD GRACZA:\n${prompt}`;
  const schema = jsonSchemaOf(RouteSchema);

  for (let i = 0; i < CFG.attempts.route; i++) {
    try {
      const raw = await ollamaChat({ model: CFG.models.pl, system: ROUTE_SYSTEM, user, schema, temperature: 0.1 });
      const route = RouteSchema.parse(extractJson(raw));
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
  const route = RouteSchema.parse(extractJson(raw));
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
  const set = new Set<Collection>(cols.length ? cols : ['items']);
  if (set.has('items') || set.has('resources') || set.has('structures')) {
    set.add('items');
    set.add('recipes');
    set.add('structures');
  }
  return [...set].slice(0, 5);
}

export async function proposeOps(
  route: Route,
  prompt: string,
  feedback: string[] = [],
  /** Pomiń model lokalny — używane na ostatnim szczeblu drabiny, gdy Bielik już raz nie trafił semantycznie. */
  preferApi = false,
): Promise<OpsResult> {
  const cols = widenCollections(route.collections);
  const opsSchema = buildOpsSchema(cols, route.removes_content);
  const schema = jsonSchemaOf(opsSchema);
  const attempts: StageAttempt[] = [];

  const base = [
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

  for (let i = 0; i < (preferApi ? 0 : CFG.attempts.ops); i++) {
    const user = feedback.length
      ? `${base}\n\nPOPRZEDNIA PRÓBA ZOSTAŁA ODRZUCONA. Napraw dokładnie te błędy:\n${feedback.join('\n')}`
      : base;
    try {
      const raw = await ollamaChat({
        model: CFG.models.pl,
        system: OPS_SYSTEM,
        user,
        schema,
        temperature: i === 0 ? 0.2 : 0.4,
      });
      const ops = opsSchema.parse(extractJson(raw)) as Record<string, unknown>;
      attempts.push({ stage: 'operacje', model: CFG.models.pl, ok: true });
      return { ops, attempts, resolvedBy: 'bielik' };
    } catch (e) {
      attempts.push({ stage: 'operacje', model: CFG.models.pl, ok: false, note: String(e).slice(0, 200) });
    }
  }

  const raw = await apiComplete(
    OPS_SYSTEM + `\n\nZwróć wyłącznie JSON zgodny z tym schematem:\n${JSON.stringify(schema)}`,
    feedback.length ? `${base}\n\nWcześniejsze próby odrzucono z powodu:\n${feedback.join('\n')}` : base,
    16_000,
  );
  const ops = opsSchema.parse(extractJson(raw)) as Record<string, unknown>;
  attempts.push({ stage: 'operacje', model: CFG.models.api, ok: true });
  return { ops, attempts, resolvedBy: 'api' };
}

export const _test = { extractJson, RouteSchema: RouteSchema as z.ZodTypeAny };
