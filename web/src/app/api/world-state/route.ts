import { NextResponse } from "next/server";
import { getWorldStatePayload } from "@/lib/world-state";

const CACHE_CONTROL_WORLD_STATE = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET(): Promise<Response> {
  const payload = await getWorldStatePayload();
  const response = NextResponse.json(payload);
  response.headers.set("Cache-Control", CACHE_CONTROL_WORLD_STATE);
  return response;
}
