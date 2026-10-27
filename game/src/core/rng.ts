/** Deterministyczne źródła losowości. Żadnego Math.random() w rdzeniu — to byłby koniec powtarzalności. */

/** Strumień stanu: ten sam seed i ta sama liczba wywołań dają tę samą sekwencję. */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Liczba całkowita z [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Bezstanowy szum punktowy — ta sama współrzędna zawsze daje tę samą wartość. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695040888963407) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(x: number, y: number, seed: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Suma oktaw — większa skala to szersze plamy terenu. */
export function fbm(x: number, y: number, seed: number, scale = 24, octaves = 4): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let s = scale;
  for (let i = 0; i < octaves; i++) {
    sum += smooth(x, y, seed + i * 7919, s) * amp;
    norm += amp;
    amp *= 0.5;
    s *= 0.5;
  }
  return sum / norm;
}
