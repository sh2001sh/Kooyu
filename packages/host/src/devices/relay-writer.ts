/** Each media entry is a complete HTTP frame response. Evicting it cannot truncate JSON. */
export class RelayWriter {
  private readonly control: Buffer<ArrayBuffer>[] = [];
  private readonly media: { packets: Buffer<ArrayBuffer>[]; dropped: () => void }[] = [];
  private bytes = 0;
  private timer?: NodeJS.Timeout;
  private closed = false;

  constructor(
    private readonly socket: {
      readonly bufferedAmount: number;
      send(packet: Buffer<ArrayBuffer>): void;
    },
  ) {}

  reliable(packet: Buffer<ArrayBuffer>) {
    if (this.closed) return false;
    this.control.push(packet);
    this.bytes += packet.length;
    this.flush();
    return true;
  }

  get congested() {
    return this.bytes + this.socket.bufferedAmount >= 512 * 1024;
  }

  picture(packets: Buffer<ArrayBuffer>[], dropped: () => void) {
    if (this.closed) return;
    if (this.media.length >= 2) this.media.shift()!.dropped();
    this.media.push({ packets, dropped });
    this.flush();
  }

  private flush() {
    while (!this.closed && this.socket.bufferedAmount < 256 * 1024) {
      const packet = this.control.shift();
      if (packet) {
        this.bytes -= packet.length;
        this.socket.send(packet);
        continue;
      }
      const picture = this.media.shift();
      if (!picture) return;
      for (const part of picture.packets) this.socket.send(part);
    }
    if (!this.closed && !this.timer && (this.control.length || this.media.length)) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.flush();
      }, 10);
      this.timer.unref();
    }
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.control.length = this.media.length = this.bytes = 0;
  }
}
