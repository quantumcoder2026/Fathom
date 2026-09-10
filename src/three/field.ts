/**
 * Stacked depth planes. One horizontal PlaneGeometry per model depth level,
 * textured with that level's Float32 grid via a colormap, positioned at
 * y = -(depth / maxDepth) * DEPTH_WORLD * exaggeration.
 *
 * NOT a raymarched volume. NaN cells in the grid are transparent (colormap.ts).
 */

import * as THREE from "three";

import type { FieldMeta } from "../../contracts/types";
import { gridToRGBA, type ColormapOptions } from "./colormap";
import { depthToWorldY, planeDimensions } from "./coords";

export type GridLoader = (
  variable: string,
  timeIndex: number,
  depthIndex: number,
) => Promise<Float32Array>;

/** Opacity multiplier for a plane `k` levels away from the active one. Falling off
 *  with distance (rather than dimming every inactive plane equally) keeps the stack
 *  readable — you can still see the shape of the column without 19 sheets of milk. */
function dimFor(distance: number): number {
  if (distance === 0) return 1;
  return Math.max(0.045, 0.3 * Math.exp(-distance / 2.6));
}

export class FieldLayers {
  readonly group = new THREE.Group();

  private readonly meta: FieldMeta;
  private readonly loader: GridLoader;

  private planes: THREE.Mesh[] = [];
  private grids: (Float32Array | null)[] = [];
  private colormap: ColormapOptions;
  private exaggeration = 1;
  private opacity = 0.85;
  private activeDepth = 0;
  private loadToken = 0;

  constructor(meta: FieldMeta, loader: GridLoader, colormap: ColormapOptions) {
    this.meta = meta;
    this.loader = loader;
    this.colormap = colormap;
  }

  private yFor(depth: number): number {
    return depthToWorldY(this.meta, depth, this.exaggeration);
  }

  /** Load every depth level for one (variable, timeIndex). Replaces existing planes. */
  async load(variable: string, timeIndex: number): Promise<void> {
    const token = ++this.loadToken;
    this.clearPlanes();

    const { nx, ny, depths } = this.meta;
    const { width: w, height: h } = planeDimensions(this.meta);
    this.grids = new Array(depths.length).fill(null);
    this.planes = new Array(depths.length);

    await Promise.all(
      depths.map(async (depth, d) => {
        const grid = await this.loader(variable, timeIndex, d);
        if (token !== this.loadToken) return; // superseded by a newer load()
        this.grids[d] = grid;

        const tex = new THREE.DataTexture(
          gridToRGBA(grid, this.colormap),
          nx,
          ny,
          THREE.RGBAFormat,
          THREE.UnsignedByteType,
        );
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;

        const geo = new THREE.PlaneGeometry(w, h);
        geo.rotateX(-Math.PI / 2); // lie flat; grid row 0 (lat_min) -> +z

        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: this.opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = this.yFor(depth);
        // paint deepest first so transparent planes blend correctly from above
        mesh.renderOrder = depths.length - d;
        mesh.userData.depthIndex = d;

        this.planes[d] = mesh;
        this.group.add(mesh);
      }),
    );

    if (token === this.loadToken) this.setActiveDepth(this.activeDepth);
  }

  setActiveDepth(index: number): void {
    this.activeDepth = index;
    this.planes.forEach((mesh, d) => {
      if (!mesh) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = this.opacity * dimFor(Math.abs(d - index));
    });
  }

  /** The raw grid for one depth level, for reading a value under the cursor. */
  gridAt(depthIndex: number): Float32Array | null {
    return this.grids[depthIndex] ?? null;
  }

  /** The mesh for one depth level, so the caller can raycast against just that plane. */
  planeAt(depthIndex: number): THREE.Mesh | null {
    return this.planes[depthIndex] ?? null;
  }

  /** min/max of the finite values on one level — used for the in-scene plane label. */
  rangeAt(depthIndex: number): { min: number; max: number } | null {
    const grid = this.grids[depthIndex];
    if (!grid) return null;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return min <= max ? { min, max } : null;
  }

  setOpacity(value: number): void {
    this.opacity = value;
    this.setActiveDepth(this.activeDepth);
  }

  setExaggeration(factor: number): void {
    this.exaggeration = factor;
    this.planes.forEach((mesh) => {
      if (!mesh) return;
      const d = mesh.userData.depthIndex as number;
      mesh.position.y = this.yFor(this.meta.depths[d]);
    });
  }

  setColormap(colormap: ColormapOptions): void {
    this.colormap = colormap;
    this.planes.forEach((mesh, d) => {
      if (!mesh) return;
      const grid = this.grids[d];
      if (!grid) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const tex = mat.map as THREE.DataTexture;
      (tex.image.data as Uint8Array).set(gridToRGBA(grid, colormap));
      tex.needsUpdate = true;
    });
  }

  private clearPlanes(): void {
    this.planes.forEach((mesh) => {
      if (!mesh) return;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
    this.planes = [];
    this.grids = [];
  }

  dispose(): void {
    this.loadToken++;
    this.clearPlanes();
  }
}
