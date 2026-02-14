# App Improvement Roadmap

Owner: Product + Engineering  
Last updated: 2026-02-14

## Phase 1 - Stability and Confidence

- [x] **Shared Electron API contract + passing root typecheck**
  - Goal: eliminate renderer/preload/main API drift.
  - Done when:
    - one shared `electronAPI` type source is used in preload + renderer.
    - root `tsc` checks pass for node + renderer configs.
    - CI fails on any contract mismatch.

- [x] **Desktop smoke tests (Playwright/Electron)**
  - Goal: prevent regressions in core flows.
  - Coverage:
    - app launch
    - close + reopen on macOS
    - open folder
    - chat scoped before first message
    - popout chat
    - terminal create/kill

## Phase 2 - Performance and UX

- [x] **Startup and bundle optimization**
  - Goal: faster launch + lower memory.
  - Focus:
    - lazy-load Monaco/workers
    - lazy-mount heavy panels
    - reduce initial renderer payload

- [x] **Stronger project scoping UX in chat**
  - Goal: easier multi-project workflows.
  - Add:
    - quick folder switch from recents
    - "new chat in current workspace" action
    - clear in-panel scope indicators

- [ ] **Persist + restore workspace state**
  - Goal: seamless resume on relaunch.
  - Restore:
    - layout
    - active tabs
    - chat directory mode
    - last workspace

## Phase 3 - Operational Maturity

- [ ] **Crash and health telemetry (opt-in)**
  - Goal: diagnose failures quickly.
  - Track:
    - uncaught exceptions
    - IPC registration/runtime errors
    - startup failure breadcrumbs

- [ ] **First-run onboarding flow**
  - Goal: reduce setup friction.
  - Verify:
    - Claude CLI availability
    - permissions mode
    - workspace defaults

## Suggested Execution Order

1. Shared Electron API contract + typecheck
2. Desktop smoke tests
3. Startup/bundle optimization
4. Chat scoping UX upgrades
5. Workspace state persistence
6. Crash/health telemetry
7. First-run onboarding
