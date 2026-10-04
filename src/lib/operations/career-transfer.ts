import { assetStore } from "../platform/asset-store";
import {
  buildTransferPackage,
  CareerAlreadyPresentError,
  importTransferPackage,
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
    const written = await assetStore.writeExport(fileName, JSON.stringify(pkg, null, 2));

    return ok({
      success: true,
      careerId,
      fileName,
      filePath: written.path,
      sizeBytes: written.sizeBytes,
      counts: pkg.counts,
    });
  } catch (error) {
    console.error("[api/career/export] failed:", error);
    return failed(500, (error as Error).message ?? "Export failed.");
  }
}

/**
 * Applies a backup the user chose. One-time and user-initiated.
 *
 * A malformed file is the user's problem to see (400), not an internal failure (500), so the two
 * are kept apart here rather than collapsed into one generic error.
 */
export async function importCareerFromFile(payload: unknown): Promise<OperationResult<unknown>> {
  try {
    const summary = await importTransferPackage(payload);
    return ok({ success: true, ...summary });
  } catch (error) {
    console.error("[api/career/import] failed:", error);
    if (error instanceof TransferPackageError) {
      return failed(400, error.message);
    }
    if (error instanceof CareerAlreadyPresentError) {
      return failed(409, error.message);
    }
    return failed(500, (error as Error).message ?? "Import failed.");
  }
}
