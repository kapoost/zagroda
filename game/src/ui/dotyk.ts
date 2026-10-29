/**
 * Sterowanie dotykiem.
 *
 * Warstwa nie zna gry: na dotknięcie wysyła ZDARZENIA KLAWIATURY, takie same, jakie
 * wysłałby klawisz. Dzięki temu jest jedna ścieżka wejścia, a nie druga do utrzymania —
 * ruch ciągły, przytrzymanie, rozmowa i pracownia działają tym samym kodem, co na
 * komputerze. Gdyby kciuk szedł osobną drogą, prędzej czy później zachowywałby się
 * inaczej niż klawisz i nikt by nie wiedział dlaczego.
 *
 * Pokazuje się tylko tam, gdzie jest czym dotykać (`pointer: coarse`), a do testów
 * da się ją wymusić adresem `?dotyk`.
 */

const KIERUNKI = [
  { kod: 'KeyW', znak: '↑', pole: 'gora' },
  { kod: 'KeyA', znak: '←', pole: 'lewo' },
  { kod: 'KeyD', znak: '→', pole: 'prawo' },
  { kod: 'KeyS', znak: '↓', pole: 'dol' },
] as const;

function klawisz(typ: 'keydown' | 'keyup', kod: string): void {
  window.dispatchEvent(new KeyboardEvent(typ, { code: kod, key: kod, bubbles: true }));
}

/**
 * Przycisk, który trzyma się wciśnięty. `setPointerCapture` jest tu konieczne:
 * bez niego zsunięcie kciuka poza przycisk gubi `pointerup` i postać idzie
 * w nieskończoność.
 */
function przycisk(klasa: string, napis: string, kod: string, trzymany: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = klasa;
  b.textContent = napis;
  b.type = 'button';

  let wcisniety = false;
  const wcisnij = (e: PointerEvent) => {
    e.preventDefault();
    if (wcisniety) return;
    wcisniety = true;
    b.setPointerCapture(e.pointerId);
    b.classList.add('wcisniety');
    klawisz('keydown', kod);
    if (!trzymany) klawisz('keyup', kod);
  };
  const pusc = () => {
    if (!wcisniety) return;
    wcisniety = false;
    b.classList.remove('wcisniety');
    if (trzymany) klawisz('keyup', kod);
  };

  b.addEventListener('pointerdown', wcisnij);
  b.addEventListener('pointerup', pusc);
  b.addEventListener('pointercancel', pusc);
  // Kontekstowe menu po długim przytrzymaniu przerywa grę w pół kroku.
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

export function wlaczDotyk(): void {
  const wymuszone = new URLSearchParams(location.search).has('dotyk');
  if (!wymuszone && !window.matchMedia('(pointer: coarse)').matches) return;

  const korzen = document.createElement('div');
  korzen.id = 'dotyk';

  const krzyz = document.createElement('div');
  krzyz.className = 'd-krzyz';
  for (const k of KIERUNKI) krzyz.append(przycisk(`d-kier d-${k.pole}`, k.znak, k.kod, true));

  const akcje = document.createElement('div');
  akcje.className = 'd-akcje';
  akcje.append(
    przycisk('d-mala', 'P', 'KeyP', false),
    przycisk('d-mala', 'T', 'KeyT', false),
    przycisk('d-duza', 'Użyj', 'Space', false),
  );

  korzen.append(krzyz, akcje);
  (document.getElementById('plansza') ?? document.body).append(korzen);

  // Panel boczny zajmuje na telefonie dolną część ekranu, a bywa zbędny w trakcie
  // biegania. Jeden przycisk go chowa — i to jedyne, co ta warstwa robi poza
  // udawaniem klawiatury.
  const zwin = document.createElement('button');
  zwin.id = 'zwin-panel';
  zwin.type = 'button';
  zwin.textContent = 'panel';
  zwin.addEventListener('click', () => document.body.classList.toggle('bez-panelu'));
  document.body.append(zwin);
}
