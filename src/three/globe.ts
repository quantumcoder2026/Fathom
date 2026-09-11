/**
 * The region-entry globe, built on globe.gl (github.com/vasturiano/globe.gl).
 *
 * A real Earth — NASA Blue Marble colour, topography bump, a drifting cloud
 * layer — with Natural Earth country borders on top, named oceans/seas/countries,
 * and every Argo float in the loaded window plotted at its actual coordinates.
 *
 * Two ways in:
 *   click a float dot   -> straight into the workspace with that float selected
 *   click a basin ring  -> into the workspace for that region
 *
 * Navigation only. No analysis here.
 *
 * All textures are served from /earth (copied out of three-globe at build time),
 * so nothing is fetched from the internet at runtime.
 */

import Globe from "globe.gl";
import * as THREE from "three";

import countrySource from "./countries.geojson?raw";

export interface GlobeRegion {
  id: string;
  label: string;
  lat: number;
  lon: number;
  hasData: boolean;
}

export interface GlobeFloat {
  id: string;
  lat: number;
  lon: number;
}

export interface GlobeCallbacks {
  onHoverRegion: (id: string | null) => void;
  onSelectRegion: (id: string) => void;
  onSelectFloat: (id: string, lat: number, lon: number) => void;
}

export interface GlobeHandle {
  resize: () => void;
  dispose: () => void;
  setHovered: (id: string | null) => void;
  /** Replace the plotted float dots without rebuilding the globe. */
  setFloats: (floats: GlobeFloat[]) => void;
  flyTo: (id: string, done: () => void) => void;
  flyToLatLon: (lat: number, lon: number, done: () => void) => void;
}

const ACCENT = "#34d1c4";
const FLY_MS = 1400;

interface MapLabel {
  lat: number;
  lng: number;
  text: string;
  size: number;
  color: string;
}

/** Curated place names — Natural Earth gives country shapes but no ocean or sea
 *  names, and labelling all 177 countries would bury the data. */
const LABELS: MapLabel[] = [
  { lat: -12, lng: 76, text: "INDIAN OCEAN", size: 1.5, color: "rgba(200,240,245,0.9)" },
  { lat: 0, lng: -158, text: "PACIFIC OCEAN", size: 1.4, color: "rgba(190,225,235,0.7)" },
  { lat: 8, lng: -36, text: "ATLANTIC OCEAN", size: 1.4, color: "rgba(190,225,235,0.7)" },
  { lat: -58, lng: 40, text: "SOUTHERN OCEAN", size: 1.2, color: "rgba(190,225,235,0.65)" },
  { lat: 84, lng: 0, text: "ARCTIC OCEAN", size: 1.1, color: "rgba(190,225,235,0.65)" },
  { lat: 15.5, lng: 64, text: "Arabian Sea", size: 0.85, color: "rgba(210,245,250,0.9)" },
  { lat: 15, lng: 88, text: "Bay of Bengal", size: 0.85, color: "rgba(210,245,250,0.9)" },
  { lat: 9, lng: 96.5, text: "Andaman Sea", size: 0.6, color: "rgba(210,245,250,0.8)" },
  { lat: 20, lng: 38.5, text: "Red Sea", size: 0.55, color: "rgba(210,245,250,0.8)" },
  { lat: 12, lng: 48, text: "Gulf of Aden", size: 0.5, color: "rgba(210,245,250,0.75)" },
  { lat: 46, lng: 95, text: "ASIA", size: 1.1, color: "rgba(255,248,225,0.8)" },
  { lat: 3, lng: 21, text: "AFRICA", size: 1.1, color: "rgba(255,248,225,0.8)" },
  { lat: 50, lng: 14, text: "EUROPE", size: 0.8, color: "rgba(255,248,225,0.75)" },
  { lat: -25, lng: 134, text: "AUSTRALIA", size: 0.95, color: "rgba(255,248,225,0.8)" },
  { lat: -82, lng: 25, text: "ANTARCTICA", size: 0.8, color: "rgba(255,255,255,0.7)" },
  { lat: 22, lng: 79, text: "India", size: 0.7, color: "rgba(255,250,235,0.9)" },
  { lat: 7.5, lng: 80.8, text: "Sri Lanka", size: 0.45, color: "rgba(255,250,235,0.85)" },
  { lat: -2, lng: 118, text: "Indonesia", size: 0.6, color: "rgba(255,250,235,0.85)" },
  { lat: -19, lng: 46.5, text: "Madagascar", size: 0.5, color: "rgba(255,250,235,0.85)" },
  { lat: 6, lng: 46, text: "Somalia", size: 0.5, color: "rgba(255,250,235,0.85)" },
  { lat: 21, lng: 57, text: "Oman", size: 0.45, color: "rgba(255,250,235,0.85)" },
];

interface CountryFeature {
  properties: { name: string | null; continent: string | null };
}

/** Soft procedural cloud cover. Generated rather than downloaded so the demo has
 *  no network dependency; deliberately faint so it never hides the data. */
function cloudTexture(): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);

  // value noise, a few octaves, wrapped in longitude so the seam is invisible
  const rand = (() => {
    let seed = 20260911;
    return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  })();
  const img = ctx.createImageData(w, h);
  const octaves = [
    { cells: 8, amp: 0.55 },
    { cells: 17, amp: 0.28 },
    { cells: 34, amp: 0.17 },
  ];
  const grids = octaves.map((o) =>
    Array.from({ length: (o.cells + 1) * (o.cells + 1) }, () => rand()),
  );
  const smooth = (t: number) => t * t * (3 - 2 * t);

  for (let y = 0; y < h; y++) {
    // taper towards the poles so clouds don't smear at the top and bottom
    const polar = Math.sin((y / h) * Math.PI);
    for (let x = 0; x < w; x++) {
      let v = 0;
      octaves.forEach((o, oi) => {
        const gx = (x / w) * o.cells;
        const gy = (y / h) * o.cells;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = smooth(gx - x0);
        const fy = smooth(gy - y0);
        const g = grids[oi];
        const at = (ix: number, iy: number) =>
          g[(iy % (o.cells + 1)) * (o.cells + 1) + (ix % (o.cells + 1))];
        const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
        const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
        v += (top * (1 - fy) + bot * fy) * o.amp;
      });
      const alpha = Math.max(0, v - 0.52) * 2.2 * polar;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function regionMarker(region: GlobeRegion): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "f3d-region" + (region.hasData ? " has-data" : "");
  el.innerHTML =
    `<span class="f3d-region-ring"></span>` +
    `<span class="f3d-region-label">${region.label}</span>`;
  el.style.pointerEvents = "auto";
  el.style.cursor = region.hasData ? "pointer" : "default";
  return el;
}

export function createGlobe(
  container: HTMLElement,
  regions: GlobeRegion[],
  floats: GlobeFloat[],
  cb: GlobeCallbacks,
): GlobeHandle {
  const countries = JSON.parse(countrySource) as { features: CountryFeature[] };
  let hovered: string | null = null;
  let pointHovered = false;

  const globe = new Globe(container)
    .backgroundColor("rgba(0,0,0,0)")
    .showGlobe(true)
    .globeImageUrl("/earth/earth-blue-marble.jpg")
    .bumpImageUrl("/earth/earth-topology.png")
    .showAtmosphere(true)
    .atmosphereColor(ACCENT)
    .atmosphereAltitude(0.16)
    // country borders drawn over the photo texture — outline only, no fill
    .polygonsData(countries.features)
    .polygonAltitude(0.004)
    .polygonCapColor(() => "rgba(255,255,255,0.015)")
    .polygonSideColor(() => "rgba(0,0,0,0)")
    .polygonStrokeColor(() => "rgba(210,225,235,0.45)")
    .polygonLabel((d) => {
      const f = d as CountryFeature;
      return `<div class="f3d-country-tip">${f.properties.name ?? ""}</div>`;
    })
    .labelsData(LABELS)
    .labelLat((d) => (d as MapLabel).lat)
    .labelLng((d) => (d as MapLabel).lng)
    .labelText((d) => (d as MapLabel).text)
    .labelSize((d) => (d as MapLabel).size)
    .labelColor((d) => (d as MapLabel).color)
    .labelDotRadius(0)
    .labelAltitude(0.014)
    .labelResolution(3)
    // every Argo float in the window, at its real position
    .pointsData(floats as unknown as object[])
    .pointLat((d) => (d as GlobeFloat).lat)
    .pointLng((d) => (d as GlobeFloat).lon)
    .pointColor(() => ACCENT)
    .pointAltitude(0.012)
    .pointRadius(0.22)
    .pointResolution(6)
    .pointLabel((d) => {
      const f = d as GlobeFloat;
      return `<div class="f3d-country-tip">Argo float ${f.id}<br>` +
        `${Math.abs(f.lat).toFixed(2)}°${f.lat >= 0 ? "N" : "S"} ` +
        `${Math.abs(f.lon).toFixed(2)}°${f.lon >= 0 ? "E" : "W"}<br>` +
        `<span style="color:${ACCENT}">click to open its profile</span></div>`;
    })
    .onPointClick((d) => {
      const f = d as GlobeFloat;
      cb.onSelectFloat(f.id, f.lat, f.lon);
    })
    .onPointHover((d) => {
      // the dots are small — hold the globe still while the cursor is on one,
      // and switch to a pointer cursor, or they're almost impossible to hit
      const over = d !== null;
      pointHovered = over;
      globe.controls().autoRotate = !over && hovered === null;
      container.style.cursor = over ? "pointer" : "";
    })
    .htmlElementsData(regions as unknown as object[])
    .htmlLat((d) => (d as GlobeRegion).lat)
    .htmlLng((d) => (d as GlobeRegion).lon)
    .htmlAltitude(0.07)
    .htmlElement((d) => {
      const region = d as GlobeRegion;
      const el = regionMarker(region);
      el.addEventListener("pointerenter", () => {
        hovered = region.id;
        globe.controls().autoRotate = false;
        cb.onHoverRegion(region.id);
      });
      el.addEventListener("pointerleave", () => {
        if (hovered !== region.id) return;
        hovered = null;
        globe.controls().autoRotate = !pointHovered;
        cb.onHoverRegion(null);
      });
      el.addEventListener("click", () => {
        if (region.hasData) cb.onSelectRegion(region.id);
      });
      return el;
    });

  // drifting cloud shell just above the surface
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(globe.getGlobeRadius() * 1.012, 64, 48),
    new THREE.MeshPhongMaterial({
      map: cloudTexture(),
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
  );
  globe.scene().add(clouds);

  let raf = 0;
  const drift = () => {
    clouds.rotation.y += 0.0002;
    raf = requestAnimationFrame(drift);
  };
  raf = requestAnimationFrame(drift);

  if (import.meta.env.DEV) (window as unknown as { __globe?: unknown }).__globe = globe;

  const controls = globe.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.32;
  controls.enablePan = false;
  controls.minDistance = 140;
  controls.maxDistance = 520;

  globe.pointOfView({ lat: 8, lng: 76, altitude: 2.1 }, 0);

  const resize = () => {
    globe.width(container.clientWidth || 1);
    globe.height(container.clientHeight || 1);
  };
  resize();

  const flyToLatLon = (lat: number, lon: number, done: () => void) => {
    controls.autoRotate = false;
    globe.pointOfView({ lat, lng: lon, altitude: 0.8 }, FLY_MS);
    // pointOfView has no completion callback, so mirror its duration
    window.setTimeout(done, FLY_MS);
  };

  return {
    resize,
    setFloats: (next) => {
      globe.pointsData(next as unknown as object[]);
    },
    setHovered: (id) => {
      hovered = id;
      controls.autoRotate = id === null;
      cb.onHoverRegion(id);
    },
    flyTo: (id, done) => {
      const region = regions.find((r) => r.id === id);
      if (!region) return done();
      flyToLatLon(region.lat, region.lon, done);
    },
    flyToLatLon,
    dispose: () => {
      cancelAnimationFrame(raf);
      controls.autoRotate = false;
      clouds.geometry.dispose();
      (clouds.material as THREE.MeshPhongMaterial).map?.dispose();
      (clouds.material as THREE.Material).dispose();
      const destroy = (globe as unknown as { _destructor?: () => void })._destructor;
      if (typeof destroy === "function") destroy.call(globe);
      container.replaceChildren();
    },
  };
}
