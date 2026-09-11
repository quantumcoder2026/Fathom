/**
 * The Three.js scene shell: WebGL renderer, a CSS2D renderer layered over it for
 * in-scene text labels, perspective camera, OrbitControls, resize handling and the
 * animation loop. Knows nothing about ocean data — field layers, markers and the
 * depth axis are added to `scene` by the caller.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export interface SceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  resize: () => void;
  /** Draw one frame now. The animation loop is paused while the tab is
   *  backgrounded, so anything that changes the scene off-screen calls this to
   *  keep the WebGL canvas and the CSS2D labels in step. */
  renderOnce: () => void;
  dispose: () => void;
}

const BACKGROUND = 0x070b0f;

export function createScene(canvas: HTMLCanvasElement, labelLayer: HTMLElement): SceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);
  camera.position.set(54, 32, 94);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const labelRenderer = new CSS2DRenderer({ element: labelLayer });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, -20, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.0));

  const renderOnce = () => {
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderOnce();
  };
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    renderOnce();
  });

  const dispose = () => {
    renderer.setAnimationLoop(null);
    controls.dispose();
    renderer.dispose();
    // Deliberately NOT forceContextLoss(): the <canvas> element outlives this
    // renderer (React keeps the same node across a StrictMode remount) and a
    // canvas only ever gets one WebGL context, so losing it here leaves the
    // next renderer with nothing to draw on — a black viewport. Reusing the
    // context is the correct behaviour, not a leak.
    labelLayer.replaceChildren();
  };

  return { scene, camera, renderer, controls, resize, renderOnce, dispose };
}
