import { expect, test, type Page } from "@playwright/test";

async function command(page: Page, query: string) {
  await page.keyboard.press("Control+k");
  await page
    .getByRole("combobox", { name: "Search pages, games and actions" })
    .fill(query);
  await page.keyboard.press("Enter");
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

test("commands select game parameters from any page, control capture, and preserve scope", async ({
  page,
}, info) => {
  const errors: string[] = [];
  let captureStarts = 0;
  page.on("websocket", (socket) =>
    socket.on("framesent", ({ payload }) => {
      try {
        if (JSON.parse(String(payload)).type === "stream.start")
          captureStarts++;
      } catch {
        /* Not an app message. */
      }
    }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await command(page, "Events");
  const options = page.getByRole("listbox", { name: "Action parameters" });
  await expect(
    options.getByRole("option", { name: /PlayLens Demo/ }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("Command-game-parameter.png"),
    animations: "disabled",
  });
  await page.getByRole("combobox").fill("Puzzle Garden");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/view=firebase.*game=com.studio.puzzlegarden/);
  await expect(
    page.getByRole("heading", { name: "This game is not installed." }),
  ).toBeVisible();
  await command(page, "Events");
  await page.getByRole("combobox").fill("PlayLens Demo");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Receiving events", { exact: true }),
  ).toBeVisible();
  await command(page, "Stop capture session");
  await expect(page.locator(".game-bar .status-chip")).toContainText("Stopped");
  await command(page, "Resume capture");
  await expect(
    page.getByRole("heading", { name: "Events", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Receiving events", { exact: true }),
  ).toBeVisible();
  await command(page, "Game library");
  await expect(
    page.getByRole("heading", { name: "Your games", exact: true }),
  ).toBeVisible();
  const previousStarts = captureStarts;
  await command(page, "Start a new capture session");
  await page.getByRole("combobox").fill("PlayLens Demo");
  await page.keyboard.press("Enter");
  await expect.poll(() => captureStarts).toBeGreaterThan(previousStarts);
  await command(page, "logs");
  await page.getByRole("combobox").fill("PlayLens Demo");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Logs", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main select[aria-label='Game']")).toHaveCount(0);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test("overview, config expansion, event dictionary, setup completion and appearance render", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?view=logs&game=com.avn.demo");
  await expect(
    page.locator(".game-bar").getByText("PlayLens Demo", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".game-bar")).toBeVisible();
  await expect(page.locator(".game-bar .status-chip")).toBeVisible();
  await expect(page.locator(".pl-overview .tiles")).toHaveCount(0);
  await expect(
    page
      .locator(".side")
      .getByRole("button", { name: /Saved sessions|Game sessions/ }),
  ).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Overview-status-first.png"),
    animations: "disabled",
  });
  await page.goto("/?view=remote-config&game=com.avn.demo");
  const toggle = page
    .getByRole("button", { name: /Show [0-9]+ fields/ })
    .first();
  await expect(toggle).toBeVisible();
  await toggle.click();
  const inspector = page.getByRole("region", { name: "AdConfig fields" });
  await expect(inspector).toBeVisible();
  await inspector.evaluate((element) => {
    (window as unknown as { inspectedConfig: Element }).inspectedConfig =
      element;
  });
  await page.waitForTimeout(1200);
  expect(
    await inspector.evaluate(
      (element) =>
        element ===
        (window as unknown as { inspectedConfig: Element }).inspectedConfig,
    ),
  ).toBe(true);
  await expect(inspector).toContainText("InterAdDelay");
  await expect(page.locator(".pl-config-expandable").first()).toContainText(
    /Json|JSON/,
  );
  await expect(
    page.locator(".verification-table td").getByText("fetch", { exact: true }),
  ).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Remote-config-expanded.png"),
    animations: "disabled",
  });
  await page.goto("/?view=firebase&game=com.avn.demo&eventView=dictionary");
  await page.getByRole("button", { name: /^Event dictionary/ }).click();
  await expect(page.locator(".event-stats")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Last seen" }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Avg/ })).toHaveCount(0);
  await expect(
    page.locator("main").getByText("FA", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View events", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("SDK and upload diagnostics")).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Firebase-dictionary.png"),
    animations: "disabled",
  });
  await page.goto("/?view=firebase-setup&game=com.avn.demo");
  await page.getByRole("button", { name: "Next: restart game" }).click();
  await page.getByRole("button", { name: "Next: listen for events" }).click();
  await expect(page.getByText("Setup complete", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Done — open Events" }),
  ).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Firebase-setup-complete.png"),
    animations: "disabled",
  });
  await command(page, "Appearance and density");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByLabel("Palette", { exact: true }).selectOption("moss");
  await expect(
    page.getByText("Compact fits more rows", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("Appearance-light-moss.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.goto("/?view=logs&game=com.avn.demo");
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Overview-light-moss.png"),
    animations: "disabled",
  });
});

test("large game icons resize, editing stays focused, and notifications use a dropdown", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?view=logs&game=com.avn.demo");
  await page.getByRole("button", { name: "Game", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit name & icon" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit game", exact: true });
  const name = dialog.getByRole("textbox", { name: "Game name" });
  await name.fill("PlayLens Demo edited");
  await page.waitForTimeout(1100);
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("PlayLens Demo edited");
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 768;
    const context = canvas.getContext("2d")!;
    const pixels = context.createImageData(768, 768);
    crypto.getRandomValues(pixels.data.subarray(0, 65536));
    for (let offset = 65536; offset < pixels.data.length; offset += 65536)
      crypto.getRandomValues(
        pixels.data.subarray(
          offset,
          Math.min(offset + 65536, pixels.data.length),
        ),
      );
    for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const buffer = Buffer.from(image, "base64");
  expect(buffer.length).toBeGreaterThan(250 * 1024);
  await dialog
    .getByLabel("Game icon", { exact: true })
    .setInputFiles({ name: "large-icon.png", mimeType: "image/png", buffer });
  await expect(
    dialog.getByRole("button", { name: "Save game", exact: true }),
  ).toBeEnabled();
  const icon = await dialog.locator(".game-icon img").getAttribute("src");
  expect(icon!.length).toBeLessThan(340001);
  await page.screenshot({
    path: info.outputPath("Game-editor-large-icon.png"),
    animations: "disabled",
  });
  // Cancel avoids changing even the isolated shared fixture library.
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  // Refresh failures produce a deterministic notification without altering capture evidence.
  await page.route("**/api/games", (route) =>
    route.fulfill({ status: 500, json: { error: "Fixture refresh error" } }),
  );
  await page
    .getByRole("button", {
      name: "Refresh game library and installed versions",
    })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not refresh" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const notifications = page.locator(".pl-notifications");
  await expect(notifications).toBeVisible();
  await expect(notifications.locator(".note-i")).toHaveCount(1);
  const bell = await page
    .getByRole("button", { name: /^Notifications/ })
    .boundingBox();
  const panel = await notifications.boundingBox();
  expect(panel!.y).toBeGreaterThan(bell!.y);
  expect(panel!.width).toBeLessThanOrEqual(380);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Notifications-dropdown.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(notifications).toHaveCount(0);
});

test("real phone replaces simulator and auto-reconnect changes independently of connection", async ({
  page,
}, info) => {
  const phone = {
    serial: "PHONE",
    state: "device",
    transport: "wifi",
    info: { model: "QA phone" },
  };
  const demo = {
    serial: "replay",
    state: "device",
    replay: true,
    info: { model: "Replay device" },
  };
  let push: ((devices: unknown[]) => void) | undefined;
  await page.routeWebSocket("**/ws", (socket) => {
    const server = socket.connectToServer();
    push = (devices) =>
      socket.send(JSON.stringify({ type: "devices", devices }));
    server.onMessage((data) => socket.send(data));
  });
  let reconnect = true;
  let releasePreference: (() => void) | undefined;
  let holdPreference = true;
  const requests: string[] = [];
  await page.route("**/api/devices/saved**", async (route) => {
    requests.push(route.request().method());
    if (route.request().method() === "PATCH") {
      if (holdPreference)
        await new Promise<void>((resolve) => {
          releasePreference = resolve;
        });
      reconnect = route.request().postDataJSON().autoReconnect;
      await route.fulfill({ json: { ok: true } });
    } else
      await route.fulfill({
        json: [
          {
            id: "PHONE",
            address: "PHONE",
            label: "QA phone",
            autoReconnect: reconnect,
          },
        ],
      });
  });
  await page.route("**/api/devices/PHONE/**", (route) =>
    route.fulfill({
      json: route.request().url().includes("/games")
        ? []
        : { packages: [], foreground: null },
    }),
  );
  await page.goto("/?view=devices");
  await expect(
    page.getByText("Currently active", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => !!push).toBe(true);
  push!([demo, phone]);
  const active = page.locator(".pl-device-active");
  await expect(active).toContainText("QA phone");
  const toggle = active.getByRole("switch", {
    name: "Auto-reconnect QA phone",
  });
  await expect(toggle).toBeChecked();
  await toggle.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page
        .locator(".pl-page")
        .evaluate(
          (root) =>
            root
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === "running").length,
        ),
    )
    .toBe(0);
  const cardBefore = await active.boundingBox();
  const disconnect = active.getByRole("button", {
    name: "Disconnect",
    exact: true,
  });
  const buttonBefore = await disconnect.boundingBox();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await expect(active.getByRole("status")).toHaveText(/Saving/);
  await expect(disconnect).toHaveText("Disconnect");
  const cardDuring = await active.boundingBox();
  const buttonDuring = await disconnect.boundingBox();
  expect(cardDuring!.height).toBe(cardBefore!.height);
  expect(buttonDuring).toEqual(buttonBefore);
  await expect.poll(() => !!releasePreference).toBe(true);
  holdPreference = false;
  releasePreference!();
  await expect(toggle).toBeEnabled();
  await expect(
    active.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeEnabled();
  expect(requests).toContain("PATCH");
  await expect(
    page.getByRole("button", { name: "Use this device", exact: true }),
  ).toBeDisabled();
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("Devices-active-phone.png"),
    animations: "disabled",
  });
  await command(page, "Toggle auto-reconnect");
  await page.getByRole("combobox").fill("QA phone");
  await page.keyboard.press("Enter");
  await expect.poll(() => reconnect).toBe(true);
  await expect(toggle).toBeChecked();
});
