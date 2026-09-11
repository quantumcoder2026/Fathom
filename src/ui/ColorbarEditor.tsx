import { useStore } from "../state/store";
import { samplePalette, type Palette } from "../three/colormap";
import styles from "./ColorbarEditor.module.css";

const PALETTES: { value: Palette; label: string }[] = [
  { value: "blue-red", label: "Blue–Red diverging" },
  { value: "viridis", label: "Viridis" },
  { value: "thermal", label: "Thermal" },
];

function gradientCss(palette: Palette): string {
  const stops = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const [r, g, b] = samplePalette(palette, t);
    return `rgb(${r | 0} ${g | 0} ${b | 0}) ${(t * 100).toFixed(0)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export default function ColorbarEditor() {
  const { min, max, palette, scale } = useStore((s) => s.colormap);
  const setColormap = useStore((s) => s.setColormap);
  const reset = useStore((s) => s.resetColormapToRange);
  const variable = useStore((s) => s.variable);
  const unit = variable === "temperature" ? "°C" : "psu";

  return (
    <div className={styles.wrap}>
      <div className={styles.gradient} style={{ background: gradientCss(palette) }} />
      <div className={styles.scaleRow}>
        <span>
          {min.toFixed(1)} {unit}
        </span>
        <span>
          {max.toFixed(1)} {unit}
        </span>
      </div>

      <select
        className={styles.select}
        value={palette}
        onChange={(e) => setColormap({ palette: e.target.value as Palette })}
      >
        {PALETTES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <div className={styles.row}>
        <div className={styles.field}>
          <label>min</label>
          <input
            type="number"
            value={min}
            step={0.5}
            onChange={(e) => {
              // an empty or half-typed box reads as "" -> Number("") is 0, which
              // silently snapped the scale to zero mid-keystroke
              const v = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(v)) setColormap({ min: v });
            }}
          />
        </div>
        <div className={styles.field}>
          <label>max</label>
          <input
            type="number"
            value={max}
            step={0.5}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(v)) setColormap({ max: v });
            }}
          />
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.linlog}>
          <button
            className={scale === "linear" ? styles.on : ""}
            onClick={() => setColormap({ scale: "linear" })}
          >
            linear
          </button>
          <button
            className={scale === "log" ? styles.on : ""}
            onClick={() => setColormap({ scale: "log" })}
          >
            log
          </button>
        </div>
        <button className={styles.reset} onClick={reset}>
          reset to data range
        </button>
      </div>
    </div>
  );
}
