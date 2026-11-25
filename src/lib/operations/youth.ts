import { YouthService } from "../services/youth-service";
import { MentorService } from "../services/mentor-service";
import { at, failed, ok, type OperationResult } from "./types";

/**
 * The academy.
 *
 * An empty list is a valid answer, not an error: a save whose academy table is missing or holds no
 * rows has no promoted prospects to show, and the UI says so rather than implying the app is broken.
 */
export async function readYouthAcademy(
  careerId: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId is required.");
  }

  try {
    const service = new YouthService();
    const prospects = await service.list(careerId);

    return ok({
      success: true,
      prospects,
      graduates: await service.graduates(careerId),
      leavers: await service.leavers(careerId),
      mentors: await new MentorService().overview(careerId),
      summary: service.summarise(prospects),
    });
  } catch (error) {
    console.error("[api/youth] read failed:", error);
    return failed(500, (error as Error).message ?? "Could not read your academy.");
  }
}

/**
 * The Promote button, and its undo.
 *
 * Body: { careerId, playerId, name?, undo? }. Writes the same YOUTH_PROMOTED event a sync writes when
 * it sees the player in the first team, so whichever arrives first wins and nothing doubles up.
 */
export async function setYouthPromotion(rawBody: string): Promise<OperationResult<unknown>> {
  let body: {
    careerId?: unknown;
    playerId?: unknown;
    name?: unknown;
    undo?: unknown;
    action?: unknown;
    mentorId?: unknown;
    text?: unknown;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return at(400, { success: false, error: "Request body must be valid JSON." });
  }
  const careerId = typeof body.careerId === "string" ? body.careerId : null;
  const playerId = Number(body.playerId);
  if (!careerId || !Number.isInteger(playerId)) {
    return at(400, { success: false, error: "careerId and playerId are required." });
  }
  try {
    const service = new YouthService();
    const mentors = new MentorService();
    if (body.action === "mentor") {
      const mentorId = Number(body.mentorId);
      if (!Number.isInteger(mentorId)) return at(400, { success: false, error: "mentorId is required." });
      await mentors.pair(careerId, playerId, mentorId);
    } else if (body.action === "unmentor") await mentors.end(careerId, playerId);
    else if (body.action === "mentorNote") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return at(400, { success: false, error: "A note needs some text." });
      await mentors.addNote(careerId, playerId, text);
    } else if (body.action === "release" || body.action === "unrelease") await service.setReleased(careerId, playerId, body.action === "release");
    else if (body.undo === true) await service.unpromote(careerId, playerId);
    else await service.promote(careerId, playerId, typeof body.name === "string" ? body.name : null);
    return readYouthAcademy(careerId);
  } catch (error) {
    console.error("[api/youth] promote failed:", error);
    return failed(500, (error as Error).message ?? "Could not update that promotion.");
  }
}
