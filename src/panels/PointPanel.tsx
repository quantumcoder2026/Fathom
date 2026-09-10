/**
 * Point inspector — click anywhere on the field and this answers two questions:
 *
 *   1. what does the model say in this whole water column, and how deep does it
 *      even go here (the column ends at the seafloor, which varies by point)
 *   2. how much should you believe it — how far away, and how long ago, was the
 *      nearest actual observation
 *
 * (2) is the point. At a float you get model AND observation. Anywhere else you
 * get the model alone, and the honest answer is usually "nothing has measured
 * near here in weeks".
 */

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { useStore } from "../state/store";
import { formatLonLat, haversineKm } from "../three/coords";
import type { PointInfo } from "../three/ThreeView";
import { Empty, Panel, StatRow } from "../ui/kit";
import styles from "./panels.module.css";

const AX = {
  stroke: "#2a3742",
  tick: { fill: "#7d8b98", fontSize: 9, fontFamily: "JetBrains Mono" },
};

/** How confident the model is here, from observation distance and age alone.
 *  Same shape as compare/evidence.py: recency decay x observation count. */
function confidenceFrom(distanceKm: number, ageDays: number): number {
  const byRange = Math.exp(-distanceKm / 250);
  const byAge = Math.exp(-ageDays / 15);
  return Math.max(0, Math.min(1, byRange * byAge));
}

export default function PointPanel({
  point,
  onClose,
}: {
  point: PointInfo | null;
  onClose: () => void;
}) {
  const meta = useStore((s) => s.meta);
  const floats = useStore((s) => s.floats);
  const variable = useStore((s) => s.variable);
  const timeIndex = useStore((s) => s.timeIndex);
  const unit = variable === "temperature" ? "°C" : "psu";

  if (!point || !meta) {
    return (
      <Panel title="Point inspector">
        <Empty hint="click anywhere on the field">
          Click a point in the 3D view to read the model column there — and how well
          observed it is.
        </Empty>
      </Panel>
    );
  }

  const column = point.column ?? [];
  const data = meta.depths.map((depth, i) => ({ depth, value: column[i] ?? null }));
  const covered = data.filter((d) => d.value !== null);
  const seafloor = covered.length ? covered[covered.length - 1].depth : null;

  // nearest observation, in space and in time
  let nearest: { id: string; km: number; days: number } | null = null;
  // age is measured against the model timestep on screen, not wall-clock now
  const when = Date.parse(meta.times[timeIndex] ?? meta.times[0]);
  for (const f of floats) {
    const km = haversineKm(point.lat, point.lon, f.lat, f.lon);
    if (!nearest || km < nearest.km) {
      nearest = {
        id: f.id,
        km,
        days: Math.abs(when - Date.parse(f.time)) / 86_400_000,
      };
    }
  }

  const confidence = nearest ? confidenceFrom(nearest.km, nearest.days) : 0;
  const verdict =
    confidence > 0.6 ? "constrained" : confidence > 0.2 ? "weakly constrained" : "unconstrained";

  return (
    <Panel
      title="Point inspector"
      sub={formatLonLat(point.lon, point.lat)}
      action={
        <button className={styles.source} onClick={onClose}>
          clear ✕
        </button>
      }
    >
      {covered.length === 0 ? (
        <Empty hint="land or below the seafloor">
          The model has no values in this column.
        </Empty>
      ) : (
        <>
          <div className={styles.chartHead}>
            <span className={styles.chartName}>model column</span>
            <span className={styles.legendDim}>
              {covered.length}/{meta.depths.length} levels
            </span>
          </div>
          <div className={`${styles.chartWrapSm} ${styles.chartFrame}`} style={{ height: 128 }}>
            <ResponsiveContainer>
              <LineChart
                layout="vertical"
                data={data}
                margin={{ top: 4, right: 12, bottom: 2, left: 2 }}
              >
                <CartesianGrid stroke="#161d26" />
                <XAxis
                  type="number"
                  domain={["auto", "auto"]}
                  stroke={AX.stroke}
                  tick={AX.tick}
                  tickLine={false}
                  height={20}
                />
                <YAxis
                  type="number"
                  dataKey="depth"
                  domain={[0, "dataMax"]}
                  stroke={AX.stroke}
                  tick={AX.tick}
                  tickLine={false}
                  width={40}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#eaa64a"
                  strokeWidth={1.7}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className={styles.section}>
            <StatRow
              items={[
                {
                  label: `at ${Math.round(point.depth)} m`,
                  value: point.value === null ? "—" : point.value.toFixed(2),
                  unit,
                },
                {
                  label: "column ends",
                  value: seafloor === null ? "—" : String(Math.round(seafloor)),
                  unit: "m",
                },
                {
                  label: "nearest obs",
                  value: nearest ? Math.round(nearest.km).toLocaleString() : "—",
                  unit: "km",
                },
                {
                  label: "obs age",
                  value: nearest ? Math.round(nearest.days).toString() : "—",
                  unit: "d",
                },
              ]}
            />
          </div>

          <div className={`${styles.decomp} ${styles.evidenceCard}`}>
            <div className={styles.decompBar}>
              <span className="eyebrow">Evidence here</span>
              <span
                className={styles.decompTag}
                data-verdict={verdict.split(" ").pop()}
              >
                {verdict}
              </span>
            </div>
            <div className={styles.verdict} style={{ paddingTop: 12 }}>
              {nearest ? (
                <>
                  The nearest Argo profile is{" "}
                  <b>{Math.round(nearest.km).toLocaleString()} km away</b> and{" "}
                  <b>{Math.round(nearest.days)} days</b> from this timestep (float{" "}
                  {nearest.id}).{" "}
                  {confidence > 0.6
                    ? "This column is well supported by observation."
                    : confidence > 0.2
                      ? "This column is only weakly supported by observation."
                      : "Nothing has measured near here recently — treat these values as model output, not as knowledge."}
                </>
              ) : (
                <>No Argo profiles loaded for this window.</>
              )}
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
