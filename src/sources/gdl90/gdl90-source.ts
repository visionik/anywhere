import { createSocket, type Socket } from 'node:dgram';
import { LocationSource } from '../../location-source.js';
import type { Position } from '../../types/position.js';
import { extractFrames, parseGdl90Message, type Gdl90Message } from './gdl90-parser.js';

/** Options for {@link GDL90Source}. */
export interface GDL90SourceOptions {
  /** UDP port to listen on. Default: `4000`. */
  port?: number;
  /** Network address to bind to. Default: `'0.0.0.0'` (all interfaces). */
  bindAddress?: string;
  /**
   * When `true`, AHRS messages (0x65) are decoded and merged into the next
   * ownship position. Default: `true`.
   */
  enableAHRS?: boolean;
}

/**
 * Location source that receives GDL-90 data over UDP.
 *
 * Compatible with Stratux, uAvionix SkyEcho, Appareo Stratus (open mode),
 * and any other ADS-B receiver that broadcasts GDL-90 on the local network.
 *
 * **Node.js only** — requires `node:dgram`. Not available in browser contexts.
 *
 * @example
 * ```ts
 * const source = new GDL90Source({ port: 4000 });
 * source.onPosition = (pos) => console.log(pos.latitude, pos.longitude);
 * source.start();
 * ```
 */
export class GDL90Source extends LocationSource {
  override readonly sourceId = 'gdl90';

  private readonly _opts: Required<GDL90SourceOptions>;
  private _socket: Socket | null = null;
  /** Cached AHRS data waiting to annotate the next ownship position. */
  private _ahrsCache: Pick<Gdl90Message, 'rollDeg' | 'pitchDeg' | 'headingDeg'> | null = null;

  constructor(options: GDL90SourceOptions = {}) {
    super();
    this._opts = {
      port: options.port ?? 4000,
      bindAddress: options.bindAddress ?? '0.0.0.0',
      enableAHRS: options.enableAHRS ?? true,
    };
  }

  override start(): void {
    const socket = createSocket('udp4');
    this._socket = socket;

    socket.on('error', (err: Error) => {
      this.emitError(err);
    });

    socket.on('message', (datagram: Buffer) => {
      this._handleDatagram(datagram);
    });

    socket.bind(this._opts.port, this._opts.bindAddress, () => {
      // Bound successfully — ready to receive
    });
  }

  override stop(): void {
    if (this._socket !== null) {
      this._socket.close();
      this._socket = null;
    }
    this._ahrsCache = null;
  }

  private _handleDatagram(datagram: Buffer): void {
    for (const payload of extractFrames(datagram)) {
      const msg = parseGdl90Message(payload);
      if (msg === null) continue;
      this._handleMessage(msg);
    }
  }

  private _handleMessage(msg: Gdl90Message): void {
    switch (msg.type) {
      case 'heartbeat':
        this.emitStatus({
          connected: msg.gpsValid ?? false,
          quality: msg.gpsValid ? 1 : 0,
        });
        break;

      case 'ownship':
        if (msg.latitude !== undefined && msg.longitude !== undefined) {
          const pos = this._buildPosition(msg);
          this.emitPosition(pos);
          this._ahrsCache = null; // consume AHRS after applying
        }
        break;

      case 'ahrs':
        if (this._opts.enableAHRS) {
          this._ahrsCache = {
            rollDeg: msg.rollDeg,
            pitchDeg: msg.pitchDeg,
            headingDeg: msg.headingDeg,
          };
        }
        break;

      default:
        // Unknown — ignore
        break;
    }
  }

  private _buildPosition(msg: Gdl90Message): Position {
    const pos: Position = {
      latitude: msg.latitude!,
      longitude: msg.longitude!,
      altitude: msg.altitudeM,
      speed: msg.speedMs,
      heading: msg.heading,
      timestamp: new Date(),
      source: 'gdl90',
    };

    if (this._ahrsCache !== null) {
      pos.roll = this._ahrsCache.rollDeg;
      pos.pitch = this._ahrsCache.pitchDeg;
      // headingDeg is the aircraft's magnetic heading — it does not map to
      // Position.magneticVariation (which is magnetic declination / variation).
      // The ownship track from the GDL-90 report already populates pos.heading.
    }

    return pos;
  }
}
