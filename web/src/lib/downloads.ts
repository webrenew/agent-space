import { SITE_REPO_URL, SITE_RELEASES_URL } from "@/lib/site";

export const AGENT_SPACE_REPO_URL = SITE_REPO_URL;
export const AGENT_SPACE_RELEASES_URL = SITE_RELEASES_URL;
export const AGENT_SPACE_INSTALLER_URL = "/download";
export const AGENT_SPACE_RELEASES_API_URL =
  "https://api.github.com/repos/webrenew/agent-space/releases/latest";

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  content_type?: string | null;
}

export interface GitHubLatestRelease {
  assets?: GitHubReleaseAsset[] | null;
}

const APPLE_DISK_IMAGE_CONTENT_TYPE = "application/x-apple-diskimage";
const ARM64_NAME_MARKERS = ["arm64", "aarch64", "apple-silicon", "apple_silicon"];

function isMacInstallerAsset(asset: GitHubReleaseAsset): boolean {
  const contentType = asset.content_type?.toLowerCase();
  return (
    asset.name.toLowerCase().endsWith(".dmg") ||
    contentType === APPLE_DISK_IMAGE_CONTENT_TYPE
  );
}

function hasArm64Marker(assetName: string): boolean {
  const normalized = assetName.toLowerCase();
  return ARM64_NAME_MARKERS.some((marker) => normalized.includes(marker));
}

export function resolveLatestInstallerAssetUrl(
  assets: GitHubReleaseAsset[]
): string | null {
  const macInstallerAssets = assets.filter(isMacInstallerAsset);
  if (macInstallerAssets.length === 0) return null;

  const preferred = macInstallerAssets.find((asset) => hasArm64Marker(asset.name));
  return (preferred ?? macInstallerAssets[0]).browser_download_url;
}
