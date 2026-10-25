import { expect, test, type Page } from "@playwright/test";

async function richCapture(page: Page) {
  // Test-only WebSocket fixtures keep screenshots deterministic and user data untouched.
  await page.routeWebSocket("**/ws", (socket) => {
    const server = socket.connectToServer();
    server.onMessage((data) => {
      const message = JSON.parse(String(data));
      if (message.type === "monitor" && message.health) {
        const ts = Date.now();
        message.health.startup = message.health.startup.map((step: object) => ({
          ...step,
          status: "done",
          at: 1000,
        }));
        message.health.sdks = message.health.sdks.map((card: object) => ({
          ...card,
          state: "Initialized",
        }));
        message.health.maxConfig = { country: "PK" };
        message.health.adapterSummary = { ok: 2, total: 11 };
        message.health.rc = {
          fetch: { lastFetchStatus: "Success", ts },
          sources: { MissingKey: "RemoteValue" },
          values: [
            {
              name: "AdConfig",
              declaredType: "Json",
              hasValue: true,
              value: {
                InterAdDelay: 30,
                Rewarded: true,
                InterstitialSlots: ["slot-one", "slot-two"],
              },
              source: "RemoteValue",
              ts,
            },
            {
              name: "GameEconomyConfig",
              declaredType: "Json",
              hasValue: true,
              value: "",
              source: "StaticValue",
              ts,
            },
            {
              name: "AppTheme",
              declaredType: "String",
              hasValue: true,
              value: "moss",
              source: "DefaultValue",
              ts,
            },
          ],
        };
        message.firebase = {
          debug: { on: true },
          receiving: true,
          counts: { firebase: 2, sent: 3, notLogged: 1, pending: 1 },
          rows: [
            {
              id: "recorded",
              ts,
              sdk: "FA",
              check: "matches-plugin",
              name: "LEVEL_ANALYSIS",
              params: {
                LEVEL_NUMBER: 26,
                STATE: "Started",
                ATTEMPT: 1,
                TIME: 62,
                TOTAL_TILES: 376,
                SOURCE: "Launch",
                PROGRESS_PCT: 14,
                PLAYER_ID: "test-player-with-a-long-identifier",
              },
            },
            {
              id: "automatic",
              ts: ts - 1000,
              sdk: "FA",
              check: "automatic",
              name: "session_start",
              auto: true,
              params: {},
            },
            {
              id: "unconfirmed",
              ts: ts - 2000,
              sdk: "FA",
              check: "sent-before-init",
              name: "POWERUP_CONSUMED",
              missing: true,
              params: {},
            },
            {
              id: "dropped",
              ts: ts - 3000,
              sdk: "FA",
              check: "dropped-by-plugin",
              name: "INTER_SHOW_MODE",
              missing: true,
              params: {},
            },
          ],
        };
      }
      socket.send(JSON.stringify(message));
    });
  });
}
async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scroll = document.querySelector(".pl-scroll")!;
        return (
          scroll.scrollWidth <= scroll.clientWidth + 1 &&
          document.documentElement.scrollWidth <= innerWidth
        );
      }),
    )
    .toBe(true);
}

test("completed startup fills every connector and SDK cards omit redundant details", async ({
  page,
}, info) => {
  await richCapture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?view=health&game=com.avn.demo");
  await expect(page.locator(".pl-pipeline .ts")).toHaveCount(8);
  await expect(
    page.locator('.pl-pipeline-connector[data-complete="true"]'),
  ).toHaveCount(7);
  const colors = await page.locator(".pl-pipeline").evaluate((root) => {
    const icon = getComputedStyle(root.querySelector(".ts i")!).backgroundColor;
    return [...root.querySelectorAll(".pl-pipeline-connector")].every(
      (line) => getComputedStyle(line).backgroundColor === icon,
    );
  });
  expect(colors).toBe(true);
  await expect(page.locator(".sdk")).not.toContainText(["Probe handed to SDK"]);
  expect(await page.locator(".sdk").allTextContents()).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(/Probe handed|Used for App Open|of 11 adapters|PK/),
    ]),
  );
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Startup-complete.png"),
    animations: "disabled",
  });
});

test("events show readable parameter chips and distinguish recorded, unconfirmed and not sent", async ({
  page,
}, info) => {
  await richCapture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?view=firebase&game=com.avn.demo");
  const event = page.getByRole("article", {
    name: "LEVEL_ANALYSIS",
    exact: true,
  });
  await expect(event).toContainText("Recorded by Firebase");
  await expect(
    page.getByRole("article", { name: "session_start", exact: true }),
  ).toContainText("Recorded by Firebase");
  await expect(
    page.getByRole("article", { name: "POWERUP_CONSUMED", exact: true }),
  ).toContainText("Not confirmed");
  await expect(
    page.getByRole("article", { name: "INTER_SHOW_MODE", exact: true }),
  ).toContainText("Not sent");
  await event.getByRole("button", { name: "Show all 8 parameters" }).click();
  await expect(event.locator(".pl-parameter-chip")).toHaveCount(8);
  expect(
    await event
      .locator(".pl-parameter-value")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(13);
  await expect(page.getByText(/Server arrival is checked/)).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Events-readable.png"),
    animations: "disabled",
  });
  await event.getByRole("button", { name: "Inspect LEVEL_ANALYSIS" }).click();
  await expect(
    page.getByRole("dialog", { name: "LEVEL_ANALYSIS", exact: true }),
  ).toContainText("Firebase logged this event on this device");
  await page.keyboard.press("Escape");
});

test("config exposes missing fallbacks and opens full-width fields with a broad button", async ({
  page,
}, info) => {
  await richCapture(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?view=remote-config&game=com.avn.demo");
  const config = page
    .locator(".pl-config-table tbody tr")
    .filter({ hasText: "AdConfig" })
    .first();
  await expect(config).toBeVisible();
  const expand = config.getByRole("button", { name: "Show 3 fields" });
  expect((await expand.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expand.click();
  const fields = page.getByRole("region", { name: "AdConfig fields" });
  await expect(fields).toContainText("InterAdDelay");
  await expect(fields).toContainText("30");
  await fields
    .locator("summary")
    .filter({ hasText: "InterstitialSlots" })
    .click();
  await expect(fields).toContainText("slot-one");
  await page.waitForTimeout(1100);
  await expect(fields.locator("details")).toHaveAttribute("open", "");
  const missing = page
    .locator(".pl-config-table tbody tr")
    .filter({ hasText: "GameEconomyConfig" });
  await expect(missing).toContainText("Missing value");
  await expect(missing).toContainText("Not configured");
  await expect(
    page.locator(".pl-config-table tbody tr").filter({ hasText: "MissingKey" }),
  ).toContainText("Value error");
  await expect(
    page.locator(".pl-config-table tbody tr").filter({ hasText: "AppTheme" }),
  ).toContainText("App default");
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Config-structured.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", {
    name: "Search pages, games and actions",
  });
  await search.fill("Plugin health");
  const option = page.getByRole("option", {
    name: "Plugin health",
    exact: true,
  });
  await expect(option).toBeVisible();
  await expect(option).not.toContainText("Choose a game");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("listbox", { name: "Action parameters" }),
  ).not.toContainText("current game");
  await expect(
    page.getByRole("option", { name: /PlayLens Demo/ }).locator(".game-icon"),
  ).toBeVisible();
  const options = await page
    .getByRole("listbox", { name: "Action parameters" })
    .getByRole("option")
    .all();
  const bounds = await Promise.all(options.map((item) => item.boundingBox()));
  expect(bounds[0]!.height).toBeGreaterThanOrEqual(64);
  if (bounds[1])
    expect(bounds[1].y).toBeGreaterThanOrEqual(
      bounds[0]!.y + bounds[0]!.height,
    );
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Commands-spaced.png"),
    animations: "disabled",
  });
});
