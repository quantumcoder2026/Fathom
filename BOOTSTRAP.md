# BOOTSTRAP — run these at H0:45, not before

This file is commands, not code. Nothing below has been run yet — that's deliberate. The
scaffolding (`vite.config.ts`, `tsconfig.json`, `package.json`, `main.py`) does not exist in
this repo yet because generating it is application setup, and the event rules say that
happens during the 36 hours, not before. Two minutes of typing at H0:45 costs nothing and
keeps the "built here" claim completely clean.

Run these from the repo root, in order. Whoever is fastest at each takes it — they don't need
to be the eventual owner of that folder.

## 1. Frontend scaffold

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install three zustand recharts
npm install -D @types/three
```

This generates `vite.config.ts`, `tsconfig.json`, `package.json`, and a default `src/`.
Delete the default `src/App.tsx` / `src/App.css` boilerplate it creates — your real `src/`
subfolders (`three/`, `state/`, `panels/`, `ui/`) already exist in this repo and are where
the real code goes.

## 2. Backend scaffold

```bash
cd api
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install fastapi uvicorn pydantic numpy
cd ..
```

`api/main.py` gets written from here — start from the opening prompt in
`docs/BUILD_BOOK.md`, Praharsh's section.

## 3. Data tooling (Parth, Priyanshu)

```bash
pip install xarray netCDF4 numpy scipy matplotlib jupyter gsw
```

## 4. Confirm the environment before anyone writes a line of product code

```bash
npm run dev            # should open a blank Vite page
uvicorn api.main:app --reload   # will fail until main.py exists — that's expected right now
```

If `npm run dev` fails at H0:45, fix it before anything else. An environment problem found
now costs two minutes. The same problem found at H14 costs the gate.

## 5. Then, and only then

Open `AGENTS.md` at the repo root. Follow it. `contracts/`, `fixtures/`, and every source
file get written from here, per `docs/BUILD_BOOK.md`.
