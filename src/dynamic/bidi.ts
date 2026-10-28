// A small WebDriver BiDi client. Firefox exposes this protocol directly;
// no separate driver or browser download is required.
export class BidiClient {
  private nextId = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  onEvent: (method: string, params: any) => void = () => {};

  private constructor(private socket: WebSocket) {
    socket.addEventListener('message', event => {
      let message: any;
      try { message = JSON.parse(String(event.data)); } catch { this.fail(new Error('Invalid JSON from Firefox BiDi')); return; }
      if (message.type === 'event') { this.onEvent(message.method, message.params); return; }
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      if (message.type === 'error') request.reject(new Error(`${message.error}: ${message.message}`));
      else request.resolve(message.result);
    });
    socket.addEventListener('close', () => this.fail(new Error('Firefox BiDi connection closed')));
    socket.addEventListener('error', () => this.fail(new Error('Firefox BiDi connection failed')));
  }

  static async connect(url: string): Promise<BidiClient> {
    if (typeof WebSocket === 'undefined') throw new Error('Dynamic observation requires Node.js 22 or newer');
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('Firefox BiDi connection timed out')); }, 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to Firefox BiDi')); }, { once: true });
    });
    return new BidiClient(socket);
  }

  command(method: string, params: Record<string, unknown> = {}, timeout = 15000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) { reject(new Error('Firefox BiDi is not connected')); return; }
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  private fail(error: Error): void {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }

  close(): void { this.fail(new Error('Observation ended')); this.socket.close(); }
}
