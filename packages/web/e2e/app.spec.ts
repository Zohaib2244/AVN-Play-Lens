import { test, expect, type Page } from "@playwright/test";
const sidebarPage = (page: Page, name: string) =>
  page.locator(".side").getByRole("button", { name: new RegExp(`^${name}`) });
async function navigate(page: Page, name: string) {
  if (await sidebarPage(page, name).isVisible()) {
    await sidebarPage(page, name).click();
    return;
  }
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  const direct = nav.getByRole("button", { name, exact: true });
  if (await direct.count()) {
    await direct.click();
    return;
  }
  await nav.getByRole("button", { name: "More", exact: true }).click();
  await page
    .getByRole("dialog", { name: "More pages", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}
async function openGame(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open PlayLens Demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "PlayLens Demo", exact: true }),
  ).toBeVisible();
}
async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector(".pl-scroll")!;
        return (
          el.scrollWidth <= el.clientWidth + 1 &&
          document.documentElement.scrollWidth <= innerWidth
        );
      }),
    )
    .toBe(true);
}

test("library and every workspace page preserve the AVN layouts", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Device connection", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".pl-library .kpis")).toHaveCount(0);
  await noOverflow(page);
  await page
    .getByRole("button", { name: "Open PlayLens Demo", exact: true })
    .click();
  for (const name of [
    "Logs",
    "Performance",
    "Plugin health",
    "Firebase events",
    "Remote Config",
    "Checklist",
    "Level Snapshooter",
  ]) {
    await navigate(page, name);
    await expect(
      page.locator("main").getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    if (name === "Performance") {
      await expect(page.locator(".uplot").first()).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator(".uplot canvas")
            .first()
            .evaluate((canvas) => {
              const pixels = (canvas as HTMLCanvasElement)
                .getContext("2d")!
                .getImageData(
                  0,
                  0,
                  (canvas as HTMLCanvasElement).width,
                  (canvas as HTMLCanvasElement).height,
                ).data;
              let green = 0;
              for (let i = 0; i < pixels.length; i += 4)
                if (
                  pixels[i + 1] > pixels[i] * 1.4 &&
                  pixels[i + 1] > pixels[i + 2] * 1.4 &&
                  pixels[i + 3] > 100
                )
                  green++;
              return green;
            }),
        )
        .toBeGreaterThan(5);
    }
    await page.screenshot({
      path: info.outputPath(`${name.replaceAll(" ", "-")}.png`),
      animations: "disabled",
    });
  }
  await navigate(page, "Game library");
  await expect(
    page.getByRole("heading", { name: "Your games", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".pl-library .kpis")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("capture survives route and URL filter changes, copied links, and browser history", async ({
  page,
  context,
}) => {
  const commands: { type: string; streamId?: number }[] = [];
  page.on("websocket", (socket) =>
    socket.on("framesent", (frame) => {
      try {
        commands.push(JSON.parse(String(frame.payload)));
      } catch {}
    }),
  );
  await openGame(page);
  await navigate(page, "Logs");
  await expect(
    page.locator(".log-row button,button.log-row").first(),
  ).toBeVisible();
  const starts = () => commands.filter((c) => c.type === "stream.start");
  await expect.poll(() => starts().length).toBeGreaterThan(0);
  const initial = starts().length;
  await page
    .getByRole("textbox", { name: "Search the logs", exact: true })
    .fill("nonexistent-entry");
  await expect(page).toHaveURL(/logSearch=nonexistent-entry/);
  const copy = await context.newPage();
  await copy.goto(page.url());
  await expect(
    copy.getByRole("textbox", { name: "Search the logs", exact: true }),
  ).toHaveValue("nonexistent-entry");
  await copy.close();
  await page
    .getByRole("button", { name: "Clear log search", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByText("View paused · capture continues", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await navigate(page, "Performance");
  await expect(page.locator(".uplot").first()).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Logs", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Performance", exact: true }),
  ).toBeVisible();
  expect(starts()).toHaveLength(initial);
  await navigate(page, "Game library");
  await page
    .getByRole("button", { name: "Open Puzzle Garden", exact: true })
    .click();
  await navigate(page, "Logs");
  await expect(
    page.getByRole("heading", {
      name: "This game is not installed.",
      exact: true,
    }),
  ).toBeVisible();
});

test("saved capture queries, sorting, simple deletion confirmation and inspectors work", async ({
  page,
}, info) => {
  const sessions = [
    {
      id: "fixture-capture",
      name: "Fixture capture",
      pkg: "com.avn.demo",
      gameName: "PlayLens Demo",
      device: "Replay device",
      lines: 1,
      startedAt: Date.now(),
      active: false,
    },
  ];
  const deletions: string[] = [];
  await page.route("**/api/sessions**", async (route) => {
    if (route.request().method() === "DELETE") {
      deletions.push(new URL(route.request().url()).pathname);
      sessions.splice(0);
      await route.fulfill({ json: { ok: true } });
      return;
    }
    const detail =
      new URL(route.request().url()).pathname ===
      "/api/sessions/fixture-capture";
    await route.fulfill({
      json: detail
        ? {
            session: sessions[0],
            snapshot: { firebase: { rows: [] } },
            entries: [
              {
                id: 1,
                ts: Date.now(),
                level: "I",
                tag: "Unity",
                message: "Fixture capture log",
                more: ["Saved details"],
              },
            ],
          }
        : sessions,
    });
  });
  await page.goto("/?view=sessions");
  await page.getByRole("button", { name: "Lines", exact: false }).click();
  await expect(page).toHaveURL(/sessionSort=lines/);
  await page.getByRole("button", { name: "Delete…", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Delete this saved session?",
    exact: true,
  });
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Delete session", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".playlens-app")).toHaveJSProperty("scrollLeft", 0);
  expect((await dialog.boundingBox())!.x).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: info.outputPath("delete-session-confirmation.png") });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(deletions).toEqual([]);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Fixture capture", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Logs (1)", exact: true }).click();
  await page
    .getByRole("button", { name: "Fixture capture log", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Unity", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Back to sessions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved sessions", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete…", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete session", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
  expect(deletions).toEqual(["/api/sessions/fixture-capture"]);
});

test("device pairing, forms and keyboard command navigation work", async ({
  page,
}) => {
  await page.goto("/?view=connect");
  await expect(page.locator(".qrscreen svg")).toBeVisible();
  await page.getByRole("button", { name: "Pairing code", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Pairing address and port",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", {
      name: "Search pages, games and actions",
      exact: true,
    })
    .fill("devices");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Devices", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Device details", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Replay device", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await noOverflow(page);
});

test("device drawer slides without shifting the page and restores focus", async ({
  page,
}, info) => {
  await page.goto("/?view=devices");
  const trigger = page.getByRole("button", { name: "Device details", exact: true });
  await expect(trigger).toBeVisible();
  // Let the separate page entrance finish before measuring the drawer entrance.
  await expect.poll(() => page.locator(".pl-page").evaluate((el) =>
    el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
  )).toBe(0);
  const baseline = await page.locator(".pl-page").boundingBox();
  for (let cycle = 0; cycle < 2; cycle++) {
    const [frames] = await Promise.all([
      page.evaluate(() => new Promise<{ x: number; y: number; scroll: number[] }[]>((resolve) => {
        const samples: { x: number; y: number; scroll: number[] }[] = [];
        const start = performance.now();
        const sample = () => {
          const rect = document.querySelector(".pl-page")!.getBoundingClientRect();
          samples.push({ x: rect.x, y: rect.y, scroll: [".playlens-app", ".workspace", ".pl-scroll"].flatMap((selector) => {
            const el = document.querySelector(selector)!;
            return [el.scrollLeft, el.scrollTop];
          }) });
          if (performance.now() - start < 900) requestAnimationFrame(sample);
          else resolve(samples);
        };
        requestAnimationFrame(sample);
      })),
      trigger.click(),
    ]);
    expect(frames.length).toBeGreaterThan(2);
    for (const frame of frames) {
      expect(Math.abs(frame.x - baseline!.x)).toBeLessThan(1);
      expect(Math.abs(frame.y - baseline!.y)).toBeLessThan(1);
      expect(frame.scroll).toEqual([0, 0, 0, 0, 0, 0]);
    }
    const drawer = page.getByRole("dialog", { name: "Replay device", exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    expect(await drawer.evaluate((el) => el.parentElement?.matches(".playlens-app"))).toBe(true);
    await noOverflow(page);
    if (cycle === 0) await page.screenshot({ path: info.outputPath("device-drawer.png") });
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.palette = "moss";
  });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Replay device", exact: true });
  await expect(drawer).toBeVisible();
  await expect.poll(() => drawer.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  await page.screenshot({ path: info.outputPath("device-drawer-light-reduced-motion.png") });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("reduced motion, light palette and density are preserved", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openGame(page);
  await navigate(page, "Logs");
  await expect
    .poll(() =>
      page
        .locator(".pl-page")
        .evaluate(
          (root) =>
            root
              .getAnimations({ subtree: true })
              .filter((a) => a.playState === "running").length,
        ),
    )
    .toBe(0);
  if (
    await page.getByTitle("Appearance and density", { exact: true }).isVisible()
  )
    await page.getByTitle("Appearance and density", { exact: true }).click();
  else {
    await page
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("button", { name: "More", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Appearance & density", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByLabel("Palette", { exact: true }).selectOption("moss");
  await page.getByRole("button", { name: "Roomy", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page).toHaveURL(/density=comfort/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await noOverflow(page);
});
