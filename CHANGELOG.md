# Changelog

All notable changes to `@visionik/anywhere` will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
Commits: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)

## [Unreleased]

### Added
- TypeDoc configuration for generating an API reference site into `docs/api/`
- Runnable `examples/efb-demo/index.ts` console demo showing `SimulatorSource` with `event`, `stale`, and `retry` offline behaviors

### Changed
- Expanded Task targets to lint/type-check examples and generate API docs
- Added final `LocationManager` timer-cleanup and late-callback regression tests to close the remaining coverage gaps

## [0.1.0] — 2026-04-13

### Added
- `Position` interface (15 fields: coordinates, motion, fix quality, AHRS extensions, stale flag)
- `StatusEvent` interface for source health reporting
- `TypedEmitter<T>` — zero-dependency typed event emitter (~30 lines)
- `LocationSource` abstract base class with `sourceId`, lifecycle callbacks, and `emitPosition/Status/Error` helpers
- `LocationManager` — priority engine, hysteresis-gated source promotion, configurable offline behavior (`event` / `stale` / `retry`), `minUpdateIntervalMs` rate limiting
- `DeviceLocationSource` — W3C `navigator.geolocation` wrapper (watch + one-shot modes)
- `GDL90Source` — UDP listener with full GDL-90 framing, Heartbeat (0x00), Ownship (0x0B), and ForeFlight AHRS (0x65) decode
- `NMEASource` — RMC/GGA/VTG/GSA/GLL sentence parser with fix accumulator; transports: UDP, TCP (auto-reconnect), Serial (`serialport`), Bluetooth (best-effort), File replay
- `SimulatorSource` — route replay with loop/once modes, configurable `intervalMs` and `sourceId`
- Dual ESM + CJS output via tsup with `.d.ts` type declarations
- GitHub Actions release workflow (publishes on `v*` tag push)
- 194 tests, ≥85% branch coverage per module
