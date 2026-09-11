/**
 * The evidence overlay: a coarse grid sheet that floats just above the active
 * depth plane, shaded by how well observation supports the model there.
 *
 *   constrained    faint cyan     — a recent Argo profile is nearby
 *   weak           faint grey     — support is thin
 *   unconstrained  red, and loud  — nothing has measured near here recently
 *
 * "Unconstrained" is drawn the most visible on purpose. The whole point of the
 * layer is that the viewer sees how much of the field is red.
 */

import * as THREE from "three";

import type { EvidenceCell, FieldMeta } from "../../contracts/types";
import { depthToWorldY, planeDimensions } from "./coords";

const COLORS: Record<EvidenceCell["status"], [number, number, number, number]> = {
  constrained: [52, 209, 196, 70],
  weak: [120, 132, 145, 34],
  unconstrained: [239, 107, 115, 96],
};

export class EvidenceLayer {
  readonly group = new THREE.Group();

  private readonly meta: FieldMeta;
  private mesh: THREE.Mesh | null = null;
  private outline: THREE.LineSegments | null = null;
  private exaggeration = 1;
  private activeDepth = 0;

  constructor(meta: FieldMeta) {
    this.meta = meta;
    this.group.visible = false;
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  set(cells: EvidenceCell[], depthIndex: number, exaggeration: number): void {
    this.clear();
    this.activeDepth = depthIndex;
    this.exaggeration = exaggeration;
    if (!cells.length) return;

    // the grid is regular — recover its shape from the distinct coordinates
    const lats = [...new Set(cells.map((c) => c.lat))].sort((a, b) => a - b);
    const lons = [...new Set(cells.map((c) => c.lon))].sort((a, b) => a - b);
    const nRow = lats.length;
    const nCol = lons.length;
    const rowOf = new Map(lats.map((v, i) => [v, i]));
    const colOf = new Map(lons.map((v, i) => [v, i]));

    const rgba = new Uint8Array(nRow * nCol * 4);
    for (const cell of cells) {
      const r = rowOf.get(cell.lat)!;
      const c = colOf.get(cell.lon)!;
      const [rr, gg, bb, aa] = COLORS[cell.status];
      const o = (r * nCol + c) * 4;
      rgba[o] = rr;
      rgba[o + 1] = gg;
      rgba[o + 2] = bb;
      rgba[o + 3] = aa;
    }

    const tex = new THREE.DataTexture(rgba, nCol, nRow, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;

    const { width, height } = planeDimensions(this.meta);
    const geo = new THREE.PlaneGeometry(width * 1.02, height * 1.02);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 900;

    // thin cell outlines so it reads as a grid, not a smear
    const pts: number[] = [];
    for (let i = 0; i <= nCol; i++) {
      const x = -width / 2 + (i / nCol) * width;
      pts.push(x, 0, -height / 2, x, 0, height / 2);
    }
    for (let j = 0; j <= nRow; j++) {
      const z = -height / 2 + (j / nRow) * height;
      pts.push(-width / 2, 0, z, width / 2, 0, z);
    }
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.outline = new THREE.LineSegments(
      lgeo,
      new THREE.LineBasicMaterial({ color: 0x1a2733, transparent: true, opacity: 0.4 }),
    );
    this.outline.renderOrder = 901;
    this.group.add(this.mesh, this.outline);

    this.reposition();
  }

  setActiveDepth(depthIndex: number): void {
    this.activeDepth = depthIndex;
    this.reposition();
  }

  setExaggeration(factor: number): void {
    this.exaggeration = factor;
    this.reposition();
  }

  private reposition(): void {
    const depth = this.meta.depths[this.activeDepth] ?? 0;
    this.group.position.setY(depthToWorldY(this.meta, depth, this.exaggeration) + 0.35);
  }

  private clear(): void {
    for (const obj of [this.mesh, this.outline]) {
      if (!obj) continue;
      this.group.remove(obj);
      obj.geometry.dispose();
      const m = obj.material as THREE.Material & { map?: THREE.Texture | null };
      m.map?.dispose?.();
      m.dispose();
    }
    this.mesh = null;
    this.outline = null;
  }

  dispose(): void {
    this.clear();
  }
}
