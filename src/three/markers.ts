/**
 * Argo float markers: one small sphere per float at its (lon, lat), sitting just
 * above the surface plane and drawn on top of everything so it stays visible
 * through the depth stack. Click a marker -> onSelect(floatId).
 *
 * Position mapping comes from coords.ts, the same module the depth planes use, so
 * a marker lands exactly on its grid cell.
 *
 * There can be a couple of hundred floats in one month, so geometry and materials
 * are shared across markers and only the selected one gets its own material.
 */

import * as THREE from "three";

import type { FieldMeta, FloatIndexItem } from "../../contracts/types";
import { lonLatToWorldXZ } from "./coords";

const MARKER_Y = 1.1; // world units above the surface plane
const BASE_RADIUS = 0.32;
const SELECTED_SCALE = 2.6;
const COLOR_DEFAULT = 0xcfe4f0;
const COLOR_SELECTED = 0x34d1c4;

export class FloatMarkers {
  readonly group = new THREE.Group();

  private readonly meta: FieldMeta;
  private readonly geometry = new THREE.SphereGeometry(BASE_RADIUS, 12, 10);
  private readonly matDefault = new THREE.MeshBasicMaterial({
    color: COLOR_DEFAULT,
    depthTest: false,
    transparent: true,
    opacity: 0.72,
  });
  private readonly matSelected = new THREE.MeshBasicMaterial({
    color: COLOR_SELECTED,
    depthTest: false,
    transparent: true,
    opacity: 1,
  });
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  private markers = new Map<string, THREE.Mesh>();
  private selectedId: string | null = null;

  constructor(meta: FieldMeta) {
    this.meta = meta;
  }

  setFloats(floats: FloatIndexItem[]): void {
    this.clear();
    for (const f of floats) {
      const [x, z] = lonLatToWorldXZ(this.meta, f.lon, f.lat);
      const mesh = new THREE.Mesh(this.geometry, this.matDefault);
      mesh.position.set(x, MARKER_Y, z);
      mesh.renderOrder = 999;
      mesh.userData.floatId = f.id;
      this.markers.set(f.id, mesh);
      this.group.add(mesh);
    }
    if (this.selectedId) this.setSelected(this.selectedId);
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    for (const [floatId, mesh] of this.markers) {
      const on = floatId === id;
      mesh.material = on ? this.matSelected : this.matDefault;
      mesh.scale.setScalar(on ? SELECTED_SCALE : 1);
      mesh.renderOrder = on ? 1000 : 999;
    }
  }

  /** NDC from a pointer event; returns the float id under the pointer, or null. */
  pick(clientX: number, clientY: number, dom: HTMLElement, camera: THREE.Camera): string | null {
    const rect = dom.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, camera);
    const hits = this.raycaster.intersectObjects([...this.markers.values()], false);
    return hits.length ? (hits[0].object.userData.floatId as string) : null;
  }

  private clear(): void {
    for (const mesh of this.markers.values()) this.group.remove(mesh);
    this.markers.clear();
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.matDefault.dispose();
    this.matSelected.dispose();
  }
}
