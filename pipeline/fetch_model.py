"""
Download the Copernicus GLORYS12 reanalysis subset for the Fathom demo box.

    copernicusmarine login          # once — caches credentials
    .venv/Scripts/python pipeline/fetch_model.py

Writes data/raw/model/glorys_io_<start>_<end>.nc and prints a summary.

Box + month from docs/SIH26067_MASTER_PLAN.md: tropical Indian Ocean,
40-100 E, 25 S - 25 N, 0-1000 m, temperature (thetao) + salinity (so),
August 2023 daily. Override with flags if needed.

If the default dataset does not cover the requested month, pass
--dataset-id cmems_mod_glo_phy_myint_0.083deg_P1D-m (the interim stream).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import xarray as xr

DEFAULT_DATASET = "cmems_mod_glo_phy_my_0.083deg_P1D-m"
OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "model"


def summarise(path: Path) -> None:
    ds = xr.open_dataset(path)
    print("\n  dims:", dict(ds.sizes))
    print("  coords:", list(ds.coords))
    for v in ds.data_vars:
        a = ds[v]
        vals = a.values.astype("float64")
        print(f"  {v}: units={a.attrs.get('units','?')}  "
              f"range={np.nanmin(vals):.3f}..{np.nanmax(vals):.3f}  "
              f"fill={a.attrs.get('_FillValue', a.encoding.get('_FillValue', 'n/a'))}  "
              f"nan={int(np.isnan(vals).sum())}/{vals.size}")
    depth_name = next((c for c in ds.coords if c.lower() in ("depth", "deptht")), None)
    if depth_name:
        print(f"  {depth_name}: {ds[depth_name].values}")
    time_name = next((c for c in ds.coords if c.lower() in ("time", "time_counter")), None)
    if time_name:
        t = ds[time_name].values
        print(f"  {time_name}: {t.min()} .. {t.max()}  n={len(t)}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--start", default="2023-08-01")
    p.add_argument("--end", default="2023-08-31")
    p.add_argument("--lon-min", type=float, default=40.0)
    p.add_argument("--lon-max", type=float, default=100.0)
    p.add_argument("--lat-min", type=float, default=-25.0)
    p.add_argument("--lat-max", type=float, default=25.0)
    p.add_argument("--depth-max", type=float, default=1000.0)
    p.add_argument("--dataset-id", default=DEFAULT_DATASET)
    p.add_argument("--variables", default="thetao,so")
    args = p.parse_args()

    import copernicusmarine  # imported here so --help works without it

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"glorys_io_{args.start}_{args.end}.nc"
    variables = [v.strip() for v in args.variables.split(",") if v.strip()]

    print(f"dataset : {args.dataset_id}")
    print(f"box     : lon {args.lon_min}..{args.lon_max}, lat {args.lat_min}..{args.lat_max}, "
          f"depth 0..{args.depth_max} m")
    print(f"time    : {args.start} .. {args.end}")
    print(f"vars    : {variables}\n")

    t0 = time.time()
    try:
        copernicusmarine.subset(
            dataset_id=args.dataset_id,
            variables=variables,
            minimum_longitude=args.lon_min,
            maximum_longitude=args.lon_max,
            minimum_latitude=args.lat_min,
            maximum_latitude=args.lat_max,
            minimum_depth=0.0,
            maximum_depth=args.depth_max,
            start_datetime=f"{args.start}T00:00:00",
            end_datetime=f"{args.end}T23:59:59",
            output_directory=str(OUT_DIR),
            output_filename=out.name,
            overwrite=True,
        )
    except Exception as e:  # noqa: BLE001 — surface the cause plainly
        msg = str(e)
        print(f"\nFAILED: {type(e).__name__}: {msg[:400]}", file=sys.stderr)
        if "authentic" in msg.lower() or "credential" in msg.lower() or "login" in msg.lower():
            print("Run `copernicusmarine login` first (caches your free account credentials).",
                  file=sys.stderr)
        if "time" in msg.lower() or "coverage" in msg.lower() or "range" in msg.lower():
            print("If the month is not covered, retry with "
                  "--dataset-id cmems_mod_glo_phy_myint_0.083deg_P1D-m", file=sys.stderr)
        sys.exit(1)

    print(f"\nwrote {out}  ({out.stat().st_size / 1e6:.1f} MB, {time.time() - t0:.1f}s)")
    summarise(out)


if __name__ == "__main__":
    main()
