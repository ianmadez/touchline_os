import { CareerService } from "../services/career-service";
import {
  CompetitionTableService,
  type DivisionSummary,
  type DivisionTable,
} from "../services/competition-table-service";
import { at, ok, type OperationResult } from "./types";

export interface DivisionsBody {
  success: true;
  /** The save's own date, which is the "as at" every background table is stamped with. */
  asAtSave: string | null;
  divisions: DivisionSummary[];
  /** Present only when a specific `leagueId` was asked for. */
  table?: DivisionTable;
}

/**
 * Reads the background division tables.
 *
 * One read for the list, one for a chosen division, and the save's own date on both so every screen can
 * stamp the figures "as at the save" rather than as current. The date is not decoration: these tables
 * are the save's record at the moment it was written, and a manager reading them a fortnight later is
 * owed that fact.
 */
export async function readDivisionTables(
  careerId: string | null,
  leagueId: string | null
): Promise<OperationResult<DivisionsBody | { success: false; error: string }>> {
  if (!careerId) return at(400, { success: false, error: "careerId is required." });

  const career = await new CareerService().getCareerRow(careerId);
  if (!career) return at(404, { success: false, error: "That career is not in this database." });

  const service = new CompetitionTableService();
  const divisions = await service.listDivisions(careerId);

  const parsed = leagueId === null ? null : Number(leagueId);
  if (parsed !== null && Number.isFinite(parsed)) {
    const table = await service.getDivisionTable(careerId, parsed);
    if (!table) {
      return at(404, { success: false, error: "Your save holds no record for that division." });
    }
    return ok({ success: true, asAtSave: career.inGameDate, divisions, table });
  }

  return ok({ success: true, asAtSave: career.inGameDate, divisions });
}
