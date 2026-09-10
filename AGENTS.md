# AGENTS.md

> Read by any coding agent working in this repo — Claude Code, Codex, or anything else that
> reads `AGENTS.md` or `CLAUDE.md`. Whoever is driving the session (any of the six of us, on
> any part of the codebase) — the rules below apply the same way. This file is not scoped to
> one person's files. If you're asked to work on the 3D renderer today and the API tomorrow,
> that's normal — follow this file either way.
>
> **Keep this file itself short.** It's read on every session, by every tool, for the whole
> project. If it grows past ~150 lines, split the frequently-changing parts (gotchas,
> decisions) into `docs/gotchas.md` and `docs/decisions.md` and leave a one-line pointer here
> instead of letting this file balloon.
>
> **Cross-tool setup, do this once:** keep `AGENTS.md` as the single source of truth and make
> `CLAUDE.md` a symlink to it — `ln -s AGENTS.md CLAUDE.md` — so the two can never drift apart
> mid-hackathon. Don't maintain two copies by hand.

---

## What this project is

**Fathom** — a browser 3D ocean workspace: real Copernicus model output and real Argo float
observations, co-visualised, compared, and diagnosed. Click a float, see how the model
disagrees with it, what *kind* of disagreement it is (displacement vs amplitude), and where
the ocean has no observational coverage at all. Built for SIH26067 (MoES / INCOIS).

Full product context lives in `docs/MASTER_PLAN.md` and `docs/BUILD_BOOK.md` if you need it —
but for writing code, this file plus `contracts/` is almost always enough. Don't re-read the
full plan documents unless the task genuinely requires that context; they're long.

## The one rule that overrides everything else

**Missing is not zero. Never invent a number.** If the model has no coverage at a point,
return a status (`"no_model_coverage"`, `"qc_rejected"`, `"outside_domain"`) — never `0`,
never an interpolated guess past the edge of real data. This applies in every file, every
language, every layer. It is the thing that makes this project trustworthy and it is not
negotiable for speed.

## Stack — frozen, do not deviate

```
Frontend   React + Vite + TypeScript
3D         Three.js (raw — no react-three-fiber)
State      Zustand
Charts     Recharts
Styling    plain CSS modules
Backend    FastAPI (Python 3.11)
Data       xarray + numpy
Storage    precomputed files on disk during the hackathon — no database
```

Don't add a library outside this list without being asked. If a task seems to need one, say
so and stop rather than silently pulling it in — a second state-management or charting library
showing up mid-project is a merge headache, not a convenience.

## Before writing anything that crosses a module boundary

Read `contracts/types.ts` (frontend/API shapes) and `contracts/schemas.py` (backend models)
first. Use the field names exactly as written there. If a shape you need isn't in the
contracts yet, that's a signal to raise it — not to invent a plausible-looking field name and
move on. A guessed field name is the single most common way this kind of project breaks at
integration time.

## How to work — the loop, not a one-shot

Don't treat a task as "generate the final code in one pass." Work in a loop:

1. **State assumptions before writing code.** What are you assuming about the data, the
   shapes, the caller? Get that right before anything else — it's the cheapest fix available.
2. **Build the smallest piece that can be run and checked.** One function, not a file.
3. **Run it. Look at the real output** — the actual printed values, the actual error, not a
   summary of what you expect it to say.
4. **Verify against something computed independently**, wherever a number is involved —
   by hand, in a notebook, against a known reference point. A number that "looks plausible"
   is not verified.
5. **If the same bug survives three attempts, stop generating and start inspecting** — add
   print statements, reduce the problem, or ask a human. A fourth guess is rarely better than
   the first three.

This is slower per-line than one-shot generation and produces code someone can actually debug
and explain later, which matters more here than typing speed.

## Ground truth over description

When a task involves real data — a NetCDF file, an API response, a stack trace — work from
the actual artifact, not a paraphrase of it. If you haven't seen the real dimension names,
the real error text, or the real JSON, that's the next thing to get, not something to assume.

## Don't guess an unfamiliar API

If you're not sure a function, method, or library option actually exists — say so and check,
rather than writing plausible-looking code against it. A confidently wrong API call costs more
time than admitting uncertainty, because it fails silently or produces a wrong result that
looks right. This applies especially to Three.js and xarray, both of which have versioned APIs
that change in ways easy to misremember.

## Before committing

Run the app. `main` must always run — that's not just a merge rule, it's a per-commit one. A
commit that breaks the build costs the next person who pulls it more time than it saved you.

## No secrets in the repo

Copernicus credentials, API keys, anything from `.env.local` — never hardcoded, never
committed. If a task seems to need a credential inline, that's a sign to use an environment
variable instead, not a sign to paste the value in.

## Domain specifics worth knowing

- **Depth vs pressure.** The ocean model reports depth (metres, positive down). Argo floats
  report pressure (decibars). These get converted explicitly (TEOS-10) — never treated as
  interchangeable.
- **Vertical interpolation never extrapolates.** Outside the model's depth range, the correct
  answer is "no coverage," not a projected value.
- **QC flags matter.** Observation levels that fail quality control are dropped, not smoothed
  over or averaged with adjacent good values.
- **Units are explicit everywhere.** Temperature in °C, depth in metres positive-down,
  longitude -180..180. A function that receives or returns a bare number with no unit
  attached in its name or docstring is a function worth fixing.

Project-specific facts discovered along the way (real variable names, fill values, which
floats have bad profiles, anything that cost someone twenty minutes to figure out) belong in
`docs/gotchas.md` — check it before debugging something that looks like a data-format
surprise, and add to it the moment you find one, so nobody else pays the same cost twice.

## Who owns what, for routing status updates

Not a restriction on what you may edit — it's how you know which `status/*.md` file to update
when you finish something. Follow the code area, not who's driving the session.

| Area | Status file |
|---|---|
| `pipeline/`, `compare/` (except `shift.py`) | `status/parth.md` |
| `compare/shift.py` | `status/priyanshu.md` |
| `api/`, `contracts/schemas.py` | `status/praharsh.md` |
| `src/three/` | `status/kunj.md` |
| `src/state/`, `src/panels/`, `contracts/types.ts` | `status/jaivardhan.md` |
| `src/ui/`, `deck/` | `status/viha.md` |
| `main` (merges, integration, deploy) | `status/priyanshu.md` |

## Updating status/*.md — keep it honest, not encouraging

Each status file has a checklist and a `Progress:` line. Update it yourself when you finish a
meaningful, verified piece of work in that area — don't wait to be asked, and don't update it
after every tiny edit either.

**A box gets checked only once you have run it and seen it work — never because the code was
written and looks correct.** The same rule that governs data in this project governs progress
reporting on it: an unverified claim is worse than no claim. If you wrote something but
haven't run it yet, it stays unchecked and goes in `BROKEN` or `NEXT` instead, described
honestly.

`Progress:` is a plain fraction — checked items over total items in that file's checklist —
recomputed whenever you check or uncheck something. Round down. If you're not sure whether an
item is fully done, it isn't.

## Decisions

Durable project decisions — not "what I did in this session," but things like "we're not
using a database this week" or "salinity uses the same code path as temperature" — get one
line each, appended, in `docs/decisions.md`. Never edit a past entry; if a decision changes,
append the reversal with the reason. Skim it before assuming how something was meant to work.

## What's explicitly out of scope right now

No database, no Docker, no CI/CD, no auth, no monitoring, no Kubernetes. Not because they're
bad ideas — because they're not what this phase of the project needs, and pulling one in
mid-task is a scope decision that should be made deliberately, not accidentally by an agent
reaching for a familiar pattern. If a task seems to want one of these, flag it instead of
adding it.

## Git

Small commits. Never rewrite shared history. Never commit secrets. If a change would leave
the app unable to run, say so before committing rather than after.

## When in doubt

Prefer the smaller, more honest change: a status field over a guessed value, a question over
an assumption, a stub with a clear TODO over a plausible-looking function nobody verified.
This project's entire credibility rests on the difference between "we don't know" and "we
made something up that looks like an answer" — that standard applies to the code as much as
to anything presented to a judge.
