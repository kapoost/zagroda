import {
  PYTANIE_CZY,
  kluczOferty,
  pytanieKtora,
  wiadomosci,
  type Oferta,
  type Okolica,
  type Postac,
  type TuraRozmowy,
  type Wiadomosc,
} from './prompt.js';

/**
 * Klient Ollamy — ten sam w Node i w przeglądarce.
 *
 * Działa wszędzie, bo używa wyłącznie `fetch` i strumieni z platformy. To nie jest
 * czystość dla czystości: gracz, który uruchomi grę u siebie i ma własnego Bielika,
 * rozmawia DOKŁADNIE tym samym kodem, co pętla agenta. Inaczej dostałby inną grę.
 *
 * Czego tu świadomie nie ma: wiedzy o tym, skąd biorą się oferty i okolica. Jedno
 * i drugie liczy silnik gry, a ten plik tylko wkłada to w prompt.
 */

export interface Polaczenie {
  /** Adres Ollamy — w przeglądarce zwykle http://127.0.0.1:11434 */
  url: string;
  model: string;
  /**
   * Blok świata do wysłania jako wiadomość systemowa.
   *
   * Pusty znaczy "model ma go wpieczony" (zagroda-npc zbudowany przez npm run npc-model).
   * Gracz z gołym Bielikiem wysyła go z przeglądarki i dostaje to samo zachowanie.
   */
  blokSwiata?: string;
}

/** Limity. Zawieszone wywołanie nie kończy się błędem, tylko oknem z trzema kropkami. */
const LIMIT_KWESTII_MS = 90_000;
const LIMIT_DECYZJI_MS = 30_000;

async function strumien(
  pol: Polaczenie,
  wiad: Wiadomosc[],
  opcje: Record<string, unknown>,
  format: unknown | null,
  naTekst?: (fragment: string) => void,
  limitMs = LIMIT_KWESTII_MS,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: pol.model,
    stream: true,
    keep_alive: '30m',
    messages: pol.blokSwiata ? [{ role: 'system', content: pol.blokSwiata }, ...wiad] : wiad,
    options: opcje,
  };
  if (format) body.format = format;

  const odp = await fetch(`${pol.url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(limitMs),
  });
  if (!odp.ok || !odp.body) throw new Error(`Ollama odpowiedziała ${odp.status}`);

  const czyt = (odp.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let bufor = '';
  let caly = '';
  for (;;) {
    const { done, value } = await czyt.read();
    if (done) break;
    bufor += dec.decode(value, { stream: true });
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

/** Kwestia postaci. Bez gramatyki, bo z nią pierwsza litera pada po 870 ms zamiast 330. */
export async function kwestia(
  pol: Polaczenie,
  postac: Postac,
  stanGracza: string,
  historia: TuraRozmowy[],
  odGracza: string,
  oferty: Oferta[],
  okolica: Okolica[],
  naTekst: (fragment: string) => void,
): Promise<{ tekst: string; watek: Wiadomosc[] }> {
  const watek = wiadomosci(postac, stanGracza, historia, odGracza, oferty, okolica);
  const tekst = await strumien(
    pol,
    watek,
    { temperature: 0.6, num_ctx: 4096, num_predict: 150 },
    null,
    naTekst,
  );
  return { tekst: tekst.trim(), watek: [...watek, { role: 'assistant', content: tekst.trim() }] };
}

/**
 * Co postać ROBI. Dwa kroki, oba z gramatyką, oba doklejone do TEGO SAMEGO wątku.
 *
 * Osobny, krótki prompt wyglądał taniej, a był droższy: Ollama trzyma jeden slot cache
 * na model, więc przeplatanie dwóch promptów kasowało prefiks rozmowy i każda tura
 * liczyła od nowa dwa i pół tysiąca tokenów.
 */
export async function akcja(pol: Polaczenie, watek: Wiadomosc[], oferty: Oferta[]): Promise<Oferta | null> {
  if (!oferty.length) return null;

  const pytaj = async (tresc: string, mozliwosci: string[]) =>
    (
      await strumien(
        pol,
        [...watek, { role: 'user', content: tresc }],
        { temperature: 0, num_ctx: 4096, num_predict: 12 },
        { type: 'string', enum: mozliwosci },
        undefined,
        LIMIT_DECYZJI_MS,
      )
    )
      .trim()
      .replace(/^"|"$/g, '');

  if ((await pytaj(PYTANIE_CZY, ['nie', 'tak'])) !== 'tak') return null;

  const wybor = await pytaj(pytanieKtora(oferty), oferty.map(kluczOferty));
  return oferty.find((o) => kluczOferty(o) === wybor) ?? null;
}

/** Które modele ma gracz u siebie. Pusta lista znaczy: Ollamy nie ma albo nie odpowiada. */
export async function dostepneModele(url: string, limitMs = 1500): Promise<string[]> {
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(limitMs) });
    if (!r.ok) return [];
    const d = (await r.json()) as { models?: Array<{ name: string }> };
    return (d.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * Który model wziąć do rozmów.
 *
 * Najpierw zagroda-npc, bo ma blok świata wpieczony i jest już rozgrzany. Potem
 * cokolwiek z Bielikiem w nazwie — gracz, który pobrał go sam, dostaje to samo
 * zachowanie, tylko blok świata leci z przeglądarki.
 */
export function wybierzModel(modele: string[]): { model: string; wlasnyBlok: boolean } | null {
  const bez = (s: string) => s.replace(/:latest$/, '');
  const npc = modele.find((m) => bez(m) === 'zagroda-npc');
  if (npc) return { model: npc, wlasnyBlok: false };
  const bielik = modele.find((m) => /bielik/i.test(m));
  if (bielik) return { model: bielik, wlasnyBlok: true };
  return null;
}
