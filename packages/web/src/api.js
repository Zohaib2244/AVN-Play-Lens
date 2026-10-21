// Talks to the local server (same origin, no login).

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// One WebSocket per tab with automatic reconnect. Listeners get every message.
export function connectSocket(onMessage, onOpenChange) {
  let ws = null;
  let closed = false;
  let retry = 500;
  const queue = [];

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 500;
      onOpenChange(true);
      while (queue.length) ws.send(queue.shift());
    };
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch { /* ignore malformed */ }
    };
    ws.onclose = () => {
      onOpenChange(false);
      if (!closed) setTimeout(open, (retry = Math.min(retry * 2, 5000)));
    };
  };
  open();

  return {
    send(msg) {
      const text = JSON.stringify(msg);
      if (ws?.readyState === 1) ws.send(text);
      else queue.push(text);
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}
