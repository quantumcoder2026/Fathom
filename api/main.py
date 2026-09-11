"""
Fathom (SIH26067) — API.

Serves the precomputed real data under data/ when it exists, and falls back to the
hand-written fixtures in fixtures/ when it does not, so the frontend works either
way. Response shapes come from contracts/schemas.py, so a payload that drifts from
the contract fails here at request time.

Routes:
    GET /health
    GET /field/meta
    GET /field/{variable}/{t}/{d}   -> binary Float32 grid (ny*nx*4 bytes)
    GET /field/seafloor             -> binary Float32 grid, deepest level per cell
    GET /floats?t={time_index}
    GET /floats/{id}/profile?variable=temperature
    GET /compare/{id}?variable=temperature
    GET /evidence?t={t}&d={d}

Run from the repo root:  .venv/Scripts/uvicorn api.main:app --reload
"""

import json
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from api.fixtures import load
from contracts.schemas import (
    ComparisonResult,
    EvidenceCell,
    FieldMeta,
    FloatIndexItem,
    HealthResponse,
    Profile,
    UnconstrainedSummary,
)

ROOT = Path(__file__).resolve().parent.parent
FIELD_DIR = ROOT / "data" / "field"
FLOATS_DIR = ROOT / "data" / "floats"

app = FastAPI(title="Fathom API", version="0.2.0")

# No auth, no cookies — open CORS is fine for the hackathon (localhost + LAN demo).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
    allow_credentials=False,
)


def have_field() -> bool:
    return (FIELD_DIR / "meta.json").exists()


def have_floats() -> bool:
    return (FLOATS_DIR / "index.json").exists()


def field_meta_dict() -> dict:
    return json.loads((FIELD_DIR / "meta.json").read_text()) if have_field() \
        else load("field_meta.json")


@app.get("/health", response_model=HealthResponse)
def health():
    return {"status": "ok"}


@app.get("/")
def index():
    m = field_meta_dict()
    return {
        "service": "Fathom API",
        "mode": "real data" if have_field() else "fixtures",
        "source": m.get("source", "hand-written fixtures"),
        "grid": f"{m['nx']}x{m['ny']}",
        "variables": m["variables"],
        "times": len(m["times"]),
        "depths": len(m["depths"]),
        "floats": len(json.loads((FLOATS_DIR / "index.json").read_text())) if have_floats() else 0,
    }


@app.get("/field/meta", response_model=FieldMeta)
def field_meta():
    return field_meta_dict()


def _synth_field(meta: dict, variable: str, t: int, d: int) -> np.ndarray:
    """Fixture-mode stand-in: a smooth grid with a crude land mask as NaN (never 0)."""
    ny, nx = meta["ny"], meta["nx"]
    vmin = meta["ranges"][variable]["min"]
    vmax = meta["ranges"][variable]["max"]
    n_depth = len(meta["depths"])
    lat = np.linspace(meta["lat_min"], meta["lat_max"], ny)[:, None]
    lon = np.linspace(meta["lon_min"], meta["lon_max"], nx)[None, :]
    equatorial = np.cos(np.radians(lat) * 1.4)
    swirl = 0.15 * np.sin(np.radians(lon) * 2.0 + t * 0.3)
    depth_frac = d / max(n_depth - 1, 1)
    falloff = 0.08 + 0.92 * (1.0 - depth_frac) ** 1.5
    warmth = np.clip(0.55 * equatorial + swirl + 0.25, 0.0, 1.0) * falloff
    field = vmin + (vmax - vmin) * warmth
    land = (lat > 8) & (lat < 24) & (lon > 70) & (lon < 88) & (lat > 8 + (88 - lon) * 1.6)
    return np.where(land, np.nan, field).astype("<f4")


@app.get("/field/seafloor")
def field_seafloor():
    path = FIELD_DIR / "seafloor.bin"
    if not path.exists():
        raise HTTPException(404, "seafloor grid not precomputed")
    return Response(content=path.read_bytes(), media_type="application/octet-stream")


@app.get("/field/{variable}/{t}/{d}")
def field_grid(variable: str, t: int, d: int):
    meta = field_meta_dict()
    if variable not in meta["variables"]:
        raise HTTPException(404, f"unknown variable '{variable}'")
    if not 0 <= t < len(meta["times"]):
        raise HTTPException(404, f"time index {t} out of range 0..{len(meta['times']) - 1}")
    if not 0 <= d < len(meta["depths"]):
        raise HTTPException(404, f"depth index {d} out of range 0..{len(meta['depths']) - 1}")

    path = FIELD_DIR / variable / str(t) / f"{d}.bin"
    if path.exists():
        return Response(content=path.read_bytes(), media_type="application/octet-stream")
    if have_field():
        # Real-data mode with a hole in it. Synthesising here would put invented
        # numbers on screen dressed as the model — the one thing this project
        # promises never to do. Say the level is missing instead.
        raise HTTPException(
            404,
            f"no precomputed grid for {variable} t={t} d={d} — re-run pipeline/precompute.py",
        )
    grid = _synth_field(meta, variable, t, d)
    return Response(content=grid.tobytes(), media_type="application/octet-stream")


@app.get("/floats", response_model=list[FloatIndexItem])
def floats(t: int | None = None):
    # Float positions are per-profile, not per-model-timestep; t is accepted and ignored.
    if have_floats():
        return json.loads((FLOATS_DIR / "index.json").read_text())
    return load("floats_index.json")


def _float_entry(float_id: str) -> dict:
    index = json.loads((FLOATS_DIR / "index.json").read_text()) if have_floats() \
        else load("floats_index.json")
    for item in index:
        if item["id"] == float_id:
            return item
    raise HTTPException(404, f"float '{float_id}' not found")


@app.get("/floats/{float_id}/profile", response_model=Profile)
def float_profile(float_id: str, variable: str = "temperature"):
    entry = _float_entry(float_id)
    path = FLOATS_DIR / f"{float_id}.json"
    if path.exists():
        profiles = json.loads(path.read_text())
        if variable not in profiles:
            raise HTTPException(404, f"no '{variable}' profile for float {float_id}")
        return profiles[variable]

    # fixture fallback — temperature only
    if variable != "temperature":
        raise HTTPException(501, "fixture data is temperature only")
    profile = load("profile_sample.json")
    profile.update(float_id=float_id, lat=entry["lat"], lon=entry["lon"], time=entry["time"])
    return profile


@app.get("/compare/{float_id}", response_model=ComparisonResult)
def compare(float_id: str, variable: str = "temperature"):
    _float_entry(float_id)
    if have_field() and (FLOATS_DIR / f"{float_id}.json").exists():
        from compare.match import compare_float, UnitMismatch
        from compare.shift import decompose_error
        try:
            result = compare_float(float_id, variable)
        except UnitMismatch as e:
            raise HTTPException(422, str(e)) from e
        except KeyError as e:
            raise HTTPException(404, f"no model field for '{variable}'") from e
        result["decomposition"] = decompose_error(result)
        return result

    if variable != "temperature":
        raise HTTPException(501, "fixture data is temperature only")
    result = load("compare_sample.json")
    result["float_id"] = float_id
    return result


def _check_evidence_args(t: int, radius: float, half_life: float, d: int | None = None) -> None:
    """Both evidence routes index straight into data/field/<t>/<d>.bin, so an
    out-of-range index used to surface as an unhandled FileNotFoundError (500)."""
    meta = field_meta_dict()
    if not 0 <= t < len(meta["times"]):
        raise HTTPException(404, f"time index {t} out of range 0..{len(meta['times']) - 1}")
    if d is not None and not 0 <= d < len(meta["depths"]):
        raise HTTPException(404, f"depth index {d} out of range 0..{len(meta['depths']) - 1}")
    if not 0 < radius <= 20:
        raise HTTPException(422, "radius must be greater than 0 and at most 20 degrees")
    if not 0 < half_life <= 365:
        raise HTTPException(422, "half_life must be greater than 0 and at most 365 days")


@app.get("/evidence", response_model=list[EvidenceCell])
def evidence(t: int = 0, d: int = 0, radius: float = 2.5, half_life: float = 21.0):
    if have_field() and have_floats():
        _check_evidence_args(t, radius, half_life, d)
        from compare.evidence import evidence_grid
        return evidence_grid(t, d, radius, half_life)
    return load("evidence_sample.json")


@app.get("/evidence/headline", response_model=UnconstrainedSummary)
def evidence_headline(t: int = 0, region: str = "full", radius: float = 2.5, half_life: float = 21.0):
    if have_field() and have_floats():
        _check_evidence_args(t, radius, half_life)
        from compare.evidence import unconstrained_fraction
        return unconstrained_fraction(t, region, radius, half_life)
    return {"percent": 38, "label": "the Bay of Bengal", "n_cells": 0, "time_index": t}
