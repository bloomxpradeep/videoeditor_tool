// One WebSocket to the studio server, reconnecting on drop. Re-subscribes to the open job after a reconnect.
import type { ClientMsg, ServerMsg } from '../../server/protocol';

type Listener = (m: ServerMsg) => void;

class Socket {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private queue: ClientMsg[] = [];
  private viewing = '';
  connected = false;
  onConnection?: (up: boolean) => void;

  constructor() {
    this.open();
  }

  private open() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.onConnection?.(true);
      if (this.viewing) ws.send(JSON.stringify({ type: 'subscribe', jobId: this.viewing }));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as ServerMsg;
      this.listeners.forEach((l) => l(m));
    };
    ws.onclose = () => {
      this.connected = false;
      this.onConnection?.(false);
      setTimeout(() => this.open(), 1500);
    };
  }

  send(m: ClientMsg) {
    if (m.type === 'subscribe') this.viewing = m.jobId;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (m.type !== 'subscribe') this.queue.push(m);
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
}

export const socket = new Socket();
