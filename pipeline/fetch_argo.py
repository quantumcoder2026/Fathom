"""
Download Argo float profiles for the Fathom demo box straight from the Ifremer
Argo ERDDAP (Coriolis GDAC mirror). No account, no argopy — just an HTTP GET of a
tabledap NetCDF.

    .venv/Scripts/python pipeline/fetch_argo.py

Writes data/raw/argo/argo_io_<start>_<end>.nc and prints a summary.

Box + month come from docs/SIH26067_MASTER_PLAN.md (tropical Indian Ocean,
40-100 E, 25 S - 25 N, August 2023). Override with flags if needed.
"""

from __future__ import annotations

import argparse
import time
import urllib.request
from pathlib import Path

import numpy as np
import xarray as xr

ERDDAP = "https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.nc"

VARIABLES = [
    "platform_number", "cycle_number", "time", "latitude", "longitude", "position_qc",
    "pres", "pres_qc", "pres_adjusted", "pres_adjusted_qc",
    "temp", "temp_qc", "temp_adjusted", "temp_adjusted_qc",
    "psal", "psal_qc", "psal_adjusted", "psal_adjusted_qc",
    "data_mode",
]

OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "argo"


def build_url(start: str, end: str, lon_min: float, lon_max: float,
              lat_min: float, lat_max: float) -> str:
    # ERDDAP tabledap: only the comparison operators need percent-encoding;
    # ':' '=' '&' ',' stay literal.
    query = (
        ",".join(VARIABLES)
        + f"&time>={start}T00:00:00Z&time<={end}T00:00:00Z"
        + f"&latitude>={lat_min}&latitude<={lat_max}"
        + f"&longitude>={lon_min}&longitude<={lon_max}"
    )
    return ERDDAP + "?" + query.replace(">", "%3E").replace("<", "%3C")


def summarise(path: Path) -> None:
    ds = xr.open_dataset(path)
    n_rows = ds.sizes.get("row", 0)
    floats = np.unique(ds["platform_number"].values)
    print(f"\n  rows (measurement levels): {n_rows}")
    print(f"  distinct floats: {len(floats)}")
    print(f"  profiles (float x cycle): "
          f"{len(np.unique(list(zip(ds['platform_number'].values, ds['cycle_number'].values))))}")
    for var in ("temp", "psal", "pres"):
        v = ds[var].values.astype(float)
        print(f"  {var:5s} range: {np.nanmin(v):8.3f} .. {np.nanmax(v):8.3f}   "
              f"({ds[var].attrs.get('units', '?')})")
    for qc in ("temp_qc", "psal_qc", "pres_qc"):
        vals, counts = np.unique(ds[qc].values.astype(str), return_counts=True)
        print(f"  {qc:8s}: " + ", ".join(f"{a or 'blank'}={c}" for a, c in zip(vals, counts)))
    modes, mcounts = np.unique(ds["data_mode"].values.astype(str), return_counts=True)
    print("  data_mode: " + ", ".join(f"{a}={c}" for a, c in zip(modes, mcounts))
          + "   (R=real-time, A=adjusted, D=delayed)")
    print(f"\n  first floats: {', '.join(map(str, floats[:12]))}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--start", default="2023-08-01")
    p.add_argument("--end", default="2023-09-01")
    p.add_argument("--lon-min", type=float, default=40.0)
    p.add_argument("--lon-max", type=float, default=100.0)
    p.add_argument("--lat-min", type=float, default=-25.0)
    p.add_argument("--lat-max", type=float, default=25.0)
    args = p.parse_args()

    url = build_url(args.start, args.end, args.lon_min, args.lon_max,
                    args.lat_min, args.lat_max)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"argo_io_{args.start}_{args.end}.nc"

    print(f"GET  {url}")
    t0 = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "fathom/pipeline"})
    with urllib.request.urlopen(req, timeout=600) as resp, open(out, "wb") as fh:
        fh.write(resp.read())
    print(f"wrote {out}  ({out.stat().st_size / 1e6:.1f} MB, {time.time() - t0:.1f}s)")

    summarise(out)


if __name__ == "__main__":
    main()
