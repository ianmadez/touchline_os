/**
 * Table sorting shared by the squad list, the match-stats table and the Stats tab.
 *
 * Three rules, the way Football Manager sorts:
 *   1. The first click on a column gives its natural order. Text and position read top to bottom (A→Z,
 *      GK→DEF→MID→ATT), shirt numbers and ages go low to high, and everything that measures quality or
 *      output goes best-first. A second click reverses it.
 *   2. A missing value is not a small value. Blanks always sink to the bottom, whichever way the column runs.
 *   3. Ties fall back to position, then overall, then name, so equal rows never shuffle between clicks.
 */

/**
 * Pitch order: goalkeeper, defence right to left, midfield from the holding role up, then attack.
 * Codes not listed (UNKNOWN, SUB) have no position and sort as blank.
 */
const POSITION_ORDER = [
  "GK",
  "SW",
  "RWB",
  "RB",
  "RCB",
  "CB",
  "LCB",
  "LB",
  "LWB",
  "CDM",
  "RDM",
  "LDM",
  "RM",
  "RCM",
  "CM",
  "LCM",
  "LM",
  "CAM",
  "RAM",
  "LAM",
  "RW",
  "LW",
  "RF",
  "CF",
  "LF",
  "ST",
  "RS",
  "LS",
  "RST",
  "LST",
] as const;

const POSITION_INDEX = new Map<string, number>(POSITION_ORDER.map((code, index) => [code, index]));

/** Where a position sits in pitch order (lower is nearer the goalkeeper), or null when it has none. */
export function positionSortKey(position: string | null | undefined): number | null {
  if (!position) return null;
  return POSITION_INDEX.get(position.toUpperCase()) ?? null;
}

/** Columns whose first click runs low-to-high. Every other column starts best-first. */
const ASCENDING_FIRST = new Set(["name", "primaryPosition", "position", "jersey", "age", "assignedRole"]);

/** The direction a column takes on its first click. */
export function naturalAscending(field: string): boolean {
  return ASCENDING_FIRST.has(field);
}

export type SortValue = string | number | null | undefined;

/** Compares two values in the given direction. Blanks always go last. */
export function compareSortValues(left: SortValue, right: SortValue, ascending: boolean): number {
  const leftBlank = left === null || left === undefined || left === "";
  const rightBlank = right === null || right === undefined || right === "";
  if (leftBlank || rightBlank) return leftBlank === rightBlank ? 0 : leftBlank ? 1 : -1;
  const order =
    typeof left === "string" && typeof right === "string"
      ? left.localeCompare(right, undefined, { sensitivity: "base" })
      : left! < right!
        ? -1
        : left! > right!
          ? 1
          : 0;
  return ascending ? order : -order;
}

/** The fixed tiebreak: position in pitch order, then the higher overall, then name. */
export function tiebreak(
  left: { position: string | null | undefined; overall: number | null | undefined; name: string },
  right: { position: string | null | undefined; overall: number | null | undefined; name: string }
): number {
  return (
    compareSortValues(positionSortKey(left.position), positionSortKey(right.position), true) ||
    compareSortValues(left.overall, right.overall, false) ||
    left.name.localeCompare(right.name)
  );
}
