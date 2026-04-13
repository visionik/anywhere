import type { NmeaTransport } from '../nmea-source.js';

/**
 * Receives NMEA sentences over Bluetooth (serial-over-BT / SPP).
 *
 * **Platform notes:**
 * - On macOS/Linux, pair the device and use the resulting `/dev/tty.*` path
 *   with `SerialTransport` instead.
 * - On Windows, the paired device exposes a COM port — use `SerialTransport`.
 * - This transport attempts to use `@serialport/binding-mock` or the `bluetooth-serial-port`
 *   npm package when available. Falls back gracefully with a clear error message.
 *
 * For most use-cases, prefer `SerialTransport` with the Bluetooth serial port path.
 */
export class BluetoothTransport implements NmeaTransport {
  private readonly _deviceName: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _conn: any = null;

  constructor(deviceName?: string) {
    this._deviceName = deviceName;
  }

  start(onLine: (line: string) => void, onError: (err: Error) => void): void {
    // @ts-expect-error bluetooth-serial-port is an optional dep with no type declarations
    import('bluetooth-serial-port')
      .then(({ BluetoothSerialPort }) => {
        const bt = new BluetoothSerialPort();
        bt.on('data', (buffer: Buffer) => {
          const lines = buffer.toString().split('\n');
          for (const line of lines) {
            const t = line.trim();
            if (t) onLine(t);
          }
        });
        bt.on('closed', () => onError(new Error('Bluetooth connection closed')));
        if (this._deviceName) {
          bt.inquire();
          bt.on('found', (address: string, name: string) => {
            if (name === this._deviceName) {
              bt.findSerialPortChannel(address, (channel: number) => {
                bt.connect(
                  address,
                  channel,
                  () => {
                    /* connected */
                  },
                  () => {
                    onError(new Error(`Bluetooth connect failed to ${name}`));
                  },
                );
              });
            }
          });
        }
        this._conn = bt;
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        onError(
          new Error(
            `bluetooth-serial-port unavailable: ${msg}. ` +
              `On most platforms, pair the device first and use SerialTransport with the resulting /dev/tty.* path.`,
          ),
        );
      });
  }

  stop(): void {
    this._conn?.close();
    this._conn = null;
  }
}
