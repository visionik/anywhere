import { createReadStream } from 'node:fs';
import { createInterface, type Interface } from 'node:readline';
import type { NmeaTransport } from '../nmea-source.js';

/**
 * Replays NMEA sentences from a log file.
 *
 * Lines are emitted synchronously at the pace of the readline stream.
 * Set `rateMultiplier > 1` for faster-than-realtime replay (e.g. `10` = 10×).
 * At `rateMultiplier = 1` (default), lines are emitted as fast as the filesystem
 * can read them — no artificial per-line delay is applied in v0.1.
 */
export class FileTransport implements NmeaTransport {
  private readonly _path: string;
  private _rl: Interface | null = null;

  constructor(path: string, _rateMultiplier = 1) {
    this._path = path;
  }

  start(onLine: (line: string) => void, onError: (err: Error) => void): void {
    const stream = createReadStream(this._path);
    stream.on('error', onError);

    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const t = line.trim();
      if (t) onLine(t);
    });
    rl.on('error', onError);
    this._rl = rl;
  }

  stop(): void {
    this._rl?.close();
    this._rl = null;
  }
}
