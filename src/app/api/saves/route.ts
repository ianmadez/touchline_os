import { NextResponse } from "next/server";
import { FeasibilitySaveParser } from "@/lib/parser/feasibility-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/saves
 * Scans the known FC career-save locations on this machine and returns the candidates
 * the onboarding wizard can offer, plus the locations that were probed.
 */
export async function GET() {
  try {
    const parser = new FeasibilitySaveParser();
    const detected = await parser.detectSaves();

    // The wizard only cares about career saves; `database` slots (storageInfo.bin, ...)
    // cannot be parsed into a squad and would only produce a broken onboarding step.
    const seen = new Set<string>();
    const saves = detected
      .filter((save) => save.slotKind !== "database")
      .filter((save) => {
        const key = `${save.fileName}|${save.fileSizeBytes}|${save.lastModified.getTime()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((save) => ({
        ...save,
        // Dates do not survive JSON, so publish a stable ISO contract.
        lastModified: save.lastModified.toISOString(),
      }));

    return NextResponse.json({
      success: true,
      saves,
      scannedLocations: parser.lastScan,
    });
  } catch (error) {
    console.error("[api/saves] save detection failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Save detection failed." },
      { status: 500 }
    );
  }
}
