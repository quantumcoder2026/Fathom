"""
Turn downloaded NetCDF into the flat files the API serves.

    .venv/Scripts/python pipeline/precompute.py field  --source incois
    .venv/Scripts/python pipeline/precompute.py floats

Field output (contract: contracts/types.ts "Field binary format"):
    data/field/meta.json                      FieldMeta
    data/field/{variable}/{t}/{d}.bin         Float32, row-major, ny rows x nx cols,
                                              row 0 = lat_min, col 0 = lon_min,
                                              NaN = missing. NEVER 0.
    data/field/seafloor.bin                   Float32 ny x nx, deepest level with data
                                              at each cell (NaN where land)

Float output:
    data/floats/index.json                    FloatIndexItem[]
    data/floats/{id}.json                     { temperature: Profile, salinity: Profile }

Missing is not zero: fill values, land, below-seafloor cells and values outside a
physical validity range all become NaN here, and stay NaN all the way to the screen.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
FIELD_DIR = DATA / "field"
FLOATS_DIR = DATA / "floats"

# Physical validity ranges — anything outside is an artifact, not a measurement.
# Temperature: open-ocean max in this basin is ~32 degC; 35 leaves headroom without
# admitting the analysis blow-ups (which reach 80 degC).
# Salinity: the upper bound stays generous because Red Sea / Gulf outflow near the
# western edge of the box genuinely reaches ~40 PSU.
VALID = {"temperature": (-2.5, 35.0), "salinity": (2.0, 41.0)}

# How each source names things.
SOURCES = {
    "incois": {
        "glob": "raw/incois/*.nc",
        "vars": {"temperature": "TEMP", "salinity": "SAL"},
        "err": {"temperature": "TERR", "salinity": "SERR"},
        "depth": "ZAX", "lat": "latitude", "lon": "longitude", "time": "time",
        "label": "INCOIS ARGO 10-day Variational Analysis (erddap.incois.gov.in)",
    },
    "glorys": {
        "glob": "raw/model/*.nc",
        "vars": {"temperature": "thetao", "salinity": "so"},
        "err": {},
        "depth": "depth", "lat": "latitude", "lon": "longitude", "time": "time",
        "label": "Copernicus GLORYS12 reanalysis (GLOBAL_MULTIYEAR_PHY_001_030)",
    },
}


def _clean(arr: np.ndarray, variable: str) -> np.ndarray:
    """NaN out fill values and physically impossible values."""
    out = np.asarray(arr, dtype="float32").copy()
    lo, hi = VALID[variable]
    bad = ~np.isfinite(out) | (out < lo) | (out > hi)
    out[bad] = np.nan
    return out


def build_field(source: str, max_depth: float) -> None:
    spec = SOURCES[source]
    files = sorted((DATA).glob(spec["glob"]))
    if not files:
        raise SystemExit(f"no NetCDF found for source '{source}' at data/{spec['glob']}")
    print(f"source : {source}  ({len(files)} file(s))")
    ds = xr.open_mfdataset(files, combine="by_coords") if len(files) > 1 else xr.open_dataset(files[0])

    lat = np.asarray(ds[spec["lat"]].values, dtype="float64")
    lon = np.asarray(ds[spec["lon"]].values, dtype="float64")
    depths_all = np.asarray(ds[spec["depth"]].values, dtype="float64")
    keep = depths_all <= max_depth
    depths = depths_all[keep]
    times = [str(t)[:19] + "Z" for t in np.asarray(ds[spec["time"]].values)]

    # row 0 must be lat_min, col 0 must be lon_min
    lat_ascending = lat[0] < lat[-1]
    lon_ascending = lon[0] < lon[-1]
    ny, nx = len(lat), len(lon)

    present = {k: v for k, v in spec["vars"].items() if v in ds}
    if not present:
        raise SystemExit(f"none of {list(spec['vars'].values())} in {files[0].name}")

    ranges: dict[str, dict[str, float]] = {}
    seafloor = np.full((ny, nx), np.nan, dtype="float32")

    for variable, ncname in present.items():
        vmin, vmax = np.inf, -np.inf
        for ti in range(len(times)):
            for di, depth in enumerate(depths):
                grid = ds[ncname].isel({spec["time"]: ti, spec["depth"]: di}).values
                grid = _clean(grid, variable)
                if not lat_ascending:
                    grid = grid[::-1, :]
                if not lon_ascending:
                    grid = grid[:, ::-1]
                out = FIELD_DIR / variable / str(ti)
                out.mkdir(parents=True, exist_ok=True)
                grid.astype("<f4").tofile(out / f"{di}.bin")
                if np.isfinite(grid).any():
                    vmin = min(vmin, float(np.nanmin(grid)))
                    vmax = max(vmax, float(np.nanmax(grid)))
                if variable == "temperature" and ti == 0:
                    has = np.isfinite(grid)
                    seafloor[has] = float(depth)
        ranges[variable] = {"min": round(vmin, 3), "max": round(vmax, 3)}
        print(f"  {variable:<12} {len(times)}t x {len(depths)}d  range {vmin:.2f}..{vmax:.2f}")

    FIELD_DIR.mkdir(parents=True, exist_ok=True)
    seafloor.astype("<f4").tofile(FIELD_DIR / "seafloor.bin")

    meta = {
        "variables": sorted(present),
        "depths": [float(d) for d in depths],
        "times": times,
        "lat_min": float(min(lat)), "lat_max": float(max(lat)),
        "lon_min": float(min(lon)), "lon_max": float(max(lon)),
        "nx": nx, "ny": ny,
        "ranges": ranges,
        "source": spec["label"],
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (FIELD_DIR / "meta.json").write_text(json.dumps(meta, indent=2))
    covered = float(np.isfinite(seafloor).mean())
    print(f"  grid {nx} x {ny}   ocean cells {covered * 100:.1f}%   "
          f"seafloor {np.nanmin(seafloor):.0f}..{np.nanmax(seafloor):.0f} m")
    print(f"  wrote {FIELD_DIR / 'meta.json'}")


def build_floats(accepted_qc: tuple[int, ...] = (1, 2)) -> None:
    files = sorted((DATA / "raw" / "argo").glob("*.nc"))
    if not files:
        raise SystemExit("no Argo NetCDF at data/raw/argo/*.nc")
    ds = xr.open_dataset(files[0])
    print(f"argo   : {files[0].name}  ({ds.sizes.get('row', 0)} levels)")

    import gsw  # TEOS-10: pressure (dbar) -> depth (m)

    def col(name: str) -> np.ndarray:
        return ds[name].values

    pid = np.array([str(x).strip() for x in col("platform_number")])
    cyc = np.asarray(col("cycle_number"))
    lat = np.asarray(col("latitude"), dtype="float64")
    lon = np.asarray(col("longitude"), dtype="float64")
    tim = np.asarray(col("time"))
    pres = np.asarray(col("pres"), dtype="float64")
    mode = np.array([str(x).strip() for x in col("data_mode")])

    def qcarr(name: str) -> np.ndarray:
        raw = np.array([str(x).strip() for x in col(name)])
        return np.array([int(v) if v.isdigit() else 9 for v in raw])

    fields = {}
    for var, base in (("temperature", "temp"), ("salinity", "psal")):
        adj, adj_qc = col(f"{base}_adjusted"), qcarr(f"{base}_adjusted_qc")
        raw, raw_qc = col(base), qcarr(f"{base}_qc")
        adj = np.asarray(adj, dtype="float64")
        raw = np.asarray(raw, dtype="float64")
        # prefer the adjusted value when its QC is acceptable, else the raw value
        use_adj = np.isin(adj_qc, accepted_qc) & np.isfinite(adj)
        value = np.where(use_adj, adj, raw)
        qc = np.where(use_adj, adj_qc, raw_qc)
        value = np.where(np.isin(qc, accepted_qc), value, np.nan)
        fields[var] = (value, qc)

    FLOATS_DIR.mkdir(parents=True, exist_ok=True)
    keys = np.array([f"{a}_{b}" for a, b in zip(pid, cyc)])
    index: list[dict] = []

    # A float can report several cycles in the window, and some are 2-level duds.
    # Keep, per float, the cycle with the most QC-passing temperature levels.
    temp_value = fields["temperature"][0]
    best: dict[str, tuple[int, str]] = {}
    for key in dict.fromkeys(keys):
        m = keys == key
        fid = pid[m][0]
        n_good = int(np.isfinite(temp_value[m]).sum())
        if n_good > best.get(fid, (-1, ""))[0]:
            best[fid] = (n_good, key)

    MIN_LEVELS = 5
    skipped = 0
    for fid, (n_good, key) in sorted(best.items()):
        if n_good < MIN_LEVELS:
            skipped += 1
            continue
        m = keys == key
        # pres[m] is already this profile's rows, so depth is too — index it with
        # `order` directly, never with `m` again.
        depth = np.abs(gsw.z_from_p(pres[m], lat[m][0]))
        order = np.argsort(depth)
        profiles = {}
        for var, (value, qc) in fields.items():
            v_sub, q_sub = value[m], qc[m]
            levels = [
                {"depth": round(float(depth[i]), 1),
                 "value": (None if not np.isfinite(v_sub[i]) else round(float(v_sub[i]), 3)),
                 "qc": int(q_sub[i])}
                for i in order
            ]
            profiles[var] = {
                "float_id": fid, "lat": float(lat[m][0]), "lon": float(lon[m][0]),
                "time": str(tim[m][0])[:19] + "Z", "variable": var,
                "units": "degC" if var == "temperature" else "psu",
                "levels": levels, "source_file": files[0].name,
                "data_mode": mode[m][0],
            }
        (FLOATS_DIR / f"{fid}.json").write_text(json.dumps(profiles))
        good = sum(1 for lv in profiles["temperature"]["levels"] if lv["value"] is not None)
        index.append({
            "id": fid, "lat": float(lat[m][0]), "lon": float(lon[m][0]),
            "time": str(tim[m][0])[:19] + "Z", "n_levels": good,
        })

    index.sort(key=lambda f: f["id"])
    (FLOATS_DIR / "index.json").write_text(json.dumps(index, indent=1))
    depths_reached = [f["n_levels"] for f in index]
    print(f"  {len(index)} floats -> {FLOATS_DIR}   ({skipped} skipped: under {MIN_LEVELS} good levels)")
    print(f"  good levels per float: min {min(depths_reached)}, median "
          f"{int(np.median(depths_reached))}, max {max(depths_reached)}")
    print(f"  QC accepted: {list(accepted_qc)}   (levels failing QC are null, never 0)")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("what", choices=["field", "floats", "all"])
    p.add_argument("--source", default="incois", choices=list(SOURCES))
    p.add_argument("--max-depth", type=float, default=1000.0)
    a = p.parse_args()
    if a.what in ("field", "all"):
        build_field(a.source, a.max_depth)
    if a.what in ("floats", "all"):
        build_floats()


if __name__ == "__main__":
    main()
