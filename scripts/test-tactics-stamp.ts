/**
 * The gate for the formation stamp (`src/lib/events/tactics-stamp.ts`).
 *
 * Pure: no database, no browser. Run with `npx tsx scripts/test-tactics-stamp.ts`.
 *
 * What it is guarding. The stamp is what a debrief claims about the shape that played, and the family is what the
 * rules profile will later use to decide whether a change to the shape is a change of shape at all. Both are easy
 * to get subtly wrong in the same way (a family that swallows two different formations), so every registry id is
 * checked for a family that no other shape shares unless the line counts genuinely match.
 */
import {
  FORMATION_NOT_RECORDED,
  FORMATION_USE_DEFAULT,
  defaultFormationChoice,
  formationDisplayName,
  formationFamily,
  formationShapeName,
  normaliseFormationStamp,
  sameFormationFamily,
  selectionForStamp,
  stampFor,
  stampForSelection,
  type FormationChoice,
  type FormationStamp,
} from "../src/lib/events/tactics-stamp";
import { FORMATIONS_REGISTRY } from "../src/lib/tactics/formations";

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const primary = (formationName: string): FormationChoice => ({
  label: "Primary",
  formationName,
  isDefault: true,
});
const backup = (formationName: string): FormationChoice => ({
  label: "Plan B",
  formationName,
  isDefault: false,
});

function main(): void {
  console.log("formation family");

  equal("4-3-3-holding is the 4-3-3 family", formationFamily("4-3-3-holding"), "4-3-3");
  equal("4-3-3-attack is the 4-3-3 family", formationFamily("4-3-3-attack"), "4-3-3");
  equal("4-2-3-1-narrow is the 4-2-3-1 family", formationFamily("4-2-3-1-narrow"), "4-2-3-1");
  equal("5-4-1-flat is the 5-4-1 family", formationFamily("5-4-1-flat"), "5-4-1");
  equal(
    "4-1-2-1-2-diamond keeps its ending digit",
    formationFamily("4-1-2-1-2-diamond"),
    "4-1-2-1-2"
  );
  equal("a suffix free shape is its own family", formationFamily("3-5-2"), "3-5-2");
  equal("case and space are tolerated", formationFamily("  4-3-3-HOLDING "), "4-3-3");
  equal("an empty name has no family", formationFamily(""), null);
  equal("null has no family", formationFamily(null), null);
  equal("a name with no line counts has no family", formationFamily("custom-shape"), null);

  check(
    "two 4-3-3s share a family",
    sameFormationFamily("4-3-3-holding", "4-3-3-attack"),
    "4-3-3-holding vs 4-3-3-attack"
  );
  check(
    "two 4-4-2s share a family",
    sameFormationFamily("4-4-2-flat", "4-4-2-holding"),
    "4-4-2-flat vs 4-4-2-holding"
  );
  check(
    "a 4-3-3 is not a 4-2-3-1",
    !sameFormationFamily("4-3-3-holding", "4-2-3-1-narrow"),
    "4-3-3-holding vs 4-2-3-1-narrow"
  );
  check(
    "a 5-4-1 is not a 5-3-2",
    !sameFormationFamily("5-4-1-flat", "5-3-2"),
    "5-4-1-flat vs 5-3-2"
  );
  check("unknown is never the same family", !sameFormationFamily(null, null));

  /*
    Every registry row, checked against the rule rather than against a hand copied table: the family must be the
    leading run of numeric segments, and two shapes may only share a family when those runs are identical. A shape
    whose id gained a numeric suffix that belongs to the shape (a 4-1-2-1-2) would fail here.
  */
  let registryOk = true;
  for (const shape of FORMATIONS_REGISTRY) {
    const expected = shape.id
      .split("-")
      .filter((segment) => /^\d+$/.test(segment))
      .join("-");
    const actual = formationFamily(shape.id);
    if (actual === null || actual !== expected) {
      registryOk = false;
      console.log(`        ${shape.id} -> ${String(actual)}, expected ${expected}`);
    }
  }
  check(`all ${FORMATIONS_REGISTRY.length} registry shapes resolve a family`, registryOk);

  const byFamily = new Map<string, string[]>();
  for (const shape of FORMATIONS_REGISTRY) {
    const family = formationFamily(shape.id) ?? "?";
    byFamily.set(family, [...(byFamily.get(family) ?? []), shape.id]);
  }
  const collapsed = [...byFamily.entries()].filter(([, ids]) => {
    // Two shapes may share a family only when their numeric runs match, which is what "same family" means.
    const lineCounts = new Set(
      ids.map((id) =>
        id
          .split("-")
          .filter((segment) => /^\d+$/.test(segment))
          .join("-")
      )
    );
    return lineCounts.size > 1;
  });
  check("no family collapses two different line counts", collapsed.length === 0, JSON.stringify(collapsed));

  console.log("stamp for a report");

  equal(
    "the default is stamped as DEFAULT",
    stampFor(primary("4-3-3-holding"), null),
    { label: "Primary", formationName: "4-3-3-holding", source: "DEFAULT" }
  );
  equal(
    "an override wins and says so",
    stampFor(primary("4-3-3-holding"), backup("5-4-1-flat")),
    { label: "Plan B", formationName: "5-4-1-flat", source: "OVERRIDE" }
  );
  equal("no default and no override is no stamp", stampFor(null, null), null);
  equal(
    "a blank label is refused",
    stampFor({ label: "   ", formationName: "4-3-3-holding", isDefault: true }, null),
    null
  );

  console.log("stamp from a select value");

  const choices = [primary("4-3-3-holding"), backup("5-4-1-flat")];

  equal(
    "same as Tactics resolves the default at save time",
    stampForSelection(choices, FORMATION_USE_DEFAULT),
    { label: "Primary", formationName: "4-3-3-holding", source: "DEFAULT" }
  );
  equal("not recorded is no stamp", stampForSelection(choices, FORMATION_NOT_RECORDED), null);
  equal(
    "a picked label is an override",
    stampForSelection(choices, "Plan B"),
    { label: "Plan B", formationName: "5-4-1-flat", source: "OVERRIDE" }
  );
  equal(
    "a label Tactics no longer holds is still honoured",
    stampForSelection(choices, "Axed shape"),
    { label: "Axed shape", formationName: "", source: "OVERRIDE" }
  );
  equal(
    "same as Tactics with nothing saved is not recorded",
    stampForSelection([], FORMATION_USE_DEFAULT),
    null
  );
  equal(
    "the default falls back to the first formation",
    defaultFormationChoice([backup("5-4-1-flat")]),
    backup("5-4-1-flat")
  );

  console.log("reading a stamp back");

  const stored: FormationStamp = { label: "Plan B", formationName: "5-4-1-flat", source: "OVERRIDE" };
  equal("a stored stamp reads back as its label", selectionForStamp(stored), "Plan B");
  equal("no stamp reads back as not recorded", selectionForStamp(null), FORMATION_NOT_RECORDED);

  equal("a missing stamp is dropped", normaliseFormationStamp(undefined), null);
  equal("a non-object stamp is dropped", normaliseFormationStamp("4-3-3"), null);
  equal("a label-less stamp is dropped", normaliseFormationStamp({ formationName: "4-3-3" }), null);
  equal(
    "a stamp is trimmed and an unknown source becomes DEFAULT",
    normaliseFormationStamp({ label: "  Primary ", formationName: " 4-3-3-holding ", source: "TYPED" }),
    { label: "Primary", formationName: "4-3-3-holding", source: "DEFAULT" }
  );
  equal(
    "an override survives the round trip",
    normaliseFormationStamp(stored),
    stored
  );
  equal(
    "a deleted shape keeps its label as text",
    normaliseFormationStamp({ label: "Axed", formationName: "8-8-8", source: "OVERRIDE" }),
    { label: "Axed", formationName: "8-8-8", source: "OVERRIDE" }
  );

  console.log("reading a stamp on screen");

  equal(
    "the registry names a known shape",
    formationShapeName("4-2-3-1-narrow"),
    "4-2-3-1 Narrow"
  );
  equal("an unknown shape has no registry name", formationShapeName("8-8-8"), null);

  equal(
    "the shape leads and the manager's name follows",
    formationDisplayName({ label: "Primary", formationName: "4-3-3-holding", source: "DEFAULT" }),
    "4-3-3 Holding (Primary)"
  );
  equal(
    "a label that is the shape is not repeated",
    formationDisplayName({ label: "4-3-3 Holding", formationName: "4-3-3-holding", source: "DEFAULT" }),
    "4-3-3 Holding"
  );
  equal(
    "an unknown shape shows as written",
    formationDisplayName({ label: "Axed", formationName: "8-8-8", source: "OVERRIDE" }),
    "8-8-8 (Axed)"
  );
  equal(
    "a stamp with no shape shows only its label",
    formationDisplayName({ label: "Axed", formationName: "", source: "OVERRIDE" }),
    "Axed"
  );

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
