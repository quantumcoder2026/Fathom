/**
 * Fathom (SIH26067) — frontend/API integration boundary.
 *
 * These shapes are the contract between the FastAPI backend and the React frontend.
 * Rules:
 *   - Use these field names EXACTLY. Never invent a field.
 *   - A contract changes in this file first, then gets announced in the group chat.
 *   - `contracts/schemas.py` is the pydantic mirror of this file — keep them in sync.
 *
 * Core principle, enforced by these types:
 *   "Missing is not zero. Never invent a number."
 *   Missing / not-covered / QC-rejected values are `null` here (and NaN in the field
 *   binaries) — never 0, never an extrapolated guess.
 *
 * Units, everywhere:
 *   temperature  degC
 *   salinity     psu
 *   depth        metres, positive down
 *   longitude    -180..180
 *   latitude     -90..90
 */

export type OceanVariable = "temperature" | "salinity";

/** One entry in the float index for a given time step. */
export interface FloatIndexItem {
  id: string; // e.g. "2902746"
  lat: number;
  lon: number;
  time: string; // ISO 8601, e.g. "2023-08-14T03:14:00Z"
  n_levels: number;
}

/** One measured level of an observed profile. */
export interface ProfileLevel {
  depth: number; // metres, positive down
  value: number | null; // null = missing or QC-rejected. NEVER 0.
  qc: number; // original QC flag from the source file
}

/** An observed Argo profile for one float, one variable. */
export interface Profile {
  float_id: string;
  lat: number;
  lon: number;
  time: string; // ISO 8601
  variable: OceanVariable;
  units: string; // "degC" | "psu"
  levels: ProfileLevel[];
  source_file: string;
}

/** Describes the precomputed model field grid. Served at GET /field/meta. */
export interface FieldMeta {
  variables: string[];
  depths: number[]; // metres, ascending
  times: string[]; // ISO 8601
  lat_min: number;
  lat_max: number;
  lon_min: number;
  lon_max: number;
  nx: number; // grid columns (longitude)
  ny: number; // grid rows (latitude)
  ranges: Record<string, { min: number; max: number }>;
  /** Human-readable provenance, e.g. the product this field was precomputed from. */
  source?: string | null;
  generated_at?: string | null;
}

export type ComparisonStatus =
  | "ok"
  | "no_model_coverage"
  | "qc_rejected"
  | "outside_domain";

/** One depth level of an observed-vs-model comparison. */
export interface ComparisonPoint {
  depth: number;
  observed: number | null;
  model: number | null;
  difference: number | null; // observed - model
  status: ComparisonStatus;
}

export interface ComparisonStats {
  n_points: number;
  bias: number | null;
  rmse: number | null;
  max_abs_difference: number | null;
  depth_of_max: number | null;
}

export interface ComparisonMatching {
  spatial_separation_km: number;
  temporal_separation_hours: number;
  method: string; // e.g. "nearest-neighbour + linear vertical interp"
}

export interface ComparisonProvenance {
  model_file: string;
  obs_file: string;
  qc_flags_accepted: number[];
  generated_at: string; // ISO 8601
}

/** Full result of comparing one float against the model. Served at GET /compare/{id}. */
export interface ComparisonResult {
  float_id: string;
  variable: string;
  points: ComparisonPoint[];
  stats: ComparisonStats;
  matching: ComparisonMatching;
  provenance: ComparisonProvenance;
  /**
   * Displacement-vs-amplitude error decomposition (compare/shift.py).
   * Optional: present once the shift analysis has run for this float.
   */
  decomposition?: ErrorDecomposition | null;
}

/**
 * Output of compare/shift.py `decompose_error(result)`.
 * best_shift_m beyond ~100 m means "no clear displacement signal", not a real result.
 */
export interface ErrorDecomposition {
  /** Unshifted RMSE over the levels the chosen shift is scored on. */
  raw_rmse: number;
  best_shift_m: number;
  shifted_rmse: number;
  displacement_fraction: number; // 1 - (shifted_rmse / raw_rmse), 0..1
  n_valid_after_shift: number;
  /** false when the best shift sits at the edge of the search window — the
   *  misfit doesn't look like a vertical displacement, so don't claim one. */
  conclusive: boolean;
}

/** One coarse cell of the observational-evidence grid. Served at GET /evidence?t=&d=. */
export interface EvidenceCell {
  lat: number;
  lon: number;
  depth: number;
  n_observations: number;
  days_since_last: number | null;
  confidence: number; // 0..1
  status: "constrained" | "weak" | "unconstrained";
}

/**
 * Field binary format — GET /field/{variable}/{time_index}/{depth_index}
 *   Content-Type: application/octet-stream
 *   Body: Float32Array, row-major, ny rows x nx columns.
 *   Row 0 = lat_min. Column 0 = lon_min.
 *   NaN = missing / land. NEVER 0.
 *   Length = nx * ny * 4 bytes.
 * Frontend read:
 *   const grid = new Float32Array(buf);  // grid[row * nx + col]
 */

/** GET /evidence/headline?t=&region= — the always-visible "% unconstrained" figure. */
export interface UnconstrainedSummary {
  percent: number | null; // null if the field isn't loaded
  label: string;          // "this region" | "the Bay of Bengal"
  n_cells: number;
  time_index: number;
}

/** GET /health */
export interface HealthResponse {
  status: "ok";
}
