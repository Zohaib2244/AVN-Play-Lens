import { afterEach, expect, it, vi } from "vitest";
import { onlineManager } from "@tanstack/react-query";
import { createQueryClient, resourceKey } from "../src/query";
import { api } from "../src/api";
afterEach(() => {
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});
it("keeps different device/game resources isolated and caches repeated reads", async () => {
  const fetch = vi.fn(
    async (url: string) =>
      new Response(JSON.stringify({ resource: url }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetch);
  const client = createQueryClient();
  const read = (path: string) =>
    client.fetchQuery({
      queryKey: resourceKey(path),
      queryFn: () => api<{ resource: string }>(path),
    });
  expect(await read("devices/one/profile?pkg=com.one.game")).not.toEqual(
    await read("devices/two/profile?pkg=com.two.game"),
  );
  await read("devices/one/profile?pkg=com.one.game");
  expect(fetch).toHaveBeenCalledTimes(2);
  client.clear();
});
it("can query the local server when the browser reports no internet", async () => {
  onlineManager.setOnline(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]")),
  );
  const client = createQueryClient();
  expect(
    await client.fetchQuery({
      queryKey: resourceKey("games"),
      queryFn: () => api("games"),
    }),
  ).toEqual([]);
  client.clear();
});
it("forwards cancellation and preserves actionable API errors", async () => {
  const controller = new AbortController();
  const fetch = vi.fn(
    async (_url: string, _options: RequestInit) =>
      new Response(JSON.stringify({ error: "Phone disconnected" }), {
        status: 409,
      }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    api("devices/one/games", { signal: controller.signal }),
  ).rejects.toThrow("Phone disconnected");
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
});
