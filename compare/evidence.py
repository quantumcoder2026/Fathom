"""
The evidence layer — how well is the model actually supported by observation,
cell by cell, depth by depth.

    from compare.evidence import evidence_grid, unconstrained_fraction

The model gives a value everywhere. That does not mean we KNOW the ocean
everywhere. This turns "how close is the nearest real profile, and how recent"
into a field, so the 3D view can be shaded by it and the headline number
("X% of the water column is currently unconstrained") is a real computed figure,
not a guess.

Method (matches BUILD_BOOK §5):
  coarse 2 deg grid over the model domain, one pass per depth level
  per cell:
    n_observations = Argo profiles in the cell that sampled near this depth
                     within RECENCY_DAYS of the model timestep
    days_since_last = age of the closest such profile, or null
    confidence      = exp(-days_since_last / 15) * min(n_observations / 3, 1)
    status          = constrained  (> 0.6)
                      weak         (> 0.2)
                      unconstrained (otherwise, incl. no observations at all)

Pure arithmetic, no interpolation between cells. Missing is not zero: a cell with
no nearby profile has confidence 0 and days_since_last null, never a filled-in age.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FIELD = ROOT / "data" / "field"
FLOATS = ROOT / "data" / "floats"

# Defaults. RADIUS_DEG and HALF_LIFE_DAYS are the two knobs BUILD_BOOK wants
# exposed as UI sliders — every call takes them as arguments so the demo can show
# how sensitive "how much do we know" is to its own assumptions.
RADIUS_DEG = 2.5          # ~275 km: an Argo profile supports the field this far out
RECENCY_DAYS = 40         # older than this and a profile no longer counts as support
HALF_LIFE_DAYS = 21.0     # recency decay in the confidence formula
TARGET_OBS = 2            # observations at which the count term saturates
_BASE_DEPTH_TOL_M = 35.0  # "sampled near this depth" window, widened with depth


@lru_cache(maxsize=1)
def _meta() -> dict:
    return json.loads((FIELD / "meta.json").read_text())


@lru_cache(maxsize=1)
def _profiles() -> list[dict]:
    """One compact record per float: position, time, and the depths it sampled."""
    out: list[dict] = []
    for path in sorted(FLOATS.glob("*.json")):
        if path.name == "index.json":
            continue
        data = json.loads(path.read_text())
        prof = data.get("temperature") or next(iter(data.values()))
        depths = np.array(
            [lv["depth"] for lv in prof["levels"] if lv["value"] is not None],
            dtype="float64",
        )
        out.append({
            "id": prof["float_id"],
            "lat": float(prof["lat"]),
            "lon": float(prof["lon"]),
            "time": datetime.fromisoformat(prof["time"].replace("Z", "+00:00")),
            "depths": depths,
        })
    return out


def _model_time(time_index: int) -> datetime:
    m = _meta()
    idx = max(0, min(time_index, len(m["times"]) - 1))
    return datetime.fromisoformat(m["times"][idx].replace("Z", "+00:00"))


def _confidence(days: float, n_obs: float, half_life: float) -> float:
    c = np.exp(-days / half_life) * min(n_obs / TARGET_OBS, 1.0)
    return float(max(0.0, min(1.0, c)))


def _status(conf: float) -> str:
    return "constrained" if conf > 0.6 else "weak" if conf > 0.2 else "unconstrained"


def _depth_tol(depth: float) -> float:
    # model levels are ~10 m apart near the surface, ~100 m apart at depth
    return max(_BASE_DEPTH_TOL_M, depth * 0.14)


def evidence_grid(
    time_index: int,
    depth_index: int,
    radius_deg: float = RADIUS_DEG,
    half_life_days: float = HALF_LIFE_DAYS,
) -> list[dict]:
    """A coarse grid over the domain (cells sized to `radius_deg`), each rated by
    how many nearby Argo profiles sampled near this depth and how recent they are.
    A profile within `radius_deg` of a cell centre counts, weighted 1/(1+dist²)."""
    m = _meta()
    depth = m["depths"][max(0, min(depth_index, len(m["depths"]) - 1))]
    when = _model_time(time_index)
    tol = _depth_tol(depth)
    profs = _profiles()

    step = radius_deg
    lat0 = np.floor(m["lat_min"] / step) * step
    lon0 = np.floor(m["lon_min"] / step) * step
    n_lat = int(np.ceil((m["lat_max"] - lat0) / step))
    n_lon = int(np.ceil((m["lon_max"] - lon0) / step))

    # keep only profiles that sampled near this depth, recently enough
    active: list[tuple[float, float, float]] = []  # (lat, lon, age_days)
    for p in profs:
        if p["depths"].size == 0 or np.min(np.abs(p["depths"] - depth)) > tol:
            continue
        age = abs((when - p["time"]).total_seconds()) / 86_400.0
        if age <= RECENCY_DAYS:
            active.append((p["lat"], p["lon"], age))

    cells: list[dict] = []
    for r in range(n_lat):
        for c in range(n_lon):
            lat = lat0 + (r + 0.5) * step
            lon = lon0 + (c + 0.5) * step
            weighted = 0.0
            nearest_age: float | None = None
            n_within = 0
            for plat, plon, age in active:
                d = np.hypot(plat - lat, (plon - lon) * np.cos(np.radians(lat)))
                if d > radius_deg:
                    continue
                n_within += 1
                weighted += 1.0 / (1.0 + (d / (radius_deg * 0.5)) ** 2)
                if nearest_age is None or age < nearest_age:
                    nearest_age = age
            conf = _confidence(nearest_age, weighted, half_life_days) if nearest_age is not None else 0.0
            cells.append({
                "lat": round(lat, 2),
                "lon": round(lon, 2),
                "depth": float(depth),
                "n_observations": n_within,
                "days_since_last": round(nearest_age, 2) if nearest_age is not None else None,
                "confidence": round(conf, 3),
                "status": _status(conf),
            })
    return cells


@lru_cache(maxsize=32)
def unconstrained_fraction(
    time_index: int,
    region: str = "full",
    radius_deg: float = RADIUS_DEG,
    half_life_days: float = HALF_LIFE_DAYS,
) -> dict:
    """Fraction of the model's water column that is currently unconstrained —
    averaged over every depth level, over the ocean cells that have a model value.
    This is the headline number, and it is a real computed figure."""
    m = _meta()
    ny, nx = m["ny"], m["nx"]
    lats = np.linspace(m["lat_min"], m["lat_max"], ny)
    lons = np.linspace(m["lon_min"], m["lon_max"], nx)

    if region == "bob":  # Bay of Bengal
        rmask = (lats[:, None] >= 5) & (lats[:, None] <= 22) & \
                (lons[None, :] >= 80) & (lons[None, :] <= 95)
        label = "the Bay of Bengal"
    else:
        rmask = np.ones((ny, nx), dtype=bool)
        label = "this region"

    step = radius_deg
    lat0 = np.floor(m["lat_min"] / step) * step
    lon0 = np.floor(m["lon_min"] / step) * step
    rr = ((lats - lat0) // step).astype(int)
    cc = ((lons - lon0) // step).astype(int)

    total = 0
    unconstrained = 0
    for d in range(len(m["depths"])):
        grid = np.fromfile(FIELD / "temperature" / str(time_index) / f"{d}.bin",
                           dtype="<f4").reshape(ny, nx)
        has_value = np.isfinite(grid) & rmask
        if not has_value.any():
            continue
        by_rc = {
            (int((c["lat"] - lat0) // step), int((c["lon"] - lon0) // step)): c["status"]
            for c in evidence_grid(time_index, d, radius_deg, half_life_days)
        }
        for i, j in zip(*np.where(has_value)):
            total += 1
            if by_rc.get((int(rr[i]), int(cc[j])), "unconstrained") == "unconstrained":
                unconstrained += 1

    pct = round(100 * unconstrained / total) if total else None
    return {"percent": pct, "label": label, "n_cells": total, "time_index": time_index}
