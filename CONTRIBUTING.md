# Contributing to Agent Observer

Thanks for contributing.

## Before You Start

1. Read the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
2. Check open issues and PRs to avoid duplicate work.
3. For security issues, do not open a public issue. Follow [`SECURITY.md`](./SECURITY.md).

## Local Setup

Prerequisites:

- Node.js 22.x
- pnpm 10.12.4

Runtime and types policy:

- [`docs/engineering/node-runtime-types-policy.md`](./docs/engineering/node-runtime-types-policy.md)

Install:

```bash
pnpm install
```

Run desktop app:

```bash
pnpm dev
```

Run web app:

```bash
pnpm -C web dev
```

## Development Workflow

1. Create a branch from `main`.
2. Make focused changes.
3. Run checks locally.
4. Open a PR with clear context and test evidence.

Suggested branch naming:

- `feat/<short-name>`
- `fix/<short-name>`
- `docs/<short-name>`
- `chore/<short-name>`

## Required Checks

Run these before opening or updating a PR:

```bash
pnpm lint
pnpm lint:web
pnpm typecheck
pnpm build
pnpm -C web build
```

If your change touches desktop behavior, also run:

```bash
pnpm test:smoke
```

## Commit and PR Guidelines

- Prefer small, reviewable commits.
- Use clear commit messages (Conventional Commit style is recommended).
- Include screenshots or recordings for UI changes.
- Document behavior changes in `CHANGELOG.md` under `Unreleased`.

## Docs Changes

Docs and guides live in `web/content/docs/`.

When changing product behavior:

- Update relevant docs pages.
- Keep examples and command snippets in sync.

## Questions

See [`SUPPORT.md`](./SUPPORT.md) for where to ask questions and report issues.
