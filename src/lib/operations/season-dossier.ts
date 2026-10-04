import { SeasonArchiveService } from "../services/season-archive-service";
import { failed, ok, type OperationResult } from "./types";

/**
 * One season's full record, in two halves that are never blended: what the save itself recorded
 * (available for every season, including ones that finished before TouchlineOS was installed) and
 * what TouchlineOS observed while it was running. The observed half is `null` for a season we were
 * not present for - that is the answer, not an error, which is why this does not pad it.
 *
 * Fetched per season rather than folded into the season read: a dossier reads snapshots, the squad
 * diff, finance, threads and events for its window, and doing that for every season on every load
 * would cost the whole history to show one.
 */
export async function readSeasonDossier(
  careerId: string | null,
  seasonParam: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  const season = Number(seasonParam);
  if (!Number.isInteger(season) || season < 1) {
    return failed(
      400,
      "season must be a positive whole number (the season ordinal, not a calendar year)."
    );
  }

  try {
    const dossier = await new SeasonArchiveService().getSeasonDossier(careerId, season);
    if (!dossier) {
      return failed(404, "NO_SEASON", `This save has no record of season ${season}.`);
    }

    return ok({ success: true, dossier });
  } catch (error) {
    console.error("Season dossier failed:", error);
    return failed(500, "DOSSIER_FAILED", String(error));
  }
}
