import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useStore } from "../state/store";
import { Empty, Panel, Shimmer } from "../ui/kit";
import styles from "./panels.module.css";

const AXIS = { stroke: "#2a3742", tick: { fill: "#7d8b98", fontSize: 9, fontFamily: "JetBrains Mono" } };

export default function ProfilePanel() {
  const profile = useStore((s) => s.profile);
  const loading = useStore((s) => s.loading.profile);
  const selected = useStore((s) => s.selectedFloatId);
  const variable = useStore((s) => s.variable);
  const error = useStore((s) => s.error);

  if (!selected)
    return (
      <Panel title="Profile">
        <Empty hint="observed vs depth">Select a float marker in the 3D view.</Empty>
      </Panel>
    );
  if (loading) return <Panel title="Profile"><Shimmer lines={5} /></Panel>;
  if (!profile)
    return (
      <Panel title="Profile">
        <Empty hint="retry from the map">
          {error ? `Couldn't load profile — ${error.replace("Error: ", "")}` : "No profile."}
        </Empty>
      </Panel>
    );

  const unit = profile.units || (variable === "temperature" ? "degC" : "psu");
  const rejected = profile.levels.filter((l) => l.value === null);
  const data = profile.levels.map((l) => ({ depth: l.depth, value: l.value }));

  return (
    <Panel
      title="Profile"
      sub={`float ${profile.float_id} · ${profile.lat.toFixed(2)}°, ${profile.lon.toFixed(2)}° · ${profile.time.slice(0, 10)}`}
    >
      <div className={styles.chartHead}>
        <span className={styles.chartName}>Argo {profile.variable} profile</span>
        <span className={styles.legendDim}>
          {profile.levels.length} levels
          {rejected.length > 0 && ` · ${rejected.length} QC-rejected`}
        </span>
      </div>
      <div className={`${styles.chartWrap} ${styles.chartFrame}`}>
        <ResponsiveContainer>
          <LineChart layout="vertical" data={data} margin={{ top: 4, right: 14, bottom: 2, left: 2 }}>
            <CartesianGrid stroke="#161d26" />
            <XAxis
              type="number"
              domain={["auto", "auto"]}
              stroke={AXIS.stroke}
              tick={AXIS.tick}
              tickLine={false}
              height={26}
              label={{ value: `${variable} (${unit})`, position: "insideBottom", offset: 0, fill: "#7d8b98", fontSize: 9 }}
            />
            <YAxis
              type="number"
              dataKey="depth"

              domain={[0, "dataMax"]}
              stroke={AXIS.stroke}
              tick={AXIS.tick}
              tickLine={false}
              width={40}
              label={{ value: "depth (m)", angle: -90, position: "insideLeft", fill: "#7d8b98", fontSize: 9 }}
            />
            <Tooltip
              contentStyle={{ background: "#121a22", border: "1px solid #1b232d", fontFamily: "JetBrains Mono", fontSize: 11 }}
              labelFormatter={(d) => `${d} m`}
              formatter={(v) => [`${typeof v === "number" ? v.toFixed(2) : v} ${unit}`, variable]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#34d1c4"
              strokeWidth={1.7}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
            {rejected.map((l) => (
              <ReferenceDot
                key={l.depth}
                x={interpAt(data, l.depth)}
                y={l.depth}
                r={3}
                fill="none"
                stroke="#ec6a72"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {rejected.length > 0 && (
        <div className={styles.note}>
          <span className={styles.badNote}>
            {rejected.length} QC-rejected level{rejected.length > 1 ? "s" : ""} shown as gaps
          </span>
        </div>
      )}
    </Panel>
  );
}

function interpAt(data: { depth: number; value: number | null }[], depth: number): number | undefined {
  const pts = data.filter((d) => d.value !== null) as { depth: number; value: number }[];
  for (let i = 1; i < pts.length; i++) {
    if (depth >= pts[i - 1].depth && depth <= pts[i].depth) {
      const t = (depth - pts[i - 1].depth) / (pts[i].depth - pts[i - 1].depth || 1);
      return pts[i - 1].value + t * (pts[i].value - pts[i - 1].value);
    }
  }
  return undefined;
}
