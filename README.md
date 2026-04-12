# Anywhere — Unified Location Library

**Get reliable position data from any source** — device GPS, NMEA 0183, GDL-90, and more.

`@visionik/anywhere` (or `libanywhere`) is a lightweight TypeScript library that normalizes GPS/location data from multiple heterogeneous sources into a single, consistent `Position` interface. It supports automatic prioritization, fallback, and easy extension for new sources.

Perfect for aviation apps (EFBs, Stratux, ForeFlight-style), drone software, marine navigation, or any project needing robust location from hardware or OS APIs.

## Core Concepts

### Position Interface
All sources emit the same normalized data:

```ts
export interface Position {
  latitude: number;           // decimal degrees, WGS84
  longitude: number;          // decimal degrees, WGS84
  altitude?: number;          // meters (MSL or geometric)
  speed?: number;             // meters per second (or knots via helper)
  heading?: number;           // degrees true (0-360)
  timestamp: Date;            // UTC time of the fix
  accuracy?: number;          // horizontal accuracy in meters
  verticalAccuracy?: number;  // vertical accuracy in meters
  source: 'device' | 'nmea' | 'gdl90' | 'simulator' | string;
  satellites?: number;        // number of satellites in fix
  hdop?: number;              // horizontal dilution of precision
  fixType?: 'none' | '2d' | '3d' | 'dgps' | 'rtk' | string;
  // Optional extensions
  roll?: number;              // degrees (from AHRS)
  pitch?: number;
  magneticVariation?: number;
}
LocationSource Abstraction
Every provider implements this base class:
TypeScriptabstract class LocationSource {
  abstract start(): void;
  abstract stop(): void;

  onPosition?: (position: Position) => void;
  onError?: (error: Error) => void;
  onStatus?: (status: { connected: boolean; quality: number }) => void;

  protected emitPosition(pos: Position) {
    this.onPosition?.(pos);
  }
}
LocationManager (Main API)
The central class that manages multiple sources with priority and fusion:
TypeScriptconst manager = new LocationManager({
  sources: [
    new DeviceLocationSource({ enableHighAccuracy: true }),
    new GDL90Source({ port: 4000 }),
    new NMEASource({ type: 'udp', port: 10110 }),   // or serial
  ],
  priorityOrder: ['device', 'gdl90', 'nmea'],   // higher = preferred
  minUpdateIntervalMs: 200,
});

manager.on('position', (pos) => {
  console.log(`Position from ${pos.source}: ${pos.latitude}, ${pos.longitude}`);
});

manager.start();
First Implementation Providers
1. Device Location Source (iOS / macOS / Android / Windows / Linux / Browser)
Supported Platforms:

Browser / Web: navigator.geolocation (W3C Geolocation API)
iOS & macOS: Via Capacitor, React Native, or Electron + native bridge (CoreLocation)
Android: Via Capacitor or native fused location provider
Desktop (Electron / Tauri): Use Node.js bindings or electron + OS APIs (macOS: CoreLocation, Windows: Geolocator, Linux: GeoClue)

Features:

High-accuracy mode with speed, heading, and altitude when available
Continuous watching (watchPosition) or one-shot (getCurrentPosition)
Automatic fallback when accuracy degrades

Usage Example:
TypeScriptimport { DeviceLocationSource } from 'libanywhere';

const deviceSource = new DeviceLocationSource({
  enableHighAccuracy: true,
  timeoutMs: 10000,
  maximumAgeMs: 0,
});
2. NMEA 0183 Source
Transport Options:

Serial (USB/RS-232 via WebSerial or Node serialport)
UDP / TCP (common for bridged receivers)
Bluetooth (via platform APIs)
File replay (for testing)

Key Sentences Parsed:

RMC — Recommended Minimum Specific GPS Data (position, speed, course, time, status)
GGA — Global Positioning System Fix Data (position, altitude, fix quality, satellites)
VTG — Track made good and ground speed
GSA — GPS DOP and active satellites (HDOP, fix type)
GLL — Geographic position (lat/lon)

Features:

Robust sentence parsing with checksum validation
Automatic talker ID handling (GP, GN, GL, etc.)
Reassembly of multi-sentence updates into one Position

Usage Example:
TypeScriptconst nmeaSource = new NMEASource({
  type: 'serial',
  path: '/dev/ttyUSB0',   // or UDP port, etc.
  baudRate: 4800,
});
3. GDL-90 Source
Protocol Overview:

Binary UDP protocol (default port 4000)
Used by Stratux, uAvionix skyAlert/SkyEcho, Appareo Stratus (Open Mode), and many DIY ADS-B receivers
Includes ownship GPS position, traffic reports, FIS-B weather, and AHRS extensions

Key Messages Supported (initial implementation):

0x00 — Heartbeat (GPS validity, status flags, timestamp)
0x0B — Ownship Report (primary ownship position, altitude, velocity)
0x65 — ForeFlight AHRS extension (roll, pitch, heading, yaw rate)
Basic framing (0x7E), byte unstuffing, and CRC validation

Features:

UDP listener with optional unicast support
Automatic discovery (listens for ForeFlight-style broadcasts)
Integration of geometric altitude and pressure altitude when available

Usage Example:
TypeScriptconst gdl90Source = new GDL90Source({
  port: 4000,
  bindAddress: '0.0.0.0',
  enableAHRS: true,
});
Priority & Fusion Strategy (Planned)

Highest-priority source with valid fix → used immediately
If primary degrades (low accuracy, lost fix), seamless fallback to next source
Optional simple fusion (e.g., average position when multiple high-quality sources agree)
Configurable hysteresis to avoid rapid switching

Getting Started
Bashnpm install @visionik/anywhere   # or libanywhere
TypeScriptimport { LocationManager, DeviceLocationSource, GDL90Source, NMEASource } from 'libanywhere';

const manager = new LocationManager();
manager.addSource(new DeviceLocationSource());
manager.addSource(new GDL90Source());
manager.addSource(new NMEASource({ type: 'udp', port: 10110 }));

manager.start();
Roadmap (v0.1 → v1.0)

 Core Position and LocationSource types
 Device Geolocation
 NMEA 0183 parser (RMC/GGA/VTG/GSA)
 GDL-90 UDP parser (Heartbeat + Ownship + AHRS)
 Serial/Bluetooth transport helpers
 Priority manager + fusion
 Comprehensive tests + simulators
 React/Vue hooks and example EFB dashboard

License
MIT

Made for pilots, builders, and developers who just want to know "where" — from anywhere.
Feedback, contributions, and Stratux/GDL-90 test reports are welcome!
