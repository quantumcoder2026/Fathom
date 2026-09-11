"""
Fathom (SIH26067) — pydantic mirror of contracts/types.ts.

Keep this file and contracts/types.ts in exact sync: same field names, same
nullability, same literals. The FastAPI routes in api/ use these as response models.

Core principle: "Missing is not zero. Never invent a number."
Missing / not-covered / QC-rejected values are None here (NaN in the field binaries) —
never 0, never an extrapolated guess.

Units, everywhere:
    temperature  degC
    salinity     psu
    depth        metres, positive down
    longitude    -180..180
    latitude     -90..90
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

OceanVariable = Literal["temperature", "salinity"]

ComparisonStatus = Literal[
    "ok",
    "no_model_coverage",
    "qc_rejected",
    "outside_domain",
]

EvidenceStatus = Literal["constrained", "weak", "unconstrained"]


class FloatIndexItem(BaseModel):
    id: str
    lat: float
    lon: float
    time: str  # ISO 8601
    n_levels: int


class ProfileLevel(BaseModel):
    depth: float  # metres, positive down
    value: float | None  # None = missing or QC-rejected. NEVER 0.
    qc: int  # original QC flag from the source file


class Profile(BaseModel):
    float_id: str
    lat: float
    lon: float
    time: str  # ISO 8601
    variable: OceanVariable
    units: str  # "degC" | "psu"
    levels: list[ProfileLevel]
    source_file: str


class VariableRange(BaseModel):
    min: float
    max: float


class FieldMeta(BaseModel):
    variables: list[str]
    depths: list[float]  # metres, ascending
    times: list[str]  # ISO 8601
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float
    nx: int  # grid columns (longitude)
    ny: int  # grid rows (latitude)
    ranges: dict[str, VariableRange]
    source: str | None = None
    generated_at: str | None = None


class ComparisonPoint(BaseModel):
    depth: float
    observed: float | None
    model: float | None
    difference: float | None  # observed - model
    status: ComparisonStatus


class ComparisonStats(BaseModel):
    n_points: int
    bias: float | None
    rmse: float | None
    max_abs_difference: float | None
    depth_of_max: float | None


class ComparisonMatching(BaseModel):
    spatial_separation_km: float
    temporal_separation_hours: float
    method: str


class ComparisonProvenance(BaseModel):
    model_file: str
    obs_file: str
    qc_flags_accepted: list[int]
    generated_at: str  # ISO 8601


class ErrorDecomposition(BaseModel):
    """Output of compare/shift.py decompose_error(). A best_shift_m at the edge of
    the search window means 'no clear displacement signal', not a real result —
    `conclusive` carries that judgement so the UI doesn't have to re-derive it."""

    raw_rmse: float  # unshifted RMSE over the levels the chosen shift is scored on
    best_shift_m: float
    shifted_rmse: float
    displacement_fraction: float  # 1 - (shifted_rmse / raw_rmse), 0..1
    n_valid_after_shift: int
    conclusive: bool


class ComparisonResult(BaseModel):
    float_id: str
    variable: str
    points: list[ComparisonPoint]
    stats: ComparisonStats
    matching: ComparisonMatching
    provenance: ComparisonProvenance
    decomposition: ErrorDecomposition | None = None


class EvidenceCell(BaseModel):
    lat: float
    lon: float
    depth: float
    n_observations: int
    days_since_last: float | None
    confidence: float  # 0..1
    status: EvidenceStatus


class UnconstrainedSummary(BaseModel):
    percent: int | None
    label: str
    n_cells: int
    time_index: int


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


# Field binary format — GET /field/{variable}/{time_index}/{depth_index}
#   Content-Type: application/octet-stream
#   Body: float32, row-major, ny rows x nx columns.
#   Row 0 = lat_min. Column 0 = lon_min.
#   NaN = missing / land. NEVER 0.
#   Length = nx * ny * 4 bytes.
