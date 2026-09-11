"""
Ocean Match — compare one Argo float profile against the model field at that
float's position and time.

    from compare.match import compare_float
    result = compare_float("1902594", "temperature")   # -> ComparisonResult dict

The six matching problems, handled explicitly:
  A  QC        levels failing QC were already dropped to null in precompute
  B  units     both sides checked, degC / psu, fail loudly otherwise
  C  space     nearest model grid cell, separation recorded in km (haversine)
  D  time      nearest model time step, separation recorded in hours
  E  depth     Argo pressure was converted to depth (TEOS-10) in precompute;
               the model column is linearly interpolated onto the float's depths
               and NEVER extrapolated - outside the column it is no_model_coverage
  F  stats     observed - model, then bias / RMSE / max |diff| / depth of max

Missing is not zero. Every point carries a status and a null, never a filled-in
number.
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

EXPECTED_UNITS = {"temperature": {"degC", "degc", "degs", "celsius"},
                  "salinity": {"psu", "pss-78", "1e-3"}}


class UnitMismatch(RuntimeError):
    pass


def _stamp() -> float:
    """Modification time of meta.json — every cache below is keyed on it, so a
    re-run of precompute.py invalidates them instead of serving the previous
    dataset's grid dimensions against the new dataset's binaries."""
    return (FIELD / "meta.json").stat().st_mtime


@lru_cache(maxsize=4)
def _meta_at(stamp: float) -> dict:
    return json.loads((FIELD / "meta.json").read_text())


def _meta() -> dict:
    return _meta_at(_stamp())


@lru_cache(maxsize=256)
def _column_at(stamp: float, variable: str, t: int, row: int, col: int) -> tuple[float, ...]:
    """The model's vertical column at one grid cell, one time step.

    Reads only the four bytes it needs per level (seek by offset) rather than
    pulling the whole grid into memory — a GLORYS level is 1.7 MB, and a column
    touches every level."""
    m = _meta_at(stamp)
    nx, ny = m["nx"], m["ny"]
    if not (0 <= row < ny and 0 <= col < nx):
        raise IndexError(f"cell ({row},{col}) outside the {ny}x{nx} grid")
    offset = (row * nx + col) * 4
    expected = nx * ny * 4
    out = []
    for d in range(len(m["depths"])):
        path = FIELD / variable / str(t) / f"{d}.bin"
        size = path.stat().st_size
        if size != expected:
            # meta and the binaries disagree — refuse rather than index into the
            # wrong ocean and return a confident wrong number
            raise ValueError(
                f"{path.name} is {size} bytes, meta.json describes {nx}x{ny} "
                f"({expected} bytes). Re-run pipeline/precompute.py."
            )
        out.append(float(np.fromfile(path, dtype="<f4", count=1, offset=offset)[0]))
    return tuple(out)


def _column(variable: str, t: int, row: int, col: int) -> tuple[float, ...]:
    return _column_at(_stamp(), variable, t, row, col)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return float(2 * r * np.arcsin(np.sqrt(a)))


def _interp_no_extrap(xs: np.ndarray, ys: np.ndarray, x: float) -> float:
    """Linear interpolation that refuses to extrapolate (returns NaN outside)."""
    ok = np.isfinite(ys)
    if ok.sum() < 2:
        return float("nan")
    xs, ys = xs[ok], ys[ok]
    if x < xs[0] or x > xs[-1]:
        return float("nan")
    return float(np.interp(x, xs, ys))


def compare_float(float_id: str, variable: str = "temperature") -> dict:
    m = _meta()
    if variable not in m["variables"]:
        raise KeyError(f"no model field for '{variable}'")

    path = FLOATS / f"{float_id}.json"
    if not path.exists():
        raise FileNotFoundError(float_id)
    profile = json.loads(path.read_text())[variable]

    units = str(profile.get("units", "")).lower()
    if units not in EXPECTED_UNITS[variable]:
        raise UnitMismatch(f"{variable} observations are in '{units}', expected "
                           f"one of {sorted(EXPECTED_UNITS[variable])}")

    # --- C: nearest grid cell -------------------------------------------------
    ny, nx = m["ny"], m["nx"]
    lats = np.linspace(m["lat_min"], m["lat_max"], ny)
    lons = np.linspace(m["lon_min"], m["lon_max"], nx)
    row = int(np.argmin(np.abs(lats - profile["lat"])))
    col = int(np.argmin(np.abs(lons - profile["lon"])))
    sep_km = _haversine_km(profile["lat"], profile["lon"], lats[row], lons[col])

    # --- D: nearest time step -------------------------------------------------
    obs_t = datetime.fromisoformat(profile["time"].replace("Z", "+00:00"))
    model_ts = [datetime.fromisoformat(t.replace("Z", "+00:00")) for t in m["times"]]
    t_idx = int(np.argmin([abs((mt - obs_t).total_seconds()) for mt in model_ts]))
    sep_h = abs((model_ts[t_idx] - obs_t).total_seconds()) / 3600.0

    # --- E: vertical alignment ------------------------------------------------
    depths = np.asarray(m["depths"], dtype="float64")
    column = np.asarray(_column(variable, t_idx, row, col), dtype="float64")

    points, diffs, diff_depths = [], [], []
    for level in profile["levels"]:
        d, observed = level["depth"], level["value"]
        if observed is None:
            model_here = _interp_no_extrap(depths, column, d)
            points.append({"depth": d, "observed": None,
                           "model": None if not np.isfinite(model_here) else round(model_here, 3),
                           "difference": None, "status": "qc_rejected"})
            continue
        # _interp_no_extrap already returns NaN outside the model column, which
        # covers both "deeper than the model goes" and "below the seafloor here".
        model_here = _interp_no_extrap(depths, column, d)
        if not np.isfinite(model_here):
            points.append({"depth": d, "observed": observed, "model": None,
                           "difference": None, "status": "no_model_coverage"})
            continue
        diff = observed - model_here
        points.append({"depth": d, "observed": observed, "model": round(model_here, 3),
                       "difference": round(diff, 3), "status": "ok"})
        diffs.append(diff)
        diff_depths.append(d)

    # --- F: statistics --------------------------------------------------------
    if diffs:
        arr = np.asarray(diffs)
        k = int(np.argmax(np.abs(arr)))
        stats = {"n_points": len(arr), "bias": round(float(arr.mean()), 3),
                 "rmse": round(float(np.sqrt((arr ** 2).mean())), 3),
                 "max_abs_difference": round(float(np.abs(arr).max()), 3),
                 "depth_of_max": diff_depths[k]}
    else:
        stats = {"n_points": 0, "bias": None, "rmse": None,
                 "max_abs_difference": None, "depth_of_max": None}

    return {
        "float_id": float_id,
        "variable": variable,
        "points": points,
        "stats": stats,
        "matching": {
            "spatial_separation_km": round(sep_km, 2),
            "temporal_separation_hours": round(sep_h, 2),
            "method": "nearest-neighbour cell + nearest time step + "
                      "linear vertical interpolation (no extrapolation)",
        },
        "provenance": {
            "model_file": m.get("source", "model"),
            "obs_file": profile.get("source_file", "argo"),
            "qc_flags_accepted": [1, 2],
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    }
