import { NewsArchiveService } from "../services/news-archive";
import { EventService } from "../services/event-service";
import { at, failed, ok, type OperationResult } from "./types";

/**
 * The news desk.
 *
 * READING is where publishing happens: the read builds today's edition from the career's own evidence,
 * stores whatever is new, trims the archive to its cap, and returns the paper. There is no background job
 * because there is nothing for one to hold: the desk is a pure function of data the app already has.
 *
 * WRITING is three small verbs and they are all the manager's own: bookmark a story, dismiss one, and mark
 * the paper read. None of them can rewrite a story, because a story that was printed was printed.
 */

interface NewsRequest {
  careerId?: string;
  id?: string;
  saved?: boolean;
}

/** Parses a body in its own guard, so malformed JSON is a 400 rather than a 500. */
function parse(rawBody: string): { body?: NewsRequest; failure?: OperationResult<unknown> } {
  try {
    return { body: JSON.parse(rawBody) as NewsRequest };
  } catch {
    return { failure: at(400, { success: false, error: "Request body must be valid JSON." }) };
  }
}

export async function readNews(careerId: string | null): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  try {
    const paper = await new NewsArchiveService().read(careerId);
    if (!paper) {
      return at(404, { success: false, error: "That career is not in the database." });
    }
    return ok({ success: true, paper });
  } catch (error) {
    console.error("[api/news] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not put the paper together.");
  }
}

/** Bookmarks or un-bookmarks one story. */
export async function saveNewsItem(rawBody: string): Promise<OperationResult<unknown>> {
  const parsed = parse(rawBody);
  if (parsed.failure) return parsed.failure;
  const { careerId, id, saved } = parsed.body ?? {};
  if (!careerId || !id || typeof saved !== "boolean") {
    return at(400, { success: false, error: "careerId, id and saved are required." });
  }

  try {
    const found = await new NewsArchiveService().setSaved(careerId, id, saved);
    if (!found) {
      return at(404, { success: false, error: "That story is not in your paper any more." });
    }
    return ok({ success: true, id, saved });
  } catch (error) {
    console.error("[api/news] save failed:", error);
    return failed(500, (error as Error).message ?? "Could not change that story.");
  }
}

/** Dismisses one story. A saved story is refused rather than quietly unsaved. */
export async function dismissNewsItem(
  careerId: string | null,
  id: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId || !id) {
    return at(400, { success: false, error: "careerId and id are required." });
  }

  try {
    const outcome = await new NewsArchiveService().dismiss(careerId, id);
    if (outcome === "missing") {
      return at(404, { success: false, error: "That story is not in your paper any more." });
    }
    if (outcome === "saved") {
      return at(409, {
        success: false,
        error: "That story is saved. Unsave it before dismissing it.",
      });
    }
    return ok({ success: true, id });
  } catch (error) {
    console.error("[api/news] dismiss failed:", error);
    return failed(500, (error as Error).message ?? "Could not dismiss that story.");
  }
}

/** Marks the paper read, which is what opening it means. */
export async function markNewsRead(rawBody: string): Promise<OperationResult<unknown>> {
  const parsed = parse(rawBody);
  if (parsed.failure) return parsed.failure;
  const { careerId } = parsed.body ?? {};
  if (!careerId) {
    return at(400, { success: false, error: "careerId is required." });
  }

  try {
    const marked = await new NewsArchiveService().markRead(careerId);
    return ok({ success: true, marked });
  } catch (error) {
    console.error("[api/news] mark read failed:", error);
    return failed(500, (error as Error).message ?? "Could not mark the paper read.");
  }
}

/**
 * Records what the manager told the press, or that he told them nothing.
 *
 * Written as its own event rather than by rewriting the debrief. Two reasons: a debrief is a record of what
 * happened and a comment is a separate thing said afterwards, and keeping them apart is what lets the news
 * desk tell "he declined" apart from "nobody asked", which read very differently in a paper.
 */
export async function recordMediaComment(rawBody: string): Promise<OperationResult<unknown>> {
  let body: {
    careerId?: string;
    debriefEventId?: string;
    opponent?: string;
    subject?: string;
    comment?: string;
    refused?: boolean;
  };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }

  if (!body.careerId || !body.debriefEventId) {
    return at(400, { success: false, error: "careerId and debriefEventId are required." });
  }

  try {
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const refused = body.refused === true || comment.length === 0;
    const eventId = `evt_media_${crypto.randomUUID()}`;

    await new EventService().appendEvent({
      id: eventId,
      careerId: body.careerId,
      eventType: "MEDIA_COMMENT",
      source: "USER",
      entityType: "MATCH",
      entityId: body.debriefEventId,
      payloadJson: JSON.stringify({
        careerId: body.careerId,
        debriefEventId: body.debriefEventId,
        opponent: body.opponent ?? "",
        subject: body.subject ?? "",
        comment: refused ? null : comment,
        refused,
      }),
      timestamp: new Date().toISOString(),
    });

    return ok({ success: true, refused, comment: refused ? null : comment });
  } catch (error) {
    console.error("[api/media-comment] failed:", error);
    return failed(500, (error as Error).message ?? "Could not record that comment.");
  }
}
