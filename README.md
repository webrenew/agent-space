# Agent Observer

Agent Observer is a desktop-first observability workspace for AI agents, with a companion web surface for docs and interactive demo views.

## Highlights

- Monitor multiple AI agents in a shared 3D office and dashboard UI.
- Track statuses, token flow, file modifications, and celebration/event streams.
- Preview explorer-opened files across text, markdown, images, audio/video, and PDF
  with staged diff review before text writes.
- Offer a website installer endpoint (`/download`) that serves the latest macOS
  (Apple Silicon) `.dmg` build when release assets are available.
- Run a production desktop app (Electron) plus a docs/demo web app (Next.js).
- Integrate local workflows, scheduled actions, and memory tooling.

## Repository Layout

- `src/`: Electron desktop app (main, preload, renderer).
- `web/`: Next.js docs and web demo.
- `tests/`: Smoke test coverage.
- `examples/`: Example integrations and orchestrator samples.

## Prerequisites

- Node.js 22.x
- pnpm 10.12.4
- macOS (Apple Silicon) for packaged desktop artifacts

Optional helpers:

- Playwright browsers for smoke tests
- Xcode Command Line Tools (for macOS native build dependencies)

## Quick Start

Install dependencies:

```bash
pnpm install
```

Run desktop app in dev mode:

```bash
pnpm dev
```

Run web app in dev mode:

```bash
pnpm -C web dev
```

## Common Commands

- `pnpm lint`: Desktop lint
- `pnpm lint:web`: Web lint
- `pnpm typecheck`: TypeScript project build check
- `pnpm build`: Desktop production build
- `pnpm -C web build`: Web production build
- `pnpm test:smoke`: Desktop smoke tests (Playwright)
- `pnpm test:coverage`: Coverage report for non-Electron smoke tests

## Docs

- Web docs route: `/docs`
- Architecture docs: `/docs/architecture`
- Quickstart docs: `/docs/quickstart`

## Contributing and Community

- Contributing guide: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Runtime and Node types policy: [`docs/engineering/node-runtime-types-policy.md`](./docs/engineering/node-runtime-types-policy.md)
- Code of conduct: [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- Security policy: [`SECURITY.md`](./SECURITY.md)
- Support guide: [`SUPPORT.md`](./SUPPORT.md)
- Changelog: [`CHANGELOG.md`](./CHANGELOG.md)

## License

MIT License. See [`LICENSE`](./LICENSE).
