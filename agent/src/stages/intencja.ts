import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLLECTIONS, type Collection } from '../spec.js';

/**
 * Wyrocznia intencji.
 *
 * Bramka dowodzi, że treść jest spójna. Nie dowodzi, że jest TA, o którą prosiłeś —
 * i to jest dziura, przez którą przeszedł młot „dużo wytrzymalszy od kilofa"
 * z wytrzymałością 30 przy kilofie 200. Każda liczba z osobna mieściła się w zakresie,
 * referencje istniały, testy przechodziły. Nikt nigdzie nie zapisał, że „wytrzymalszy"
 * to warunek na liczbę.
 *
 * Tutaj się go zapisuje. Routing, który i tak wypisuje jedno zdanie o tym, co gracz
 * zauważy, wypisuje przy okazji to samo jako porównanie — a to porównanie liczy
 * deterministyczny kod, nie model.
 *
 * Składnia jest celowo mała, bo większą model zacznie zgadywać:
 *
 *   items.mlot_kamienny.tool.durability > items.kilof_kamienny.tool.durability
 *   recipes.r_mlot_kamienny.inputs.length == 3
 *   config.energyMax >= 100
 */

const ROOT = resolve(new URL('../../..', import.meta.url).pathname);
const OPERATORY = ['>=', '<=', '==', '!=', '>', '<'] as const;
type Operator = (typeof OPERATORY)[number];

export interface WynikAsercji {
  asercja: string;
  ok: boolean;
  powod: string;
}

function wczytaj(kolekcja: Collection): unknown {
  return JSON.parse(readFileSync(resolve(ROOT, `game/content/${kolekcja}.json`), 'utf8'));
}

/**
 * Rozwiązanie ścieżki. Zwraca liczbę albo komunikat, czego nie znaleziono —
 * nierozwiązywalna ścieżka jest BŁĘDEM, nie prawdą. Fail-closed: asercja, której
 * nie umiemy sprawdzić, jest gorsza niż jej brak, bo udaje dowód.
 */
function rozwiaz(sciezka: string): { wartosc: number } | { blad: string } {
  const czesci = sciezka.split('.');
  const liczba = Number(sciezka);
  if (czesci.length === 1 && Number.isFinite(liczba)) return { wartosc: liczba };

  const [kolekcja, ...reszta] = czesci;
  if (!COLLECTIONS.includes(kolekcja as Collection)) {
    return { blad: `"${kolekcja}" to nie jest kolekcja treści (są: ${COLLECTIONS.join(', ')})` };
  }
  let biezacy: unknown = wczytaj(kolekcja as Collection);
  let przebyte = kolekcja!;

  for (const krok of reszta) {
    if (Array.isArray(biezacy)) {
      if (krok === 'length') { biezacy = biezacy.length; przebyte += '.length'; continue; }
      const wpis = biezacy.find((x) => (x as { id?: string }).id === krok);
      if (!wpis) return { blad: `w "${przebyte}" nie ma wpisu o id "${krok}"` };
      biezacy = wpis;
    } else if (biezacy && typeof biezacy === 'object') {
      if (!(krok in biezacy)) return { blad: `"${przebyte}" nie ma pola "${krok}"` };
      biezacy = (biezacy as Record<string, unknown>)[krok];
    } else {
      return { blad: `"${przebyte}" to nie jest obiekt, więc nie ma w nim "${krok}"` };
    }
    przebyte += `.${krok}`;
  }
  if (typeof biezacy !== 'number') {
    return { blad: `"${przebyte}" nie jest liczbą, a porównywać umiemy tylko liczby` };
  }
  return { wartosc: biezacy };
}

function porownaj(a: number, op: Operator, b: number): boolean {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '==': return a === b;
    case '!=': return a !== b;
  }
}

export function sprawdzAsercje(asercje: string[]): WynikAsercji[] {
  return asercje.map((asercja) => {
    const op = OPERATORY.find((o) => asercja.includes(o));
    if (!op) {
      return { asercja, ok: false, powod: `brak operatora porównania (${OPERATORY.join(', ')})` };
    }
    const [lewa, prawa] = asercja.split(op).map((s) => s.trim());
    if (!lewa || !prawa) return { asercja, ok: false, powod: 'porównanie ma dwie strony, a tu jest jedna' };

    const l = rozwiaz(lewa);
    if ('blad' in l) return { asercja, ok: false, powod: l.blad };
    const p = rozwiaz(prawa);
    if ('blad' in p) return { asercja, ok: false, powod: p.blad };

    const ok = porownaj(l.wartosc, op, p.wartosc);
    return { asercja, ok, powod: ok ? 'spełniona' : `${l.wartosc} ${op} ${p.wartosc} jest fałszem` };
  });
}

/** Komunikaty dla modelu — w tym samym kształcie, co feedback z bramki. */
export function feedbackAsercji(wyniki: WynikAsercji[]): string[] {
  return wyniki
    .filter((w) => !w.ok)
    .map((w) => `warunek "${w.asercja}" nie jest spełniony: ${w.powod}`);
}
