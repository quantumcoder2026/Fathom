import { useMemo, useState, type CSSProperties } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { useStore } from "../state/store";
import { Empty, Panel, Shimmer, StatRow } from "../ui/kit";
import styles from "./panels.module.css";

const STATUS_LABEL: Record<string, string> = {
  no_model_coverage: "no model coverage",
  qc_rejected: "QC rejected",
  outside_domain: "outside domain",
};
const AX = { stroke: "#2a3742", tick: { fill: "#7d8b98", fontSize: 9, fontFamily: "JetBrains Mono" } };

/** A real profile can have hundreds of gap levels. List depth RANGES per status,
 *  not every level, or the panel becomes a wall of red. */
function summariseGaps(gaps: { depth: number; status: string }[]) {
  const byStatus = new Map<string, number[]>();
  for (const g of gaps) {
    const list = byStatus.get(g.status) ?? [];
    list.push(g.depth);
    byStatus.set(g.status, list);
  }
  const out: { label: string }[] = [];
  for (const [status, depthsRaw] of byStatus) {
    const depths = [...depthsRaw].sort((a, b) => a - b);
    // collapse into runs, allowing a modest jump between consecutive levels
    const runs: [number, number][] = [];
    let lo = depths[0];
    let prev = depths[0];
    for (const d of depths.slice(1)) {
      if (d - prev > Math.max(60, prev * 0.15)) {
        runs.push([lo, prev]);
        lo = d;
      }
      prev = d;
    }
    runs.push([lo, prev]);
    const spans = runs
      .map(([a, b]) => {
        const lo = Math.round(a);
        const hi = Math.round(b);
        return lo === hi ? `${lo} m` : `${lo}–${hi} m`;
      })
      .join(", ");
    const label = `${depths.length} level${depths.length > 1 ? "s" : ""} ` +
      `${STATUS_LABEL[status] ?? status} · ${spans}`;
    out.push({ label });
  }
  return out;
}

function interp(xs: number[], ys: number[], x: number): number | null {
  if (xs.length < 2 || x < xs[0] || x > xs[xs.length - 1]) return null;
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) {
      const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return null;
}

export default function ComparisonPanel() {
  const comparison = useStore((s) => s.comparison);
  const loading = useStore((s) => s.loading.comparison);
  const selected = useStore((s) => s.selectedFloatId);
  const variable = useStore((s) => s.variable);
  const error = useStore((s) => s.error);
  const activeDepth = useStore((s) => s.meta?.depths[s.depthIndex] ?? null);
  const unit = variable === "temperature" ? "°C" : "psu";

  const [shift, setShift] = useState(0);

  const modelDepths = useMemo(
    () => (comparison?.points ?? []).filter((p) => p.model !== null).map((p) => p.depth),
    [comparison],
  );
  const modelValues = useMemo(
    () => (comparison?.points ?? []).filter((p) => p.model !== null).map((p) => p.model as number),
    [comparison],
  );

  const chartData = useMemo(() => {
    if (!comparison) return [];
    return comparison.points.map((p) => {
      const shifted = shift === 0 ? p.model : interp(modelDepths, modelValues, p.depth + shift);
      return {
        depth: p.depth,
        observed: p.observed,
        model: shifted,
        difference: p.observed !== null && shifted !== null ? p.observed - shifted : null,
        status: p.status,
      };
    });
  }, [comparison, shift, modelDepths, modelValues]);

  const liveRmse = useMemo(() => {
    const d = chartData.map((r) => r.difference).filter((v): v is number => v !== null);
    if (!d.length) return null;
    return Math.sqrt(d.reduce((a, v) => a + v * v, 0) / d.length);
  }, [chartData]);

  // the row closest to the depth slider, so the slider reads out here too.
  // Uses chartData, not the raw points, so it reflects the shift on screen.
  const atDepth = useMemo(() => {
    if (activeDepth === null) return null;
    let best: (typeof chartData)[number] | null = null;
    let bestGap = Infinity;
    for (const row of chartData) {
      const gap = Math.abs(row.depth - activeDepth);
      if (gap < bestGap) {
        bestGap = gap;
        best = row;
      }
    }
    return best;
  }, [chartData, activeDepth]);

  if (!selected)
    return (
      <Panel title="Comparison">
        <Empty hint="observed − model">Select a float to compare it against the model.</Empty>
      </Panel>
    );
  if (loading)
    return (
      <Panel title="Comparison">
        <Shimmer lines={7} />
      </Panel>
    );
  if (!comparison)
    return (
      <Panel title="Comparison">
        <Empty hint="retry from the map">
          {error ? `Couldn't load comparison — ${error.replace("Error: ", "")}` : "No comparison."}
        </Empty>
      </Panel>
    );

  const gaps = comparison.points.filter((p) => p.status !== "ok");
  const s = comparison.stats;
  const dec = comparison.decomposition;
  const fmt = (v: number | null, d = 2) => (v === null ? "—" : v.toFixed(d));

  return (
    <Panel title="Comparison" sub={`float ${comparison.float_id} vs model`}>
      {/* observed vs model */}
      <div className={styles.chartHead}>
        <span className={styles.chartName}>depth profile</span>
        <span className={styles.legend}>
          <span><i className={styles.lObs} /> observed</span>
          <span><i className={styles.lMod} /> model{shift !== 0 ? ` · shifted ${shift > 0 ? "+" : ""}${shift} m` : ""}</span>
        </span>
      </div>
      <div className={`${styles.chartWrap} ${styles.chartFrame}`}>
        <ResponsiveContainer>
          <LineChart layout="vertical" data={chartData} margin={{ top: 4, right: 12, bottom: 2, left: 2 }}>
            <CartesianGrid stroke="#161d26" />
            <XAxis type="number" domain={["auto", "auto"]} stroke={AX.stroke} tick={AX.tick} tickLine={false} height={22} />
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
              dataKey="observed"
              stroke="#34d1c4"
              strokeWidth={1.8}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="model"
              stroke="#98a4b0"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            {activeDepth !== null && (
              <ReferenceLine y={activeDepth} stroke="#eaa64a" strokeDasharray="3 3" />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {gaps.length > 0 && (
        <div className={styles.note}>
          {summariseGaps(gaps).map((g) => (
            <span key={g.label} className={styles.badNote}>
              {g.label}
            </span>
          ))}
        </div>
      )}

      {/* difference */}
      <div className={styles.chartHead} style={{ marginTop: 12 }}>
        <span className={styles.chartName}>difference</span>
        <span className={styles.legendDim}>
          observed − model
          {s.depth_of_max !== null && ` · max Δ ${fmt(s.max_abs_difference, 1)} ${unit} @ ${s.depth_of_max} m`}
        </span>
      </div>
      <div className={`${styles.chartWrapSm} ${styles.chartFrame}`}>
        <ResponsiveContainer>
          <LineChart layout="vertical" data={chartData} margin={{ top: 2, right: 12, bottom: 2, left: 2 }}>
            <CartesianGrid stroke="#161d26" />
            <XAxis type="number" domain={["auto", "auto"]} stroke={AX.stroke} tick={AX.tick} tickLine={false} height={18} />
            <YAxis type="number" dataKey="depth" domain={[0, "dataMax"]} stroke={AX.stroke} tick={AX.tick} tickLine={false} width={40} />
            <ReferenceLine x={0} stroke="#3a4652" />
            {activeDepth !== null && (
              <ReferenceLine y={activeDepth} stroke="#eaa64a" strokeDasharray="3 3" />
            )}
            <Line type="monotone" dataKey="difference" stroke="#e8a33d" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {activeDepth !== null && (
        <div className={styles.depthCue}>
          <span className={styles.depthCueMark} />
          at <b>{Math.round(activeDepth)} m</b>
          {atDepth ? (
            atDepth.status === "ok" && atDepth.observed !== null && atDepth.model !== null ? (
              <>
                {" · observed "}<b>{atDepth.observed.toFixed(2)}</b>
                {" · model "}<b>{atDepth.model.toFixed(2)}</b>
                {" · Δ "}
                <b>
                  {atDepth.difference !== null && atDepth.difference > 0 ? "+" : ""}
                  {atDepth.difference?.toFixed(2)} {unit}
                </b>
              </>
            ) : (
              <>
                {" · "}
                <span className={styles.badNote}>
                  {STATUS_LABEL[atDepth.status] ?? atDepth.status}
                </span>
                {atDepth.observed !== null && ` · observed ${atDepth.observed.toFixed(2)} ${unit}`}
              </>
            )
          ) : (
            " · outside this float's profile"
          )}
        </div>
      )}

      {/* stats */}
      <div className={styles.section}>
        <StatRow
          items={[
            { label: "bias", value: fmt(s.bias), unit },
            { label: "RMSE", value: fmt(shift === 0 ? s.rmse : liveRmse), unit },
            { label: "max |Δ|", value: fmt(s.max_abs_difference, 1), unit },
            { label: "depth of max", value: s.depth_of_max === null ? "—" : String(s.depth_of_max), unit: "m" },
          ]}
        />
        <div className={styles.matchLine}>
          nearest model cell {comparison.matching.spatial_separation_km.toFixed(1)} km away ·{" "}
          {comparison.matching.temporal_separation_hours.toFixed(1)} h apart · {comparison.matching.method}
        </div>
      </div>

      {/* error decomposition */}
      {dec && (
        <div className={styles.decomp}>
          <div className={styles.decompBar}>
            <span className="eyebrow">Error decomposition</span>
            <span className={styles.decompTag}>displacement vs amplitude</span>
          </div>
          <div className={styles.decompQ}>Is the model wrong about the value, or about the depth?</div>
          <div className={styles.shiftRow}>
            <input
              type="range"
              className={styles.shiftRange}
              style={{ "--fill": `${((shift + 120) / 240) * 100}%` } as CSSProperties}
              min={-120}
              max={120}
              step={5}
              value={shift}
              onChange={(e) => setShift(Number(e.target.value))}
            />
            <span className={styles.shiftVal}>{shift > 0 ? "+" : ""}{shift} m</span>
          </div>
          <button className={styles.snap} onClick={() => setShift(dec.best_shift_m)}>
            snap to best fit · {dec.best_shift_m > 0 ? "+" : ""}{dec.best_shift_m} m
          </button>
          <div className={styles.figs}>
            <div className={styles.fig}>
              <div className={styles.figLabel}>raw RMSE</div>
              <div className={styles.figValue}>{dec.raw_rmse.toFixed(2)} {unit}</div>
            </div>
            <div className={styles.fig}>
              <div className={styles.figLabel}>best shift</div>
              <div className={styles.figValue}>{dec.best_shift_m > 0 ? "+" : ""}{dec.best_shift_m} m</div>
            </div>
            <div className={styles.fig}>
              <div className={styles.figLabel}>RMSE after shift</div>
              <div className={styles.figValue}>{dec.shifted_rmse.toFixed(2)} {unit}</div>
            </div>
          </div>
          <div className={styles.verdict}>
            {!dec.conclusive ? (
              <>No clear displacement signal — the misfit doesn’t line up with a vertical shift.</>
            ) : (
              <>
                <b>{Math.round(dec.displacement_fraction * 100)}% of this error is displacement</b>,
                not amplitude — the model has the right water in the wrong place.{" "}
                <span className={styles.legendDim}>
                  over {dec.n_valid_after_shift} levels with model coverage at this shift
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
