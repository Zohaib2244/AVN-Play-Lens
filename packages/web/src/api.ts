import type { Command, ServerMessage } from "./types";

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Same-origin requests keep the local executable and offline use self-contained.
export async function api<T = void>(
  path: string,
  {
    method = "GET",
    body,
    signal,
  }: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method,
    signal,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : `Request failed (${res.status})`,
    );
  return data as T;
}

export function connectSocket(
  onMessage: (message: ServerMessage) => void,
  onOpenChange: (open: boolean) => void,
) {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queue: string[] = [];
  const open = () => {
    if (closed) return;
    const next = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
    );
    ws = next;
    next.onopen = () => {
      if (closed) {
        next.close();
        return;
      }
      retry = 500;
      onOpenChange(true);
      while (queue.length) next.send(queue.shift()!);
    };
    next.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      // Do not swallow bugs in application subscribers as malformed network data.
      onMessage(message);
    };
    next.onclose = () => {
      if (closed) return;
      onOpenChange(false);
      timer = setTimeout(open, (retry = Math.min(retry * 2, 5000)));
    };
  };
  open();
  return {
    send(message: Command) {
      const text = JSON.stringify(message);
      if (ws?.readyState === WebSocket.OPEN) ws.send(text);
      else queue.push(text);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      queue.length = 0;
      ws?.close();
    },
  };
}
