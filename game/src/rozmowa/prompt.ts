import type { Content } from '../content/schema.js';

/**
 * Prompty rozmowy — jedno źródło dla trzech miejsc, które ich używają.
 *
 * Blok świata składa się tu raz i czytają go: generator modelu Ollamy
 * (`tools/npc-model.ts`), serwer pętli (`agent/src/rozmowa.ts`) i sama gra, gdy
 * rozmawia z Ollamą gracza bez żadnego serwera pośrodku. Każda kopia tego kodu
 * prędzej czy później pokazałaby co innego, niż model naprawdę dostaje — a wtedy
 * cały podgląd promptu przestaje być narzędziem diagnozy.
 *
 * Plik nie dotyka systemu plików ani sieci, więc działa tak samo w Node i w
 * przeglądarce. To nie jest przypadek, tylko warunek: inaczej gracz z własnym
 * modelem dostałby inną grę niż ty.
 */

export interface Postac {
  id: string;
  name: string;
  gives: string[];
  opis?: string;
  wiedza?: string[];
}

export interface Oferta {
  daj: string;
  za: string;
  ile: number;
  darNazwa: string;
  zaNazwa: string;
}

export interface Okolica {
  nazwa: string;
  metrow: number;
  kierunek: string;
}

export interface TuraRozmowy {
  rola: 'gracz' | 'postac';
  tekst: string;
}

export type Wiadomosc = { role: string; content: string };

export const kluczOferty = (o: Oferta) => `${o.daj}|${o.za}`;

/**
 * Blok stały: świat, zasady rozmowy i CAŁA prawda o wytwarzaniu.
 *
 * Bez receptur w prompcie model wymyśla krzemień, miech i długie szlifowanie —
 * brzmi wiarygodnie i jest nieprawdą. Z nimi podaje składniki co do sztuki.
 */
export function blokSwiata(lore: string, c: Pick<Content, 'items' | 'recipes' | 'resources'>): string {
  const nazwa = (id: string) => c.items.find((i) => i.id === id)?.name ?? id;
  return [
    lore.trim(),
    '',
    'Jestes jedna z postaci gry "Zagroda" i rozmawiasz z graczem. Zasady rozmowy:',
    '',
    '- Odpowiadasz JEDNYM albo DWOMA zdaniami. Nigdy dluzej.',
    '- Mowisz po polsku, w pierwszej osobie, tonem swojej postaci.',
    '- Nie wychodzisz z roli, nie opisujesz siebie z zewnatrz, nie piszesz didaskaliow.',
    '- Nie wymyslasz niczego, czego nie ma ponizej. Gdy nie wiesz, mowisz wprost, ze nie wiesz.',
    '- Nie obiecujesz graczowi rzeczy, ktorych nie ma na Twojej liscie darow.',
    '',
    'RECEPTURY - to sa WSZYSTKIE sposoby wytwarzania, jakie w tej grze istnieja:',
    ...c.recipes.map(
      (r) => `  ${nazwa(r.output.item)} (przy: ${r.station}) = ${r.inputs.map((i) => `${i.qty}x ${nazwa(i.item)}`).join(' + ')}`,
    ),
    '',
    'SKAD BIORA SIE SUROWCE:',
    ...c.resources.map(
      (r) =>
        `  ${r.name} - rosnie na: ${r.biomes.join(', ')}; zbierasz: ${r.tool === 'hand' ? 'reka' : r.tool};` +
        ` daje: ${r.drops.map((d) => nazwa(d.item)).join(', ')}`,
    ),
  ].join('\n');
}

/**
 * Blok zmienny. Kolejność nie jest kosmetyką, tylko wydajnością i skutecznością.
 *
 * Prefiks musi ROSNĄĆ, a nie przebudowywać się: rola postaci i jej wiedza są stałe
 * przez całą rozmowę, więc idą na początek i trafiają w cache. Cennik i okolica
 * zależą od plecaka i pozycji, więc idą na sam koniec — a przy okazji ostatnie
 * miejsce przed generowaniem jest najmocniejsze. Gdy cennik stał na początku,
 * Bartek wyceniał rybę na „pięć gałęzi albo osiem kamieni": piątkę brał z cennika,
 * ósemkę ze stanu plecaka gracza.
 */
export function wiadomosci(
  postac: Postac,
  stanGracza: string,
  historia: TuraRozmowy[],
  odGracza: string,
  oferty: Oferta[],
  okolica: Okolica[],
): Wiadomosc[] {
  const dary = postac.gives.length
    ? `Mozesz dac graczowi wylacznie: ${postac.gives.join(', ')}. Nic poza tym.`
    : 'Nie handlujesz — gdy gracz poprosi o przedmiot, odmow krotko.';

  const ktoTy = [`Jestes: ${postac.name}.`, postac.opis ?? '', dary].filter(Boolean).join(' ');

  // "Wiedza" to zdania z treści gry i model ma ich UŻYWAĆ, a nie uzupełniać. Zapytany
  // wprost o kamienice Rynku Wielkiego wymienił tę samą "Pod Małpą" dwa razy jako dwa
  // różne domy i połączył prawdziwą Kamienicę Wilczkowską z prawdziwą Pod Aniołem
  // w jeden budynek. Wie, jak to brzmi; nie wie, jak było.
  const coWiesz = postac.wiedza?.length
    ? [
        '',
        'CO WIESZ O OKOLICY — mow z tego i NICZEGO poza tym nie dopowiadaj:',
        ...postac.wiedza.map((w) => `  ${w}`),
        'Gdy gracz pyta o cos spoza tej listy, mow wprost, ze nie wiesz.',
        'O budynkach podawaj NAZWE i KIERUNEK, nic wiecej. Nie opisuj ich wygladu,',
        'koloru ani ulicy — tego nie wiesz, a zmyslone szczegoly brzmia tak samo jak prawda.',
      ]
    : [];

  const cennik = oferty.length
    ? [
        'CENNIK (policzony, nie do negocjacji — podawaj dokladnie te liczby):',
        ...oferty.map((o) => `  ${o.darNazwa} = ${o.ile}x ${o.zaNazwa}`),
      ]
    : ['[gracz nie ma teraz czym zaplacic — nie oddawaj mu nic, ale nie recytuj tego zdania]'];

  // Lista jest ZAMKNIĘTA i trzeba to powiedzieć wprost. Sama lista nie wystarczyła:
  // model wymieniał z niej poprawne nazwy, a między nie wplatał studnie, wieże
  // i pomniki, których w grze nie ma. Brak czegoś na liście nie jest dla modelu
  // informacją, dopóki się tego nie napisze.
  const wokol = okolica.length
    ? [
        'W zasiegu wzroku stoi DOKLADNIE TO i nic wiecej:',
        ...okolica.map((m) => `  ${m.nazwa} — ${m.metrow} m na ${m.kierunek}`),
        'Nie dodawaj zadnych innych obiektow: ani studni, ani wiez, ani pomnikow.',
        'Czego nie ma na tej liscie, tego tu nie ma.',
      ]
    : ['[w zasiegu wzroku nie ma nic nazwanego — nie wymyslaj budowli]'];

  return [
    { role: 'user', content: [ktoTy, ...coWiesz].join('\n') },
    { role: 'assistant', content: 'Rozumiem. Jestem soba i mowie krotko.' },
    ...historia.map((t) => ({ role: t.rola === 'gracz' ? 'user' : 'assistant', content: t.tekst })),
    {
      role: 'user',
      content: [...wokol, '', ...cennik, '', `[gracz ma: ${stanGracza}]`, odGracza].join('\n'),
    },
  ];
}

/**
 * Krok 1 decyzji: pytanie dwustanowe, BEZ żadnej nazwy przedmiotu w treści.
 *
 * Gramatyka zawężona do listy ofert kusi wybraniem czegokolwiek z niej — na pytanie
 * „Masz konia na sprzedaż?" postać odpowiadała, że konia nie ma, a decyzja i tak
 * padała na sznurek. Pytanie tak/nie tej pokusy nie ma.
 */
export const PYTANIE_CZY = [
  '[pytanie spoza rozmowy, odpowiadasz jako Ty sama]',
  'Czy w swojej ostatniej wypowiedzi dochodzi do wymiany TU I TERAZ:',
  'gracz oddaje Ci zaplate, a Ty oddajesz mu przedmiot?',
  'Sama propozycja, warunek, odmowa albo wyliczenie cen to NIE jest wymiana.',
  'Odpowiedz: tak albo nie.',
].join('\n');

/** Krok 2: dopiero teraz pada lista — i są na niej wyłącznie wymiany policzone przez silnik. */
export function pytanieKtora(oferty: Oferta[]): string {
  return [
    '[pytanie spoza rozmowy]',
    'Ktora dokladnie wymiana doszla do skutku? Odpowiedz samym identyfikatorem.',
    ...oferty.map((o) => `- ${kluczOferty(o)} = ${o.darNazwa} za ${o.ile}x ${o.zaNazwa}`),
  ].join('\n');
}
