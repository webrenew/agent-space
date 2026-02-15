# Node Runtime and Type Policy

This project standardizes on **Node.js 22.x** for local development, CI, and production usage.

## Source of Truth

- `.nvmrc` defines the default local Node version.
- `engines.node` in:
  - `package.json`
  - `web/package.json`
- GitHub Actions CI uses `.nvmrc` via `actions/setup-node`.

All three must stay aligned.

## `@types/node` Policy

- `@types/node` must stay on major `22`.
- Minor and patch updates within major `22` are allowed through normal dependency maintenance.
- Major upgrades (for example, `22 -> 23`) are treated as a planned refactor, not an automatic dependency bump.

## Dependabot Policy

- Dependabot major-version updates are ignored by default.
- `@types/node` major updates are explicitly ignored to keep runtime and type upgrades intentional and coordinated.

## Upgrade Procedure for Next Node Major

When moving from Node 22 to the next major:

1. Open a tracking issue describing runtime, CI, and dependency impact.
2. Update `.nvmrc`.
3. Update `engines.node` in both `package.json` files.
4. Update `@types/node` in all workspaces that reference Node APIs.
5. Update CI and any release/build scripts that assume a Node major.
6. Run full CI (desktop checks, frontend checks, and smoke where applicable).
7. Document the change in `CHANGELOG.md`.
