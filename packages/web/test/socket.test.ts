// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { connectSocket } from "../src/api";
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeSocket.instances = [];
});
it("queues commands once, reconnects, and cancels reconnect on unmount", () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  const onMessage = vi.fn(),
    online = vi.fn();
  const socket = connectSocket(onMessage, online);
  socket.send({ type: "stream.start", pkg: "com.test.game", streamId: 1 });
  const first = FakeSocket.instances[0];
  first.open();
  expect(first.sent.map((s) => JSON.parse(s))).toEqual([
    { type: "stream.start", pkg: "com.test.game", streamId: 1 },
  ]);
  first.onmessage?.({ data: "malformed" });
  expect(onMessage).not.toHaveBeenCalled();
  first.close();
  vi.advanceTimersByTime(1000);
  expect(FakeSocket.instances).toHaveLength(2);
  const second = FakeSocket.instances[1];
  second.open();
  expect(second.sent).toEqual([]);
  second.close();
  socket.close();
  vi.runAllTimers();
  expect(FakeSocket.instances).toHaveLength(2);
});
