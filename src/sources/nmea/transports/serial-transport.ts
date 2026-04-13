import type { NmeaTransport } from '../nmea-source.js';

/** Receives NMEA sentences from a serial port using the `serialport` package. */
export class SerialTransport implements NmeaTransport {
  private readonly _path: string;
  private readonly _baudRate: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _port: any = null;

  constructor(path: string, baudRate = 4800) {
    this._path = path;
    this._baudRate = baudRate;
  }

  start(onLine: (line: string) => void, onError: (err: Error) => void): void {
    import('serialport')
      .then(({ SerialPort, ReadlineParser }) => {
        const port = new SerialPort({ path: this._path, baudRate: this._baudRate });
        const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
        parser.on('data', (line: string) => {
          const t = line.trim();
          if (t) onLine(t);
        });
        port.on('error', (err: Error) => onError(err));
        this._port = port;
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        onError(new Error(`serialport unavailable: ${msg}. Install it with: npm i serialport`));
      });
  }

  stop(): void {
    this._port?.close();
    this._port = null;
  }
}
