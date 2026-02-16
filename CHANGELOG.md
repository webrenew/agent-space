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

### Changed

- Docs sidebar behavior stabilized for desktop docs layout.
- Web simulation now preserves manual menu-driven agent task updates briefly.

## [1.1.0] - 2026-02-15

### Added

- Renamed product/app surface to Agent Observer.
- Expanded web mission-control features and docs surface.

### Changed

- Improved office scene styling and parity between desktop and web interactions.

[Unreleased]: https://github.com/webrenew/agent-observer/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/webrenew/agent-observer/releases/tag/v1.1.0
