/**
 * The operation allowlist: every URL this app calls, and the operation that answers it.
 *
 * Extracted from the browser client because there are now three callers that must agree exactly:
 * the static-export build answering a call in the page, the bridge hosting the same calls for a
 * paired device, and any test that wants to check the contract without a browser. One switch means
 * one place where a URL becomes an operation, so a route added to one runtime cannot be missing from
 * another - which is the failure mode that would leave a phone with a blank screen and nothing to go
 * on.
 *
 * Adding an endpoint means adding a case here. The default arm is deliberately loud: an unknown
 * call is a bug in the caller, not a result to be invented.
 */
import { exportCareerToFile, importCareerFromFile } from "./career-transfer";
import { deleteCareer, patchCareer, readCareer } from "./career";
import { deleteDebrief, logMatchDebrief, updateDebrief } from "./debrief";
import { readDiagnostics } from "./diagnostics";
import { readFinanceReport, saveFinanceInputs } from "./finance";
import { readReview, recordReviewDecision } from "./review";
import { createHypothesis, deleteHypothesis, readHypotheses, updateHypothesis } from "./hypotheses";
import {
  createAssignment,
  deleteAssignment,
  readAssignments,
  updateAssignment,
} from "./assignments";
import { readRulesProfile, saveRulesProfile } from "./rules-profile";
import { deleteObjective, readObjectives, saveObjective } from "./objectives";
import { parseAndSyncSave } from "./parse-save";
import {
  chooseSave,
  forgetLocalBridge,
  forgetRememberedSave,
  listSaveCandidates,
  pairLocalBridge,
  reconnectRememberedSave,
} from "./saves";
import { archiveScoutTarget, readScoutingMemory, restoreScoutTarget } from "./scouting-memory";
import { saveFootOverride, searchScoutPool } from "./scouting-search";
import { deleteScoutTarget, readScoutingBoard, saveScoutTarget } from "./scouting";
import { deleteTargetBlock, readTargetBlocks, saveTargetBlock } from "./season-blocks";
import { readSeasonDossier } from "./season-dossier";
import { readSeasonReview, recordCarryOver, runSeasonTransition } from "./season-review";
import { readDivisionTables } from "./season-divisions";
import { readSeasonState, recordSeason } from "./season";
import { patchSettings, readSettings } from "./settings";
import { readTrophyCabinet, recordTrophyWin, removeTrophyWin } from "./trophies";
import {
  dismissNewsItem,
  markNewsRead,
  readNews,
  recordMediaComment,
  saveNewsItem,
} from "./news";
import { readCompetitions } from "./competitions";
import { readHeadToHead } from "./head-to-head";
import { addTransferEntry, nameTransferCounterparty, readTransferLedger, removeTransferEntry, searchLedgerPlayers } from "./transfer-ledger";
import { readFinanceRules } from "./finance-rules";
import { readDebriefMarks, setDebriefStar } from "./debrief";
import { readYouthAcademy } from "./youth";
import type { OperationResult } from "./types";

/** The envelope the route handlers return when the body is not JSON at all. */
const INVALID_JSON: OperationResult<unknown> = {
  status: 400,
  body: { success: false, error: "Request body must be valid JSON." },
};

const statusOnly = (status: number, error: string): OperationResult<unknown> => ({
  status,
  body: { success: false, error },
});

/**
 * The request body as text.
 *
 * Every call this app makes sends a JSON string. Anything else (a `FormData`, a `Blob`) would reach
 * the operation as an empty string and fail confusingly, so it is refused by name instead.
 */
function rawBody(init: RequestInit | undefined): string | null {
  const body = init?.body;
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  throw new Error(
    `[api-client] the browser build only sends string bodies; got ${body.constructor?.name ?? typeof body}.`
  );
}

/** A parsed body, or the 400 the route would have answered with. */
function jsonBody(raw: string | null): OperationResult<unknown> {
  try {
    return { status: 200, body: raw === null ? undefined : JSON.parse(raw) };
  } catch {
    return INVALID_JSON;
  }
}

interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  /** The request body, exactly as it was handed to `fetch`. */
  raw: string | null;
}

/** Reads the parsed body, or reports the route's 400 so the caller can return it verbatim. */
function body(call: Call): { value: unknown; failure: OperationResult<unknown> | null } {
  const parsed = jsonBody(call.raw);
  return parsed.status === 400
    ? { value: undefined, failure: parsed }
    : { value: parsed.body, failure: null };
}

async function dispatch(call: Call): Promise<OperationResult<unknown>> {
  const { method, path, params, raw } = call;

  switch (`${method} ${path}`) {
    case "GET /api/saves":
      return listSaveCandidates();
    case "POST /api/saves": {
      const parsed = body(call);
      if (parsed.failure) return parsed.failure;
      const action = (parsed.value as { action?: unknown } | null)?.action;
      if (action === "reconnect") return reconnectRememberedSave();
      if (action === "choose") return chooseSave();
      if (action === "forget") return forgetRememberedSave();
      if (action === "bridge-pair") return pairLocalBridge(parsed.value);
      if (action === "bridge-forget") return forgetLocalBridge();
      return {
        status: 400,
        body: {
          success: false,
          error: 'action must be one of "reconnect", "choose", "forget", "bridge-pair", "bridge-forget".',
        },
      };
    }

    case "GET /api/career":
      return readCareer(params.get("careerId"));
    case "PATCH /api/career": {
      const parsed = body(call);
      return parsed.failure ?? patchCareer(parsed.value);
    }
    case "DELETE /api/career":
      return deleteCareer(params.get("careerId"));

    case "GET /api/career/export":
      return exportCareerToFile(params.get("careerId"));
    case "POST /api/career/import": {
      const parsed = body(call);
      return parsed.failure ?? importCareerFromFile(parsed.value);
    }

    case "POST /api/parse-save":
      // These three own their own JSON parsing, because their routes always did: a body that is not
      // JSON answered 500, not 400. Handing over the raw text keeps that.
      return parseAndSyncSave(raw ?? "");

    case "POST /api/debrief":
      return logMatchDebrief(raw ?? "");
    case "PATCH /api/debrief":
      return updateDebrief(params.get("id"), raw ?? "");
    case "DELETE /api/debrief":
      return deleteDebrief(params.get("id"), params.get("careerId"));

    case "GET /api/season/blocks":
      return readTargetBlocks(params.get("careerId"), params.get("season"));
    case "PUT /api/season/blocks":
      return saveTargetBlock(raw ?? "");
    case "DELETE /api/season/blocks":
      return deleteTargetBlock(params.get("careerId"), params.get("id"));

    case "GET /api/review":
      return readReview(params.get("careerId"), {
        blockId: params.get("blockId"),
        from: params.get("from"),
        to: params.get("to"),
        count: params.get("count"),
      });
    case "POST /api/review":
      return recordReviewDecision(raw ?? "");

    case "GET /api/hypotheses":
      return readHypotheses(params.get("careerId"), {
        blockId: params.get("blockId"),
        from: params.get("from"),
        to: params.get("to"),
        count: params.get("count"),
        eventIds: params.get("eventIds"),
      });
    case "POST /api/hypotheses":
      return createHypothesis(raw ?? "");
    case "PUT /api/hypotheses":
      return updateHypothesis(raw ?? "");
    case "DELETE /api/hypotheses":
      return deleteHypothesis(params.get("careerId"), params.get("id"));

    case "GET /api/assignments":
      return readAssignments(params.get("careerId"), {
        blockId: params.get("blockId"),
        from: params.get("from"),
        to: params.get("to"),
        count: params.get("count"),
      });
    case "POST /api/assignments":
      return createAssignment(raw ?? "");
    case "PUT /api/assignments":
      return updateAssignment(raw ?? "");
    case "DELETE /api/assignments":
      return deleteAssignment(params.get("careerId"), params.get("id"));

    case "GET /api/rules-profile":
      return readRulesProfile(params.get("careerId"));
    case "PUT /api/rules-profile":
      return saveRulesProfile(raw ?? "");

    case "GET /api/season/dossier":
      return readSeasonDossier(params.get("careerId"), params.get("season"));
    case "GET /api/season/review":
      return params.get("action") === "transition"
        ? runSeasonTransition(params.get("careerId"))
        : readSeasonReview(params.get("careerId"), params.get("season"));
    case "POST /api/season/review":
      return recordCarryOver(raw ?? "");
    case "GET /api/season/divisions":
      return readDivisionTables(params.get("careerId"), params.get("leagueId"));
    case "GET /api/season":
      return readSeasonState(params.get("careerId"));
    case "POST /api/season": {
      const parsed = body(call);
      return parsed.failure ?? recordSeason(parsed.value as never);
    }

    case "GET /api/finance":
      return readFinanceReport(params.get("careerId"));
    case "PUT /api/finance": {
      const parsed = body(call);
      return parsed.failure ?? saveFinanceInputs(parsed.value as never);
    }

    case "GET /api/objectives":
      return readObjectives(params.get("careerId"), params.get("season"));
    case "PUT /api/objectives": {
      const parsed = body(call);
      return parsed.failure ?? saveObjective(parsed.value as never);
    }
    case "DELETE /api/objectives":
      return deleteObjective({
        careerId: params.get("careerId"),
        id: params.get("id"),
        season: params.get("season"),
      });

    case "GET /api/scouting":
      return readScoutingBoard(params.get("careerId"));
    case "PUT /api/scouting": {
      const parsed = body(call);
      return parsed.failure ?? saveScoutTarget(parsed.value as never);
    }
    case "DELETE /api/scouting":
      return deleteScoutTarget(params);

    case "GET /api/scouting/memory":
      return readScoutingMemory(params.get("careerId"), params.get("budget"));
    case "PUT /api/scouting/memory": {
      const parsed = body(call);
      return parsed.failure ?? archiveScoutTarget(parsed.value as never);
    }
    case "DELETE /api/scouting/memory":
      return restoreScoutTarget(params);

    case "GET /api/scouting/search":
      return searchScoutPool(params);
    case "PUT /api/scouting/search": {
      const parsed = body(call);
      return parsed.failure ?? saveFootOverride(parsed.value as never);
    }

    case "GET /api/settings":
      return readSettings();
    case "PATCH /api/settings": {
      const parsed = body(call);
      return parsed.failure ?? patchSettings(parsed.value);
    }

    case "GET /api/diagnostics":
      return readDiagnostics();

    case "GET /api/youth":
      return readYouthAcademy(params.get("careerId"));

    case "GET /api/news":
      return readNews(params.get("careerId"));
    case "PUT /api/news": {
      const parsed = body(call);
      return parsed.failure ?? saveNewsItem(call.raw ?? "");
    }
    case "POST /api/news": {
      const parsed = body(call);
      return parsed.failure ?? markNewsRead(call.raw ?? "");
    }
    case "DELETE /api/news":
      return dismissNewsItem(params.get("careerId"), params.get("id"));

    case "POST /api/media-comment": {
      const parsed = body(call);
      return parsed.failure ?? recordMediaComment(call.raw ?? "");
    }

    case "GET /api/competitions":
      return readCompetitions(params.get("careerId"));

    case "GET /api/h2h":
      return readHeadToHead(params.get("careerId"));

    case "GET /api/transfer-ledger":
      return readTransferLedger(params.get("careerId"));
    case "GET /api/transfer-ledger/players":
      return searchLedgerPlayers(params.get("careerId"), params.get("query"));
    case "POST /api/transfer-ledger": {
      const parsed = body(call);
      return parsed.failure ?? addTransferEntry(call.raw ?? "");
    }
    case "PUT /api/transfer-ledger": {
      const parsed = body(call);
      return parsed.failure ?? nameTransferCounterparty(call.raw ?? "");
    }
    case "DELETE /api/transfer-ledger":
      return removeTransferEntry(params.get("careerId"), params.get("id"));

    case "GET /api/finance-rules":
      return readFinanceRules(params.get("careerId"));

    case "GET /api/debrief-marks":
      return readDebriefMarks(params.get("careerId"));
    case "PUT /api/debrief-marks": {
      const parsed = body(call);
      return parsed.failure ?? setDebriefStar(call.raw ?? "");
    }

    case "GET /api/trophies":
      return readTrophyCabinet(params.get("careerId"));
    case "PUT /api/trophies": {
      const parsed = body(call);
      return parsed.failure ?? recordTrophyWin(call.raw ?? "");
    }
    case "DELETE /api/trophies":
      return removeTrophyWin(params);

    default:
      // Loud rather than silent: a URL that reaches here is a call the browser build cannot answer,
      // and pretending otherwise would leave a screen blank with nothing to go on.
      console.error(`[dispatch] no handler for ${method} ${path}`);
      return statusOnly(404, `This build has no handler for ${method} ${path}.`);
  }
}

export { dispatch, rawBody };
export type { Call };
