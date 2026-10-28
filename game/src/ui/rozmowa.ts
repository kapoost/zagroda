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
}

type Zdarzenie =
  | { typ: 'czekaj'; tekst: string }
  | { typ: 'tekst'; tekst: string }
  | { typ: 'koniec'; daj: string | null }
  | { typ: 'blad'; tekst: string };

let korzen: HTMLDivElement | null = null;
let otwarta = false;
let biezaca: PostacDoRozmowy | null = null;
let naAkcje: ((npc: string, daj: string) => void) | null = null;
let dajStan: (() => string) | null = null;
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
  const stopka = el('div', 'ro-stopka');
  stopka.append(pole);
  okno.append(head, watek, stopka);
  tlo.append(okno);
  document.body.append(tlo);

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
    const odp = // Ścieżka względna, bo Vite proxuje /api do serwera pętli — to samo pochodzenie, zero CORS-u.
    await fetch('/api/rozmowa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postac: biezaca, tekst, stan: dajStan?.() ?? 'nic' }),
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
        } else if (z.typ === 'koniec' && z.daj && biezaca) {
          naAkcje?.(biezaca.id, z.daj);
          dopisz('ro-dar', `${biezaca.name} daje ci coś.`);
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

export function otworz(
  postac: PostacDoRozmowy,
  stan: () => string,
  akcja: (npc: string, daj: string) => void,
): void {
  korzen ??= zbuduj();
  biezaca = postac;
  dajStan = stan;
  naAkcje = akcja;
  otwarta = true;
  korzen.classList.add('widoczne');
  (korzen.querySelector('h2') as HTMLElement).textContent = postac.name;
  watekEl().replaceChildren();
  dopisz('ro-info', `Rozmawiasz z: ${postac.name}. Odpowiedzi pisze lokalny model, więc bywają wolniejsze niż gra.`);
  (korzen.querySelector('.ro-pole') as HTMLInputElement).focus();
}

export function zamknij(): void {
  otwarta = false;
  korzen?.classList.remove('widoczne');
}
