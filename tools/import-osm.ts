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
const BOK_METROW = 900;
const ROZMIAR = 96;

/** Kolejność ma znaczenie: późniejsze nadpisuje wcześniejsze. */
const LEGENDA = ['ziemia', 'trawa', 'las', 'bruk', 'rynek', 'kamienica', 'woda'] as const;
type Biom = (typeof LEGENDA)[number];
const nr = (b: Biom) => LEGENDA.indexOf(b);

interface Wezel { lat: number; lon: number }
interface Czlon { role?: string; geometry?: Wezel[] }
interface Element { type: string; tags?: Record<string, string>; geometry?: Wezel[]; members?: Czlon[] }

const M_NA_STOPIEN_LAT = 111_320;
const M_NA_STOPIEN_LON = 111_320 * Math.cos((SRODEK.lat * Math.PI) / 180);
const POL = BOK_METROW / 2;

/** Współrzędne geograficzne na ułamek siatki (0..ROZMIAR). */
function naSiatke(w: Wezel): { x: number; y: number } {
  const dx = (w.lon - SRODEK.lon) * M_NA_STOPIEN_LON;
  const dy = (SRODEK.lat - w.lat) * M_NA_STOPIEN_LAT;
  return { x: ((dx + POL) / BOK_METROW) * ROZMIAR, y: ((dy + POL) / BOK_METROW) * ROZMIAR };
}

const siatka = new Uint8Array(ROZMIAR * ROZMIAR).fill(nr('ziemia'));
const ustaw = (x: number, y: number, b: Biom) => {
  if (x < 0 || y < 0 || x >= ROZMIAR || y >= ROZMIAR) return;
  const i = y * ROZMIAR + x;
  if (nr(b) >= siatka[i]!) siatka[i] = nr(b);
};

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
  // Promienie w kaflach. Przy 8,5 m na kafel chodnik to ułamek kafla, więc wąskie drogi
  // dostają promień poniżej 0.5 — zaznaczą tylko kafel, przez który faktycznie biegną.
  if (t.highway === 'pedestrian' || t.place === 'square') return { biom: 'rynek', linia: 1.2 };
  if (t.highway && DROGI_SZEROKIE.has(t.highway)) return { biom: 'bruk', linia: 0.8 };
  if (t.highway && DROGI_WASKIE.has(t.highway)) return { biom: 'bruk', linia: 0.35 };
  if (t.natural === 'wood' || t.natural === 'tree_row' || t.landuse === 'forest') return { biom: 'las' };
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'pitch') return { biom: 'trawa' };
  if (t.historic === 'castle' || t.historic === 'citywalls' || t.barrier === 'city_wall') return { biom: 'kamienica' };
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green') return { biom: 'trawa' };
  if (t.natural === 'scrub' || t.natural === 'grassland') return { biom: 'trawa' };
  return null;
}

const zrodlo = process.argv[2];
if (!zrodlo) {
  console.error('podaj plik z odpowiedzią Overpass: tsx tools/import-osm.ts <plik.json>');
  process.exit(2);
}

const dane = JSON.parse(readFileSync(zrodlo, 'utf8')) as { elements: Element[] };
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
    for (const kontur of kontury) {
      if (czyDroga && !zamkniety(kontur)) linia(kontur, k.biom, k.linia!);
      else wielokat(kontur, k.biom);
    }
  }
}

// RLE: plik ma być czytelny w diffie i mały w repozytorium.
const rle: string[] = [];
let biezacy = siatka[0]!, licznik = 0;
for (const v of siatka) {
  if (v === biezacy) licznik++;
  else { rle.push(`${licznik}x${biezacy}`); biezacy = v; licznik = 1; }
}
rle.push(`${licznik}x${biezacy}`);

const wynik = {
  miejsce: 'Zamość, Stare Miasto',
  zrodlo: 'OpenStreetMap contributors, ODbL',
  pobrano: new Date().toISOString().slice(0, 10),
  srodek: [SRODEK.lat, SRODEK.lon],
  bokMetrow: BOK_METROW,
  rozmiar: ROZMIAR,
  legenda: [...LEGENDA],
  kafle: rle.join(' '),
};
writeFileSync(resolve(ROOT, 'game/content/mapa.json'), JSON.stringify(wynik, null, 2) + '\n', 'utf8');

const licz = new Map<string, number>();
for (const v of siatka) licz.set(LEGENDA[v]!, (licz.get(LEGENDA[v]!) ?? 0) + 1);
console.log(`zapisano game/content/mapa.json — ${rle.length} odcinków RLE, ${(JSON.stringify(wynik).length / 1024).toFixed(1)} kB`);
for (const [k, v] of [...licz].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)} kafli  ${((v / siatka.length) * 100).toFixed(1)}%`);
}

export {};
