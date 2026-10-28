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

export type Tryb = 'pelny' | 'bezModelu' | 'nieznany';

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
    stan = r.ok ? 'pelny' : 'bezModelu';
  } catch {
    stan = 'bezModelu';
  }
  for (const f of sluchacze) f(stan);
  sluchacze.clear();
  return stan;
}
