import { NextResponse } from "next/server";
import {
  dismissNewsItem,
  markNewsRead,
  readNews,
  saveNewsItem,
} from "@/lib/operations/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin HTTP adapter over `@/lib/operations/news`.
 *
 * The operation holds the behaviour; this file only translates `Request` in and `NextResponse` out, so
 * the browser build can call the operation directly with no HTTP hop in between.
 */
export async function GET(request: Request) {
  const outcome = await readNews(new URL(request.url).searchParams.get("careerId"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/** Bookmarks or un-bookmarks a story. */
export async function PUT(request: Request) {
  const outcome = await saveNewsItem(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/** Marks the paper read. */
export async function POST(request: Request) {
  const outcome = await markNewsRead(await request.text());
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/** Dismisses a story. */
export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = await dismissNewsItem(params.get("careerId"), params.get("id"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
