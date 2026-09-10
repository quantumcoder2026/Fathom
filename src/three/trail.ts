/**
 * The selected float's profile drawn as a vertical string of beads descending
 * through the depth stack at its (lon, lat) — one bead per sampled level,
 * coloured by the measured value on the same colour scale as the model planes.
 *
 * This is why the markers alone were misleading: a dot on the surface says
 * nothing about how deep that float actually sampled. The string does, and you
 * can read the thermocline off it against the planes it passes through.
 *
 * QC-rejected levels get no bead. Missing is not zero.
 */

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

import type { FieldMeta, Profile } from "../../contracts/types";
import { samplePalette, type ColormapOptions } from "./colormap";
import { depthToWorldY, lonLatToWorldXZ } from "./coords";

const MAX_BEADS = 44; // a full Argo profile is ~250 levels — thin it for the eye
const BEAD_RADIUS = 0.28;

export class ProfileTrail {
  readonly group = new THREE.Group();

  private readonly meta: FieldMeta;
  private readonly geometry = new THREE.SphereGeometry(BEAD_RADIUS, 10, 8);
  private readonly lineMat = new THREE.LineBasicMaterial({
    color: 0x8fb3c7,
    transparent: true,
    opacity: 0.35,
  });

  private beads: THREE.Mesh[] = [];
  private line: THREE.Line | null = null;
  private levels: { depth: number; value: number }[] = [];
  private notes: CSS2DObject[] = [];

  constructor(meta: FieldMeta) {
    this.meta = meta;
  }

  set(profile: Profile | null, colormap: ColormapOptions, exaggeration: number): void {
    this.clear();
    if (!profile) return;

    const good = profile.levels.filter(
      (l): l is { depth: number; value: number; qc: number } => l.value !== null,
    );
    if (!good.length) return;

    const stride = Math.max(1, Math.ceil(good.length / MAX_BEADS));
    this.levels = good
      .filter((_, i) => i % stride === 0 || i === good.length - 1)
      .map((l) => ({ depth: l.depth, value: l.value }));

    const [x, z] = lonLatToWorldXZ(this.meta, profile.lon, profile.lat);
    const span = colormap.max - colormap.min || 1;
    const modelFloor = this.meta.depths[this.meta.depths.length - 1] ?? 0;
    const pts: number[] = [];

    for (const level of this.levels) {
      const t = (level.value - colormap.min) / span;
      const [r, g, b] = samplePalette(colormap.palette, t);
      // Below the model's deepest level the float is still measuring but there is
      // nothing to compare against — draw those beads hollow and faint so the
      // string visibly changes character instead of just running off the bottom.
      const belowModel = level.depth > modelFloor;
      const mesh = new THREE.Mesh(
        this.geometry,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(r / 255, g / 255, b / 255),
          depthTest: false,
          transparent: belowModel,
          opacity: belowModel ? 0.32 : 1,
          wireframe: belowModel,
        }),
      );
      const y = depthToWorldY(this.meta, level.depth, exaggeration);
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(belowModel ? 0.75 : 1);
      mesh.renderOrder = 1001;
      this.beads.push(mesh);
      this.group.add(mesh);
      pts.push(x, y, z);
    }

    const deepest = this.levels[this.levels.length - 1].depth;
    if (deepest > modelFloor) {
      this.addNote(
        x, depthToWorldY(this.meta, modelFloor, exaggeration), z,
        "f3d-trail-floor", `model floor ${Math.round(modelFloor)} m`,
      );
      this.addNote(
        x, depthToWorldY(this.meta, deepest, exaggeration), z,
        "f3d-trail-deep", `float reaches ${Math.round(deepest)} m · no model here`,
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.line = new THREE.Line(geo, this.lineMat);
    this.line.renderOrder = 1000;
    this.group.add(this.line);
  }

  private addNote(x: number, y: number, z: number, cls: string, text: string): void {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(x, y, z);
    this.notes.push(obj);
    this.group.add(obj);
  }

  setExaggeration(factor: number): void {
    const modelFloor = this.meta.depths[this.meta.depths.length - 1] ?? 0;
    const deepest = this.levels.length ? this.levels[this.levels.length - 1].depth : 0;
    if (this.notes[0]) this.notes[0].position.y = depthToWorldY(this.meta, modelFloor, factor);
    if (this.notes[1]) this.notes[1].position.y = depthToWorldY(this.meta, deepest, factor);
    const pts: number[] = [];
    this.beads.forEach((mesh, i) => {
      const y = depthToWorldY(this.meta, this.levels[i].depth, factor);
      mesh.position.y = y;
      pts.push(mesh.position.x, y, mesh.position.z);
    });
    if (this.line) {
      this.line.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    }
  }

  private clear(): void {
    for (const note of this.notes) {
      note.removeFromParent();
      note.element.remove();
    }
    this.notes = [];
    for (const mesh of this.beads) {
      this.group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    this.beads = [];
    this.levels = [];
    if (this.line) {
      this.group.remove(this.line);
      this.line.geometry.dispose();
      this.line = null;
    }
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.lineMat.dispose();
  }
}
