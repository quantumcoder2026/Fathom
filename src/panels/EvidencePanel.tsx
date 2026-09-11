import { useMemo } from "react";

import { useStore } from "../state/store";
import { Empty, Panel, StatRow, Toggle } from "../ui/kit";
import styles from "./panels.module.css";

export default function EvidencePanel() {
  const showEvidence = useStore((s) => s.showEvidence);
  const toggleEvidence = useStore((s) => s.toggleEvidence);
  const cells = useStore((s) => s.evidenceCells);
  const radius = useStore((s) => s.evidenceRadius);
  const halfLife = useStore((s) => s.evidenceHalfLife);
  const unconstrainedPct = useStore((s) => s.unconstrainedPct);
  const depthM = useStore((s) => s.meta?.depths[s.depthIndex] ?? null);

  const counts = useMemo(() => {
    const c = { constrained: 0, weak: 0, unconstrained: 0 };
    for (const cell of cells) c[cell.status] += 1;
    return c;
  }, [cells]);

  return (
    <Panel title="Evidence" sub={depthM !== null ? `at ${Math.round(depthM)} m` : undefined}>
      <Toggle label="Show evidence overlay" on={showEvidence} onChange={toggleEvidence} />
      <p className={styles.matchLine} style={{ marginTop: 10 }}>
        Confidence is a weighting over nearby Argo observation count and recency — a tunable
        assumption, not a physical law. Influence radius {radius.toFixed(1)}° · recency
        half-life {halfLife} d.
      </p>

      {!showEvidence ? (
        <Empty hint="toggle it on above">
          Turn the overlay on to see the coverage grid for this depth and timestep.
        </Empty>
      ) : cells.length === 0 ? (
        <Empty hint="loading…">Fetching the coverage grid.</Empty>
      ) : (
        <div className={styles.section}>
          <StatRow
            items={[
              { label: "constrained", value: String(counts.constrained) },
              { label: "weak", value: String(counts.weak) },
              { label: "unconstrained", value: String(counts.unconstrained) },
              {
                label: "unconstrained water column",
                value: unconstrainedPct === null ? "—" : String(unconstrainedPct),
                unit: "%",
              },
            ]}
          />
        </div>
      )}
    </Panel>
  );
}
