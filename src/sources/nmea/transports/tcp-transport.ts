import { Socket } from 'node:net';
import type { NmeaTransport } from '../nmea-source.js';

/** Receives NMEA sentences over a TCP connection with automatic reconnect. */
export class TcpTransport implements NmeaTransport {
  private readonly _host: string;
  private readonly _port: number;
  private _socket: Socket | null = null;
  private _stopped = false;

  constructor(host: string, port: number) {
    this._host = host;
    this._port = port;
  }

  start(onLine: (line: string) => void, onError: (err: Error) => void): void {
    this._stopped = false;
    this._connect(onLine, onError);
  }

  stop(): void {
    this._stopped = true;
    this._socket?.destroy();
    this._socket = null;
  }

  private _connect(onLine: (line: string) => void, onError: (err: Error) => void): void {
    if (this._stopped) return;
    const socket = new Socket();
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) { const t = line.trim(); if (t) onLine(t); }
    });
    socket.on('error', (err) => {
      onError(err);
      if (!this._stopped) {
        setTimeout(() => this._connect(onLine, onError), 2000);
      }
    });
    socket.on('close', () => {
      if (!this._stopped) {
        setTimeout(() => this._connect(onLine, onError), 2000);
      }
    });
    socket.connect(this._port, this._host);
    this._socket = socket;
  }
}
