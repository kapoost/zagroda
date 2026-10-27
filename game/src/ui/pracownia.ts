/**
 * Pracownia — okno, w którym gracz opisuje, co ma się w grze zmienić.
 *
 * Panel nie wie nic o modelach ani o gicie: wysyła zdanie po polsku i pokazuje,
 * co z nim robi pętla. Cała wiedza o tym, jak zmiana powstaje, siedzi po stronie
 * serwera — tutaj zostaje to, co gracz ma zobaczyć.
 */

interface WynikBiegu {
  outcome: 'merged' | 'branch' | 'abandoned' | 'dry' | 'error';
  title?: string;
  branch?: string;
  changes: string[];
  note?: string;
}

type Zdarzenie =
  | { typ: 'log'; tekst: string }
  | { typ: 'koniec'; wynik: WynikBiegu }
  | { typ: 'blad'; tekst: string };

interface WpisHistorii {
  at: string;
  prompt: string;
  title: string | null;
  outcome: string;
  kind: string | null;
}

const PRZYKLADY = [
  'dodaj drewnianą fujarkę — NPC lubią, gdy im się zagra',
  'jagody powinny dawać mniej sił, bo są teraz za mocne',
  'postawione pochodnie niech się wypalają po kilku dniach',
];

const OPIS_WYNIKU: Record<WynikBiegu['outcome'], { etykieta: string; klasa: string }> = {
  merged: { etykieta: 'w grze', klasa: 'ok' },
  branch: { etykieta: 'czeka na Twoją akceptację', klasa: 'wait' },
  abandoned: { etykieta: 'odrzucone przez bramkę', klasa: 'bad' },
  dry: { etykieta: 'tylko podgląd', klasa: 'wait' },
  error: { etykieta: 'błąd', klasa: 'bad' },
};

let otwarte = false;
let zajety = false;
let korzen: HTMLElement | null = null;

export const pracowniaOtwarta = (): boolean => otwarte;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  klasa?: string,
  tekst?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (klasa) n.className = klasa;
  if (tekst !== undefined) n.textContent = tekst;
  return n;
}

function zbuduj(): HTMLElement {
  const tlo = el('div', 'pr-tlo');
  const okno = el('div', 'pr-okno');
  okno.setAttribute('role', 'dialog');
  okno.setAttribute('aria-label', 'Pracownia — zgłoś zmianę w grze');

  const head = el('header', 'pr-head');
  head.append(
    el('h2', undefined, 'Pracownia'),
    el('p', 'pr-dek', 'Opisz po polsku, co ma się zmienić. Bielik to sklasyfikuje, wprowadzi i przepuści przez bramkę.'),
  );

  const pole = el('textarea', 'pr-pole');
  pole.rows = 3;
  pole.placeholder = 'np. dodaj kamienny młot — wolniejszy od kilofa, ale wytrzymalszy';
  pole.setAttribute('aria-label', 'Opis zmiany');

  const chipy = el('div', 'pr-chipy');
  for (const p of PRZYKLADY) {
    const b = el('button', 'pr-chip', p);
    b.type = 'button';
    b.addEventListener('click', () => {
      pole.value = p;
      pole.focus();
    });
    chipy.append(b);
  }

  const wyslij = el('button', 'pr-wyslij', 'Wyślij do Bielika');
  wyslij.type = 'button';

  const stan = el('div', 'pr-stan');
  const log = el('ol', 'pr-log');
  const wynik = el('div', 'pr-wynik');
  stan.append(log, wynik);

  const histTyt = el('p', 'pr-podtytul', 'Ostatnie zgłoszenia');
  const hist = el('ul', 'pr-hist');

  const stopka = el('p', 'pr-stopka', 'Esc zamyka · zmiana w treści wchodzi sama, zmiana w kodzie czeka na Ciebie');

  okno.append(head, pole, chipy, wyslij, stan, histTyt, hist, stopka);
  tlo.append(okno);

  // ── działanie ────────────────────────────────────────────────────
  const dopiszLog = (tekst: string) => {
    log.append(el('li', undefined, tekst));
    log.scrollTop = log.scrollHeight;
  };

  const pokazWynik = (w: WynikBiegu) => {
    const opis = OPIS_WYNIKU[w.outcome];
    wynik.className = `pr-wynik widoczny ${opis.klasa}`;
    wynik.replaceChildren();
    wynik.append(el('p', 'pr-wynik-tyt', `${w.title ?? 'Zmiana'} — ${opis.etykieta}`));
    if (w.changes.length) {
      const ul = el('ul', 'pr-zmiany');
      for (const c of w.changes) ul.append(el('li', undefined, c));
      wynik.append(ul);
    }
    if (w.note) wynik.append(el('p', 'pr-nota', w.note));
    if (w.outcome === 'merged') {
      const b = el('button', 'pr-odswiez', 'Zagraj z nową treścią');
      b.type = 'button';
      b.addEventListener('click', () => location.reload());
      wynik.append(b);
    }
  };

  const sluchaj = (biegId: string) => {
    const es = new EventSource(`/api/strumien?id=${encodeURIComponent(biegId)}`);
    es.addEventListener('message', (ev) => {
      const z = JSON.parse((ev as MessageEvent<string>).data) as Zdarzenie;
      if (z.typ === 'log') dopiszLog(z.tekst);
      else if (z.typ === 'koniec') pokazWynik(z.wynik);
      else {
        wynik.className = 'pr-wynik widoczny bad';
        wynik.replaceChildren(el('p', 'pr-wynik-tyt', z.tekst));
      }
    });
    const koniec = () => {
      es.close();
      zajety = false;
      wyslij.disabled = false;
      wyslij.textContent = 'Wyślij do Bielika';
      void odswiezHistorie();
    };
    es.addEventListener('error', koniec);
  };

  wyslij.addEventListener('click', () => {
    const prompt = pole.value.trim();
    if (zajety || prompt.length < 8) return;
    zajety = true;
    wyslij.disabled = true;
    wyslij.textContent = 'Bielik pracuje…';
    log.replaceChildren();
    wynik.className = 'pr-wynik';
    dopiszLog('wysłano — pierwsza odpowiedź modelu potrafi zająć dwie minuty');

    void fetch('/api/zmiana', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
      .then(async (r) => ({ kod: r.status, dane: (await r.json()) as { biegId?: string; blad?: string } }))
      .then(({ kod, dane }) => {
        if (kod === 202 && dane.biegId) {
          sluchaj(dane.biegId);
          return;
        }
        dopiszLog(dane.blad ?? `serwer odpowiedział kodem ${kod}`);
        zajety = false;
        wyslij.disabled = false;
        wyslij.textContent = 'Wyślij do Bielika';
      })
      .catch(() => {
        dopiszLog('Nie ma kontaktu z pracownią. Uruchom ją: npm run pracownia');
        zajety = false;
        wyslij.disabled = false;
        wyslij.textContent = 'Wyślij do Bielika';
      });
  });

  const odswiezHistorie = async (): Promise<void> => {
    try {
      const r = await fetch('/api/stan');
      const d = (await r.json()) as { historia: WpisHistorii[] };
      hist.replaceChildren();
      if (!d.historia.length) {
        hist.append(el('li', 'pr-pusto', 'jeszcze nic — zacznij od przykładu powyżej'));
        return;
      }
      for (const w of d.historia) {
        const li = el('li');
        const opis = OPIS_WYNIKU[w.outcome as WynikBiegu['outcome']];
        li.append(
          el('span', `pr-znacznik ${opis?.klasa ?? 'bad'}`, opis?.etykieta ?? w.outcome),
          el('span', 'pr-hist-tekst', w.title ?? w.prompt),
        );
        hist.append(li);
      }
    } catch {
      hist.replaceChildren(el('li', 'pr-pusto', 'pracownia nie odpowiada — npm run pracownia'));
    }
  };

  tlo.addEventListener('click', (e) => {
    if (e.target === tlo) zamknij();
  });
  void odswiezHistorie();
  queueMicrotask(() => pole.focus());
  return tlo;
}

export function otworz(): void {
  if (otwarte) return;
  otwarte = true;
  korzen = zbuduj();
  document.body.append(korzen);
}

export function zamknij(): void {
  if (!otwarte) return;
  otwarte = false;
  korzen?.remove();
  korzen = null;
}

export function przelacz(): void {
  otwarte ? zamknij() : otworz();
}
