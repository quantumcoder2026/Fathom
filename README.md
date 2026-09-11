# Fathom

Smart India Hackathon 2026 · Problem Statement **SIH26067** · Ministry of Earth Sciences (INCOIS)

**A browser 3D ocean workspace that shows where a numerical ocean model and the real ocean
disagree — how much, in what way, and where there is no observational evidence at all.**

---

## The idea

You load a model field (temperature or salinity) over the tropical Indian Ocean as a stack of
depth planes. Real Argo floats are plotted on it at their true positions. Click a float and
Fathom does a QC-aware, unit-normalised, vertically-aligned comparison against the model at
that exact place and time — the difference, the statistics, the provenance.

Then it goes further:

- **Error decomposition.** RMSE hides two different failures. *Amplitude* error: right depth,
  wrong value. *Displacement* error: right values, whole structure sitting too shallow or too
  deep. Fathom finds the vertical shift that best re-aligns the model and reports the split —
  *"79% of this error is displacement, not amplitude."*
- **Evidence, not just values.** Click anywhere, not only on a float, and Fathom reads the
  whole model column there and tells you how far away and how old the nearest real observation
  is. Usually the honest answer is *"nothing has measured near here in weeks — treat this as
  model output, not knowledge."*

The governing rule, everywhere: **missing is not zero.** Land, below the seafloor, failed QC,
outside the model domain — all render as an explicit gap, never as `0` and never as a guess.

## Data — all live, no bulk downloads

| | Source | Access |
|---|---|---|
| Model field | INCOIS gridded Argo analysis (`incois_argo_10d_VAM`) | `erddap.incois.gov.in` — INCOIS's own ERDDAP, one of the two model-output links in the problem statement. No account. |
| Observations | Argo float profiles | Ifremer Argo ERDDAP. No account. |
| Model field (independent) | Copernicus GLORYS12 reanalysis (`GLOBAL_MULTIYEAR_PHY_001_030`) | Copernicus Marine Data Store web subsetter, free account, manual download — see `pipeline/precompute.py field --source glorys` |

A whole month of the Indian Ocean field from INCOIS is **~4 MB**, fetched as a griddap
slice — not the multi-GB a full Copernicus subset would be. GLORYS is the genuinely
independent model (see *Honest boundaries* below) and is a manual, one-time download
rather than a live fetch; both sources run through the same pipeline and the same
`/field/*` contract, so switching is a precompute flag, not a code change.

## Stack

React + Vite + TypeScript · Three.js + [globe.gl](https://github.com/vasturiano/globe.gl) ·
Zustand · Recharts · plain CSS Modules — frontend.
FastAPI + xarray + numpy + gsw (TEOS-10) — backend. Precomputed files on disk, no database.

## Run it

```bash
# backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python pipeline/fetch_incois.py       # ~4 MB, the model field
.venv\Scripts\python pipeline/fetch_argo.py         # ~31 MB, the floats
.venv\Scripts\python pipeline/precompute.py field --source incois
.venv\Scripts\python pipeline/precompute.py floats
.venv\Scripts\uvicorn api.main:app --port 8000

# frontend
npm install
npm run dev
```

The API serves the precomputed `data/` when it exists and hand-written `fixtures/` when it
does not, so the frontend runs either way.

## Layout

```
contracts/   types.ts + schemas.py — the frontend/API boundary, kept in exact sync
fixtures/    hand-written sample payloads, one per endpoint
pipeline/    fetch_*.py (download) + precompute.py (NetCDF -> .bin grids + float JSON)
compare/     match.py (Ocean Match) + shift.py (error decomposition)
api/         FastAPI — seven routes, real data or fixtures
src/three/   the 3D: scene, stacked depth planes, float markers, bead-string trail,
             depth axis, point probe, and the entry globe
src/panels/  ProfilePanel, ComparisonPanel, PointPanel, EvidencePanel, ProvenancePanel,
             MeasurePanel — the analysis, in a tabbed column (Float / Point / Evidence /
             Provenance)
docs/        MASTER_PLAN, BUILD_BOOK, and an append-only decisions.md + gotchas.md
```

## Honest boundaries

- INCOIS VAM is an *objective analysis of Argo*, so an Argo-vs-VAM difference measures
  representativeness plus analysis error, not independent model error. GLORYS (Copernicus) is
  the genuinely independent numerical model, runs through the same pipeline, and is what a
  headline comparison should use — VAM remains the zero-account, always-available fallback.
- The evidence layer is a first-order screening tool, not adjoint-based optimal network design.
- The displacement/amplitude split is a transfer from atmospheric forecast verification, used
  deliberately, not a new method.
