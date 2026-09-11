"""
The evidence layer — how well is the model actually supported by observation,
cell by cell, depth by depth.

    from compare.evidence import evidence_grid, unconstrained_fraction

The model gives a value everywhere. That does not mean we KNOW the ocean
everywhere. This turns "how close is the nearest real profile, and how recent"
into a field, so the 3D view can be shaded by it and the headline number
("X% of the water column is currently unconstrained") is a real computed figure,
not a guess.

Method:
  a coarse grid over the model domain, cells sized to `radius_deg`, one pass per
  depth level. Per cell, over the Argo profiles that sampled within `_depth_tol`
  of this depth and are no older than `_recency_cut(half_life)`:
    n_observations  = profiles whose centre distance is <= radius_deg
    days_since_last = age of the closest such profile, or null
    weighted        = sum over those profiles of 1 / (1 + (dist / (radius/2))^2)
                      — a nearby profile counts for more than one at the rim
    confidence      = exp(-days_since_last / half_life) * min(weighted / TARGET_OBS, 1)
                      clamped to 0..1
    status          = constrained  (> 0.6)
                      weak         (> 0.2)
                      unconstrained (otherwise, incl. no observations at all)

Both `radius_deg` and `half_life` are UI knobs, not physical constants — the
point of the layer is that the headline number moves when you state a different
assumption, and you can see it move.

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


def _stamp() -> tuple[float, float]:
    """(meta.json mtime, float index mtime) — every cache below is keyed on this,
    so re-running precompute.py invalidates them instead of mixing one dataset's
    grid with another's binaries."""
    meta_t = (FIELD / "meta.json").stat().st_mtime
    idx = FLOATS / "index.json"
    return (meta_t, idx.stat().st_mtime if idx.exists() else 0.0)


@lru_cache(maxsize=4)
def _meta_at(stamp: tuple[float, float]) -> dict:
    return json.loads((FIELD / "meta.json").read_text())


def _meta() -> dict:
    return _meta_at(_stamp())


@lru_cache(maxsize=4)
def _profiles_at(stamp: tuple[float, float]) -> list[dict]:
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


def _profiles() -> list[dict]:
    return _profiles_at(_stamp())


def _model_time(time_index: int) -> datetime:
    m = _meta()
    idx = max(0, min(time_index, len(m["times"]) - 1))
    return datetime.fromisoformat(m["times"][idx].replace("Z", "+00:00"))


def _status(conf: float) -> str:
    return "constrained" if conf > 0.6 else "weak" if conf > 0.2 else "unconstrained"


def _depth_tol(depth: float) -> float:
    # model levels are ~10 m apart near the surface, ~100 m apart at depth
    return max(_BASE_DEPTH_TOL_M, depth * 0.14)


def _recency_cut(half_life_days: float) -> float:
    """Age past which a profile stops counting at all. Scales with the half-life
    knob: with a fixed 40-day cut, every half-life above ~40 d produced the same
    map, so the top third of the slider silently did nothing."""
    return max(RECENCY_DAYS, 2.0 * half_life_days)


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
    cut = _recency_cut(half_life_days)
    active: list[tuple[float, float, float]] = []  # (lat, lon, age_days)
    for p in profs:
        if p["depths"].size == 0 or np.min(np.abs(p["depths"] - depth)) > tol:
            continue
        age = abs((when - p["time"]).total_seconds()) / 86_400.0
        if age <= cut:
            active.append((p["lat"], p["lon"], age))

    # cell centres, flattened row-major (r outer, c inner)
    lat_c = lat0 + (np.arange(n_lat) + 0.5) * step
    lon_c = lon0 + (np.arange(n_lon) + 0.5) * step
    cell_lat = np.repeat(lat_c, n_lon)
    cell_lon = np.tile(lon_c, n_lat)
    n_cells = cell_lat.size

    if active:
        # every cell against every nearby profile in one array op — the nested
        # Python loop this replaces dominated the headline figure's runtime
        p_lat = np.array([a[0] for a in active], dtype="float64")
        p_lon = np.array([a[1] for a in active], dtype="float64")
        p_age = np.array([a[2] for a in active], dtype="float64")
        dlat = p_lat[None, :] - cell_lat[:, None]
        dlon = (p_lon[None, :] - cell_lon[:, None]) * np.cos(np.radians(cell_lat))[:, None]
        dist = np.hypot(dlat, dlon)
        within = dist <= radius_deg
        n_within = within.sum(axis=1)
        weighted = np.where(within, 1.0 / (1.0 + (dist / (radius_deg * 0.5)) ** 2), 0.0).sum(axis=1)
        nearest = np.where(within, p_age[None, :], np.inf).min(axis=1)
    else:
        n_within = np.zeros(n_cells, dtype=int)
        weighted = np.zeros(n_cells)
        nearest = np.full(n_cells, np.inf)

    seen = np.isfinite(nearest)
    conf = np.where(
        seen,
        np.exp(-np.where(seen, nearest, 0.0) / half_life_days)
        * np.minimum(weighted / TARGET_OBS, 1.0),
        0.0,
    )
    conf = np.clip(conf, 0.0, 1.0)

    cells: list[dict] = [
        {
            "lat": round(float(cell_lat[i]), 2),
            "lon": round(float(cell_lon[i]), 2),
            "depth": float(depth),
            "n_observations": int(n_within[i]),
            "days_since_last": round(float(nearest[i]), 2) if seen[i] else None,
            "confidence": round(float(conf[i]), 3),
            "status": _status(float(conf[i])),
        }
        for i in range(n_cells)
    ]
    return cells


def unconstrained_fraction(
    time_index: int,
    region: str = "full",
    radius_deg: float = RADIUS_DEG,
    half_life_days: float = HALF_LIFE_DAYS,
) -> dict:
    return _unconstrained_at(_stamp(), time_index, region, radius_deg, half_life_days)


@lru_cache(maxsize=32)
def _unconstrained_at(
    stamp: tuple[float, float],
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
    # which coarse evidence cell each model row / column falls in
    rr = ((lats - lat0) // step).astype(int)
    cc = ((lons - lon0) // step).astype(int)
    n_row = int(rr.max()) + 2  # +2 so an index landing exactly on the top edge fits
    n_col = int(cc.max()) + 2

    total = 0
    unconstrained = 0
    for d in range(len(m["depths"])):
        path = FIELD / "temperature" / str(time_index) / f"{d}.bin"
        raw = np.fromfile(path, dtype="<f4")
        if raw.size != ny * nx:
            raise ValueError(
                f"{path.name} holds {raw.size} values, meta.json describes "
                f"{ny}x{nx} = {ny * nx}. Re-run pipeline/precompute.py."
            )
        has_value = np.isfinite(raw.reshape(ny, nx)) & rmask
        if not has_value.any():
            continue
        # a cell with no evidence entry counts as unconstrained, so default True
        unc = np.ones((n_row, n_col), dtype=bool)
        for c in evidence_grid(time_index, d, radius_deg, half_life_days):
            r_i = int((c["lat"] - lat0) // step)
            c_i = int((c["lon"] - lon0) // step)
            if 0 <= r_i < n_row and 0 <= c_i < n_col:
                unc[r_i, c_i] = c["status"] == "unconstrained"
        # broadcast the coarse grid back onto the model grid in one shot — the
        # per-cell Python loop this replaces took ~12 s on a 720x601x35 field
        cell_unc = unc[rr[:, None], cc[None, :]]
        total += int(has_value.sum())
        unconstrained += int((has_value & cell_unc).sum())

    pct = round(100 * unconstrained / total) if total else None
    return {"percent": pct, "label": label, "n_cells": total, "time_index": time_index}
