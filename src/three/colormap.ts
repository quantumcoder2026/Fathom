/**
 * Colormaps for the 3D field. A Float32 grid (NaN = missing / land) becomes an
 * RGBA byte array; NaN cells get alpha 0 so they render fully transparent —
 * never a colour, never zero.
 */

export type Palette = "blue-red" | "viridis" | "thermal";

type Stop = [number, [number, number, number]];

const PALETTES: Record<Palette, Stop[]> = {
  "blue-red": [
    [0.0, [43, 58, 103]],
    [0.25, [74, 144, 217]],
    [0.5, [127, 212, 193]],
    [0.75, [242, 232, 92]],
    [1.0, [232, 102, 63]],
  ],
  viridis: [
    [0.0, [68, 1, 84]],
    [0.25, [59, 82, 139]],
    [0.5, [33, 145, 140]],
    [0.75, [94, 201, 98]],
    [1.0, [253, 231, 37]],
  ],
  thermal: [
    [0.0, [3, 35, 79]],
    [0.25, [86, 45, 129]],
    [0.5, [187, 53, 105]],
    [0.75, [242, 143, 58]],
    [1.0, [255, 246, 179]],
  ],
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function samplePalette(palette: Palette, t: number): [number, number, number] {
  const stops = PALETTES[palette] ?? PALETTES["blue-red"];
  const c = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    const [t0, c0] = stops[i - 1];
    const [t1, c1] = stops[i];
    if (c <= t1) {
      const f = (c - t0) / (t1 - t0 || 1);
      return [lerp(c0[0], c1[0], f), lerp(c0[1], c1[1], f), lerp(c0[2], c1[2], f)];
    }
  }
  const last = stops[stops.length - 1][1];
  return [last[0], last[1], last[2]];
}

export interface ColormapOptions {
  palette: Palette;
  min: number;
  max: number;
  scale?: "linear" | "log";
}

/** RGBA bytes for a Float32 grid. Length = grid.length * 4. Missing -> alpha 0. */
export function gridToRGBA(grid: Float32Array, opts: ColormapOptions): Uint8Array {
  const { palette, min, max } = opts;
  const scale = opts.scale ?? "linear";
  const out = new Uint8Array(grid.length * 4);
  const span = max - min || 1;

  // A log scale needs a positive domain. Ocean temperature ranges routinely
  // start at or below 0, and flooring those at 1e-6 put six orders of magnitude
  // of empty scale below the data — every real value landed in the top fifth of
  // the palette and the log view was a flat wash. Floor at three decades below
  // the top instead, and fall back to linear if nothing is positive.
  const useLog = scale === "log" && max > 0;
  const lo = min > 0 ? min : max * 1e-3;
  const logLo = useLog ? Math.log(lo) : 0;
  const logSpan = useLog ? Math.log(max) - logLo || 1 : 1;

  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    const o = i * 4;
    // isFinite, not !isNaN: an infinity would otherwise be painted as a real value
    if (!Number.isFinite(v)) {
      out[o + 3] = 0; // missing / land — transparent, not a colour
      continue;
    }
    const t = useLog
      ? v <= lo
        ? 0
        : (Math.log(v) - logLo) / logSpan
      : (v - min) / span;
    const [r, g, b] = samplePalette(palette, t);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return out;
}
