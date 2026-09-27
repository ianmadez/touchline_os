/**
 * How a career event is described to a person.
 *
 * The spine stores events as typed rows with a JSON payload. That shape is right for storage and
 * wrong for a screen, so every surface that shows an event - the dashboard feed, the timeline -
 * renders it through here. One implementation means the same event reads identically wherever it
 * appears, and the copy can be rewritten in one place.
 */
import type { ParsedCareerEvent } from "@/lib/services/event-service";
import type { DomainEvent } from "@/lib/events/types";
import { eventLabel } from "./labels";

/**
 * Provenance, in the project's own terms.
 *
 * The whole product rests on a fact/derived/observed distinction, so it is worth spelling out
 * rather than showing the raw enum. "From your save" is a claim the user can trust; "SAVE" is not.
 */
export function provenanceLabel(source: string): string {
  switch (source) {
    case "SAVE":
      return "From your save";
    case "USER":
      return "You recorded";
    case "DERIVED":
      return "Worked out";
    case "AI":
      return "AI";
    default:
      return "Unattributed";
  }
}

/**
 * Reads an event's payload from either shape it arrives in.
 *
 * The timeline hands over an already-parsed `payload`; storyline evidence hands over the raw
 * `payloadJson` column. Accepting both means one summariser serves every surface, so the same fact
 * cannot end up described two different ways depending on where it is shown.
 */
function readPayload(evt: ParsedCareerEvent | DomainEvent): Record<string, unknown> {
  const raw: unknown =
    (evt as ParsedCareerEvent).payload ?? (evt as DomainEvent).payloadJson;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (raw ?? {}) as Record<string, unknown>;
}

/** A one-line, plain-English description of what an event actually was. */
export function summariseEvent(evt: ParsedCareerEvent | DomainEvent): string {
  const payload = readPayload(evt);
  const name = typeof payload.name === "string" ? payload.name : "Player";

  switch (evt.eventType) {
    case "CAREER_INITIALIZED":
      return `Started following this career with ${payload.initialSquadSize ?? 0} players.`;
    case "SNAPSHOT_CREATED":
      return "A new save state was recorded.";
    case "PLAYER_SIGNED":
      return `${name} joined the squad${payload.overallRating ? ` rated ${payload.overallRating}` : ""}.`;
    case "PLAYER_SOLD":
      return `${name} left the squad.`;
    case "PLAYER_OVR_CHANGED": {
      const delta = Number(payload.delta);
      const direction = delta > 0 ? "up" : "down";
      return `${name} went ${direction} ${Math.abs(delta)} to ${payload.newOvr}.`;
    }
    case "PLAYER_POTENTIAL_CHANGED":
      return `${name}'s potential moved to ${payload.newPotential}.`;
    case "FINANCE_CHANGED":
      return "The transfer and wage budgets moved.";
    case "SQUAD_SIZE_CHANGED":
      return "The squad size changed.";
    case "MATCH_DEBRIEF": {
      const opponent = typeof payload.opponent === "string" ? payload.opponent : "an unnamed opponent";
      const scoreline = typeof payload.scoreline === "string" ? payload.scoreline : "no scoreline";
      return `You logged a debrief against ${opponent}, ${scoreline}.`;
    }
    case "SEASON_ENDED":
      return "The season finished.";
    case "STORYLINE_OPENED":
      return typeof payload.title === "string" ? `Opened: ${payload.title}.` : "A new thread opened.";
    case "STORYLINE_RESOLVED":
      return typeof payload.title === "string" ? `Resolved: ${payload.title}.` : "A thread was resolved.";
    case "STORYLINE_STALE":
      return typeof payload.title === "string"
        ? `Dropped: ${payload.title} - the season ended without it resolving.`
        : "A thread was dropped.";
    // Evidence rows carry a sentence composed when the fact was recorded, so it is shown as-is
    // rather than re-derived here. Re-wording a card must not rewrite what was observed.
    case "PLAYER_CONTRACT_EXPIRING":
    case "PLAYER_DEVELOPED":
    case "PLAYER_POSITION_CHANGED":
      return typeof payload.summary === "string"
        ? payload.summary
        : `${eventLabel(evt.eventType)} recorded.`;
    default:
      return `${eventLabel(evt.eventType)} recorded.`;
  }
}

/** A short, readable date. Events carry a full timestamp; the time of day is noise here. */
export function formatEventDate(timestamp?: string | null): string {
  if (!timestamp) return "Undated";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return String(timestamp).slice(0, 10);
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
