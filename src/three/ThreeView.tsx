/**
 * React wrapper around the Three.js scene: depth planes, float markers, and the
 * in-scene depth axis. Owns a <canvas> plus a CSS2D label layer above it.
 *
 * Prop changes are pushed imperatively:
 *   meta / variable / timeIndex       -> reload all depth planes
 *   depthIndex                        -> highlight one plane + move the axis marker
 *   exaggeration / opacity / colormap -> live setters
 *   floats / selectedFloatId          -> markers
 *
 * Pointer behaviour:
 *   hover  -> reads the value under the cursor on the active plane (onHoverPoint)
 *   click  -> a float marker selects it (onSelectFloat); otherwise the point on the
 *             active plane is picked (onPickPoint). Dragging never selects.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";

import type { FieldMeta, FloatIndexItem, Profile } from "../../contracts/types";
import { DepthAxis } from "./axis";
import type { Palette } from "./colormap";
import { lonLatToGridIndex, worldXZToLonLat } from "./coords";
import { FieldLayers, type GridLoader } from "./field";
import { FloatMarkers } from "./markers";
import { ProfileTrail } from "./trail";
import { createScene, type SceneHandle } from "./scene";

export interface PointInfo {
  lon: number;
  lat: number;
  depth: number;
  /** null where the model has no value here — land, or below the seafloor. */
  value: number | null;
  /** The model's whole vertical column at this cell, one entry per depth level,
   *  null where there is no value. Read straight out of the grids already in
   *  memory, so picking a point costs no network round trip. */
  column?: (number | null)[];
}

export interface ThreeViewProps {
  meta: FieldMeta;
  variable: string;
  timeIndex: number;
  depthIndex: number;
  colormap: { min: number; max: number; palette: Palette; scale: "linear" | "log" };
  exaggeration: number;
  opacity: number;
  loadGrid: GridLoader;
  floats?: FloatIndexItem[];
  selectedFloatId?: string | null;
  /** the selected float's profile, drawn as a string of beads down the stack */
  profile?: Profile | null;
  onSelectFloat?: (id: string) => void;
  onHoverPoint?: (info: PointInfo | null) => void;
  onPickPoint?: (info: PointInfo) => void;

  // reserved for the evidence pass
  showEvidence?: boolean;
}

const CLICK_MOVE_TOLERANCE = 6; // px — beyond this a pointer gesture is an orbit

export default function ThreeView(props: ThreeViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  const sceneRef = useRef<SceneHandle | null>(null);
  const fieldRef = useRef<FieldLayers | null>(null);
  const markersRef = useRef<FloatMarkers | null>(null);
  const axisRef = useRef<DepthAxis | null>(null);
  const trailRef = useRef<ProfileTrail | null>(null);

  // latest props for the imperative pointer handlers, which live in a []-effect
  const live = useRef(props);
  useEffect(() => {
    live.current = props;
  });

  /** Raycast the active depth plane and read the model value at that cell.
   *  `withColumn` also reads every depth level at that cell (for picking). */
  const probe = (clientX: number, clientY: number, withColumn = false): PointInfo | null => {
    const handle = sceneRef.current;
    const field = fieldRef.current;
    const canvas = canvasRef.current;
    if (!handle || !field || !canvas) return null;
    const { meta, depthIndex } = live.current;
    const plane = field.planeAt(depthIndex);
    if (!plane) return null;

    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, handle.camera);
    const hit = ray.intersectObject(plane, false)[0];
    if (!hit) return null;

    const [lon, lat] = worldXZToLonLat(meta, hit.point.x, hit.point.z);
    const cell = lonLatToGridIndex(meta, lon, lat);
    if (!cell) return null;
    const offset = cell.row * meta.nx + cell.col;
    const at = (d: number): number | null => {
      const grid = field.gridAt(d);
      const raw = grid ? grid[offset] : Number.NaN;
      // isFinite, not !isNaN: an out-of-range read gives undefined, and
      // Number.isNaN(undefined) is false — that slipped through and crashed the panel.
      return Number.isFinite(raw) ? (raw as number) : null;
    };

    return {
      lon,
      lat,
      depth: meta.depths[depthIndex] ?? 0,
      value: at(depthIndex),
      column: withColumn ? meta.depths.map((_, d) => at(d)) : undefined,
    };
  };

  /** Floating label beside the active plane: its depth and the value range on it. */
  function updatePlaneLabel() {
    const { meta, depthIndex, variable } = live.current;
    const range = fieldRef.current?.rangeAt(depthIndex);
    const unit = variable === "temperature" ? "°C" : "psu";
    const depth = meta.depths[depthIndex];
    axisRef.current?.setPlaneLabel(
      range
        ? `${Math.round(depth)} m · ${range.min.toFixed(1)}–${range.max.toFixed(1)} ${unit}`
        : `${Math.round(depth)} m · no data`,
    );
  }

  // scene lifecycle + pointer handling
  useEffect(() => {
    const canvas = canvasRef.current;
    const labels = labelsRef.current;
    if (!canvas || !labels) return;

    const handle = createScene(canvas, labels);
    sceneRef.current = handle;
    if (import.meta.env.DEV) (window as unknown as { __three?: unknown }).__three = handle;

    const ro = new ResizeObserver(() => handle.resize());
    ro.observe(canvas);

    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (down) return; // orbiting — don't chase the cursor
      live.current.onHoverPoint?.(probe(e.clientX, e.clientY));
    };
    const onLeave = () => live.current.onHoverPoint?.(null);
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      down = null;
      if (moved > CLICK_MOVE_TOLERANCE) return;
      const id = markersRef.current?.pick(e.clientX, e.clientY, canvas, handle.camera);
      if (id) {
        live.current.onSelectFloat?.(id);
        return;
      }
      const point = probe(e.clientX, e.clientY, true);
      if (point) live.current.onPickPoint?.(point);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerup", onUp);

    return () => {
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerup", onUp);
      axisRef.current?.dispose();
      axisRef.current = null;
      trailRef.current?.dispose();
      trailRef.current = null;
      markersRef.current?.dispose();
      markersRef.current = null;
      fieldRef.current?.dispose();
      fieldRef.current = null;
      handle.dispose();
      sceneRef.current = null;
    };
  }, []);

  // depth axis + markers — rebuilt only when the geographic frame changes
  useEffect(() => {
    const handle = sceneRef.current;
    if (!handle) return;

    const axis = new DepthAxis(props.meta);
    axisRef.current = axis;
    handle.scene.add(axis.group);
    axis.setExaggeration(props.exaggeration);
    axis.setActive(props.depthIndex);

    const trail = new ProfileTrail(props.meta);
    trailRef.current = trail;
    handle.scene.add(trail.group);

    const markers = new FloatMarkers(props.meta);
    markersRef.current = markers;
    handle.scene.add(markers.group);
    markers.setFloats(props.floats ?? []);
    markers.setSelected(props.selectedFloatId ?? null);
    handle.renderOnce();

    return () => {
      handle.scene.remove(axis.group, markers.group, trail.group);
      axis.dispose();
      markers.dispose();
      trail.dispose();
    };
  }, [props.meta]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    markersRef.current?.setFloats(props.floats ?? []);
    markersRef.current?.setSelected(props.selectedFloatId ?? null);
  }, [props.floats]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    markersRef.current?.setSelected(props.selectedFloatId ?? null);
    sceneRef.current?.renderOnce();
  }, [props.selectedFloatId]);

  // depth planes — reload on frame / variable / time change
  useEffect(() => {
    const handle = sceneRef.current;
    if (!handle) return;

    if (fieldRef.current) {
      handle.scene.remove(fieldRef.current.group);
      fieldRef.current.dispose();
    }

    const layers = new FieldLayers(props.meta, props.loadGrid, props.colormap);
    fieldRef.current = layers;
    handle.scene.add(layers.group);
    layers.setExaggeration(props.exaggeration);
    layers.setOpacity(props.opacity);
    void layers.load(props.variable, props.timeIndex).then(() => {
      if (fieldRef.current !== layers) return;
      layers.setActiveDepth(props.depthIndex);
      updatePlaneLabel();
      handle.renderOnce();
    });
  }, [props.meta, props.variable, props.timeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fieldRef.current?.setActiveDepth(props.depthIndex);
    axisRef.current?.setActive(props.depthIndex);
    updatePlaneLabel();
    sceneRef.current?.renderOnce();
  }, [props.depthIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fieldRef.current?.setExaggeration(props.exaggeration);
    axisRef.current?.setExaggeration(props.exaggeration);
    trailRef.current?.setExaggeration(props.exaggeration);
    sceneRef.current?.renderOnce();
  }, [props.exaggeration]);

  useEffect(() => {
    fieldRef.current?.setOpacity(props.opacity);
    sceneRef.current?.renderOnce();
  }, [props.opacity]);

  // the selected float's bead string
  useEffect(() => {
    trailRef.current?.set(props.profile ?? null, props.colormap, props.exaggeration);
    sceneRef.current?.renderOnce();
  }, [props.profile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fieldRef.current?.setColormap(props.colormap);
    trailRef.current?.set(props.profile ?? null, props.colormap, props.exaggeration);
    sceneRef.current?.renderOnce();
  }, [props.colormap]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      <div
        ref={labelsRef}
        style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
      />
    </div>
  );
}
