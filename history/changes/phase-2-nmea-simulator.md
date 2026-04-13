# Change: phase-2-nmea-simulator

**Status:** approved
**Date:** 2026-04-13

## Scope

Implements SPECIFICATION tasks 2.3 (NMEASource — all transports) and 2.4 (SimulatorSource).

## Files

- `src/sources/nmea/nmea-parser.ts`
- `src/sources/nmea/fix-accumulator.ts`
- `src/sources/nmea/sentences/{rmc,gga,vtg,gsa,gll}.ts`
- `src/sources/nmea/transports/{udp,tcp,serial,bluetooth,file}-transport.ts`
- `src/sources/nmea/nmea-source.ts`
- `src/sources/simulator/simulator-source.ts`
- `src/index.ts` (updated)
- `tests/sources/nmea/sentences.test.ts`
- `tests/sources/nmea/fix-accumulator.test.ts`
- `tests/sources/nmea/nmea-source.test.ts`
- `tests/sources/simulator/simulator-source.test.ts`
