"""Load hand-written fixture payloads from fixtures/.

Used by the API skeleton before the real precomputed data lands. Each call re-reads
and re-parses the file (they are tiny) so callers can freely mutate the result
without poisoning a shared object.
"""

import json
from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def load(name: str):
    """Return a fresh parse of fixtures/<name>."""
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))
