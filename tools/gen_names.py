#!/usr/bin/env python3
"""Generate packages/sim/src/nameData.ts from the Python `faker` library.

FLOCK names its world at runtime (a fresh town name per match seed, named
streets, household surnames) but the sim must stay deterministic and pure TS —
so faker runs HERE, at authoring time, and bakes curated name banks into a
generated TypeScript module. Rerun after `pip install faker` whenever you want
fresh corpora:

    python3 tools/gen_names.py

The output file is checked in and must never be hand-edited.
"""

from __future__ import annotations

import re
from pathlib import Path

from faker import Faker
import faker as faker_pkg

OUT = Path(__file__).resolve().parent.parent / "packages" / "sim" / "src" / "nameData.ts"

# Deterministic corpora: same faker version + seed -> same file.
Faker.seed(0x464C4F43)  # "FLOC"
fake = Faker("en_US")

WORD = re.compile(r"^[A-Za-z][A-Za-z .'-]*$")


def clean(pool: list[str], cap: int) -> list[str]:
    """dedupe, keep plain printable names, sort for a stable diff, cap size."""
    seen: set[str] = set()
    out: list[str] = []
    for name in pool:
        name = " ".join(name.split()).strip()
        if not name or not WORD.match(name) or len(name) > 24:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    out.sort()
    return out[:cap]


# ---- town names: small-town America. faker.city() plus a hand-shaped blend of
# surname + smalltown suffixes so seeds land on names like "Copeland Falls".
suffixes = [
    "Falls", "Creek", "Grove", "Hollow", "Springs", "Ridge", "Bluff", "Bend",
    "Prairie", "Junction", "Crossing", "Landing", "Meadow", "Pines", "Forks",
]
towns: list[str] = [fake.city() for _ in range(900)]
towns += [f"{fake.last_name()} {suffixes[i % len(suffixes)]}" for i in range(600)]

# ---- street BASE names (suffix added in TS by road class: Ave/St/Rd/Ln).
# faker street names carry their own suffix; strip the final word.
street_bases: list[str] = []
for _ in range(1200):
    base = fake.street_name().rsplit(" ", 1)[0]
    street_bases.append(base)
street_bases += [
    "Main", "Church", "Oak", "Maple", "Elm", "Cedar", "Walnut", "Chestnut",
    "Washington", "Lincoln", "Jefferson", "Franklin", "Mill", "Bridge",
    "Prospect", "Highland", "Sunset", "Orchard", "Meadow", "River",
]

first_names = [fake.first_name() for _ in range(900)]
surnames = [fake.last_name() for _ in range(1400)]

TOWNS = clean(towns, 512)
STREETS = clean(street_bases, 384)
FIRSTS = clean(first_names, 384)
SURNAMES = clean(surnames, 512)


def ts_array(name: str, items: list[str]) -> str:
    body = ",\n".join(f'  "{s}"' for s in items)
    return f"export const {name}: readonly string[] = [\n{body},\n];\n"


header = f"""/**
 * GENERATED FILE — do not edit by hand.
 *
 * Name corpora for FLOCK's world naming (town names, street names, resident
 * names). Produced by tools/gen_names.py using the Python `faker` library
 * (faker {faker_pkg.VERSION}, en_US, seeded) so the runtime sim stays pure,
 * dependency-free TypeScript while every match still gets a fresh fake town.
 * Regenerate with:  python3 tools/gen_names.py
 */

"""

OUT.write_text(
    header
    + ts_array("TOWN_NAMES", TOWNS)
    + "\n"
    + ts_array("STREET_BASES", STREETS)
    + "\n"
    + ts_array("FIRST_NAMES", FIRSTS)
    + "\n"
    + ts_array("SURNAMES", SURNAMES),
    encoding="utf-8",
)
print(f"wrote {OUT} — towns={len(TOWNS)} streets={len(STREETS)} firsts={len(FIRSTS)} surnames={len(SURNAMES)}")
