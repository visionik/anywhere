import { LocationSource } from '../../location-source.js';
import { parseSentence } from './nmea-parser.js';
import { FixAccumulator } from './fix-accumulator.js';
import { UdpTransport } from './transports/udp-transport.js';
import { TcpTransport } from './transports/tcp-transport.js';
import { SerialTransport } from './transports/serial-transport.js';
import { BluetoothTransport } from './transports/bluetooth-transport.js';
import { FileTransport } from './transports/file-transport.js';

/**
 * Transport interface implemented by all NMEA transports.
 * Inject a custom implementation for testing or exotic hardware.
 */
export interface NmeaTransport {
  /** Begin receiving data; call `onLine` for each complete NMEA sentence. */
  start(onLine: (line: string) => void, onError: (err: Error) => void): void;
  /** Stop receiving data and release resources. */
  stop(): void;
}

/** Options discriminant union for {@link NMEASource}. */
export type NMEASourceOptions =
  | { type: 'udp'; port: number }
  | { type: 'tcp'; host: string; port: number }
  | { type: 'serial'; path: string; baudRate?: number }
  | { type: 'bluetooth'; deviceName?: string }
  | { type: 'file'; path: string; rateMultiplier?: number };

/**
 * Location source that parses NMEA 0183 sentences from a variety of transports.
 *
 * Sentence order per cycle is typically: GGA → GLL → GSA → VTG → RMC.
 * A complete `Position` is emitted when a valid RMC sentence closes an epoch,
 * carrying altitude (GGA), HDOP (GSA), and speed/heading (VTG) from the same cycle.
 *
 * @example
 * ```ts
 * // UDP (e.g. Stratux NMEA forwarding)
 * const source = new NMEASource({ type: 'udp', port: 10110 });
 *
 * // Serial GPS dongle
 * const source = new NMEASource({ type: 'serial', path: '/dev/ttyUSB0', baudRate: 4800 });
 *
 * // File replay
 * const source = new NMEASource({ type: 'file', path: './track.nmea', rateMultiplier: 10 });
 * ```
 */
export class NMEASource extends LocationSource {
  override readonly sourceId = 'nmea';

  private readonly _transport: NmeaTransport;
  private readonly _accumulator = new FixAccumulator();

  /**
   * @param options - Transport selection and configuration.
   * @param transport - Optional transport override (useful for testing).
   */
  constructor(options: NMEASourceOptions, transport?: NmeaTransport) {
    super();
    this._transport = transport ?? NMEASource._createTransport(options);
  }

  override start(): void {
    this._accumulator.reset();
    this._transport.start(
      (line) => this._handleLine(line),
      (err) => this.emitError(err),
    );
  }

  override stop(): void {
    this._transport.stop();
    this._accumulator.reset();
  }

  private _handleLine(line: string): void {
    const result = parseSentence(line);
    if (!result) return;
    const pos = this._accumulator.add(result);
    if (pos) this.emitPosition(pos);
  }

  /* c8 ignore start */
  private static _createTransport(options: NMEASourceOptions): NmeaTransport {
    switch (options.type) {
      case 'udp':       return new UdpTransport(options.port);
      case 'tcp':       return new TcpTransport(options.host, options.port);
      case 'serial':    return new SerialTransport(options.path, options.baudRate);
      case 'bluetooth': return new BluetoothTransport(options.deviceName);
      case 'file':      return new FileTransport(options.path, options.rateMultiplier);
    }
  }
  /* c8 ignore stop */
}
