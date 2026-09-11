import { useStore } from "../state/store";
import { Empty, Panel } from "../ui/kit";
import styles from "./panels.module.css";

export default function ProvenancePanel() {
  const comparison = useStore((s) => s.comparison);
  const selected = useStore((s) => s.selectedFloatId);

  if (!selected || !comparison) {
    return (
      <Panel title="Provenance">
        <Empty hint="every comparison traces to a file">
          Select a float and let its comparison load to see the source files, QC flags,
          separation and method behind the numbers.
        </Empty>
      </Panel>
    );
  }

  return (
    <Panel title="Provenance" sub={`float ${comparison.float_id}`}>
      <div className={styles.provCard}>
        <div>
          <b>model_file</b> {comparison.provenance.model_file}
        </div>
        <div>
          <b>obs_file</b> {comparison.provenance.obs_file}
        </div>
        <div>
          <b>qc_flags_accepted</b> [{comparison.provenance.qc_flags_accepted.join(", ")}]
        </div>
        <div>
          <b>separation</b> {comparison.matching.spatial_separation_km.toFixed(1)} km ·{" "}
          {comparison.matching.temporal_separation_hours.toFixed(1)} h
        </div>
        <div>
          <b>method</b> {comparison.matching.method}
        </div>
        <div>
          <b>generated_at</b> {comparison.provenance.generated_at}
        </div>
      </div>
    </Panel>
  );
}
