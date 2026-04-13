import { createSocket, type Socket } from 'node:dgram';
import type { NmeaTransport } from '../nmea-source.js';

/** Receives NMEA sentences over UDP. */
export class UdpTransport implements NmeaTransport {
  private readonly _port: number;
  private _socket: Socket | null = null;

  constructor(port: number) {
    this._port = port;
  }

  start(onLine: (line: string) => void, onError: (err: Error) => void): void {
    const socket = createSocket('udp4');
    let buf = '';
    socket.on('message', (msg) => {
      buf += msg.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (t) onLine(t);
      }
    });
    socket.on('error', onError);
    socket.bind(this._port);
    this._socket = socket;
  }

  stop(): void {
    this._socket?.close();
    this._socket = null;
  }
}
