# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Open-source project governance docs and templates (`README`, `CONTRIBUTING`,
  `CODE_OF_CONDUCT`, `SECURITY`, issue templates, PR template, `CODEOWNERS`).
- Explorer-driven file previews now support text/markdown/image/audio/video/PDF
  modes with a binary metadata fallback and staged diff-preview saves for
  text-like edits.
- Added a dedicated GitHub Actions test-coverage workflow that runs non-Electron
  smoke tests under `c8` and publishes coverage artifacts/summary.
- App now checks GitHub releases on startup and shows an in-app update banner
  when a newer version is available.
- Packaged desktop builds now stream updater status and show a one-click
  "Install update and restart" toast when a downloaded update is ready.
- Added a release workflow that builds macOS `.dmg` installers and uploads them
  to GitHub releases on publish.
- Editor now supports staged image proposal diffs with apply/discard, while
  unsupported non-text formats show explicit external-compare fallback guidance.
- Editor now supports staged PDF proposal workflows with text diff preview
  (`dataUrl` + extracted `currentText`/`proposedText`) plus apply/discard controls.

### Changed

- Docs sidebar behavior stabilized for desktop docs layout.
- Web simulation now preserves manual menu-driven agent task updates briefly.
- Website installer flows now explicitly call out macOS (Apple Silicon), and
  `/download` now scans recent releases for the newest available `.dmg`.
- Release automation now uploads `latest-mac.yml` and `.dmg.blockmap` metadata
  assets required by in-app auto-updates.
- Packaged builds now re-check for updates periodically after startup, and the
  in-app update banner appears as soon as an update is available/downloading.
- Desktop 3D office now uses the full web-parity scene reskin modules and layout.
- Fixed chat prompt history capture so each new message includes the latest
  conversation context from prior turns in the active chat.

## [1.1.0] - 2026-02-15

### Added

- Renamed product/app surface to Agent Observer.
- Expanded web mission-control features and docs surface.

### Changed

- Improved office scene styling and parity between desktop and web interactions.

[Unreleased]: https://github.com/webrenew/agent-observer/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/webrenew/agent-observer/releases/tag/v1.1.0
