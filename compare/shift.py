"""
Error decomposition — is the model wrong about the VALUE, or about the DEPTH?

    from compare.shift import decompose_error
    decompose_error(result)   # result from compare.match.compare_float

RMSE collapses two very different failures into one number:
  amplitude error     right depth, wrong value  (model heat budget is off)
  displacement error  right values, whole structure sitting too high or too low
                      (model mixing / dynamics is off)

We search for the vertical shift that best aligns the model column to the
observations, and report how much of the raw RMSE that shift explains.

Method (mirrors the atmospheric forecast-verification technique, not our own
invention): for each candidate shift s, re-interpolate the ORIGINAL model column
onto (observed_depths + s) and recompute RMSE. Three traps this avoids:
  - always re-interpolate from the original column, never from a shifted copy
  - require at least 60% of levels to still have model coverage after the shift
  - a best shift at the edge of the search window is "no clear signal", not a result
"""

from __future__ import annotations

import numpy as np

SEARCH_M = 120      # search +/- this many metres
STEP_M = 2
MIN_COVERAGE = 0.6  # a shift that loses more than 40% of levels doesn't count


def _interp_no_extrap(xs: np.ndarray, ys: np.ndarray, x: float) -> float:
    if x < xs[0] or x > xs[-1]:
        return float("nan")
    return float(np.interp(x, xs, ys))


def decompose_error(result: dict) -> dict | None:
    """Returns an ErrorDecomposition dict, or None if there isn't enough to work with."""
    ok = [p for p in result["points"] if p["status"] == "ok"]
    if len(ok) < 5:
        return None

    obs_d = np.array([p["depth"] for p in ok], dtype="float64")
    obs_v = np.array([p["observed"] for p in ok], dtype="float64")

    # Rebuild the original model column from the matched points (depth -> model),
    # deduplicated and sorted, so every candidate shift samples the same source.
    have_model = [p for p in result["points"] if p["model"] is not None]
    if len(have_model) < 2:
        return None
    md = np.array([p["depth"] for p in have_model], dtype="float64")
    mv = np.array([p["model"] for p in have_model], dtype="float64")
    order = np.argsort(md)
    md, mv = md[order], mv[order]
    uniq = np.concatenate(([True], np.diff(md) > 0))
    md, mv = md[uniq], mv[uniq]

    raw_rmse = float(np.sqrt(((obs_v - np.array([p["model"] for p in ok])) ** 2).mean()))
    if raw_rmse == 0:
        return None

    best: tuple[float, float, int] | None = None
    for s in range(-SEARCH_M, SEARCH_M + 1, STEP_M):
        shifted = np.array([_interp_no_extrap(md, mv, d + s) for d in obs_d])
        valid = np.isfinite(shifted)
        if valid.mean() < MIN_COVERAGE:
            continue
        rmse = float(np.sqrt(((obs_v[valid] - shifted[valid]) ** 2).mean()))
        if best is None or rmse < best[1]:
            best = (float(s), rmse, int(valid.sum()))

    if best is None:
        return None
    best_shift, shifted_rmse, n_valid = best

    return {
        "raw_rmse": round(raw_rmse, 3),
        "best_shift_m": best_shift,
        "shifted_rmse": round(shifted_rmse, 3),
        "displacement_fraction": round(max(0.0, 1.0 - shifted_rmse / raw_rmse), 3),
        "n_valid_after_shift": n_valid,
        # a shift pinned to the edge of the window means the misfit doesn't
        # actually look like a vertical displacement
        "conclusive": abs(best_shift) < SEARCH_M * 0.85,
    }
