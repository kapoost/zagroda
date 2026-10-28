import type { Registry } from '../content/registry.js';
import type { State } from './types.js';

/**
 * Prawo wymiany. NIEZAPISYWALNE dla agenta (agent/src/config.ts -> WRITE_DENY).
 *
 * Postacie same z siebie zaczely handlowac, bo lore mowi, ze wymiana odbywa sie
 * rzeczami i przysluga — Zofia chciala jagod za sznurek, Hanka "czegos w zamian"
 * za wegiel, Bartek drewna za rybe. Model robil wiec rzecz sluszna, tylko mechaniki
 * pod to nie bylo, a proba klasyfikowania jego zdan na "dal / nie dal" gonila ogon:
 * "Wezme w zamian" przechodzilo jako dar, a "Tutaj, masz jedna" juz nie.
 *
 * Stad ten plik. Rozdzial odpowiedzialnosci jest tu ostry i celowy:
 *
 *   model decyduje  CO ZA CO   (i tylko z listy, ktora policzyl silnik)
 *   silnik decyduje ILE        (zawsze, bez wyjatku, bez mozliwosci wplywu)
 *
 * Kurs nie jest danymi i nie jest w tresci, bo tresc jest zapisywalna dla agenta —
 * a cena to nie jest pokretlo rozgrywki, tylko granica ekonomii. Gdyby dalo sie ja
 * zmienic z zewnatrz, wymiana zamienilaby sie w pompe wartosci: ryba warta piec
 * za galaz warta jeden, w kolko, az do konca gry.
 *
 * Ta sama funkcja liczy oferty dwa razy: raz, zeby powiedziec modelowi, co w ogole
 * wolno zaproponowac, i drugi raz w tick(), zeby sprawdzic, co przyszlo z powrotem.
 * Dzieki temu nie ma gdzie powstac rozjazd — ani przez model, ani przez przegladarke,
 * ani przez kogos, kto wpisze sobie wejscie recznie w konsoli.
 */

export interface Oferta {
  /** Co postac daje — zawsze z jej listy "gives". */
  daj: string;
  /** Czym gracz placi — zawsze cos, co naprawde ma w plecaku. */
  za: string;
  /** Ile sztuk. Liczy silnik, nigdy model. */
  ile: number;
}

/**
 * Gorna granica ceny. Bez niej za rzecz warta sto trzeba by oddac sto galezi, czego
 * nikt nigdy nie uniesie — a oferta nie do spelnienia to tylko halas w rozmowie.
 */
export const MAX_CENA = 12;

/** Cena w sztukach: tyle, zeby gracz nie wyszedl na wymianie lepiej, niz wlozyl. */
export function cena(wartoscDaru: number, wartoscZaplaty: number): number {
  if (wartoscZaplaty <= 0) return Infinity;
  return Math.ceil(wartoscDaru / wartoscZaplaty);
}

/**
 * Wszystkie wymiany, jakie ta postac moze teraz zawrzec z tym graczem.
 *
 * Czysta funkcja stanu i tresci — ten sam stan zawsze daje te sama liste, w tej samej
 * kolejnosci. To wazne: lista idzie do promptu modelu i do walidacji w rdzeniu, wiec
 * gdyby zalezala od czegokolwiek poza stanem, obie strony widzialyby co innego.
 */
export function oferty(state: State, reg: Registry, npcId: string): Oferta[] {
  const npc = reg.npcs.get(npcId);
  if (!npc) return [];
  const wynik: Oferta[] = [];

  for (const idDaru of npc.gives) {
    const dar = reg.items.get(idDaru);
    if (!dar) continue;
    // Kolejnosc po id, a nie po kolejnosci w obiekcie — stan ma byc odtwarzalny.
    for (const idZaplaty of Object.keys(state.player.inv).sort()) {
      if (idZaplaty === idDaru) continue;
      const ma = state.player.inv[idZaplaty] ?? 0;
      if (ma <= 0) continue;
      const zaplata = reg.items.get(idZaplaty);
      if (!zaplata) continue;
      // Narzedziem ani budynkiem sie nie placi. Oddanie siekiery za jagode byloby
      // dla gracza katastrofa, a postac nie ma prawa mu jej proponowac.
      if (zaplata.tool || zaplata.placeable) continue;
      const ile = cena(dar.value, zaplata.value);
      if (!Number.isFinite(ile) || ile > MAX_CENA || ile > ma) continue;
      wynik.push({ daj: idDaru, za: idZaplaty, ile });
    }
  }
  return wynik;
}

/** Czy dokladnie ta wymiana jest teraz dozwolona. Rdzen pyta o to przed kazda zmiana stanu. */
export function dozwolona(state: State, reg: Registry, npcId: string, daj: string, za: string): Oferta | null {
  return oferty(state, reg, npcId).find((o) => o.daj === daj && o.za === za) ?? null;
}
