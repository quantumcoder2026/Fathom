/**
 * Two-point distance measurement: a pin at each picked point, a dashed line
 * between them, and a floating label with the great-circle distance (and the
 * depth gap, if the two points sit at different depths — nothing stops you
 * measuring between planes).
 */

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

import type { FieldMeta } from "../../contracts/types";
import { depthToWorldY, haversineKm, lonLatToWorldXZ } from "./coords";

export interface MeasurePoint {
  lon: number;
  lat: number;
  depth: number;
}

const PIN_RADIUS = 0.34;
const COLOR = 0xeaa64a; // amber — matches the point inspector, not the float/comparison cyan

export class MeasureLayer {
  readonly group = new THREE.Group();

  private readonly meta: FieldMeta;
  private readonly geometry = new THREE.SphereGeometry(PIN_RADIUS, 12, 10);
  private readonly material = new THREE.MeshBasicMaterial({
    color: COLOR,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  private readonly lineMat = new THREE.LineDashedMaterial({
    color: COLOR,
    transparent: true,
    opacity: 0.85,
    dashSize: 0.4,
    gapSize: 0.25,
  });

  private pins: THREE.Mesh[] = [];
  private line: THREE.Line | null = null;
  private label: CSS2DObject | null = null;

  constructor(meta: FieldMeta) {
    this.meta = meta;
  }

  /** Rebuilds pins/line/label from scratch — cheap enough at two points that
   *  there's no separate incremental update path. */
  set(a: MeasurePoint | null, b: MeasurePoint | null, exaggeration: number): void {
    this.clear();

    for (const p of [a, b]) {
      if (!p) continue;
      const [x, z] = lonLatToWorldXZ(this.meta, p.lon, p.lat);
      const y = depthToWorldY(this.meta, p.depth, exaggeration);
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.position.set(x, y, z);
      mesh.renderOrder = 1002;
      this.pins.push(mesh);
      this.group.add(mesh);
    }

    if (!a || !b) return;

    const [ax, az] = lonLatToWorldXZ(this.meta, a.lon, a.lat);
    const ay = depthToWorldY(this.meta, a.depth, exaggeration);
    const [bx, bz] = lonLatToWorldXZ(this.meta, b.lon, b.lat);
    const by = depthToWorldY(this.meta, b.depth, exaggeration);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([ax, ay, az, bx, by, bz], 3));
    this.line = new THREE.Line(geo, this.lineMat);
    this.line.computeLineDistances();
    this.line.renderOrder = 1001;
    this.group.add(this.line);

    const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
    const depthGap = Math.abs(a.depth - b.depth);
    const el = document.createElement("div");
    el.className = "f3d-measure-label";
    el.textContent = depthGap > 0 ? `${km.toFixed(1)} km · Δ${depthGap.toFixed(0)} m` : `${km.toFixed(1)} km`;
    const label = new CSS2DObject(el);
    label.position.set((ax + bx) / 2, Math.max(ay, by) + 0.5, (az + bz) / 2);
    this.label = label;
    this.group.add(label);
  }

  private clear(): void {
    for (const mesh of this.pins) this.group.remove(mesh);
    this.pins = [];
    if (this.line) {
      this.group.remove(this.line);
      this.line.geometry.dispose();
      this.line = null;
    }
    if (this.label) {
      this.label.removeFromParent();
      this.label.element.remove();
      this.label = null;
    }
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.lineMat.dispose();
  }
}
