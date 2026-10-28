/**
 * W jakim trybie chodzi gra.
 *
 * Powód jest jeden i konkretny: komunikaty o braku serwera były pisane do mnie,
 * nie do gracza. Statyczna pracownia mówiła „pracownia nie odpowiada — npm start",
 * a ktoś, kto otworzył link, nie ma ani repozytorium, ani terminala. Przycisk
 * „Wyślij do Bielika" świecił na żółto i prowadził donikąd.
 *
 * Gra sprawdza więc raz, czy ma z kim rozmawiać, i od tego zależy, co w ogóle
 * pokazuje. Żaden komunikat nie ma prawa kłamać, a żaden przycisk prowadzić w pustkę.
 */

import { dostepneModele, wybierzModel } from '../rozmowa/klient.js';

/**
 * - `pelny`      — jest serwer pętli: rozmowy i pracownia działają w całości
 * - `wlasnyModel`— serwera nie ma, ale gracz ma własną Ollamę: rozmowy działają,
 *                  pracownia nie (zapisuje pliki i robi commity, czego przeglądarka nie zrobi)
 * - `bezModelu`  — ani jedno, ani drugie: zostaje gra i eksponat
 */

export type Tryb = 'pelny' | 'wlasnyModel' | 'bezModelu' | 'nieznany';

/**
 * Ollama gracza. Adres jest stały, bo przeglądarka i tak dosięgnie tylko localhost:
 * zmierzone — strona z `https://kapoost.github.io` dostaje timeout po 6 s, ta sama
 * strona z `http://127.0.0.1` dostaje odpowiedź w 23 ms. Blokada jest po stronie
 * przeglądarki (Private Network Access), więc model lokalny działa wyłącznie wtedy,
 * gdy gra też stoi lokalnie.
 */
export const OLLAMA = 'http://127.0.0.1:11434';

let stan: Tryb = 'nieznany';
const sluchacze = new Set<(t: Tryb) => void>();

/** Sprawdzenie ma być krótkie: gracz nie będzie czekał na odpowiedź, której nie ma. */
const LIMIT_MS = 1500;

export function tryb(): Tryb {
  return stan;
}

export function gdyTrybZnany(f: (t: Tryb) => void): void {
  if (stan !== 'nieznany') f(stan);
  else sluchacze.add(f);
}

export async function rozpoznajTryb(): Promise<Tryb> {
  try {
    const r = await fetch('/api/stan', { signal: AbortSignal.timeout(LIMIT_MS) });
    if (r.ok) return ustal('pelny');
  } catch {
    // Serwera pętli nie ma — ale model gracza może być.
  }

  const modele = await dostepneModele(OLLAMA, LIMIT_MS);
  const wybor = wybierzModel(modele);
  if (wybor) {
    model = wybor;
    return ustal('wlasnyModel');
  }
  return ustal('bezModelu');
}

/** Model wybrany u gracza. Null, dopóki nie wiadomo albo gdy nie ma czego wybrać. */
let model: { model: string; wlasnyBlok: boolean } | null = null;
export const wybranyModel = () => model;

function ustal(t: Tryb): Tryb {
  stan = t;
  for (const f of sluchacze) f(stan);
  sluchacze.clear();
  return stan;
}
