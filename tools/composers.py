"""The composer table: one place that decides who a name refers to.

Both ingest paths go through `resolve()`. It matches exactly — against an id, a
sort name, a display name or a listed alias — after collapsing whitespace and
case, and raises on anything it does not know. Fuzzy matching is deliberately
absent: "Bach" and "C.P.E. Bach" are two people, and a table that guesses would
merge them silently. Add the alias to composers.tsv instead.

    from composers import Composers
    people = Composers.load()
    people.resolve("L. van Beethoven").id      # 'beethoven'
    people.resolve("L. van Beethoven").period  # 'Classical'
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path

TSV = Path(__file__).with_name("composers.tsv")

# Chronological, which is the order a period list should print in — alphabetical
# would put Baroque before Renaissance and Modern in the middle.
PERIODS = ("Renaissance", "Baroque", "Classical", "Romantic", "Modern")

# The genre vocabulary, deliberately short. A facet with 500 values is the `cat`
# column this replaced; one with a dozen is a thing you can read down in a
# sitting. Anything not on this list is an error in works.tsv, not a new genre —
# widen the list on purpose or pick the nearest.
GENRES = (
    "Chorale", "Song", "Madrigal & chanson", "Mass & motet", "Opera & aria",
    "Prelude & fugue", "Piano sonata", "Piano piece", "String quartet",
    "Chamber", "Orchestral", "Variations",
)


def _norm(s: str) -> str:
    """Whitespace and case, nothing else. Not a fuzzy match."""
    return re.sub(r"\s+", " ", s).strip().casefold()


@dataclass(frozen=True)
class Composer:
    id: str
    sort: str
    display: str
    period: str
    born: int
    died: int
    nationality: str
    aliases: tuple[str, ...] = field(default=())


class Composers:
    def __init__(self, people: list[Composer]):
        self.people = people
        self.by_id = {c.id: c for c in people}
        self._lookup: dict[str, Composer] = {}
        for c in people:
            for name in (c.id, c.sort, c.display, *c.aliases):
                if not name:
                    continue
                key = _norm(name)
                if (prior := self._lookup.get(key)) and prior.id != c.id:
                    raise ValueError(f"composers.tsv: '{name}' claimed by both "
                                     f"{prior.id} and {c.id}")
                self._lookup[key] = c

    @classmethod
    def load(cls, path: Path = TSV) -> "Composers":
        people = []
        with path.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                cells = next(csv.reader([line.rstrip("\n")], delimiter="\t"))
                if len(cells) != 8:
                    raise ValueError(f"composers.tsv: expected 8 columns, got "
                                     f"{len(cells)}: {cells[:2]}")
                cid, sort, display, period, born, died, nat, aliases = cells
                if period not in PERIODS:
                    raise ValueError(f"composers.tsv: {cid} has unknown period {period!r}")
                people.append(Composer(cid, sort, display, period, int(born), int(died),
                                       nat, tuple(a for a in aliases.split("|") if a)))
        return cls(people)

    def resolve(self, name: str) -> Composer:
        c = self._lookup.get(_norm(name))
        if c is None:
            raise KeyError(
                f"no composer matches {name!r}. Add it to tools/composers.tsv — as a "
                f"new row if it is a new person, or as an alias on an existing one.")
        return c

    def get(self, name: str) -> Composer | None:
        return self._lookup.get(_norm(name))

    def index_dict(self) -> dict[str, dict]:
        """The `composers` block of public/data/index.json.

        The index carries one of these per composer instead of repeating the name
        on every piece — at 413 Bach chorales the string alone was 8 KB of the
        payload, and this way sort name, period and dates arrive for free.
        """
        return {c.id: {"name": c.display, "sort": c.sort, "period": c.period,
                       "born": c.born, "died": c.died, "nationality": c.nationality}
                for c in self.people}
