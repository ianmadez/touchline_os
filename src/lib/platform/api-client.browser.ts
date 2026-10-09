/**
 * The API port, browser build.
 *
 * A static export has no server, so `/api/...` cannot be a request. Every URL the app already calls
 * is mapped here to the operation its route handler wraps, and the answer is returned as a real
 * `Response` so callers cannot tell the difference between this and a same-origin fetch.
 *
 * This is the only place that knows the URL-to-operation mapping. Screens keep calling URLs, so they
 * hold no opinion about which runtime they are in.
 */
import { exportCareerToFile, importCareerFromFile } from "../operations/career-transfer";
import { deleteCareer, patchCareer, readCareer } from "../operations/career";
import { deleteDebrief, logMatchDebrief, updateDebrief } from "../operations/debrief";
import { readDiagnostics } from "../operations/diagnostics";
import { readFinanceReport, saveFinanceInputs } from "../operations/finance";
import { deleteObjective, readObjectives, saveObjective } from "../operations/objectives";
import { parseAndSyncSave } from "../operations/parse-save";
import {
  forgetLocalBridge,
  forgetRememberedSave,
  listSaveCandidates,
  pairLocalBridge,
  reconnectRememberedSave,
} from "../operations/saves";
import { archiveScoutTarget, readScoutingMemory, restoreScoutTarget } from "../operations/scouting-memory";
import { saveFootOverride, searchScoutPool } from "../operations/scouting-search";
import { deleteScoutTarget, readScoutingBoard, saveScoutTarget } from "../operations/scouting";
import { deleteTargetBlock, readTargetBlocks, saveTargetBlock } from "../operations/season-blocks";
import { readSeasonDossier } from "../operations/season-dossier";
import { readSeasonState, recordSeason } from "../operations/season";
import { patchSettings, readSettings } from "../operations/settings";
import { readYouthAcademy } from "../operations/youth";
import type { OperationResult } from "../operations/types";
import type { ApiFetch } from "./api-client";

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
      if (action === "forget") return forgetRememberedSave();
      if (action === "bridge-pair") return pairLocalBridge(parsed.value);
      if (action === "bridge-forget") return forgetLocalBridge();
      return {
        status: 400,
        body: {
          success: false,
          error: 'action must be one of "reconnect", "forget", "bridge-pair", "bridge-forget".',
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

    case "GET /api/season/dossier":
      return readSeasonDossier(params.get("careerId"), params.get("season"));
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

    default:
      // Loud rather than silent: a URL that reaches here is a call the browser build cannot answer,
      // and pretending otherwise would leave a screen blank with nothing to go on.
      console.error(`[api-client] no browser handler for ${method} ${path}`);
      return statusOnly(404, `This build has no handler for ${method} ${path}.`);
  }
}

export const apiFetch: ApiFetch = async (input: string, init?: RequestInit) => {
  // The origin is a parsing device only - nothing is requested, and `input` is always same-origin.
  const url = new URL(input, "http://localhost");
  const outcome = await dispatch({
    method: (init?.method ?? "GET").toUpperCase(),
    path: url.pathname.replace(/\/+$/, "") || "/",
    params: url.searchParams,
    raw: rawBody(init),
  });

  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { "content-type": "application/json" },
  });
};
