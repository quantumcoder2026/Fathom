/**
 * Single source of truth for mapping the model's geographic + depth extent into
 * Three.js world space. Both the depth planes (field.ts) and the float markers
 * (markers.ts) use these, so a marker at (lon, lat) lands exactly on the plane
 * cell for that position.
 *
 * World layout:
 *   x  <- longitude   (lon_min -> -width/2,  lon_max -> +width/2)
 *   z  <- latitude    (lat_min -> +height/2, lat_max -> -height/2)   [north is -z]
 *   y  <- depth        (0 m -> 0,  deeper -> more negative)
 *
 * The z flip matches a PlaneGeometry rotated -90 deg about X with a DataTexture
 * whose row 0 is lat_min.
 */

import type { FieldMeta } from "../../contracts/types";

/** World units spanning the full longitude extent. Latitude scales to keep aspect. */
export const WORLD_LON_SPAN = 60;

/** World units for the full depth column at exaggeration 1. */
export const DEPTH_WORLD = 6;

export interface PlaneDimensions {
  width: number;
  height: number;
}

export function planeDimensions(meta: FieldMeta): PlaneDimensions {
  const lonRange = meta.lon_max - meta.lon_min || 1;
  const latRange = meta.lat_max - meta.lat_min || 1;
  return { width: WORLD_LON_SPAN, height: WORLD_LON_SPAN * (latRange / lonRange) };
}

export function lonLatToWorldXZ(meta: FieldMeta, lon: number, lat: number): [number, number] {
  const { width, height } = planeDimensions(meta);
  const lonRange = meta.lon_max - meta.lon_min || 1;
  const latRange = meta.lat_max - meta.lat_min || 1;
  const x = -width / 2 + ((lon - meta.lon_min) / lonRange) * width;
  const z = height / 2 - ((lat - meta.lat_min) / latRange) * height;
  return [x, z];
}

export function depthToWorldY(meta: FieldMeta, depth: number, exaggeration: number): number {
  const maxDepth = meta.depths[meta.depths.length - 1] || 1;
  return -(depth / maxDepth) * DEPTH_WORLD * exaggeration;
}

/** Inverse of lonLatToWorldXZ — used to turn a click/hover on a plane into a position. */
export function worldXZToLonLat(meta: FieldMeta, x: number, z: number): [number, number] {
  const { width, height } = planeDimensions(meta);
  const lonRange = meta.lon_max - meta.lon_min || 1;
  const latRange = meta.lat_max - meta.lat_min || 1;
  const lon = meta.lon_min + ((x + width / 2) / width) * lonRange;
  const lat = meta.lat_min + ((height / 2 - z) / height) * latRange;
  return [lon, lat];
}

/** Nearest grid cell for a position, or null if it falls outside the domain. */
export function lonLatToGridIndex(
  meta: FieldMeta,
  lon: number,
  lat: number,
): { row: number; col: number } | null {
  const lonRange = meta.lon_max - meta.lon_min || 1;
  const latRange = meta.lat_max - meta.lat_min || 1;
  const col = Math.round(((lon - meta.lon_min) / lonRange) * (meta.nx - 1));
  const row = Math.round(((lat - meta.lat_min) / latRange) * (meta.ny - 1));
  if (col < 0 || col >= meta.nx || row < 0 || row >= meta.ny) return null;
  return { row, col };
}

/** Great-circle distance in km — how far apart two positions actually are. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371.0088;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** "12.34°N 87.61°E" — the way a position is written on screen. */
export function formatLonLat(lon: number, lat: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}
