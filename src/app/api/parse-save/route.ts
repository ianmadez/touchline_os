import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { FeasibilitySaveParser } from "@/lib/parser/feasibility-parser";
import type { SaveCandidate } from "@/lib/parser/interface";
import { SyncService } from "@/lib/sync/sync-service";
import { CareerService, OnboardingInput } from "@/lib/services/career-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Guard rail: a legit FC career save is a few MB; refuse anything absurd. */
const MAX_SAVE_BYTES = 256 * 1024 * 1024;

interface ParseSaveRequest {
  savePath?: string;
  saveId?: string;
  onboarding?: OnboardingInput;
}

/**
 * POST /api/parse-save
 * Body: { savePath?, saveId?, onboarding? }
 *
 * Reads the local FC25 save, runs the parser + deterministic diff sync, persists the
 * snapshot/cache, then returns the full hydrated career payload (squad + tactics).
 */
export async function POST(request: Request) {
  let body: ParseSaveRequest;
  try {
    body = (await request.json()) as ParseSaveRequest;
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  try {
    const candidate = await resolveCandidate(body);
    if (!candidate) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No FC25 career save found at that location. Re-scan saves and select one of the detected files.",
        },
        { status: 404 }
      );
    }

    const syncResult = await new SyncService().syncCandidate(candidate);

    const careerService = new CareerService();
    if (body.onboarding && typeof body.onboarding === "object") {
      await careerService.upsertOnboarding(syncResult.careerId, body.onboarding);
      await careerService.ensureInitialTactics(syncResult.careerId, body.onboarding.favFormations);
    }

    const payload = await careerService.hydrate(syncResult.careerId);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: `Career ${syncResult.careerId} could not be hydrated.` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      syncStatus: syncResult.status,
      snapshotNumber: syncResult.snapshotNumber ?? payload.latestSnapshotNumber,
      eventsEmitted: syncResult.eventsEmittedCount,
      // The events this sync actually emitted (not the whole timeline), so a sync prompt can show
      // the manager a plain "what changed" list.
      syncEvents: syncResult.events,
      warnings: syncResult.warnings,
      savePath: candidate.filePath,
      saveFileName: candidate.fileName,
      ...payload,
    });
  } catch (error) {
    console.error("[api/parse-save] parsing failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Save parsing failed." },
      { status: 500 }
    );
  }
}

/** Resolves the request into a concrete, validated save candidate. */
async function resolveCandidate(body: ParseSaveRequest): Promise<SaveCandidate | null> {
  // 1. Explicit path (what the wizard sends) — cheap, no directory walking.
  if (body.savePath && body.savePath.trim().length > 0) {
    const resolved = path.resolve(body.savePath);
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_SAVE_BYTES) return null;
      return {
        id: crypto.createHash("sha1").update(resolved).digest("hex").slice(0, 16),
        filePath: resolved,
        fileName: path.basename(resolved),
        lastModified: stat.mtime,
        fileSizeBytes: stat.size,
      };
    } catch {
      return null;
    }
  }

  // 2. Detected id fallback (re-detection keeps the id contract identical to /api/saves).
  if (body.saveId) {
    const detected = await new FeasibilitySaveParser().detectSaves();
    return detected.find((save) => save.id === body.saveId) ?? null;
  }

  return null;
}
