import { expect, test } from "@playwright/test";
import {
  resolveLatestInstallerAssetUrl,
  resolveLatestInstallerFromReleases,
  type GitHubReleaseAsset,
  type GitHubReleaseSummary,
} from "../../web/src/lib/downloads";

test("installer resolver prefers arm64 dmg when multiple mac installers exist", () => {
  const assets: GitHubReleaseAsset[] = [
    {
      name: "agent-observer-1.2.0-mac.dmg",
      browser_download_url: "https://example.com/mac.dmg",
      content_type: "application/x-apple-diskimage",
    },
    {
      name: "agent-observer-1.2.0-arm64.dmg",
      browser_download_url: "https://example.com/arm64.dmg",
      content_type: "application/x-apple-diskimage",
    },
  ];

  expect(resolveLatestInstallerAssetUrl(assets)).toBe("https://example.com/arm64.dmg");
});

test("release resolver skips missing/draft releases and finds latest installer", () => {
  const releases: GitHubReleaseSummary[] = [
    { assets: [], draft: false, prerelease: false },
    {
      draft: true,
      prerelease: false,
      assets: [
        {
          name: "draft-arm64.dmg",
          browser_download_url: "https://example.com/draft-arm64.dmg",
          content_type: "application/x-apple-diskimage",
        },
      ],
    },
    {
      draft: false,
      prerelease: false,
      assets: [
        {
          name: "stable-arm64.dmg",
          browser_download_url: "https://example.com/stable-arm64.dmg",
          content_type: "application/x-apple-diskimage",
        },
      ],
    },
  ];

  expect(resolveLatestInstallerFromReleases(releases)).toBe("https://example.com/stable-arm64.dmg");
});
