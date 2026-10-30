/**
 * Okno rozmowy z postacia.
 *
 * Panel nie wie nic o modelu ani o tym, skad biora sie zdania — dostaje strumien tekstu
 * i jedna akcje na koniec. Cala wiedza o promptach siedzi po stronie serwera.
 *
 * Podzial, ktory tu widac, jest celowy: KWESTIA to proza i leci strumieniem, bo gracz
 * czyta w trakcie. RECEPTURY obok sa wzięte z rejestru gry, a nie ze zdania postaci —
 * model potrafi powiedziec "deska" tam, gdzie w recepturze jest "drewno", wiec liczby
 * i skladniki pokazuje interfejs, a nie rozmowca.
 */

export interface PostacDoRozmowy {
  id: string;
  name: string;
  gives: string[];
  opis: string;
  wiedza: string[];
}

import lore from '../../../docs/LORE.md?raw';
import { akcja, kwestia } from '../rozmowa/klient.js';
import { blokSwiata, type TuraRozmowy } from '../rozmowa/prompt.js';
import { OLLAMA, tryb, wybranyModel } from './tryb.js';

export interface MiejsceWPoblizu {
  nazwa: string;
  metrow: number;
  kierunek: string;
}

export interface OfertaUi {
  daj: string;
  za: string;
  ile: number;
  darNazwa: string;
  zaNazwa: string;
}

type Zdarzenie =
  | { typ: 'czekaj'; tekst: string }
  | { typ: 'tekst'; tekst: string }
  | { typ: 'koniec'; wymiana: { daj: string; za: string } | null }
  | { typ: 'blad'; tekst: string };

let korzen: HTMLDivElement | null = null;
let otwarta = false;
let biezaca: PostacDoRozmowy | null = null;
let naAkcje: ((npc: string, daj: string, za: string) => void) | null = null;
let dajStan: (() => string) | null = null;
let dajOferty: (() => OfertaUi[]) | null = null;
let dajOkolice: (() => MiejsceWPoblizu[]) | null = null;
/** Treść gry do zbudowania bloku świata, gdy rozmawiamy z gołym Bielikiem gracza. */
let dajTresc: (() => Parameters<typeof blokSwiata>[1]) | null = null;
/** Historia wątku. W trybie pełnym trzyma ją serwer; z własnym modelem — my. */
const watki = new Map<string, TuraRozmowy[]>();
let czeka = false;

export const rozmowaOtwarta = (): boolean => otwarta;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, klasa?: string, tekst?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (klasa) n.className = klasa;
  if (tekst !== undefined) n.textContent = tekst;
  return n;
}

function zbuduj(): HTMLDivElement {
  const tlo = el('div', 'pr-tlo ro-tlo');
  const okno = el('div', 'pr-okno ro-okno');
  const head = el('div', 'pr-head');
  head.append(el('h2', undefined, 'Rozmowa'), el('p', 'pr-dek', 'Esc zamyka. Enter wysyła.'));
  const watek = el('div', 'ro-watek');
  const pole = el('input', 'pr-pole ro-pole');
  pole.type = 'text';
  pole.placeholder = 'Co mówisz?';
  // Wymiana stoi OSOBNO od pisania i działa zawsze. Kurs i tak liczy silnik, więc
  // nic tu nie zależy od tego, czy ktoś ma osiem i pół giga modelu w pamięci.
  const handel = el('div', 'ro-handel');
  const stopka = el('div', 'ro-stopka');
  stopka.append(pole);
  okno.append(head, watek, handel, stopka);
  tlo.append(okno);
  document.body.append(tlo);

  // Kliknięcie w tło zamyka, tak samo jak w pracowni — żeby myszą dało się wyjść
  // z rozmowy bez szukania klawisza.
  tlo.addEventListener('click', (e) => {
    if (e.target === tlo) zamknij();
  });

  /**
   * Po podniesieniu klawiatury ekranowej przeglądarka przewija kontener sama, ale
   * nie zawsze i nie od razu. Jedno przewinięcie po animacji kosztuje nic, a bez
   * niego pole do pisania bywa tuż pod krawędzią klawiatury.
   */
  pole.addEventListener('focus', () => {
    setTimeout(() => pole.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
  });

  pole.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { zamknij(); return; }
    if (e.key !== 'Enter' || czeka) return;
    const tekst = pole.value.trim();
    if (!tekst) return;
    pole.value = '';
    void wyslij(tekst);
  });
  return tlo as HTMLDivElement;
}

const watekEl = () => korzen!.querySelector('.ro-watek') as HTMLDivElement;
const handelEl = () => korzen!.querySelector('.ro-handel') as HTMLDivElement;

/**
 * Lista wymian do kliknięcia. Odświeżana po każdej transakcji, bo cennik zależy od
 * tego, co gracz ma w plecaku — a to się właśnie zmieniło.
 */
function odswiezHandel(): void {
  const h = handelEl();
  const lista = dajOferty?.() ?? [];
  h.replaceChildren();
  if (!biezaca?.gives.length) return;
  if (!lista.length) {
    h.append(el('p', 'ro-handel-pusto', `${biezaca.name} coś by oddał, ale nie masz czym zapłacić.`));
    return;
  }
  h.append(el('p', 'ro-handel-tyt', 'Wymiana'));
  for (const o of lista) {
    const b = el('button', 'ro-oferta', `${o.darNazwa} za ${o.ile}× ${o.zaNazwa}`);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (!biezaca) return;
      naAkcje?.(biezaca.id, o.daj, o.za);
      dopisz('ro-dar', `Wymiana: ${o.darNazwa} za ${o.ile}× ${o.zaNazwa}.`);
      // Rdzeń stosuje wejście dopiero w następnym tiku, więc odświeżamy po nim.
      setTimeout(odswiezHandel, 150);
    });
    h.append(b);
  }
}

function dopisz(klasa: string, tekst: string): HTMLDivElement {
  const w = watekEl();
  const linia = el('div', `ro-linia ${klasa}`, tekst);
  w.append(linia);
  w.scrollTop = w.scrollHeight;
  return linia as HTMLDivElement;
}

async function wyslij(tekst: string): Promise<void> {
  if (!biezaca) return;
  czeka = true;
  dopisz('ro-gracz', tekst);
  const mowi = dopisz('ro-postac', '');
  mowi.dataset.kto = biezaca.name;

  try {
    if (tryb() === 'wlasnyModel') {
      await zWlasnymModelem(tekst, mowi);
      return;
    }
    const odp = // Ścieżka względna, bo Vite proxuje /api do serwera pętli — to samo pochodzenie, zero CORS-u.
    await fetch('/api/rozmowa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        postac: biezaca,
        tekst,
        stan: dajStan?.() ?? 'nic',
        // Cennik liczy silnik gry, a nie model: tu jedzie po to, żeby postać mówiła
        // te same liczby, które za chwilę zastosuje rdzeń.
        oferty: dajOferty?.() ?? [],
        // Nazwane zabytki w zasięgu wzroku. Fakty z mapy, nie z pamięci modelu.
        okolica: dajOkolice?.() ?? [],
      }),
    });
    if (!odp.ok || !odp.body) {
      const b = await odp.json().catch(() => ({ blad: `serwer odpowiedział ${odp.status}` }));
      mowi.className = 'ro-linia ro-blad';
      mowi.textContent = String((b as { blad?: string }).blad ?? 'nie udało się połączyć');
      return;
    }
    const czyt = odp.body.getReader();
    const dec = new TextDecoder();
    let bufor = '';
    for (;;) {
      const { done, value } = await czyt.read();
      if (done) break;
      bufor += dec.decode(value, { stream: true });
      const czesci = bufor.split('\n\n');
      bufor = czesci.pop() ?? '';
      for (const c of czesci) {
        const linia = c.split('\n').find((l) => l.startsWith('data: '));
        if (!linia) continue;
        const z = JSON.parse(linia.slice(6)) as Zdarzenie;
        if (z.typ === 'czekaj') mowi.textContent = z.tekst;
        else if (z.typ === 'tekst') {
          if (mowi.dataset.pusto !== 'nie') { mowi.textContent = ''; mowi.dataset.pusto = 'nie'; }
          mowi.textContent += z.tekst;
          watekEl().scrollTop = watekEl().scrollHeight;
        } else if (z.typ === 'blad') {
          mowi.className = 'ro-linia ro-blad';
          mowi.textContent = z.tekst;
        } else if (z.typ === 'koniec' && z.wymiana && biezaca) {
          const o = (dajOferty?.() ?? []).find((x) => x.daj === z.wymiana!.daj && x.za === z.wymiana!.za);
          naAkcje?.(biezaca.id, z.wymiana.daj, z.wymiana.za);
          dopisz('ro-dar', o ? `Wymiana: ${o.darNazwa} za ${o.ile}× ${o.zaNazwa}.` : 'Wymiana doszła do skutku.');
          setTimeout(odswiezHandel, 150);
        }
      }
    }
  } catch (e) {
    mowi.className = 'ro-linia ro-blad';
    mowi.textContent = `nie udało się połączyć z serwerem rozmów (${e instanceof Error ? e.message : String(e)})`;
  } finally {
    czeka = false;
    delete mowi.dataset.pusto;
  }
}

/**
 * Rozmowa prosto z przeglądarki do Ollamy gracza, bez żadnego serwera pośrodku.
 *
 * Ten sam kod promptów i ten sam klient, co w pętli agenta — gdyby były dwa, gracz
 * z własnym modelem dostałby inną grę. Serwerowi zostaje to, czego przeglądarka
 * zrobić nie może: pilnowanie świeżości modelu, zwalnianie wag i jedna tura naraz.
 */
async function zWlasnymModelem(tekst: string, mowi: HTMLDivElement): Promise<void> {
  const wybor = wybranyModel();
  if (!biezaca || !wybor) {
    mowi.className = 'ro-linia ro-blad';
    mowi.textContent = 'nie ma z czym rozmawiać — Ollama nie odpowiada';
    return;
  }
  const pol = {
    url: OLLAMA,
    model: wybor.model,
    // Model zbudowany przez `npm run npc-model` ma blok świata wpieczony. Goły Bielik
    // nie ma, więc dostaje go z przeglądarki — i zachowuje się tak samo.
    blokSwiata: wybor.wlasnyBlok && dajTresc ? blokSwiata(lore, dajTresc()) : undefined,
  };
  const historia = watki.get(biezaca.id) ?? [];
  const oferty = dajOferty?.() ?? [];

  const { tekst: odp, watek } = await kwestia(
    pol,
    biezaca,
    dajStan?.() ?? 'nic',
    historia,
    tekst,
    oferty,
    dajOkolice?.() ?? [],
    (f) => {
      if (mowi.dataset.pusto !== 'nie') { mowi.textContent = ''; mowi.dataset.pusto = 'nie'; }
      mowi.textContent += f;
      watekEl().scrollTop = watekEl().scrollHeight;
    },
  );

  const wymiana = await akcja(pol, watek, oferty);
  historia.push({ rola: 'gracz', tekst }, { rola: 'postac', tekst: odp });
  watki.set(biezaca.id, historia.slice(-8));

  if (wymiana) {
    naAkcje?.(biezaca.id, wymiana.daj, wymiana.za);
    dopisz('ro-dar', `Wymiana: ${wymiana.darNazwa} za ${wymiana.ile}× ${wymiana.zaNazwa}.`);
    setTimeout(odswiezHandel, 150);
  }
}

export function otworz(
  postac: PostacDoRozmowy,
  stan: () => string,
  cennik: () => OfertaUi[],
  wokol: () => MiejsceWPoblizu[],
  tresc: () => Parameters<typeof blokSwiata>[1],
  akcja: (npc: string, daj: string, za: string) => void,
): void {
  korzen ??= zbuduj();
  biezaca = postac;
  dajStan = stan;
  dajOferty = cennik;
  dajOkolice = wokol;
  dajTresc = tresc;
  naAkcje = akcja;
  otwarta = true;
  korzen.classList.add('widoczne');
  (korzen.querySelector('h2') as HTMLElement).textContent = postac.name;
  watekEl().replaceChildren();
  dopisz('ro-info', postac.opis || `Rozmawiasz z: ${postac.name}.`);

  // Rozmowa po polsku wymaga modelu; wymiana nie. Mówimy to wprost, zamiast pokazywać
  // pole, które po Enterze odpowie błędem połączenia.
  const pisanie = korzen.querySelector('.ro-stopka') as HTMLElement;
  const zModelem = tryb() === 'pelny' || tryb() === 'wlasnyModel';
  pisanie.style.display = zModelem ? '' : 'none';
  (korzen.querySelector('.pr-dek') as HTMLElement).textContent = zModelem
    ? 'Esc zamyka. Enter wysyła.'
    : 'Esc zamyka.';
  const wybor = wybranyModel();
  dopisz(
    'ro-info',
    tryb() === 'wlasnyModel' && wybor
      ? `Rozmawiasz przez swoją Ollamę (${wybor.model}). Pierwsza odpowiedź bywa wolna — model się budzi.`
      : zModelem
        ? 'Odpowiedzi pisze lokalny model, więc bywają wolniejsze niż gra.'
        : 'Ta wersja chodzi bez modelu, więc rozmowy nie ma — zostaje wymiana. Spacja przy postaci daje jej kwestie i zlecenia.',
  );

  odswiezHandel();
  if (zModelem) (korzen.querySelector('.ro-pole') as HTMLInputElement).focus();
}

export function zamknij(): void {
  otwarta = false;
  korzen?.classList.remove('widoczne');
}
