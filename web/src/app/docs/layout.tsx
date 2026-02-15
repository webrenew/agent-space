import type { CSSProperties, ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ enabled: false }}>
      <DocsLayout
        tree={source.pageTree}
        sidebar={{
          collapsible: false,
        }}
        containerProps={{
          style: {
            "--fd-layout-width": "100dvw",
          } as CSSProperties,
        }}
        nav={{
          title: (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 700,
                letterSpacing: 0.3,
              }}
            >
              <span style={{ color: "#d4a040" }}>⬢</span>
              Agent Observer Docs
            </span>
          ),
        }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
