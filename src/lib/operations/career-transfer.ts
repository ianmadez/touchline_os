import { assetStore } from "../platform/asset-store";
import {
  buildTransferPackage,
  importTransferPackage,
  PartialBackupError,
  TransferPackageError,
} from "../services/career-transfer-service";
import { failed, ok, type OperationResult } from "./types";

/** Filesystem-safe timestamp: 2026-09-27T14-05-33-123Z */
function timestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Writes a complete JSON backup of one career and reports where it landed.
 *
 * This is the export half of the transfer bridge: the artefact it leaves behind is the single file a
 * user can hand to another build. It is also what makes the destructive Reset action recoverable.
 *
 * The serialised backup is returned as well as written, because `assetStore.writeExport` means two
 * different things per build - the Node build writes to `data/exports/`, the browser build has no
 * folder and used to trigger the download itself. That made Export behave differently depending on
 * where you ran it: locally it quietly produced a file on disk and nothing in the browser. The bytes
 * travel back with the summary so the UI can deliver ONE download in both runtimes.
 */
export async function exportCareerToFile(
  careerId: string | null
): Promise<OperationResult<unknown>> {
  if (!careerId) {
    return failed(400, "careerId parameter is required.");
  }

  try {
    const pkg = await buildTransferPackage(careerId);
    if (!pkg) {
      return failed(404, `Career ${careerId} not found.`);
    }

    const fileName = `${careerId}_${timestampSlug()}.json`;
    const contents = JSON.stringify(pkg, null, 2);
    const written = await assetStore.writeExport(fileName, contents);

    return ok({
      success: true,
      careerId,
      fileName,
      filePath: written.path,
      sizeBytes: written.sizeBytes,
      counts: pkg.counts,
      contents,
    });
  } catch (error) {
    console.error("[api/career/export] failed:", error);
    return failed(500, (error as Error).message ?? "Export failed.");
  }
}

/**
 * Applies a backup the user chose. One-time and user-initiated.
 *
 * A malformed file is the user's problem to see (400) and a backup that cannot be applied without
 * destroying what it does not carry is a conflict (409), not an internal failure (500), so the
 * three are kept apart here rather than collapsed into one generic error.
 */
export async function importCareerFromFile(payload: unknown): Promise<OperationResult<unknown>> {
  try {
    const summary = await importTransferPackage(payload);

    // Faces for the career that just landed, and deliberately not awaited.
    //
    // An imported career has never been through a sync, so nothing has ever asked for its faces -
    // and importing one is the ordinary way a career reaches the browser build. Kicking the pass here
    // means the squad has faces without the manager waiting on a download to see the result of an
    // import, and a player the CDN cannot supply simply keeps his initials disc either way.
    void assetStore.refreshSquadFaces(summary.careerId).catch(() => {
      // Faces are presentation. A failed import must not be reported as one because a CDN was down.
    });

    return ok({ success: true, ...summary });
  } catch (error) {
    console.error("[api/career/import] failed:", error);
    if (error instanceof TransferPackageError) {
      return failed(400, error.message);
    }
    if (error instanceof PartialBackupError) {
      return failed(409, error.message);
    }
    return failed(500, (error as Error).message ?? "Import failed.");
  }
}
