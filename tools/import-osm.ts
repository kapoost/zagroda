import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Import mapy z OpenStreetMap do siatki kafli.
 *
 * Świat nie jest wymyślany ani losowany, tylko importowany: kształt Starego Miasta
 * w Zamościu daje plan, którego żaden szum nie wygeneruje — pięciokąt bastionów,
 * trzy rynki, siatka uliczek Morandiego.
 *
 * Importer uruchamia się RĘCZNIE i raz. Do repozytorium trafia wyłącznie wynik —
 * siatka 96×96 spakowana RLE — więc gra nie zależy od sieci, a bramka dalej liczy
 * ten sam hash stanu co wczoraj.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Kadr obejmuje Stare Miasto i Zalew Zamojski — bez zalewu w tym fragmencie OSM nie ma
 * ani jednego kafla wody, a wtedy łowisko i trzcina nie miałyby gdzie rosnąć. Woda jest
 * tu prawdziwa, nie dorysowana.
 */
const SRODEK = { lat: 50.7181, lon: 23.2519 };
const BOK_METROW = 768;
/**
 * 3 metry na kafel — skala Pokémona.
 *
 * Pokémon nie udaje realnych proporcji i w tym jest jego sztuczka: świat jest
 * ściśnięty WZGLĘDEM postaci. Kamienica ma pięć kafli szerokości, człowiek jeden,
 * więc dom jest pięć razy szerszy od gracza zamiast dziesięciu. Dzięki temu w kadrze
 * mieści się ulica z obiema pierzejami, a nie pół elewacji.
 */
const ROZMIAR = 256;

/** Kolejność ma znaczenie: późniejsze nadpisuje wcześniejsze. */
const LEGENDA = ['trawa', 'ziemia', 'las', 'bruk', 'rynek', 'kamienica', 'woda'] as const;
type Biom = (typeof LEGENDA)[number];
const nr = (b: Biom) => LEGENDA.indexOf(b);

interface Wezel { lat: number; lon: number }
interface Czlon { role?: string; geometry?: Wezel[] }
interface Element { type: string; tags?: Record<string, string>; geometry?: Wezel[]; members?: Czlon[] }

const M_NA_STOPIEN_LAT = 111_320;
const M_NA_STOPIEN_LON = 111_320 * Math.cos((SRODEK.lat * Math.PI) / 180);
const POL = BOK_METROW / 2;
/** Zasięg pomiaru kąta: pięciokąt bastionów ma około 600 m w poprzek. */
const PROMIEN_POMIARU = 300;

/**
 * Kąt, o jaki obrócona jest siatka miasta względem północy.
 *
 * Zamość nie leży równo w osi północ–południe, a kafle owszem. Bez obrotu prosta pod
 * kątem kilkunastu stopni rasteryzuje się na piłę i żadne rysowanie tego nie naprawi.
 * Kąt nie jest zgadywany, tylko liczony z mapy: bierzemy krawędzie, sprowadzamy je
 * modulo 90° (kierunek i prostopadły to ten sam kierunek) i ważymy długością.
 *
 * Liczymy go z OSI ULIC, nie ze ścian budynków. Ulica jest tym, po czym gracz chodzi:
 * gdy biegnie skosem, rasteryzuje się na schodki i chodnik raz ma dwa kafle, raz jeden,
 * a gracz co chwilę zahacza o róg. Ściany to tylko tło — a w mieście idealnym i tak
 * stoją prostopadle do ulic, więc prostując jedno, prostujemy oba.
 */
function katMiasta(elementy: Element[], co: 'ulice' | 'budynki'): number {
  const kubelki = new Array<number>(900).fill(0); // co 0,1°
  for (const e of elementy) {
    const pasuje = co === 'ulice' ? Boolean(e.tags?.highway) : Boolean(e.tags?.building);
    if (!pasuje || !e.geometry) continue;
    const g = e.geometry;
    for (let i = 1; i < g.length; i++) {
      const dx = (g[i]!.lon - g[i - 1]!.lon) * M_NA_STOPIEN_LON;
      const dy = (SRODEK.lat - g[i]!.lat - (SRODEK.lat - g[i - 1]!.lat)) * M_NA_STOPIEN_LAT;
      const dl = Math.hypot(dx, dy);
      if (dl < 2) continue;
      // Tylko Stare Miasto. Przedmieścia mają własną siatkę i gdyby weszły do pomiaru,
      // przeważyłyby liczbą — a gra toczy się w pięciokącie, nie przy obwodnicy.
      const sx = (g[i]!.lon - SRODEK.lon) * M_NA_STOPIEN_LON;
      const sy = (SRODEK.lat - g[i]!.lat) * M_NA_STOPIEN_LAT;
      if (Math.hypot(sx, sy) > PROMIEN_POMIARU) continue;
      const stopnie = (((Math.atan2(dy, dx) * 180) / Math.PI) % 90 + 90) % 90;
      const k = Math.round(stopnie * 10) % 900;
      kubelki[k] = kubelki[k]! + dl;
    }
  }
  let szczyt = 0;
  for (let i = 1; i < kubelki.length; i++) if (kubelki[i]! > kubelki[szczyt]!) szczyt = i;
  // Dociągnięcie do środka ciężkości szczytu, żeby nie zostać na krawędzi kubełka.
  let suma = 0, waga = 0;
  for (let d = -20; d <= 20; d++) {
    const i = (szczyt + d + 900) % 900;
    suma += kubelki[i]! * (szczyt + d);
    waga += kubelki[i]!;
  }
  return waga ? (suma / waga) / 10 : 0;
}

let OBROT = 0;

/** Współrzędne geograficzne na ułamek siatki (0..ROZMIAR), już w osiach miasta. */
function naSiatke(w: Wezel): { x: number; y: number } {
  const dx = (w.lon - SRODEK.lon) * M_NA_STOPIEN_LON;
  const dy = (SRODEK.lat - w.lat) * M_NA_STOPIEN_LAT;
  const c = Math.cos(-OBROT), s = Math.sin(-OBROT);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  return { x: ((rx + POL) / BOK_METROW) * ROZMIAR, y: ((ry + POL) / BOK_METROW) * ROZMIAR };
}

/**
 * Tło to trawa, nie goła ziemia. Przy półtora metra na kafel widać grunt pod nogami
 * przez cały czas gry, a wokół zamojskich wałów rosną planty, nie klepisko. Ziemia
 * zostaje tym, czym jest naprawdę — polem i ugorem, tam gdzie OSM je oznacza.
 */
const siatka = new Uint8Array(ROZMIAR * ROZMIAR).fill(nr('trawa'));
/**
 * Odcień dachu per kafel, 0 = brak budynku.
 *
 * Bez tego sąsiadujące kamienice zlewają się w jedną brązową bryłę, bo przy trzech
 * metrach na kafel dzielą ścianę. Zamojski Rynek żyje właśnie z tego, że widać
 * pojedyncze pierzeje — więc każdy budynek dostaje własny odcień i własną krawędź.
 */
const odcienie = new Uint8Array(ROZMIAR * ROZMIAR);
const ODCIENI = 8;
let licznikBudynkow = 0;
const ustaw = (x: number, y: number, b: Biom) => {
  if (x < 0 || y < 0 || x >= ROZMIAR || y >= ROZMIAR) return;
  const i = y * ROZMIAR + x;
  if (nr(b) >= siatka[i]!) siatka[i] = nr(b);
};

/**
 * Zachłanne kolorowanie grafu: budynek bierze pierwszy odcień, którego nie ma żaden
 * sąsiad — także po skosie. Dzięki temu „inny odcień" w rendererze znaczy naprawdę
 * „inny budynek", więc krawędź da się postawić tam, gdzie kamienice dzielą ścianę.
 * Ośmiu odcieni starcza, bo kamienica styka się najwyżej z kilkoma naraz.
 */
function pomaluj(kafle: number[]): void {
  const zajete = new Set<number>();
  for (const i of kafle) {
    const x = i % ROZMIAR, y = (i / ROZMIAR) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ROZMIAR || ny >= ROZMIAR) continue;
        const o = odcienie[ny * ROZMIAR + nx]!;
        if (o) zajete.add(o);
      }
    }
  }
  const start = licznikBudynkow++ % ODCIENI;
  let odcien = start + 1;
  for (let k = 0; k < ODCIENI; k++) {
    const kandydat = ((start + k) % ODCIENI) + 1;
    if (!zajete.has(kandydat)) { odcien = kandydat; break; }
  }
  for (const i of kafle) odcienie[i] = odcien;
}

/**
 * Budynek jako prostokąt wpisany w siatkę.
 *
 * Obrys z OSM ma skosy, wykusze i przybudówki — przy trzech metrach na kafel każdy
 * taki detal zamienia się w jeden odstający piksel. W Pokémonie dom jest pudełkiem
 * i tak go tu stawiamy: bierzemy prostokąt opisany na obrysie, zaokrąglamy do kafli
 * i wypełniamy. Kafle zajęte przez wcześniejszy budynek zostają jego — dzięki temu
 * sąsiednie kamienice nie zlewają się mimo wspólnych granic.
 *
 * Co mniejsze niż 2×2 kafle, czyli 36 m², odpada. To szopy, garaże i śmietniki —
 * w tej skali byłyby plamką wielkości gracza.
 */
function budynek(kontury: Wezel[][]): number[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const kontur of kontury) {
    for (const w of kontur) {
      const q = naSiatke(w);
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
  }
  const x0 = Math.round(minX), x1 = Math.round(maxX);
  const y0 = Math.round(minY), y1 = Math.round(maxY);
  if (x1 - x0 < 2 || y1 - y0 < 2) return [];
  const kafle: number[] = [];
  for (let y = Math.max(0, y0); y < Math.min(ROZMIAR, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(ROZMIAR, x1); x++) {
      const i = y * ROZMIAR + x;
      if (odcienie[i]) continue; // cudzy budynek — nie zabieramy
      siatka[i] = nr('kamienica');
      kafle.push(i);
    }
  }
  return kafle;
}

function wielokat(geo: Wezel[], b: Biom): void {
  const p = geo.map(naSiatke);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of p) {
    minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
    minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(ROZMIAR - 1, Math.ceil(maxY)); y++) {
    for (let x = Math.max(0, Math.floor(minX)); x <= Math.min(ROZMIAR - 1, Math.ceil(maxX)); x++) {
      const px = x + 0.5, py = y + 0.5;
      let w = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const a = p[i]!, c = p[j]!;
        if (a.y > py !== c.y > py && px < ((c.x - a.x) * (py - a.y)) / (c.y - a.y) + a.x) w = !w;
      }
      if (w) ustaw(x, y, b);
    }
  }
}

function linia(geo: Wezel[], b: Biom, promien: number): void {
  const p = geo.map(naSiatke);
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!, c = p[i]!;
    const kroki = Math.max(2, Math.ceil(Math.hypot(c.x - a.x, c.y - a.y) * 3));
    for (let k = 0; k <= kroki; k++) {
      const t = k / kroki;
      const cx = a.x + (c.x - a.x) * t;
      const cy = a.y + (c.y - a.y) * t;
      const r = Math.ceil(promien);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.hypot(dx, dy) <= promien) ustaw(Math.floor(cx) + dx, Math.floor(cy) + dy, b);
        }
      }
    }
  }
}

const DROGI_SZEROKIE = new Set(['secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service']);
const DROGI_WASKIE = new Set(['footway', 'path', 'steps', 'track', 'cycleway']);

function klasyfikuj(t: Record<string, string>): { biom: Biom; linia?: number } | null {
  if (t.building) return { biom: 'kamienica' };
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'moat') return { biom: 'woda' };
  // Promienie w kaflach, przy 3 m na kafel. Ulica wychodzi na dwa kafle, czyli sześć
  // metrów — tyle, żeby gracz zawsze miał czym iść i żeby chodnik nie rwał się na pół kafla.
  if (t.highway === 'pedestrian' || t.place === 'square') return { biom: 'rynek', linia: 1.2 };
  if (t.highway && DROGI_SZEROKIE.has(t.highway)) return { biom: 'bruk', linia: 0.9 };
  if (t.highway && DROGI_WASKIE.has(t.highway)) return { biom: 'bruk', linia: 0.5 };
  if (t.natural === 'wood' || t.natural === 'tree_row' || t.landuse === 'forest') return { biom: 'las' };
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'pitch') return { biom: 'trawa' };
  if (t.historic === 'castle' || t.historic === 'citywalls' || t.barrier === 'city_wall') return { biom: 'kamienica' };
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green') return { biom: 'trawa' };
  if (t.natural === 'scrub' || t.natural === 'grassland') return { biom: 'trawa' };
  // Pole, ugór i piach — stąd bierze się ruda darniowa i kamień polny.
  if (t.landuse === 'farmland' || t.landuse === 'farmyard' || t.landuse === 'allotments') return { biom: 'ziemia' };
  if (t.landuse === 'orchard' || t.landuse === 'vineyard' || t.landuse === 'greenhouse_horticulture') return { biom: 'ziemia' };
  if (t.landuse === 'brownfield' || t.landuse === 'landfill' || t.landuse === 'quarry') return { biom: 'ziemia' };
  if (t.natural === 'sand' || t.natural === 'bare_rock' || t.natural === 'beach') return { biom: 'ziemia' };
  return null;
}

const zrodlo = process.argv[2];
if (!zrodlo) {
  console.error('podaj plik z odpowiedzią Overpass: tsx tools/import-osm.ts <plik.json>');
  process.exit(2);
}

const dane = JSON.parse(readFileSync(zrodlo, 'utf8')) as { elements: Element[] };
const katStopnie = katMiasta(dane.elements, 'ulice');
const katScian = katMiasta(dane.elements, 'budynki');
OBROT = (katStopnie * Math.PI) / 180;
console.log(
  `siatka obrócona o ${katStopnie.toFixed(2)}° wg osi ulic ` +
  `(ściany budynków wypadają na ${katScian.toFixed(2)}°, rozjazd ${Math.abs(katStopnie - katScian).toFixed(2)}°)`,
);
const zamkniety = (g: Wezel[]) =>
  g.length > 3 && Math.abs(g[0]!.lat - g[g.length - 1]!.lat) < 1e-9 && Math.abs(g[0]!.lon - g[g.length - 1]!.lon) < 1e-9;

// Dwa przebiegi, bo kolejność legendy decyduje o nadpisywaniu: najpierw powierzchnie,
// potem drogi, na końcu budynki.
/**
 * Duże akweny i lasy bywają w OSM relacjami wielobokowymi, a nie ścieżkami — Zalew
 * Zamojski właśnie taki jest. Overpass zwraca ich geometrię w członach, więc relacja
 * rozkłada się na pierścienie zewnętrzne.
 */
function obrysy(e: Element): Wezel[][] {
  if (e.geometry) return [e.geometry];
  if (!e.members) return [];
  return e.members
    .filter((m) => m.geometry && m.geometry.length > 2 && (m.role === 'outer' || !m.role))
    .map((m) => m.geometry!);
}

for (const faza of [0, 1, 2]) {
  for (const e of dane.elements) {
    if (!e.tags) continue;
    const kontury = obrysy(e);
    if (!kontury.length) continue;
    const k = klasyfikuj(e.tags);
    if (!k) continue;
    const czyDroga = k.linia !== undefined;
    const czyBudynek = k.biom === 'kamienica';
    if (faza === 0 && (czyDroga || czyBudynek)) continue;
    if (faza === 1 && !czyDroga) continue;
    if (faza === 2 && !czyBudynek) continue;
    if (czyBudynek) {
      const kafle = budynek(kontury);
      if (kafle.length) pomaluj(kafle);
      continue;
    }
    for (const kontur of kontury) {
      if (czyDroga && !zamkniety(kontur)) linia(kontur, k.biom, k.linia!);
      else wielokat(kontur, k.biom);
    }
  }
}

/**
 * Brzeg: pas podmokłej ziemi wokół wody.
 *
 * Bez niego ziemia znika z mapy całkowicie — Zamość jest zielony, a OSM nie oznacza
 * tu pól. A ziemia musi być, bo z niej bierze się ruda darniowa, która z definicji
 * leży w podmokłym gruncie. Brzeg robi więc dwie rzeczy naraz: domyka łańcuch
 * wytwarzania i rysuje plażę tam, gdzie trawa dotykałaby wody na styk.
 */
const BRZEG = 3;
{
  const woda = nr('woda'), trawa = nr('trawa'), ziemia = nr('ziemia');
  const kopia = siatka.slice();
  for (let y = 0; y < ROZMIAR; y++) {
    for (let x = 0; x < ROZMIAR; x++) {
      if (kopia[y * ROZMIAR + x] !== woda) continue;
      for (let dy = -BRZEG; dy <= BRZEG; dy++) {
        for (let dx = -BRZEG; dx <= BRZEG; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= ROZMIAR || ny >= ROZMIAR) continue;
          if (Math.hypot(dx, dy) > BRZEG) continue;
          const i = ny * ROZMIAR + nx;
          if (siatka[i] === trawa) siatka[i] = ziemia;
        }
      }
    }
  }
}

// RLE: plik ma być czytelny w diffie i mały w repozytorium.
function spakuj(dane: Uint8Array): string {
  const out: string[] = [];
  let biezacy = dane[0]!;
  let licznik = 0;
  for (const v of dane) {
    if (v === biezacy) licznik++;
    else { out.push(`${licznik}x${biezacy}`); biezacy = v; licznik = 1; }
  }
  out.push(`${licznik}x${biezacy}`);
  return out.join(' ');
}
const rle = spakuj(siatka).split(' ');

const wynik = {
  miejsce: 'Zamość, Stare Miasto',
  zrodlo: 'OpenStreetMap contributors, ODbL',
  pobrano: new Date().toISOString().slice(0, 10),
  srodek: [SRODEK.lat, SRODEK.lon],
  bokMetrow: BOK_METROW,
  obrotStopnie: Number(katStopnie.toFixed(3)),
  rozmiar: ROZMIAR,
  legenda: [...LEGENDA],
  kafle: rle.join(' '),
  odcieni: ODCIENI,
  dachy: spakuj(odcienie),
};
writeFileSync(resolve(ROOT, 'game/content/mapa.json'), JSON.stringify(wynik, null, 2) + '\n', 'utf8');

const licz = new Map<string, number>();
for (const v of siatka) licz.set(LEGENDA[v]!, (licz.get(LEGENDA[v]!) ?? 0) + 1);
console.log(`zapisano game/content/mapa.json — ${rle.length} odcinków RLE, ${licznikBudynkow} budynków, ${(JSON.stringify(wynik).length / 1024).toFixed(1)} kB`);
for (const [k, v] of [...licz].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)} kafli  ${((v / siatka.length) * 100).toFixed(1)}%`);
}

export {};
