import { formatLonLat, haversineKm } from "../three/coords";
import type { PointInfo } from "../three/ThreeView";
import { Empty, Panel, StatRow, Toggle } from "../ui/kit";
import styles from "./panels.module.css";

export default function MeasurePanel({
  measuring,
  a,
  b,
  onToggle,
  onClear,
}: {
  measuring: boolean;
  a: PointInfo | null;
  b: PointInfo | null;
  onToggle: () => void;
  onClear: () => void;
}) {
  const km = a && b ? haversineKm(a.lat, a.lon, b.lat, b.lon) : null;
  const depthGap = a && b ? Math.abs(a.depth - b.depth) : null;

  return (
    <Panel
      title="Distance"
      action={
        (a || b) && (
          <button className={styles.source} onClick={onClear}>
            clear ✕
          </button>
        )
      }
    >
      <Toggle label="Measure between two points" on={measuring} onChange={onToggle} />

      {!measuring ? (
        <Empty hint="toggle it on above">
          Turn measuring on, then click two points in the 3D view.
        </Empty>
      ) : !a ? (
        <Empty hint="click anywhere on the field">Click a first point.</Empty>
      ) : !b ? (
        <Empty hint="click a second point">
          Point A at {formatLonLat(a.lon, a.lat)}, {Math.round(a.depth)} m — click a second point.
        </Empty>
      ) : (
        <div className={styles.section}>
          <StatRow
            items={[
              { label: "great-circle distance", value: km!.toFixed(1), unit: "km" },
              { label: "depth gap", value: depthGap!.toFixed(0), unit: "m" },
            ]}
          />
          <p className={styles.matchLine}>
            A {formatLonLat(a.lon, a.lat)} @ {Math.round(a.depth)} m · B{" "}
            {formatLonLat(b.lon, b.lat)} @ {Math.round(b.depth)} m
          </p>
        </div>
      )}
    </Panel>
  );
}
