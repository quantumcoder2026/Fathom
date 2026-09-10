import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import type { FieldMeta, FloatIndexItem } from "../../contracts/types";
import { createGlobe, type GlobeHandle, type GlobeRegion } from "../three/globe";
import { REGIONS, useStore, type Region } from "../state/store";
import styles from "./RegionEntry.module.css";

const CENTROIDS: Record<string, { lat: number; lon: number }> = {
  io: { lat: 0, lon: 78 },
  pac: { lat: 0, lon: -150 },
  atl: { lat: 15, lon: -30 },
  so: { lat: -62, lon: 20 },
  arc: { lat: 80, lon: 0 },
};

export default function RegionEntry() {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GlobeHandle | null>(null);
  const enterRegion = useStore((s) => s.enterRegion);
  const selectFloat = useStore((s) => s.selectFloat);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const [floats, setFloats] = useState<FloatIndexItem[]>([]);
  const [meta, setMeta] = useState<FieldMeta | null>(null);

  const globeRegions: GlobeRegion[] = useMemo(
    () =>
      REGIONS.map((r) => ({
        id: r.id,
        label: r.label,
        hasData: r.hasData,
        ...CENTROIDS[r.id],
      })),
    [],
  );

  // the globe plots the real float positions, so it needs the index up front
  useEffect(() => {
    let live = true;
    void api.floats(0).then((f) => live && setFloats(f)).catch(() => undefined);
    void api.fieldMeta().then((m) => live && setMeta(m)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // one-shot guard: the fly-in animation and the safety timer race
    const enterOnce = (region: Region, floatId?: string) => {
      let done = false;
      return () => {
        if (done) return;
        done = true;
        enterRegion(region);
        if (floatId) selectFloat(floatId);
      };
    };

    const handle = createGlobe(container, globeRegions, floats, {
      onHoverRegion: (id) => setHoveredId(id),
      onSelectRegion: (id) => {
        const region = REGIONS.find((r) => r.id === id);
        if (!region) return;
        setEntering(region.label);
        const go = enterOnce(region);
        handle.flyTo(id, go);
        window.setTimeout(go, 2200);
      },
      onSelectFloat: (floatId, lat, lon) => {
        const region = REGIONS.find((r) => r.hasData) ?? REGIONS[0];
        setEntering(`float ${floatId}`);
        const go = enterOnce(region, floatId);
        handle.flyToLatLon(lat, lon, go);
        window.setTimeout(go, 2200);
      },
    });

    handleRef.current = handle;
    const ro = new ResizeObserver(() => handle.resize());
    ro.observe(container);
    return () => {
      ro.disconnect();
      handle.dispose();
      handleRef.current = null;
    };
  }, [globeRegions, floats, enterRegion, selectFloat]);

  const hovered = REGIONS.find((r) => r.id === hoveredId) ?? null;
  const cells = meta ? meta.nx * meta.ny * meta.depths.length : null;

  return (
    <div className={styles.screen}>
      <div ref={containerRef} className={styles.canvas} />

      <div className={styles.mark}>
        <div className={styles.wordmark}>FATHOM</div>
        <div className={styles.tagline}>
          Where the ocean model and the ocean disagree — and why.
        </div>
      </div>

      <div className={`${styles.hoverCard} ${hovered ? styles.show : ""}`}>
        {hovered && (
          <>
            <div className={styles.hoverLabel}>{hovered.label}</div>
            <div className={styles.hoverMeta}>
              {hovered.hasData ? (
                <>
                  {cells ? cells.toLocaleString() : "—"} model cells
                  <br />
                  {floats.length} Argo floats
                  <br />
                  {meta ? meta.times.length : "—"} timesteps ·{" "}
                  {meta ? meta.depths.length : "—"} depths
                </>
              ) : (
                "no dataset loaded"
              )}
            </div>
            <div className={`${styles.hoverHint} ${hovered.hasData ? "" : styles.disabled}`}>
              {hovered.hasData ? "click to enter →" : "unavailable"}
            </div>
          </>
        )}
      </div>

      <div className={styles.legend}>
        <div className={styles.legendRow}>
          <span className={`${styles.swatch} ${styles.on}`} /> dataset loaded
        </div>
        <div className={styles.legendRow}>
          <span className={`${styles.swatch} ${styles.off}`} /> no dataset loaded
        </div>
        <div className={styles.legendRow}>
          <span className={`${styles.dot} ${styles.on}`} />
          {floats.length} Argo floats — click one to open its profile
        </div>
      </div>

      <div className={styles.stamp}>v0.1.0-demo · build 2026.09.11</div>

      {entering && <div className={styles.entering}>Entering {entering}…</div>}
    </div>
  );
}
