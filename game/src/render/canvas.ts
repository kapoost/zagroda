import type { Registry } from '../content/registry.js';
import { entityAt, idx, timeOfDay } from '../core/tick.js';
import type { State } from '../core/types.js';

/**
 * Rysowanie świata w proporcjach Pokémona.
 *
 * Kafel to trzy metry, ale człowiek i tak zajmuje cały kafel — i na tym polega cała
 * sztuczka. Pokémon nie udaje realnych proporcji: ściska świat WZGLĘDEM postaci, żeby
 * w kadrze zmieściła się ulica z obiema pierzejami, a nie pół elewacji.
 *
 *   człowiek   1 kafel      drzewo     1,5 kafla
 *   ulica      2 kafle      kamienica  4–6 kafli
 *
 * Dwie rzeczy decydują o tym, czy obraz czyta się jako świat, a nie jako mapa:
 *
 * 1. **Równe przejścia.** Teren nie jest szachownicą kwadratów, tylko warstwami,
 *    z których każda ma zaokrąglony obrys. Trawa leży na ziemi, bruk na trawie,
 *    woda wprost na ziemi — dlatego brzeg jeziora sam z siebie robi piaszczysty
 *    pas, a krawędź placu obchodzi róg łagodnym łukiem.
 * 2. **Kamienica to budynek, nie plama.** Dwa ostatnie rzędy od południa to nie
 *    dach, tylko elewacja: tynk, okna i zamojskie podcienia. Dach ma okap,
 *    a pod budynkiem leży cień.
 */

export const TILE = 32;

const ZABUDOWA = 'kamienica';

/**
 * Najwięcej rzędów od południa, jakie mogą być ścianą. Płytki budynek dostaje mniej,
 * bo dom bez ani jednego rzędu dachu przestaje być domem.
 */
const SCIANA = 2;

/** Dachy — ceramika w ośmiu odcieniach, żeby sąsiednie pierzeje dało się rozróżnić. */
const DACHY = ['#b0573c', '#9c4a38', '#bb6a45', '#8e4b3b', '#a95f42', '#c07650', '#95543f', '#b3634a'];
/** Tynki, w parze z dachami. Zamojski Rynek jest kolorowy i tego się trzymamy. */
const TYNKI = ['#e9d7ab', '#e6bda4', '#dcd6c2', '#cfdac9', '#ead0bb', '#dcc7d4', '#f0e5c9', '#cfd8de'];

/**
 * Co na czym leży. To jedyne miejsce, w którym zapisane są przejścia terenu —
 * warstwa rysuje się na wszystkim, co z niej wyrasta, więc jej obrys jest ciągły
 * i zaokrąglony sam z siebie, bez tablicy wariantów kafla.
 */
const RODZIC: Record<string, string | null> = {
  ziemia: null,
  trawa: 'ziemia',
  las: 'trawa',
  bruk: 'trawa',
  rynek: 'bruk',
  kamienica: 'bruk',
  woda: 'ziemia',
};
/** Kolejność malowania. Kamienicy tu nie ma — budynki rysuje osobny przebieg. */
const WARSTWY = ['ziemia', 'trawa', 'las', 'bruk', 'rynek', 'woda'];
/** Warstwy, które dostają spoiny kostki. */
const BRUKOWANE = new Set(['bruk', 'rynek']);

/** Wysokość surowca w kaflach — w tej skali drzewo jest półtora raza wyższe od gracza. */
const WYSOKOSC: Record<string, number> = {
  drzewo: 1.5,
  zloze_zelaza: 0.8,
  kamien_polny: 0.55,
  krzak: 0.8,
  trzcina: 1,
  trawa_wysoka: 0.75,
  lowisko: 1,
  len: 0.65,
};
const DOMYSLNA = 0.75;

function nightAlpha(t: number): number {
  const night = Math.cos(t * Math.PI * 2) * 0.5 + 0.5;
  // Noc ma być nastrojowa, nie nieprzejrzysta — przy pełnej ciemności nie dałoby się grać.
  return Math.min(0.42, Math.pow(night, 1.6) * 0.48);
}

function przyciemnij(hex: string, ile: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - ile))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/**
 * Obrys kafla warstwy: narożnik zaokrąglamy tylko tam, gdzie warstwa naprawdę się
 * kończy w obie strony. Sąsiedzi domykają resztę, więc z pojedynczych kafli składa
 * się jeden gładki kształt.
 */
function ksztalt(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  n: boolean, s: boolean, e: boolean, w: boolean,
  r: number,
): void {
  const T = TILE;
  const nw = !n && !w ? r : 0;
  const ne = !n && !e ? r : 0;
  const se = !s && !e ? r : 0;
  const sw = !s && !w ? r : 0;
  ctx.beginPath();
  ctx.moveTo(px + nw, py);
  ctx.lineTo(px + T - ne, py);
  if (ne) ctx.arcTo(px + T, py, px + T, py + ne, ne); else ctx.lineTo(px + T, py);
  ctx.lineTo(px + T, py + T - se);
  if (se) ctx.arcTo(px + T, py + T, px + T - se, py + T, se); else ctx.lineTo(px + T, py + T);
  ctx.lineTo(px + sw, py + T);
  if (sw) ctx.arcTo(px, py + T, px, py + T - sw, sw); else ctx.lineTo(px, py + T);
  ctx.lineTo(px, py + nw);
  if (nw) ctx.arcTo(px, py, px + nw, py, nw); else ctx.lineTo(px, py);
  ctx.closePath();
}

export function draw(ctx: CanvasRenderingContext2D, state: State, reg: Registry): void {
  const { width, height } = ctx.canvas;
  const cols = Math.ceil(width / TILE) + 2;
  const rows = Math.ceil(height / TILE) + 2;
  const camX = state.player.x - Math.floor(cols / 2);
  const camY = state.player.y - Math.floor(rows / 2);

  const poza = (x: number, y: number) => x < 0 || y < 0 || x >= state.size || y >= state.size;
  const biomAt = (x: number, y: number) =>
    poza(x, y) ? null : reg.content.biomes[state.biome[idx(state, x, y)]!]!;

  // Dla każdego biomu: zbiór warstw, na których leży. Liczone raz na klatkę.
  const warstwyBiomu = reg.content.biomes.map((b) => {
    const zbior = new Set<string>();
    let id: string | null | undefined = b.id;
    while (id) { zbior.add(id); id = RODZIC[id] ?? null; }
    return zbior;
  });
  const naWarstwie = (x: number, y: number, w: string) => {
    if (poza(x, y)) return false;
    return warstwyBiomu[state.biome[idx(state, x, y)]!]!.has(w);
  };

  const zabudowa = (x: number, y: number) => biomAt(x, y)?.id === ZABUDOWA;
  const dach = (x: number, y: number) => (poza(x, y) ? 0 : state.dachy[idx(state, x, y)]!);
  const ton = (x: number, y: number) => (dach(x, y) - 1 + DACHY.length) % DACHY.length;
  /** Ten sam budynek, nie ta sama zabudowa — sąsiednie kamienice dzielą ścianę. */
  const tenSam = (x: number, y: number, ten: number) => zabudowa(x, y) && dach(x, y) === ten;

  ctx.fillStyle = '#10140f';
  ctx.fillRect(0, 0, width, height);

  // ── 1. teren warstwami, z zaokrąglonym obrysem ──────────────────────────
  const promien = TILE * 0.45;
  const spoina = 'rgba(90,76,58,0.08)';
  for (const w of WARSTWY) {
    const biom = reg.content.biomes.find((b) => b.id === w);
    if (!biom) continue;
    ctx.fillStyle = biom.color;
    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        const x = camX + rx;
        const y = camY + ry;
        if (!naWarstwie(x, y, w)) continue;
        if (w === 'ziemia') { ctx.fillRect(rx * TILE, ry * TILE, TILE, TILE); continue; }
        ksztalt(
          ctx, rx * TILE, ry * TILE,
          naWarstwie(x, y - 1, w), naWarstwie(x, y + 1, w),
          naWarstwie(x + 1, y, w), naWarstwie(x - 1, y, w),
          promien,
        );
        ctx.fill();
        // Spoiny bruku. Sto metrów placu bez żadnej faktury czyta się jak dziura w kadrze.
        if (BRUKOWANE.has(w)) {
          ctx.fillStyle = spoina;
          const px = rx * TILE, py = ry * TILE;
          if (naWarstwie(x + 1, y, w)) ctx.fillRect(px + TILE - 1, py, 1, TILE);
          if (naWarstwie(x, y + 1, w) && (x + y) % 2 === 0) ctx.fillRect(px, py + TILE - 1, TILE, 1);
          ctx.fillStyle = biom.color;
        }
      }
    }
  }

  // ── 2. cień pod kamienicą, rzucany na południe ──────────────────────────
  ctx.fillStyle = 'rgba(32,24,18,0.20)';
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const x = camX + rx;
      const y = camY + ry;
      if (zabudowa(x, y) || !zabudowa(x, y - 1)) continue;
      ctx.fillRect(rx * TILE, ry * TILE, TILE, TILE * 0.38);
    }
  }

  // ── 3. kamienice: dach, okap, elewacja, podcienia ───────────────────────
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const x = camX + rx;
      const y = camY + ry;
      if (!zabudowa(x, y)) continue;
      const ten = dach(x, y);
      const t = ton(x, y);
      const px = rx * TILE;
      const py = ry * TILE;

      // Który rząd od południa — i jak głęboki jest w tym miejscu budynek.
      let odPoludnia = SCIANA + 1;
      for (let k = 1; k <= SCIANA + 1; k++) {
        if (!tenSam(x, y + k, ten)) { odPoludnia = k - 1; break; }
      }
      let naPolnoc = 0;
      while (naPolnoc < 4 && tenSam(x, y - naPolnoc - 1, ten)) naPolnoc++;
      const glebokosc = Math.min(odPoludnia, SCIANA + 1) + naPolnoc + 1;
      // Dachu ma być więcej niż ściany — inaczej budynek czyta się jak płot z oknami.
      const rzedowSciany = glebokosc >= 5 ? SCIANA : 1;

      if (odPoludnia >= rzedowSciany) {
        rysujDach(ctx, px, py, t, !tenSam(x, y - 1, ten), odPoludnia === rzedowSciany);
      } else {
        // Drzwi trafiają na środek pierzei tego budynku, nie co drugi kafel.
        let zachod = x, wschod = x;
        while (tenSam(zachod - 1, y, ten)) zachod--;
        while (tenSam(wschod + 1, y, ten)) wschod++;
        const drzwi = odPoludnia === 0 && x === ((zachod + wschod) >> 1);
        rysujElewacje(ctx, px, py, x, t, odPoludnia, rzedowSciany, drzwi);
      }

      // Krawędź stawiamy tam, gdzie kończy się TEN budynek.
      ctx.strokeStyle = przyciemnij(DACHY[t]!, 0.62);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (!tenSam(x, y - 1, ten)) { ctx.moveTo(px, py + 1); ctx.lineTo(px + TILE, py + 1); }
      if (!tenSam(x, y + 1, ten)) { ctx.moveTo(px, py + TILE - 1); ctx.lineTo(px + TILE, py + TILE - 1); }
      if (!tenSam(x - 1, y, ten)) { ctx.moveTo(px + 1, py); ctx.lineTo(px + 1, py + TILE); }
      if (!tenSam(x + 1, y, ten)) { ctx.moveTo(px + TILE - 1, py); ctx.lineTo(px + TILE - 1, py + TILE); }
      ctx.stroke();
    }
  }

  // ── 4. encje. Rząd wyżej niż widok, bo korona drzewa sięga dwóch kafli ──
  for (let ry = -2; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const x = camX + rx;
      const y = camY + ry;
      const e = entityAt(state, x, y);
      if (!e) continue;
      const px = rx * TILE;
      const py = ry * TILE;

      if (e.kind === 'resource') {
        const def = reg.resources.get(e.def);
        if (!def) continue;
        const pelnia = def.hp > 0 ? e.hp / def.hp : 1;
        rysujSurowiec(ctx, px, py, e.def, def.color, (WYSOKOSC[e.def] ?? DOMYSLNA) * (0.7 + 0.3 * pelnia));
      } else if (e.kind === 'placed') {
        const def = reg.structures.get(e.def);
        if (!def) continue;
        rysujStrukture(ctx, px, py, def.color);
      } else {
        const def = reg.npcs.get(e.def);
        if (!def) continue;
        rysujPostac(ctx, px, py, def.color);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(def.name, px + TILE / 2, py - 3);
      }
    }
  }

  // ── 5. gracz ────────────────────────────────────────────────────────────
  const ppx = (state.player.x - camX) * TILE;
  const ppy = (state.player.y - camY) * TILE;
  rysujPostac(ctx, ppx, ppy, '#f0c674');
  const d = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[state.player.facing]!;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ksztalt(ctx, ppx + d[0]! * TILE + 2, ppy + d[1]! * TILE + 2, false, false, false, false, TILE * 0.2);
  ctx.stroke();

  // ── 6. noc ──────────────────────────────────────────────────────────────
  const a = nightAlpha(timeOfDay(state, reg));
  if (a > 0.01) {
    ctx.fillStyle = `rgba(8,14,38,${a})`;
    ctx.fillRect(0, 0, width, height);
    for (const e of state.ents) {
      if (e.kind !== 'placed' || e.respawnAt !== 0) continue;
      if (e.def !== 'pochodnia_stojaca') continue;
      const lx = (e.x - camX) * TILE + TILE / 2;
      const ly = (e.y - camY) * TILE + TILE / 2;
      if (lx < -200 || ly < -200 || lx > width + 200 || ly > height + 200) continue;
      const r = TILE * 5;
      const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
      grad.addColorStop(0, `rgba(255,204,85,${a * 0.95})`);
      grad.addColorStop(1, 'rgba(255,204,85,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Połać dachu. Okap od północy łapie światło — jedno słońce dla całego miasta. */
function rysujDach(
  ctx: CanvasRenderingContext2D, px: number, py: number, t: number, polnocny: boolean, nadScianą: boolean,
): void {
  const kolor = DACHY[t]!;
  ctx.fillStyle = kolor;
  ctx.fillRect(px, py, TILE, TILE);
  if (polnocny) {
    // Kalenica: jasny pas na grzbiecie, żeby połać miała spadek, a nie była plamą.
    ctx.fillStyle = przyciemnij(kolor, -0.2);
    ctx.fillRect(px, py, TILE, TILE * 0.26);
  }
  if (nadScianą) {
    ctx.fillStyle = przyciemnij(kolor, 0.18);
    ctx.fillRect(px, py + TILE * 0.7, TILE, TILE * 0.3);
  }
  // Rowki dachówki: delikatne, co kilka pikseli, żeby połać nie była płaską plamą.
  ctx.fillStyle = przyciemnij(kolor, 0.1);
  for (let i = 0; i < TILE; i += 8) ctx.fillRect(px + i, py, 1, TILE);
}

/**
 * Elewacja. Przy płytkim budynku cały front mieści się w jednym rzędzie kafli, więc
 * okno i arkada dzielą ten sam kafel — okno u góry, przejście u dołu. Rytm liczymy
 * z bezwzględnego x, żeby arkady układały się w linię przez całą pierzeję, a drzwi
 * trafiały dokładnie na środek budynku.
 */
function rysujElewacje(
  ctx: CanvasRenderingContext2D, px: number, py: number, x: number, t: number,
  rzad: number, rzedow: number, drzwi: boolean,
): void {
  const tynk = TYNKI[t]!;
  ctx.fillStyle = tynk;
  ctx.fillRect(px, py, TILE, TILE);

  const gorny = rzad === rzedow - 1;
  if (gorny) {
    // Pod okapem zawsze jest cień.
    ctx.fillStyle = 'rgba(40,28,20,0.26)';
    ctx.fillRect(px, py, TILE, TILE * 0.16);
  }

  // Okna: w górnym rzędzie, a przy jednorzędowym froncie — w jego górnej części.
  if (gorny && x % 2 === 0) {
    const w = TILE * 0.34;
    const h = rzedow > 1 ? TILE * 0.44 : TILE * 0.3;
    const ox = px + (TILE - w) / 2;
    const oy = py + TILE * (rzedow > 1 ? 0.34 : 0.22);
    ctx.fillStyle = '#4b5b63';
    ctx.fillRect(ox, oy, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillRect(ox, oy, w, h * 0.34);
    ctx.strokeStyle = przyciemnij(tynk, 0.4);
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, w - 1, h - 1);
  }

  if (rzad > 0) return;

  // Parter: drzwi na środku pierzei, podcienia co drugi kafel obok nich.
  const otwor = drzwi || x % 2 === 0;
  if (otwor) {
    const w = TILE * (drzwi ? 0.44 : 0.5);
    const ox = px + (TILE - w) / 2;
    const gora = py + TILE * (rzedow > 1 ? 0.2 : 0.46);
    ctx.fillStyle = drzwi ? '#5a3a24' : 'rgba(52,36,26,0.8)';
    ctx.beginPath();
    ctx.moveTo(ox, py + TILE);
    ctx.lineTo(ox, gora + w / 2);
    ctx.arc(ox + w / 2, gora + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(ox + w, py + TILE);
    ctx.closePath();
    ctx.fill();
    if (drzwi) {
      ctx.strokeStyle = przyciemnij(tynk, 0.45);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#d8b25f';
      ctx.beginPath();
      ctx.arc(ox + w * 0.76, py + TILE * 0.78, TILE * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Próg: ciemny pas tam, gdzie mur styka się z brukiem.
  ctx.fillStyle = 'rgba(40,28,20,0.32)';
  ctx.fillRect(px, py + TILE - 2, TILE, 2);
}

/** Cień pod obiektem — bez niego wszystko wisi w powietrzu. */
function cien(ctx: CanvasRenderingContext2D, cx: number, stopy: number, r: number): void {
  ctx.fillStyle = 'rgba(30,24,16,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, stopy, r, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function kolko(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, kolor: string): void {
  ctx.fillStyle = kolor;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Surowce. Drzewo wyrasta w górę poza swój kafel — stoi na nim stopą, nie środkiem. */
function rysujSurowiec(ctx: CanvasRenderingContext2D, px: number, py: number, id: string, kolor: string, h: number): void {
  const cx = px + TILE / 2;
  const stopy = py + TILE * 0.88;
  const ciemny = przyciemnij(kolor, 0.3);

  if (id === 'drzewo') {
    cien(ctx, cx, stopy, TILE * 0.34);
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(cx - TILE * 0.09, stopy - TILE * h * 0.42, TILE * 0.18, TILE * h * 0.42);
    const kr = TILE * h * 0.36;
    const ky = stopy - TILE * h * 0.62;
    kolko(ctx, cx - kr * 0.5, ky + kr * 0.2, kr, ciemny);
    kolko(ctx, cx + kr * 0.5, ky + kr * 0.2, kr, ciemny);
    kolko(ctx, cx, ky - kr * 0.35, kr * 1.05, kolor);
    kolko(ctx, cx - kr * 0.35, ky - kr * 0.55, kr * 0.5, przyciemnij(kolor, -0.18));
    return;
  }

  if (id === 'krzak') {
    cien(ctx, cx, stopy, TILE * 0.26);
    const r = TILE * h * 0.3;
    kolko(ctx, cx - r * 0.6, stopy - r * 0.7, r, ciemny);
    kolko(ctx, cx + r * 0.6, stopy - r * 0.7, r, ciemny);
    kolko(ctx, cx, stopy - r * 1.2, r * 1.05, kolor);
    kolko(ctx, cx + r * 0.3, stopy - r * 1.5, r * 0.25, '#b2334a');
    return;
  }

  if (id === 'kamien_polny' || id === 'zloze_zelaza') {
    cien(ctx, cx, stopy, TILE * 0.3);
    const r = TILE * h * 0.5;
    ctx.fillStyle = kolor;
    ctx.beginPath();
    ctx.moveTo(cx - r, stopy);
    ctx.lineTo(cx - r * 0.75, stopy - r * 0.85);
    ctx.lineTo(cx, stopy - r * 1.1);
    ctx.lineTo(cx + r * 0.8, stopy - r * 0.75);
    ctx.lineTo(cx + r, stopy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = przyciemnij(kolor, -0.2);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.75, stopy - r * 0.85);
    ctx.lineTo(cx, stopy - r * 1.1);
    ctx.lineTo(cx, stopy - r * 0.5);
    ctx.closePath();
    ctx.fill();
    if (id === 'zloze_zelaza') {
      kolko(ctx, cx - r * 0.3, stopy - r * 0.5, r * 0.16, '#d79a5b');
      kolko(ctx, cx + r * 0.35, stopy - r * 0.7, r * 0.13, '#d79a5b');
    }
    return;
  }

  if (id === 'lowisko') {
    ctx.strokeStyle = 'rgba(235,245,250,0.55)';
    ctx.lineWidth = 1.5;
    for (let k = 1; k <= 2; k++) {
      ctx.beginPath();
      ctx.ellipse(cx, py + TILE / 2, TILE * 0.18 * k, TILE * 0.09 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  // Wszystko, co rośnie źdźbłem: trzcina, trawa wysoka, len.
  cien(ctx, cx, stopy, TILE * 0.2);
  const wys = TILE * h * 0.8;
  ctx.strokeStyle = kolor;
  ctx.lineWidth = 2;
  for (let k = -1; k <= 1; k++) {
    ctx.beginPath();
    ctx.moveTo(cx + k * TILE * 0.16, stopy);
    ctx.quadraticCurveTo(cx + k * TILE * 0.24, stopy - wys * 0.6, cx + k * TILE * 0.34, stopy - wys);
    ctx.stroke();
    if (id === 'len') kolko(ctx, cx + k * TILE * 0.34, stopy - wys, TILE * 0.08, '#8fa3d8');
  }
}

/** Rzecz postawiona przez gracza: pudło z blatem, nie kwadrat. */
function rysujStrukture(ctx: CanvasRenderingContext2D, px: number, py: number, kolor: string): void {
  const cx = px + TILE / 2;
  const stopy = py + TILE * 0.9;
  cien(ctx, cx, stopy, TILE * 0.34);
  const w = TILE * 0.72;
  const h = TILE * 0.62;
  ctx.fillStyle = przyciemnij(kolor, 0.22);
  ctx.fillRect(cx - w / 2, stopy - h, w, h);
  ctx.fillStyle = kolor;
  ctx.fillRect(cx - w / 2, stopy - h, w, h * 0.42);
  ctx.strokeStyle = przyciemnij(kolor, 0.5);
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - w / 2 + 0.5, stopy - h + 0.5, w - 1, h - 1);
}

/**
 * Postać zajmuje kafel wszerz i półtora kafla wzwyż, a głowa to prawie połowa sylwetki.
 *
 * To jest ta jedna rzecz, w której Pokémon świadomie kłamie: przy trzech metrach na
 * kafel człowiek powinien mieć pół kafla. Gdyby go tak narysować, gracz zgubiłby się
 * własnym oczom — a tu ma być bohaterem kadru, nie szpilką na planie.
 */
function rysujPostac(ctx: CanvasRenderingContext2D, px: number, py: number, kolor: string): void {
  const cx = px + TILE / 2;
  const stopy = py + TILE * 0.94;
  const kreska = 'rgba(38,30,22,0.8)';
  cien(ctx, cx, stopy, TILE * 0.3);

  const tulow = TILE * 0.42;
  const szer = TILE * 0.5;
  ctx.fillStyle = kolor;
  ctx.strokeStyle = kreska;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - szer / 2, stopy);
  ctx.lineTo(cx - szer / 2, stopy - tulow * 0.7);
  ctx.quadraticCurveTo(cx, stopy - tulow * 1.25, cx + szer / 2, stopy - tulow * 0.7);
  ctx.lineTo(cx + szer / 2, stopy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const rg = TILE * 0.32;
  const gy = stopy - tulow - rg * 0.6;
  kolko(ctx, cx, gy, rg, '#f3d6b0');
  ctx.fillStyle = przyciemnij(kolor, 0.3);
  ctx.beginPath();
  ctx.arc(cx, gy, rg, Math.PI * 0.92, Math.PI * 0.08);
  ctx.fill();
  ctx.fillStyle = '#241c14';
  ctx.beginPath();
  ctx.arc(cx - rg * 0.4, gy + rg * 0.25, rg * 0.16, 0, Math.PI * 2);
  ctx.arc(cx + rg * 0.4, gy + rg * 0.25, rg * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = kreska;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, gy, rg, 0, Math.PI * 2);
  ctx.stroke();
}
