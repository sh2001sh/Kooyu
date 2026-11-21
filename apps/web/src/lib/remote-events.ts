import { api, apiPath } from "./host-client";

// The gateway forwards the Host event stream as bounded binary WebSocket messages.
export class RemoteEvents extends EventTarget {
  onopen?: () => void;
  onerror?: () => void;
  onmessage?: (event: MessageEvent<string>) => void;
  private closed = false;
  private socket?: WebSocket;

  constructor(after: number) {
    super();
    void api<{ ticket: string }>("/ws-ticket", "POST", { after })
      .then(({ ticket }) => {
        if (this.closed) return;
        const url = new URL(apiPath("/events/ws"), location.origin);
        url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(url, ["kooyu.events.v1", "kooyu.ticket." + ticket]);
        this.socket = socket;
        socket.binaryType = "arraybuffer";
        const decoder = new TextDecoder();
        let buffer = "";
        socket.onopen = () => this.onopen?.();
        socket.onclose = () => {
          if (!this.closed) this.onerror?.();
        };
        socket.onmessage = ({ data }) => {
          buffer += decoder.decode(data, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const lines = buffer.slice(0, boundary).split("\n");
            buffer = buffer.slice(boundary + 2);
            const type = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "message";
            const body = lines
              .filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6))
              .join("\n");
            if (!body) continue;
            const event = new MessageEvent(type, { data: body });
            if (type === "message") this.onmessage?.(event);
            else this.dispatchEvent(event);
          }
          if (buffer.length > 4 * 1024 * 1024) socket.close(1009, "Event too large");
        };
      })
      .catch(() => {
        if (!this.closed) this.onerror?.();
      });
  }

  close() {
    this.closed = true;
    this.socket?.close();
  }
}
