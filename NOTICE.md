# Notices and attribution

## Map data

The state boundaries in `data/states.js` are derived from:

> **udit-001/india-maps-data**, pinned at commit `2884453`
> <https://github.com/udit-001/india-maps-data>
> file used: `topojson/india.json` (district-level, 762 districts)

That project states its data was "curated from publicly available sources". Its
lineage points to the **DataMeet** Census-2011 district boundary maps, which are
commonly distributed under **CC BY 4.0**.

**This attribution is best-effort.** The upstream repository ships no `LICENSE`
file and makes no explicit licence statement, so we cannot state the licence of
the underlying data with certainty. If you are the rights holder, or you know the
definitive provenance, please open an issue.

## Boundaries are not authoritative

The boundaries shown here follow the source dataset and are then **heavily
simplified** — deliberately, so that a four-year-old can grab and place them.
They are a toy, not a reference.

Specifically:

- Borders are simplified to roughly 1.5% of their original vertex count.
  Fine coastal detail, narrow corridors and small enclaves are approximated.
- The depiction of Jammu and Kashmir, Ladakh, Aksai Chin, Pakistan-administered
  Kashmir and Arunachal Pradesh follows the source dataset, which shows Indian
  claim lines. These areas are the subject of international dispute. Nothing here
  is intended as a political statement, and no attempt has been made to alter
  what the source data contains.
- **Exclaves are collapsed.** Puducherry consists of four separate territories
  (Puducherry, Karaikal, Mahe, Yanam) scattered across roughly 700 km and three
  different states; Dadra and Nagar Haveli and Daman and Diu consists of three.
  A single draggable puzzle piece cannot span that. Only the largest part of each
  is kept. This loses real territory and is a deliberate, documented compromise.
- Small offshore islands are pruned, and Andaman & Nicobar and Lakshadweep are
  drawn in enlarged inset boxes rather than at true position and scale — the same
  convention used by printed Indian atlases, and the only way to make them
  draggable.

Do not use this data for anything that matters.

## Emoji

Emoji are rendered by the operating system's own colour-emoji font. No emoji
artwork is bundled with this project.
