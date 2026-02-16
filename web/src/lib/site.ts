function normalizeSiteUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "http://localhost:3000";
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

const rawSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.SITE_URL ??
  process.env.VERCEL_PROJECT_PRODUCTION_URL ??
  process.env.VERCEL_URL ??
  "http://localhost:3000";

export const SITE_URL = normalizeSiteUrl(rawSiteUrl);
export const SITE_NAME = "Agent Observer";
export const SITE_TITLE = "Agent Observer — Mission Control for Your AI Agents";
export const SITE_DESCRIPTION =
  "Observe, debug, and manage every AI agent across your tools. Real-time dashboards, traces, and alerts in one workspace.";
export const SITE_REPO_URL = "https://github.com/webrenew/agent-observer";
export const SITE_RELEASES_URL = `${SITE_REPO_URL}/releases/latest`;
export const SITE_INSTALLER_URL = `${SITE_URL}/download`;
export const SITE_OG_IMAGE = "/opengraph.png";
