import type { Registry } from '../content/registry.js';
import { entityAt, idx, timeOfDay } from '../core/tick.js';
import type { State } from '../core/types.js';

/**
 * Rysowanie świata w proporcjach Animal Crossing.
 *
 * Jedna liczba trzyma tu wszystko w ryzach: **kafel to 1,5 metra**. Z niej wynika
 * cała drabinka wielkości i żaden rysunek nie ma prawa z niej wyłamać:
 *
 *   człowiek   1 kafel      drzewo     2 kafle
 *   ulica      4 kafle      kamienica  8–13 kafli
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

export const TILE = 20;

const ZABUDOWA = 'kamienica';

/** Ile rzędów kafli od południa rysujemy jako ścianę, a nie jako dach. */
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

/** Wysokość surowca w kaflach. Drzewo ma być dwa razy wyższe od człowieka. */
const WYSOKOSC: Record<string, number> = {
  drzewo: 2,
  zloze_zelaza: 0.85,
  kamien_polny: 0.6,
  krzak: 0.85,
  trzcina: 1.1,
  trawa_wysoka: 0.8,
  lowisko: 1,
  len: 0.7,
};
const DOMYSLNA = 0.8;

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
  const spoina = 'rgba(90,76,58,0.13)';
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

      // Który rząd od południa? Dwa ostatnie to ściana widziana od frontu.
      let odPoludnia = SCIANA;
      for (let k = 1; k <= SCIANA; k++) {
        if (!tenSam(x, y + k, ten)) { odPoludnia = k - 1; break; }
      }

      if (odPoludnia >= SCIANA) {
        rysujDach(ctx, px, py, t, !tenSam(x, y - 1, ten));
      } else {
        rysujElewacje(ctx, px, py, x, t, odPoludnia);
      }

      // Krawędź stawiamy tam, gdzie kończy się TEN budynek.
      ctx.strokeStyle = przyciemnij(DACHY[t]!, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (!tenSam(x, y - 1, ten)) { ctx.moveTo(px, py + 0.5); ctx.lineTo(px + TILE, py + 0.5); }
      if (!tenSam(x, y + 1, ten)) { ctx.moveTo(px, py + TILE - 0.5); ctx.lineTo(px + TILE, py + TILE - 0.5); }
      if (!tenSam(x - 1, y, ten)) { ctx.moveTo(px + 0.5, py); ctx.lineTo(px + 0.5, py + TILE); }
      if (!tenSam(x + 1, y, ten)) { ctx.moveTo(px + TILE - 0.5, py); ctx.lineTo(px + TILE - 0.5, py + TILE); }
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
function rysujDach(ctx: CanvasRenderingContext2D, px: number, py: number, t: number, polnocny: boolean): void {
  const kolor = DACHY[t]!;
  ctx.fillStyle = kolor;
  ctx.fillRect(px, py, TILE, TILE);
  if (polnocny) {
    ctx.fillStyle = przyciemnij(kolor, -0.16);
    ctx.fillRect(px, py, TILE, TILE * 0.3);
  }
  // Rowki dachówki: delikatne, co trzeci piksel, żeby połać nie była płaską plamą.
  ctx.fillStyle = przyciemnij(kolor, 0.1);
  for (let i = 0; i < TILE; i += 6) ctx.fillRect(px + i, py, 1, TILE);
}

/**
 * Elewacja: dolny rząd to podcienia, górny okna. Rytm liczymy z bezwzględnego x,
 * więc arkady i okna układają się w jedną linię przez całą pierzeję.
 */
function rysujElewacje(ctx: CanvasRenderingContext2D, px: number, py: number, x: number, t: number, rzad: number): void {
  const tynk = TYNKI[t]!;
  ctx.fillStyle = tynk;
  ctx.fillRect(px, py, TILE, TILE);

  if (rzad === 1) {
    // Pod okapem zawsze jest cień.
    ctx.fillStyle = 'rgba(40,28,20,0.22)';
    ctx.fillRect(px, py, TILE, TILE * 0.18);
    if (x % 2 === 0) {
      const w = TILE * 0.4;
      const h = TILE * 0.46;
      const ox = px + (TILE - w) / 2;
      const oy = py + TILE * 0.34;
      ctx.fillStyle = '#4b5b63';
      ctx.fillRect(ox, oy, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(ox, oy, w, h * 0.3);
      ctx.strokeStyle = przyciemnij(tynk, 0.35);
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + 0.5, oy + 0.5, w - 1, h - 1);
    }
    return;
  }

  // Podcienia: arkada co drugi kafel, między nimi filar.
  if (x % 2 === 0) {
    const w = TILE * 0.56;
    const ox = px + (TILE - w) / 2;
    const gora = py + TILE * 0.22;
    ctx.fillStyle = 'rgba(52,36,26,0.78)';
    ctx.beginPath();
    ctx.moveTo(ox, py + TILE);
    ctx.lineTo(ox, gora + w / 2);
    ctx.arc(ox + w / 2, gora + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(ox + w, py + TILE);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = przyciemnij(tynk, 0.08);
    ctx.fillRect(px + TILE * 0.35, py + TILE * 0.2, TILE * 0.3, TILE * 0.8);
  }
  // Próg: ciemny pas tam, gdzie mur styka się z brukiem.
  ctx.fillStyle = 'rgba(40,28,20,0.3)';
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
 * Człowiek zajmuje kafel, czyli półtora metra, a głowa to blisko połowa postaci.
 * Tak wygląda proporcja Animal Crossing i to ona odróżnia ten świat od mapy.
 */
function rysujPostac(ctx: CanvasRenderingContext2D, px: number, py: number, kolor: string): void {
  const cx = px + TILE / 2;
  const stopy = py + TILE * 0.9;
  cien(ctx, cx, stopy, TILE * 0.28);

  const tulow = TILE * 0.3;
  const szer = TILE * 0.38;
  ctx.fillStyle = kolor;
  ctx.beginPath();
  ctx.ellipse(cx, stopy - tulow / 2, szer / 2, tulow / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  const rg = TILE * 0.25;
  const gy = stopy - tulow - rg * 0.75;
  kolko(ctx, cx, gy, rg, '#f0d2ac');
  ctx.fillStyle = przyciemnij(kolor, 0.35);
  ctx.beginPath();
  ctx.arc(cx, gy, rg, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#2b2219';
  ctx.beginPath();
  ctx.arc(cx - rg * 0.38, gy + rg * 0.22, rg * 0.15, 0, Math.PI * 2);
  ctx.arc(cx + rg * 0.38, gy + rg * 0.22, rg * 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(40,32,22,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, gy, rg, 0, Math.PI * 2);
  ctx.stroke();
}
