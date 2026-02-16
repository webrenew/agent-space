import { NextResponse } from "next/server";
import {
  AGENT_SPACE_RELEASES_API_URL,
  AGENT_SPACE_RELEASES_URL,
  resolveLatestInstallerAssetUrl,
  type GitHubLatestRelease,
} from "@/lib/downloads";

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";
const GITHUB_ACCEPT = "application/vnd.github+json";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_USER_AGENT = "agent-observer-web-download";

async function resolveInstallerUrl(): Promise<string> {
  try {
    const response = await fetch(AGENT_SPACE_RELEASES_API_URL, {
      headers: {
        Accept: GITHUB_ACCEPT,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": GITHUB_USER_AGENT,
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) return AGENT_SPACE_RELEASES_URL;

    const release = (await response.json()) as GitHubLatestRelease;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    return resolveLatestInstallerAssetUrl(assets) ?? AGENT_SPACE_RELEASES_URL;
  } catch {
    return AGENT_SPACE_RELEASES_URL;
  }
}

export async function GET(): Promise<Response> {
  const installerUrl = await resolveInstallerUrl();
  const response = NextResponse.redirect(installerUrl, { status: 302 });
  response.headers.set("Cache-Control", CACHE_CONTROL);
  return response;
}
