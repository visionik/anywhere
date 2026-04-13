# Anywhere SPECIFICATION

## Overview

`@visionik/anywhere` is a cross-platform TypeScript library that normalizes GPS/location data from multiple heterogeneous sources into a single consistent `Position` interface. It supports automatic source prioritization, configurable fallback, and extensible source architecture.

**Target runtimes:** Browser (W3C Geolocation API), Node.js 18+ (GDL-90 UDP, NMEA serial/UDP/TCP/BT/file), and native runtimes (Capacitor/Electron — v0.2+).

**Package:** `@visionik/anywhere` · **Version:** 0.1.0 · **Module:** Dual ESM + CJS

---

## Requirements

### Functional Requirements

- **FR-1:** Library exports a `Position` interface with: `latitude`, `longitude`, `altitude?`, `speed?`, `heading?`, `timestamp`, `accuracy?`, `verticalAccuracy?`, `source`, `satellites?`, `hdop?`, `fixType?`, `roll?`, `pitch?`, `magneticVariation?`
- **FR-2:** Library exports an abstract `LocationSource` base class with `start()`, `stop()`, `emitPosition()`, `onPosition`, `onError`, and `onStatus` callbacks
- **FR-3:** `LocationManager` accepts multiple sources with a configurable `priorityOrder`, `minUpdateIntervalMs`, and `hysteresisMs`; selects the highest-priority source with a valid fix; falls back automatically when the active source degrades
- **FR-4:** `LocationManager` exposes configurable `offlineBehavior`: `'event'` (emit offline event), `'retry'` (auto-restart sources on interval), or `'stale'` (emit last position with stale flag) when all sources lose fix
- **FR-5:** `DeviceLocationSource` wraps `navigator.geolocation` (W3C, browser only in v0.1); supports `enableHighAccuracy`, `timeoutMs`, `maximumAgeMs` options; supports both `watchPosition` and one-shot `getCurrentPosition` modes
- **FR-6:** `GDL90Source` listens on a UDP port (default 4000); decodes Heartbeat (0x00), Ownship Report (0x0B), and ForeFlight AHRS (0x65) messages with full framing (0x7E delimiters, byte unstuffing, CRC-16/CCITT)
- **FR-7:** `NMEASource` parses RMC, GGA, VTG, GSA, GLL sentences with checksum validation; supports UDP, TCP, Serial (serialport), Bluetooth, and File replay transports; merges multi-sentence epochs via fix accumulator
- **FR-8:** `SimulatorSource` replays a `Position[]` route at a configurable `intervalMs` in `loop` or one-shot mode
- **FR-9:** `LocationManager` and `LocationSource` use a typed micro-emitter (`TypedEmitter<T>`) — zero runtime dependencies, `~20` lines, full TypeScript generics
- **FR-10:** Library is built with tsup producing dual ESM (`.mjs`) + CJS (`.js`) output with `.d.ts` type declarations and a correct `package.json` exports map
- **FR-11:** Project uses CHANGELOG.md (Keep a Changelog format), semantic versioning, and conventional commits

### Non-Functional Requirements

- **NFR-1:** Minimum runtime: Node.js 18+ · Browser: Chrome 90+, Firefox 90+, Safari 15+
- **NFR-2:** Zero runtime dependencies except `serialport` (serial transport only, optional peer dep)
- **NFR-3:** All public APIs have JSDoc comments; README examples are copy-paste runnable
- **NFR-4:** TypeScript strict mode throughout; ESLint + Prettier enforced
- **NFR-5:** ≥85% test coverage overall and per module (Vitest + v8 provider)

---

## Architecture

```
src/
├── index.ts                          # Public API re-exports
├── types/
│   ├── position.ts                   # Position interface
│   └── status-event.ts               # StatusEvent interface
├── emitter/
│   └── typed-emitter.ts              # TypedEmitter<T> micro-emitter
├── location-source.ts                # Abstract LocationSource base class
├── location-manager.ts               # LocationManager
└── sources/
    ├── device/
    │   └── device-location-source.ts
    ├── gdl90/
    │   ├── gdl90-source.ts
    │   └── gdl90-parser.ts
    ├── nmea/
    │   ├── nmea-source.ts
    │   ├── nmea-parser.ts
    │   ├── fix-accumulator.ts
    │   ├── sentences/
    │   │   ├── rmc.ts
    │   │   ├── gga.ts
    │   │   ├── vtg.ts
    │   │   ├── gsa.ts
    │   │   └── gll.ts
    │   └── transports/
    │       ├── udp-transport.ts
    │       ├── tcp-transport.ts
    │       ├── serial-transport.ts
    │       ├── bluetooth-transport.ts
    │       └── file-transport.ts
    └── simulator/
        └── simulator-source.ts
tests/                                # Mirror of src/ structure
```

**Data flow:**

```
[Hardware / OS / Network]
        ↓
[LocationSource subclass]   ← start() / stop()
   emitPosition(pos)
        ↓
[LocationManager]           ← priority engine, hysteresis, rate limiting
   active source selected
        ↓
[TypedEmitter]
   .on('position', handler)
        ↓
[Consumer Application]
```

**Key design decisions:**
- `TypedEmitter<T>` — custom micro-emitter, cross-platform, zero deps, typed generics
- `LocationSource` uses callback pattern (`onPosition`, `onError`, `onStatus`) internally; `LocationManager` exposes `TypedEmitter` externally
- Fusion architecture deferred to v0.2 — `LocationManager` accepts a `fusionStrategy?: FusionStrategy` option slot (no-op in v0.1) so the interface is stable

---

## Implementation Plan

### Phase 1: Foundation

#### Subphase 1.1: Project Setup
- **Task 1.1.1:** Initialize `package.json` — name `@visionik/anywhere`, version `0.1.0`, exports map (`main`/`module`/`types` + `exports['.']`), `engines.node ≥ 18` (traces: FR-10, NFR-1)
  - Dependencies: none
  - Acceptance: exports map present; `npm publish --dry-run` succeeds
- **Task 1.1.2:** Configure `tsconfig.json` — `strict: true`, `target: ES2020`, `moduleResolution: bundler`, `declaration: true` (traces: NFR-4)
  - Dependencies: 1.1.1
  - Acceptance: `tsc --noEmit` passes on empty `src/index.ts`
- **Task 1.1.3:** Configure `tsup.config.ts` — entry `src/index.ts`, format `['cjs', 'esm']`, `dts: true`, `sourcemap: true` (traces: FR-10)
  - Dependencies: 1.1.2
  - Acceptance: `task build` produces `dist/index.js`, `dist/index.mjs`, `dist/index.d.ts`
- **Task 1.1.4:** Set up Vitest — `vitest.config.ts` with `coverage.provider: 'v8'`, thresholds at 85% (traces: NFR-5)
  - Dependencies: 1.1.1
  - Acceptance: `task test:coverage` runs and reports; fails below 85% threshold
- **Task 1.1.5:** Configure ESLint (`@typescript-eslint`) + Prettier (traces: NFR-4)
  - Dependencies: 1.1.2
  - Acceptance: `task lint` passes on empty source
- **Task 1.1.6:** Create `Taskfile.yml` with tasks: `default` (list), `check`, `lint`, `typecheck`, `test`, `test:coverage`, `build`, `clean` (traces: FR-11)
  - Dependencies: 1.1.3, 1.1.4, 1.1.5
  - Acceptance: `task --list` shows all tasks; `task check` runs lint → typecheck → test → coverage
- **Task 1.1.7:** Initialize `CHANGELOG.md` (Keep a Changelog, `[Unreleased]` section, conventional-commits note) (traces: FR-11)
  - Dependencies: none
  - Acceptance: file present and valid format
- **Task 1.1.8:** Create `.gitignore` (node_modules, dist, coverage, .env) and `.npmignore` (src, tests, *.config.ts) (traces: NFR-2)
  - Dependencies: none
  - Acceptance: `git status` shows only intended files

#### Subphase 1.2: Core Types (depends on: 1.1)
- **Task 1.2.1:** Define `Position` interface in `src/types/position.ts` with JSDoc on every field (traces: FR-1, NFR-3)
  - Dependencies: 1.1.2
  - Acceptance: all 15 fields present; exported from `src/index.ts`
- **Task 1.2.2:** Define `StatusEvent` interface `{ connected: boolean; quality: number }` in `src/types/status-event.ts` (traces: FR-2)
  - Dependencies: 1.1.2
  - Acceptance: exported from `src/index.ts`
- **Task 1.2.3:** Implement `TypedEmitter<T extends Record<string, unknown[]>>` in `src/emitter/typed-emitter.ts` — `on`, `off`, `emit` with generic event maps (traces: FR-9, NFR-2)
  - Dependencies: 1.1.2
  - Acceptance: ~20 lines; zero imports from external packages; full TypeScript inference on event names and payloads
- **Task 1.2.4:** Define abstract `LocationSource` in `src/location-source.ts` — `abstract start()`, `abstract stop()`, `protected emitPosition(pos)`, public `onPosition?`, `onError?`, `onStatus?` (traces: FR-2)
  - Dependencies: 1.2.1, 1.2.2
  - Acceptance: concrete subclass compiles and emits positions
- **Task 1.2.5:** Tests for `TypedEmitter` and `LocationSource` base (traces: FR-9, NFR-5)
  - Dependencies: 1.2.3, 1.2.4
  - Acceptance: on/off/emit, multiple listeners, removal, error paths — ≥85% branch coverage

#### Subphase 1.3: LocationManager (depends on: 1.2)
- **Task 1.3.1:** Implement `LocationManager` lifecycle — `constructor(options)`, `addSource`, `removeSource`, `start`, `stop`; wire source callbacks; extend `TypedEmitter` for `position`, `sourceChange`, `offline` events (traces: FR-3)
  - Dependencies: 1.2.3, 1.2.4
  - Acceptance: manager starts/stops all sources; `addSource` works at runtime; `position` event fires
- **Task 1.3.2:** Implement priority engine — select active source by `priorityOrder` index + fix quality (`hdop`/`accuracy`) + `hysteresisMs` gate (traces: FR-3)
  - Dependencies: 1.3.1
  - Acceptance: given two `SimulatorSource`s with different priorities, only the higher-priority one emits; fallback promoted after primary stops + hysteresis elapsed
- **Task 1.3.3:** Implement configurable `offlineBehavior: 'event' | 'retry' | 'stale'` (traces: FR-4)
  - Dependencies: 1.3.1
  - Acceptance: all three modes work as specified in FR-4; `stale` position includes `{ ...lastPos, stale: true }`
- **Task 1.3.4:** Tests for `LocationManager` — priority, fallback, hysteresis, all offline modes, `minUpdateIntervalMs` rate limiting (traces: FR-3, FR-4, NFR-5)
  - Dependencies: 1.3.1, 1.3.2, 1.3.3
  - Acceptance: ≥85% coverage; all key behaviors have assertions

---

### Phase 2: Location Sources (depends on: Phase 1)

Subphases 2.1–2.4 have no dependencies on each other and may be implemented in parallel.

#### Subphase 2.1: DeviceLocationSource (depends on: 1.2)
- **Task 2.1.1:** Implement `DeviceLocationSource` — wraps `navigator.geolocation.watchPosition` (continuous) and `getCurrentPosition` (one-shot); options: `enableHighAccuracy`, `timeoutMs`, `maximumAgeMs` (traces: FR-5)
  - Dependencies: 1.2.4
  - Acceptance: `start()` calls `watchPosition`; `stop()` calls `clearWatch`
- **Task 2.1.2:** Normalize `GeolocationPosition` → `Position`; derive `quality` from `accuracy`; set `source: 'device'` (traces: FR-5)
  - Dependencies: 2.1.1
  - Acceptance: all `GeolocationCoordinates` fields mapped; `onStatus` called with quality signal
- **Task 2.1.3:** Tests — mock `navigator.geolocation`; cover success, error, and `clearWatch` paths (traces: FR-5, NFR-5)
  - Dependencies: 2.1.2
  - Acceptance: ≥85% coverage

#### Subphase 2.2: GDL90Source (depends on: 1.2)
- **Task 2.2.1:** UDP socket listener in `src/sources/gdl90/gdl90-source.ts` using `node:dgram`; options: `port` (default 4000), `bindAddress` (default `'0.0.0.0'`), `enableAHRS` (default true) (traces: FR-6)
  - Dependencies: 1.2.4
  - Acceptance: binds on `start()`; closes on `stop()`; `onError` fires on socket error
- **Task 2.2.2:** GDL-90 framing in `src/sources/gdl90/gdl90-parser.ts` — 0x7E frame extraction, byte unstuffing (0x7D ^ 0x20), CRC-16/CCITT validation (traces: FR-6)
  - Dependencies: 2.2.1
  - Acceptance: valid frames decoded; bad CRC discarded silently; stuffed bytes correctly unstuffed
- **Task 2.2.3:** Decode Heartbeat (0x00) — GPS validity bit, UAT initialized bit, UTC time; update `onStatus` (traces: FR-6)
  - Dependencies: 2.2.2
  - Acceptance: `onStatus({ connected: true, quality: 1 })` when GPS valid bit set
- **Task 2.2.4:** Decode Ownship Report (0x0B) — lat/lon from 3-byte semicircle encoding, geometric altitude (25ft increments), NACp→accuracy, horizontal velocity components→speed+track (traces: FR-6)
  - Dependencies: 2.2.2
  - Acceptance: position emitted with correct decimal degrees; altitude in meters; speed in m/s; `source: 'gdl90'`
- **Task 2.2.5:** Decode ForeFlight AHRS (0x65) — roll (0.1°/LSB), pitch (0.1°/LSB); cache and annotate next Ownship position (traces: FR-6)
  - Dependencies: 2.2.4
  - Acceptance: `roll` and `pitch` populated on emitted `Position` when AHRS received; `headingDeg` is decoded but not mapped to any `Position` field (it is the aircraft's magnetic heading, not magnetic declination)
  - Note: Corrected by PR #2 — original spec incorrectly listed `magneticVariation`
- **Task 2.2.6:** Tests — construct real GDL-90 binary frames; inject via mock socket (traces: FR-6, NFR-5)
  - Dependencies: 2.2.3, 2.2.4, 2.2.5
  - Acceptance: known frames → expected field values; ≥85% coverage

#### Subphase 2.3: NMEASource (depends on: 1.2)
- **Task 2.3.1:** Core parser in `src/sources/nmea/nmea-parser.ts` — line extraction, `*XX` checksum validation, talker ID prefix normalization (traces: FR-7)
  - Dependencies: 1.2.4
  - Acceptance: valid/invalid sentence discrimination; type dispatch to sentence parsers
- **Task 2.3.2–2.3.6:** Sentence parsers in `src/sources/nmea/sentences/` for RMC, GGA, VTG, GSA, GLL — each returns a `Partial<Position>` (traces: FR-7)
  - Dependencies: 2.3.1
  - Acceptance: each parser converts correct fields; speed in m/s; fix type mapped correctly
- **Task 2.3.7:** Fix accumulator in `src/sources/nmea/fix-accumulator.ts` — merge `Partial<Position>` updates keyed by UTC epoch; emit complete `Position` on RMC (or GGA fallback) (traces: FR-7)
  - Dependencies: 2.3.2–2.3.6
  - Acceptance: RMC + GGA + GSA merge into single emission; accumulator resets post-emit
- **Task 2.3.8:** UDP transport — `node:dgram` socket, streams datagrams as line buffer (traces: FR-7)
  - Dependencies: 2.3.7
  - Acceptance: `NMEASource({ type: 'udp', port: 10110 })` works end-to-end
- **Task 2.3.9:** TCP transport — `node:net` socket with reconnect on `close`/`error` (traces: FR-7)
  - Dependencies: 2.3.7
  - Acceptance: reconnects after disconnect; `stop()` destroys socket
- **Task 2.3.10:** Serial transport — `serialport` with `ReadlineParser`; guards Node.js-only with runtime check (traces: FR-7)
  - Dependencies: 2.3.7
  - Acceptance: `NMEASource({ type: 'serial', path: '/dev/ttyUSB0', baudRate: 4800 })` works; throws useful error in browser
- **Task 2.3.11:** Bluetooth transport — serial-over-BT via platform API; documented with caveats (traces: FR-7)
  - Dependencies: 2.3.7
  - Acceptance: documented behavior; graceful error when unavailable
- **Task 2.3.12:** File replay transport — `fs.createReadStream`, line-by-line via `readline`, respects `rateMultiplier` timing (traces: FR-7)
  - Dependencies: 2.3.7
  - Acceptance: `NMEASource({ type: 'file', path, rateMultiplier: 10 })` emits positions 10× faster than real time
- **Task 2.3.13:** Tests — sentence fixture strings; mock transport streams; accumulator merge; error paths (traces: FR-7, NFR-5)
  - Dependencies: 2.3.1–2.3.12
  - Acceptance: ≥85% coverage; all 5 sentence types asserted

#### Subphase 2.4: SimulatorSource (depends on: 1.2)
- **Task 2.4.1:** Implement `SimulatorSource` in `src/sources/simulator/simulator-source.ts` — `route: Position[]`, `intervalMs: number`, `loop: boolean` (default true) (traces: FR-8)
  - Dependencies: 1.2.4
  - Acceptance: emits positions from route at interval; loops or stops based on `loop` flag
- **Task 2.4.2:** Tests — playback, loop mode, one-shot mode, `stop()` halts (traces: FR-8, NFR-5)
  - Dependencies: 2.4.1
  - Acceptance: ≥85% coverage

---

### Phase 3: Quality & Release (depends on: Phase 2)

#### Subphase 3.1: Test Coverage (depends on: Phase 2)
- **Task 3.1.1:** Review coverage report; write additional tests to reach ≥85% in all modules (traces: NFR-5)
  - Dependencies: all of Phase 2
  - Acceptance: `task test:coverage` exits 0
- **Task 3.1.2:** Integration tests — `LocationManager` + two `SimulatorSource`s; test priority, fallback on stop, all three offline behaviors end-to-end (traces: FR-3, FR-4, NFR-5)
  - Dependencies: 3.1.1
  - Acceptance: full end-to-end scenarios covered; all assertions pass

#### Subphase 3.2: Package & Publish (depends on: 3.1)
- **Task 3.2.1:** Validate dual-package output — `require()` and `import` both resolve; types work in a fresh TS consumer project (traces: FR-10)
  - Dependencies: 3.1.1
  - Acceptance: `npm pack` + install in temp project; both module formats import correctly
- **Task 3.2.2:** `.github/workflows/release.yml` — trigger on `v*` tag push; run `task build`; publish to npm with `NODE_AUTH_TOKEN` (traces: FR-10, FR-11)
  - Dependencies: 3.2.1
  - Acceptance: workflow YAML valid; dry-run mode tested

#### Subphase 3.3: Documentation (depends on: Phase 2)
- **Task 3.3.1:** Add JSDoc to all exported classes, interfaces, methods, and option types (traces: NFR-3)
  - Dependencies: all of Phase 2
  - Acceptance: no public symbol missing JSDoc; IDE hover shows useful docs
- **Task 3.3.2:** Update README Getting Started section to match final API; verify all code examples are correct (traces: NFR-3)
  - Dependencies: 3.3.1
  - Acceptance: examples copy-paste runnable against `dist/`
- **Task 3.3.3:** Populate `CHANGELOG.md` `[0.1.0]` section; reset `[Unreleased]` (traces: FR-11)
  - Dependencies: 3.3.1
  - Acceptance: all v0.1 features listed under Added

---

## Dependency Map

```
1.1 → 1.2 → 1.3
            ↓
     Phase 2 (2.1, 2.2, 2.3, 2.4 — parallel)
            ↓
     Phase 3 (3.1 → 3.2, 3.3)
```

Phase 2 subphases are independent of each other and may be built by separate agents in parallel. Each requires only the Phase 1 foundation.

---

## Testing Strategy

- **Unit tests:** Each module has a co-located test file under `tests/` mirroring `src/`
- **Mocking:** `navigator.geolocation` (browser), `node:dgram` (GDL-90 + NMEA UDP), `node:net` (TCP), `serialport` — all mocked via Vitest `vi.mock`
- **Fixture data:** Pre-built GDL-90 binary frames and NMEA sentence strings in `tests/fixtures/`
- **Coverage:** Vitest v8 provider; 85% lines/branches/functions enforced in `vitest.config.ts` per-file thresholds
- **Integration:** `tests/integration/location-manager.test.ts` uses `SimulatorSource` — no hardware required

---

## Deployment

1. Merge to `main` with conventional commit message (`feat:`, `fix:`, etc.)
2. Update `CHANGELOG.md` `[Unreleased]` → `[x.y.z]` with release date
3. Bump version in `package.json`
4. Push a `vX.Y.Z` tag — GitHub Actions `release.yml` runs `task build` and publishes to npm
5. Create GitHub Release from tag with CHANGELOG excerpt as body

---

*Generated by deft-setup skill (interview strategy, Light path) · 2026-04-13*
