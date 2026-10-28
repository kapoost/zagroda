import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.js';
import { run, type RunResult } from './pipeline.js';

/**
 * Mostek między grą a pętlą agenta.
 *
 * Przeglądarka nie uruchomi gita ani Ollamy, więc panel w grze rozmawia z tym serwerem.
 * Świadomie bez frameworka i bez zależności: to narzędzie deweloperskie na localhoście,
 * a nie usługa — każda dołożona warstwa byłaby tu kosztem bez pokrycia.
 */

import { akcja, kwestia, modelAktualny, przygotuj, type Oferta, type Postac, type TuraRozmowy } from './rozmowa.js';
import { podgladOps, podgladRoutingu, routeRequest } from './stages/intent.js';

const PORT = Number(process.env.ZU_PORT ?? 5182);

type Event =
  | { typ: 'log'; tekst: string }
  | { typ: 'koniec'; wynik: RunResult }
  | { typ: 'blad'; tekst: string };

interface Bieg {
  id: string;
  prompt: string;
  zdarzenia: Event[];
  sluchacze: Set<ServerResponse>;
  zakonczony: boolean;
}

/** Jeden bieg naraz: pętla modyfikuje drzewo robocze i gałęzie, więc równoległość oznaczałaby wyścig o repozytorium. */
let aktywny: Bieg | null = null;
const historia = new Map<string, Bieg>();

function rozeslij(bieg: Bieg, e: Event): void {
  bieg.zdarzenia.push(e);
  const ramka = `data: ${JSON.stringify(e)}\n\n`;
  for (const s of bieg.sluchacze) s.write(ramka);
}

function zamknij(bieg: Bieg): void {
  bieg.zakonczony = true;
  for (const s of bieg.sluchacze) s.end();
  bieg.sluchacze.clear();
}

function json(res: ServerResponse, kod: number, dane: unknown): void {
  const body = JSON.stringify(dane);
  res.writeHead(kod, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function czytajBody(req: IncomingMessage): Promise<unknown> {
  const kawalki: Buffer[] = [];
  for await (const c of req) kawalki.push(c as Buffer);
  if (!kawalki.length) return {};
  return JSON.parse(Buffer.concat(kawalki).toString('utf8'));
}

function startuj(prompt: string): Bieg {
  const bieg: Bieg = {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    prompt,
    zdarzenia: [],
    sluchacze: new Set(),
    zakonczony: false,
  };
  aktywny = bieg;
  historia.set(bieg.id, bieg);

  void run({ prompt, log: (tekst) => rozeslij(bieg, { typ: 'log', tekst }) })
    .then((wynik) => rozeslij(bieg, { typ: 'koniec', wynik }))
    .catch((e: unknown) => rozeslij(bieg, { typ: 'blad', tekst: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      zamknij(bieg);
      if (aktywny === bieg) aktywny = null;
    });

  return bieg;
}

function dziennik(limit = 8): unknown[] {
  try {
    return readFileSync(resolve(ROOT, '.agent/journal.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .reverse()
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .map((r) => ({
        at: r.at,
        prompt: r.prompt,
        kind: r.kind ?? null,
        title: r.title ?? null,
        outcome: r.outcome,
        resolvedBy: r.resolvedBy ?? null,
      }));
  } catch {
    return [];
  }
}

/**
 * Zywa rozmowa z postacia.
 *
 * Strumien SSE, bo liczy sie pierwszy token, nie calosc: gracz czyta w trakcie.
 * Historia watku siedzi po stronie serwera, a nie przegladarki - dzieki temu kolejna
 * tura doklada sie do tego samego, rosnacego prefiksu i trafia w cache modelu.
 *
 * Do gry wraca wylacznie wybrana akcja. Tekst jest prezentacja i nigdy nie dotyka stanu.
 */
const watki = new Map<string, TuraRozmowy[]>();

async function obsluzRozmowe(res: ServerResponse, body: Record<string, unknown>): Promise<void> {
  const swiezy = modelAktualny();
  if (!swiezy.ok) {
    json(res, 503, { blad: swiezy.powod });
    return;
  }
  const postac = body.postac as Postac | undefined;
  // Oferty liczy silnik gry po stronie przegladarki. Sa NIEZAUFANE: sluza modelowi
  // za liste wyboru i za cennik do zacytowania, a rdzen i tak przelicza kurs od nowa.
  const oferty = Array.isArray(body.oferty) ? (body.oferty as Oferta[]) : [];
  const odGracza = String(body.tekst ?? '').trim();
  const stanGracza = String(body.stan ?? 'nic');
  if (!postac?.id || !odGracza) {
    json(res, 400, { blad: 'Potrzebuję postaci i tego, co gracz powiedział.' });
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const slij = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  const historia = watki.get(postac.id) ?? [];
  try {
    if (!rozgrzany) {
      slij({ typ: 'czekaj', tekst: 'budzę model…' });
      await przygotuj();
      rozgrzany = true;
    }
    const { tekst, watek } = await kwestia(postac, stanGracza, historia, odGracza, oferty, (f: string) =>
      slij({ typ: 'tekst', tekst: f }),
    );
    const wymiana = await akcja(postac, watek, oferty);
    historia.push({ rola: 'gracz', tekst: odGracza }, { rola: 'postac', tekst });
    // Pamiec rozmowy jest krotka celowo: dluzszy watek to dluzszy prompt i wolniejsza tura.
    watki.set(postac.id, historia.slice(-8));
    slij({ typ: 'koniec', wymiana: wymiana ? { daj: wymiana.daj, za: wymiana.za } : null });
  } catch (e) {
    slij({ typ: 'blad', tekst: e instanceof Error ? e.message : String(e) });
  }
  res.end();
}

let rozgrzany = false;

const serwer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/stan') {
    json(res, 200, { zajety: aktywny !== null, biegId: aktywny?.id ?? null, historia: dziennik() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/zmiana') {
    void czytajBody(req).then((body) => {
      const prompt = String((body as { prompt?: unknown }).prompt ?? '').trim();
      if (prompt.length < 8) {
        json(res, 400, { blad: 'Opisz zmianę pełnym zdaniem — kilka słów to za mało, żeby model trafił.' });
        return;
      }
      if (aktywny) {
        json(res, 409, { blad: 'Jedna zmiana naraz. Poczekaj, aż bieżąca się skończy.', biegId: aktywny.id });
        return;
      }
      json(res, 202, { biegId: startuj(prompt).id });
    });
    return;
  }

  /**
   * Podgląd promptu. Nie da się rozwijać gry modelem, nie widząc, co model dostaje —
   * a dotąd dało się to obejrzeć wyłącznie przez CLI. Krok routingu renderuje się bez
   * żadnego wywołania, więc panel pokazuje go natychmiast i za darmo.
   */
  if (req.method === 'POST' && url.pathname === '/api/prompt') {
    void czytajBody(req).then(async (body) => {
      const opis = String((body as { prompt?: unknown })?.prompt ?? '').trim();
      if (opis.length < 8) {
        json(res, 400, { blad: 'Opisz zmianę pełnym zdaniem — prompt powstaje z tego opisu.' });
        return;
      }
      const kroki = [podgladRoutingu(opis)];
      if ((body as { pelny?: unknown })?.pelny) {
        try {
          const { route } = await routeRequest(opis);
          kroki.push(...podgladOps(route, opis));
        } catch (e) {
          json(res, 200, { kroki, blad: `klasyfikacja się nie udała: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }
      }
      json(res, 200, { kroki });
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/rozmowa') {
    void czytajBody(req).then((body) => obsluzRozmowe(res, (body ?? {}) as Record<string, unknown>));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/strumien') {
    const bieg = historia.get(url.searchParams.get('id') ?? '');
    if (!bieg) {
      json(res, 404, { blad: 'Nie ma takiego biegu' });
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    // Zdarzenia sprzed podłączenia odtwarzamy od razu: panel otwarty sekundę później
    // ma zobaczyć cały przebieg, a nie jego ogon.
    for (const e of bieg.zdarzenia) res.write(`data: ${JSON.stringify(e)}\n\n`);
    if (bieg.zakonczony) {
      res.end();
      return;
    }
    bieg.sluchacze.add(res);
    req.on('close', () => bieg.sluchacze.delete(res));
    return;
  }

  json(res, 404, { blad: 'Nieznana ścieżka' });
});

serwer.listen(PORT, '127.0.0.1', () => {
  console.log(`pracownia: http://127.0.0.1:${PORT} (panel w grze rozmawia przez proxy Vite)`);
});
