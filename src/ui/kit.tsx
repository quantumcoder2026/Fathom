import type { CSSProperties, ReactNode } from "react";

import styles from "./kit.module.css";

export function Segmented<T extends string>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className={styles.segmented} role="tablist">
      {props.options.map((o) => (
        <button
          key={o.value}
          className={`${styles.segItem} ${o.value === props.value ? styles.active : ""}`}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LabeledSlider(props: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const span = props.max - props.min || 1;
  const pct = Math.max(0, Math.min(100, ((props.value - props.min) / span) * 100));
  return (
    <label className={`${styles.slider} ${props.disabled ? styles.sliderOff : ""}`}>
      <span className={styles.sliderHead}>
        <span className={styles.sliderLabel}>{props.label}</span>
        <span className={styles.sliderValue}>{props.display}</span>
      </span>
      <input
        type="range"
        className={styles.range}
        style={{ "--fill": `${pct}%` } as CSSProperties}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Toggle(props: { label: string; on: boolean; onChange: () => void }) {
  return (
    <button
      className={`${styles.toggle} ${props.on ? styles.on : ""}`}
      onClick={props.onChange}
      aria-pressed={props.on}
    >
      <span className={styles.toggleBox} />
      <span className={styles.toggleLabel}>{props.label}</span>
    </button>
  );
}

export function Panel(props: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <span className={styles.panelTitle}>
          <span className={styles.tick} aria-hidden />
          <span className="eyebrow">{props.title}</span>
          {props.sub && <span className={styles.panelSub}>{props.sub}</span>}
        </span>
        {props.action}
      </header>
      <div className={styles.panelBody}>{props.children}</div>
    </section>
  );
}

export function StatRow(props: { items: { label: string; value: string; unit?: string }[] }) {
  return (
    <div className={styles.stats}>
      {props.items.map((s) => (
        <div key={s.label} className={styles.stat}>
          <div className={styles.statLabel}>{s.label}</div>
          <div className={styles.statValue}>
            {s.value}
            {s.unit && <span className={styles.statUnit}>{s.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMark} aria-hidden />
      <span className={styles.emptyText}>{children}</span>
      {hint && <span className={styles.emptyHint}>{hint}</span>}
    </div>
  );
}

export function Shimmer({ lines = 4 }: { lines?: number }) {
  return (
    <div>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={styles.shimmer} style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}
