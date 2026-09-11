import { useCallback, useState, type CSSProperties, type ReactNode } from "react";

import { api } from "../api/client";
import ComparisonPanel from "../panels/ComparisonPanel";
import PointPanel from "../panels/PointPanel";
import ProfilePanel from "../panels/ProfilePanel";
import { useStore } from "../state/store";
import ColorbarEditor from "../ui/ColorbarEditor";
import { LabeledSlider, Segmented, Toggle } from "../ui/kit";
import ThreeView, { type PointInfo } from "../three/ThreeView";
import { formatLonLat } from "../three/coords";
import styles from "./Workspace.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export default function Workspace() {
  const s = useStore();
  const meta = s.meta;
  const [hover, setHover] = useState<PointInfo | null>(null);
  const [picked, setPicked] = useState<PointInfo | null>(null);

  const loadGrid = useCallback(
    (variable: string, t: number, d: number) => api.fieldGrid(variable, t, d),
    [],
  );

  const iso = meta?.times[s.timeIndex]?.slice(0, 10) ?? "";
  const depthM = meta?.depths[s.depthIndex] ?? 0;
  const nTimes = meta?.times.length ?? 1;
  const unit = s.variable === "temperature" ? "°C" : "psu";

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>FATHOM</span>
          <button className={styles.crumb} onClick={s.backToEntry} title="back to region select">
            <span className={styles.crumbArrow}>←</span>
            {s.region?.label ?? "—"}
          </button>
        </div>

        <div className={styles.headCenter}>
          <Segmented
            options={[
              { value: "temperature", label: "Temperature" },
              { value: "salinity", label: "Salinity" },
            ]}
            value={s.variable}
            onChange={s.setVariable}
          />
          <div className={styles.timeCtl}>
            <button
              className={styles.stepBtn}
              onClick={() => s.setTimeIndex(Math.max(0, s.timeIndex - 1))}
              aria-label="previous day"
            >
              ‹
            </button>
            <div className={styles.timeTrack}>
              <input
                type="range"
                className={styles.timeRange}
                style={{ "--fill": `${(s.timeIndex / Math.max(1, nTimes - 1)) * 100}%` } as CSSProperties}
                min={0}
                max={Math.max(0, nTimes - 1)}
                value={s.timeIndex}
                onChange={(e) => s.setTimeIndex(Number(e.target.value))}
              />
              <span className={styles.timeLabel}>
                {iso ? prettyDate(iso) : "—"} <em>· {s.timeIndex + 1}/{nTimes}</em>
              </span>
            </div>
            <button
              className={styles.stepBtn}
              onClick={() => s.setTimeIndex(Math.min(nTimes - 1, s.timeIndex + 1))}
              aria-label="next day"
            >
              ›
            </button>
          </div>
        </div>

        <div className={styles.headline} title="fraction of the model water column with no recent nearby observation">
          <span className={styles.headlineNum}>
            {s.unconstrainedPct === null ? "···" : `${s.unconstrainedPct}%`}
          </span>
          <span className={styles.headlineCap}>
            unconstrained<br />water column
          </span>
        </div>
      </header>

      <aside className={styles.rail}>
        <RailGroup n="01" title="Field">
          <LabeledSlider
            label="depth level"
            value={s.depthIndex}
            display={`${depthM} m`}
            min={0}
            max={Math.max(0, (meta?.depths.length ?? 1) - 1)}
            onChange={s.setDepthIndex}
          />
        </RailGroup>

        <RailGroup n="02" title="3D view">
          <LabeledSlider
            label="vertical exaggeration"
            value={s.exaggeration}
            display={`${s.exaggeration}×`}
            min={1}
            max={50}
            onChange={s.setExaggeration}
          />
          <LabeledSlider
            label="plane opacity"
            value={s.opacity}
            display={s.opacity.toFixed(2)}
            min={0}
            max={1}
            step={0.05}
            onChange={s.setOpacity}
          />
        </RailGroup>

        <RailGroup n="03" title="Colour scale">
          <ColorbarEditor />
        </RailGroup>

        <RailGroup n="04" title="Evidence">
          <Toggle label="Evidence layer" on={s.showEvidence} onChange={s.toggleEvidence} />
          <p className={styles.groupNote}>
            Shades the field by how well recent Argo profiles support it. Both knobs are
            assumptions, not physical constants.
          </p>
          {s.showEvidence && (
            <>
              <LabeledSlider
                label="influence radius"
                value={s.evidenceRadius}
                display={`${s.evidenceRadius.toFixed(1)}°`}
                min={1}
                max={5}
                step={0.5}
                onChange={s.setEvidenceRadius}
              />
              <LabeledSlider
                label="recency half-life"
                value={s.evidenceHalfLife}
                display={`${s.evidenceHalfLife} d`}
                min={7}
                max={45}
                step={1}
                onChange={s.setEvidenceHalfLife}
              />
            </>
          )}
        </RailGroup>

        <RailGroup n="05" title="Dataset">
          <dl className={styles.meta}>
            <dt>model</dt>
            <dd>{meta?.source ?? "—"}</dd>
            <dt>grid</dt>
            <dd>
              {meta ? `${meta.nx} × ${meta.ny} · ${meta.depths.length} depths` : "—"}
            </dd>
            <dt>window</dt>
            <dd>
              {meta
                ? `${meta.times.length} steps · ${prettyDate(meta.times[0].slice(0, 10))}`
                : "—"}
            </dd>
            <dt>observations</dt>
            <dd>{s.floats.length} Argo profiles</dd>
          </dl>
          <p className={styles.groupNote}>
            <span className={styles.noDataSwatch} /> land or below the seafloor — shown as a
            gap, never as zero.
          </p>
        </RailGroup>
      </aside>

      <main className={styles.main}>
        <div className={styles.viewport}>
          <div className={styles.viewGrid} aria-hidden />
          <div className={styles.viewReadout}>
            <span className={styles.roVar}>{s.variable}</span>
            <span className={styles.roVal}>{depthM} m</span>
            <span className={styles.roVal}>{iso}</span>
            <span className={styles.roDim}>
              range{" "}
              {meta
                ? `${meta.ranges[s.variable]?.min.toFixed(1)}–${meta.ranges[s.variable]?.max.toFixed(1)} ${unit}`
                : "—"}
            </span>
            <span className={styles.roProbe}>
              {hover ? (
                <>
                  <b>
                    {hover.value === null ? "no data" : `${hover.value.toFixed(2)} ${unit}`}
                  </b>
                  <i>{formatLonLat(hover.lon, hover.lat)}</i>
                </>
              ) : (
                <i>hover the field to read a value</i>
              )}
            </span>
          </div>
          <div className={styles.depthGutter}>
            <span>0 m</span>
            <span>{meta?.depths[Math.floor((meta.depths.length - 1) / 2)] ?? ""} m</span>
            <span>{meta?.depths[meta.depths.length - 1] ?? ""} m</span>
          </div>
          {meta && (
            <ThreeView
              meta={meta}
              variable={s.variable}
              timeIndex={s.timeIndex}
              depthIndex={s.depthIndex}
              colormap={s.colormap}
              exaggeration={s.exaggeration}
              opacity={s.opacity}
              loadGrid={loadGrid}
              floats={s.floats}
              selectedFloatId={s.selectedFloatId}
              onSelectFloat={s.selectFloat}
              onHoverPoint={setHover}
              onPickPoint={setPicked}
              profile={s.profile}
              showEvidence={s.showEvidence}
              evidenceCells={s.evidenceCells}
            />
          )}
          {s.showEvidence && (
            <div className={styles.evLegend}>
              <span><i className={styles.evC} />constrained</span>
              <span><i className={styles.evW} />weak</span>
              <span><i className={styles.evU} />unconstrained</span>
            </div>
          )}
          {!s.selectedFloatId && s.floats.length > 0 && (
            <div className={styles.viewHint}>click a float marker to compare it with the model</div>
          )}
        </div>
      </main>

      <aside className={styles.analysis}>
        {picked && <PointPanel point={picked} onClose={() => setPicked(null)} />}
        <ProfilePanel />
        <ComparisonPanel />
      </aside>
    </div>
  );
}

function RailGroup(props: { n: string; title: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <span className={styles.groupN}>{props.n}</span>
        <span className="eyebrow">{props.title}</span>
      </div>
      {props.children}
    </div>
  );
}
