/**
 * The depth axis drawn inside the 3D scene: a vertical rule down one corner of
 * the plane stack, a tick at every model level, and CSS2D labels giving the depth
 * in metres. Without this the stack is a pretty pile of translucent sheets and the
 * viewer has no idea what they are looking at.
 *
 * Labels thin themselves out as vertical exaggeration shrinks, so they never
 * collide; the active level is always labelled and always highlighted.
 */

import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

import type { FieldMeta } from "../../contracts/types";
import { depthToWorldY, planeDimensions } from "./coords";

const LABEL_GAP_WORLD = 1.6; // minimum vertical world gap between two labels
const TICK_LEN = 1.2;

function labelEl(className: string, text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}

export class DepthAxis {
  readonly group = new THREE.Group();

  private readonly meta: FieldMeta;
  private readonly axisX: number;
  private readonly axisZ: number;

  private readonly rule: THREE.Line;
  private readonly ruleGeom = new THREE.BufferGeometry();
  private readonly tickGeom = new THREE.BufferGeometry();
  private readonly ticks: THREE.LineSegments;
  private readonly lineMat = new THREE.LineBasicMaterial({
    color: 0x2b3947,
    transparent: true,
    opacity: 0.9,
  });

  private readonly labels: CSS2DObject[] = [];
  private readonly title: CSS2DObject;
  private readonly planeLabel: CSS2DObject;
  private readonly planeLabelEl: HTMLDivElement;

  /** Ticks below the model's deepest level, for the stretch of a float profile
   *  the model does not cover. Without these the trail dangles past the end of
   *  the ruler with nothing to read its depth against. */
  private belowDepths: number[] = [];
  private belowLabels: CSS2DObject[] = [];

  private exaggeration = 1;
  private active = 0;

  constructor(meta: FieldMeta) {
    this.meta = meta;
    const { width, height } = planeDimensions(meta);
    this.axisX = -width / 2 - 1.2;
    this.axisZ = height / 2;

    this.rule = new THREE.Line(this.ruleGeom, this.lineMat);
    this.ticks = new THREE.LineSegments(this.tickGeom, this.lineMat);
    this.group.add(this.rule, this.ticks);

    for (const depth of meta.depths) {
      const el = labelEl("f3d-tick", `${Math.round(depth)} m`);
      const obj = new CSS2DObject(el);
      obj.position.set(this.axisX - 2.2, 0, this.axisZ);
      this.labels.push(obj);
      this.group.add(obj);
    }

    this.title = new CSS2DObject(labelEl("f3d-axis-title", "depth (m)"));
    this.title.position.set(this.axisX - 2.2, 2.2, this.axisZ);
    this.group.add(this.title);

    this.planeLabelEl = labelEl("f3d-plane-label", "");
    this.planeLabel = new CSS2DObject(this.planeLabelEl);
    this.planeLabel.visible = false;
    this.group.add(this.planeLabel);

    this.layout();
  }

  setExaggeration(factor: number): void {
    this.exaggeration = factor;
    this.layout();
  }

  setActive(index: number): void {
    this.active = index;
    this.layout();
  }

  /** Extend the ruler past the model floor down to `deepest` metres (the selected
   *  float's deepest measured level), or clear it with null. */
  setBelowFloor(deepest: number | null): void {
    const floor = this.meta.depths[this.meta.depths.length - 1] ?? 0;
    const next: number[] = [];
    if (deepest !== null && deepest > floor) {
      // round ticks, coarse enough not to crowd: 250 m normally, 500 m if deep
      const stepM = deepest - floor > 1500 ? 500 : 250;
      for (let d = Math.ceil(floor / stepM) * stepM; d <= deepest; d += stepM) {
        if (d > floor) next.push(d);
      }
      next.push(deepest); // always mark where the float actually ends
    }

    const same =
      next.length === this.belowDepths.length &&
      next.every((d, i) => Math.abs(d - this.belowDepths[i]) < 0.5);
    if (same) return;

    for (const obj of this.belowLabels) {
      obj.removeFromParent();
      obj.element.remove();
    }
    this.belowLabels = [];
    this.belowDepths = next;
    for (const depth of next) {
      const el = labelEl("f3d-tick f3d-tick-below", `${Math.round(depth)} m`);
      const obj = new CSS2DObject(el);
      obj.position.set(this.axisX - 2.2, 0, this.axisZ);
      this.belowLabels.push(obj);
      this.group.add(obj);
    }
    this.layout();
  }

  /** Text shown floating beside the active plane, e.g. "75 m · 12.4–29.8 °C". */
  setPlaneLabel(text: string | null): void {
    this.planeLabel.visible = text !== null;
    if (text !== null) this.planeLabelEl.textContent = text;
  }

  private layout(): void {
    const { meta, exaggeration } = this;
    const ys = meta.depths.map((d) => depthToWorldY(meta, d, exaggeration));
    const belowYs = this.belowDepths.map((d) => depthToWorldY(meta, d, exaggeration));
    const top = 0;
    const bottom = belowYs.length ? belowYs[belowYs.length - 1] : (ys[ys.length - 1] ?? 0);

    this.ruleGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [this.axisX, top, this.axisZ, this.axisX, bottom, this.axisZ],
        3,
      ),
    );

    const tickPts: number[] = [];
    for (const y of ys) {
      tickPts.push(this.axisX, y, this.axisZ, this.axisX + TICK_LEN, y, this.axisZ);
    }
    for (const y of belowYs) {
      // shorter ticks so the covered range still reads as the primary scale
      tickPts.push(this.axisX, y, this.axisZ, this.axisX + TICK_LEN * 0.6, y, this.axisZ);
    }
    this.tickGeom.setAttribute("position", new THREE.Float32BufferAttribute(tickPts, 3));

    let lastBelowY = Infinity;
    this.belowLabels.forEach((obj, i) => {
      const y = belowYs[i];
      const isLast = i === belowYs.length - 1;
      const show = isLast || Math.abs(lastBelowY - y) >= LABEL_GAP_WORLD;
      obj.visible = show;
      if (show) lastBelowY = y;
      obj.position.y = y;
    });

    // thin labels so they never collide, but always keep the first, last and active
    let lastShownY = Infinity;
    this.labels.forEach((obj, i) => {
      const y = ys[i];
      const isEdge = i === 0 || i === ys.length - 1;
      const isActive = i === this.active;
      const room = Math.abs(lastShownY - y) >= LABEL_GAP_WORLD;
      const show = isEdge || isActive || room;
      obj.visible = show;
      if (show) lastShownY = y;
      obj.position.y = y;
      obj.element.classList.toggle("is-active", isActive);
    });

    this.title.position.y = 2.2;
    const { width } = planeDimensions(this.meta);
    this.planeLabel.position.set(width / 2 + 3.2, ys[this.active] ?? 0, 0);
  }

  dispose(): void {
    for (const obj of [...this.labels, ...this.belowLabels, this.title, this.planeLabel]) {
      obj.removeFromParent();
      obj.element.remove();
    }
    this.ruleGeom.dispose();
    this.tickGeom.dispose();
    this.lineMat.dispose();
  }
}
