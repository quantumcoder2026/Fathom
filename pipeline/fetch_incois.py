"""
Download the INCOIS gridded Argo analysis (Variational Analysis Methodology) for
the Fathom demo box, straight from INCOIS's own ERDDAP.

This is one of the two model-output sources named in problem statement SIH26067
(https://las.incois.gov.in/). No account, no API key — a plain HTTP griddap slice.

    .venv/Scripts/python pipeline/fetch_incois.py

Writes data/raw/incois/incois_vam_<start>_<end>.nc and prints a summary.

Why this dataset matters beyond being a field to draw:
  TEMP / SAL   the analysed temperature + salinity field (1 deg, 10-day)
  TERR / SERR  INCOIS's OWN published per-cell analysis error

so we can ask whether our observed-minus-analysis misfit is consistent with the
uncertainty INCOIS themselves publish — a real validation question, not just a
picture. Note this is an objective ANALYSIS of Argo, so an Argo-vs-VAM
difference is representativeness + analysis error, not independent model error;
GLORYS (pipeline/fetch_model.py) is the independent numerical model.
"""

from __future__ import annotations

import argparse
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import xarray as xr

ERDDAP = "https://erddap.incois.gov.in/erddap/griddap"
DATASET = "incois_argo_10d_VAM"
OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "incois"

# Tomcat in front of this ERDDAP rejects raw [ ] in a query string, so the whole
# constraint expression must be percent-encoded (commas stay literal).
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE


def build_url(variables: list[str], start: str, end: str, depth_max: float,
              lon_min: float, lon_max: float, lat_min: float, lat_max: float,
              ext: str = ".nc") -> str:
    box = (f"[({start}T00:00:00Z):({end}T00:00:00Z)]"
           f"[(0):({depth_max})]"
           f"[({lat_min}):({lat_max})]"
           f"[({lon_min}):({lon_max})]")
    query = ",".join(f"{v}{box}" for v in variables)
    return f"{ERDDAP}/{DATASET}{ext}?" + urllib.parse.quote(query, safe=",")


def fetch(url: str, timeout: int = 300) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "fathom/pipeline"})
    with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
        return r.read()


def summarise(path: Path) -> None:
    ds = xr.open_dataset(path)
    print(f"\n  dims: {dict(ds.sizes)}")
    print(f"  depths (m): {ds['ZAX'].values}")
    times = ds["time"].values
    print(f"  times: {len(times)} step(s)  {str(times[0])[:19]} .. {str(times[-1])[:19]}")
    print(f"  lat: {float(ds['latitude'].min()):.1f} .. {float(ds['latitude'].max()):.1f}"
          f"   lon: {float(ds['longitude'].min()):.1f} .. {float(ds['longitude'].max()):.1f}")
    for v in ds.data_vars:
        a = ds[v].values.astype("float64")
        finite = np.isfinite(a)
        print(f"  {v:<6} units={ds[v].attrs.get('units', '?'):<10} "
              f"range {np.nanmin(a):8.3f} .. {np.nanmax(a):8.3f}   "
              f"missing {a.size - int(finite.sum())}/{a.size}"
              f" ({100 * (1 - finite.mean()):.1f}% — land / below seafloor)")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--start", default="2023-08-01")
    p.add_argument("--end", default="2023-08-31")
    p.add_argument("--depth-max", type=float, default=1000.0)
    p.add_argument("--lon-min", type=float, default=40.0)
    p.add_argument("--lon-max", type=float, default=100.0)
    p.add_argument("--lat-min", type=float, default=-25.0)
    p.add_argument("--lat-max", type=float, default=25.0)
    p.add_argument("--variables", default="TEMP,SAL,TERR,SERR")
    args = p.parse_args()

    variables = [v.strip() for v in args.variables.split(",") if v.strip()]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"incois_vam_{args.start}_{args.end}.nc"

    url = build_url(variables, args.start, args.end, args.depth_max,
                    args.lon_min, args.lon_max, args.lat_min, args.lat_max)
    print(f"dataset : {DATASET}  (INCOIS ERDDAP)")
    print(f"vars    : {variables}")
    print(f"box     : lon {args.lon_min}..{args.lon_max}, lat {args.lat_min}..{args.lat_max}, "
          f"0..{args.depth_max} m")
    print(f"time    : {args.start} .. {args.end}\n")

    t0 = time.time()
    try:
        data = fetch(url)
    except urllib.error.HTTPError as e:  # noqa: F821 - urllib.error imported via urllib.request
        body = e.read().decode(errors="replace")
        raise SystemExit(f"FAILED HTTP {e.code}\n{body[:400]}") from e
    out.write_bytes(data)
    print(f"wrote {out}  ({len(data) / 1e6:.2f} MB, {time.time() - t0:.1f}s)")
    summarise(out)


if __name__ == "__main__":
    main()
