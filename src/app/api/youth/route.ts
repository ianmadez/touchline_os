import { NextResponse } from "next/server";
import { YouthService } from "@/lib/services/youth-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The academy.
 *
 * An empty list is a valid answer, not an error: a save whose academy table is missing or holds no
 * rows has no promoted prospects to show, and the UI says so rather than implying the app is broken.
 */
export async function GET(request: Request) {
  try {
    const careerId = new URL(request.url).searchParams.get("careerId");
    if (!careerId) {
      return NextResponse.json(
        { success: false, error: "careerId is required." },
        { status: 400 }
      );
    }

    const service = new YouthService();
    const prospects = await service.list(careerId);

    return NextResponse.json({
      success: true,
      prospects,
      summary: service.summarise(prospects),
    });
  } catch (error) {
    console.error("[api/youth] read failed:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message ?? "Could not read your academy." },
      { status: 500 }
    );
  }
}
