// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { DataTable } from "../src/components/DataTable";
import { validateSearch } from "../src/navigation";
import { useState } from "react";

it("keeps expanded values and focused inputs mounted across live table updates", async () => {
  vi.stubGlobal("scrollTo", vi.fn());
  function LiveTable() {
    const [tick, setTick] = useState(0);
    return (
      <>
        <button onClick={() => setTick((value) => value + 1)}>
          Live update
        </button>
        <DataTable
          data={[{ id: "config", tick }]}
          rowKey={(row) => row.id}
          columns={[
            {
              id: "value",
              header: "Value",
              cell: (row) => (
                <>
                  <details>
                    <summary>Config fields</summary>
                    <p>{row.tick}</p>
                  </details>
                  <input aria-label="Editable value" defaultValue="Keep me" />
                </>
              ),
            },
          ]}
        />
      </>
    );
  }
  const root = createRootRoute({ validateSearch, component: LiveTable });
  const index = createRoute({ getParentRoute: () => root, path: "/" });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/?view=remote-config"] }),
  });
  render(<RouterProvider router={router} />);
  const summary = await screen.findByText("Config fields");
  const details = summary.parentElement as HTMLDetailsElement;
  details.open = true;
  const input = screen.getByRole("textbox", {
    name: "Editable value",
  }) as HTMLInputElement;
  input.focus();
  input.value = "Edited";
  fireEvent.click(screen.getByText("Live update"));
  expect(details.isConnected).toBe(true);
  expect(details.open).toBe(true);
  expect(input.isConnected).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe("Edited");
  cleanup();
});
it("sorts typed data and restores sorting from a copied URL", async () => {
  vi.stubGlobal("scrollTo", vi.fn());
  const root = createRootRoute({
    validateSearch,
    component: () => (
      <DataTable
        data={[
          { id: "a", lines: 2 },
          { id: "b", lines: 1 },
        ]}
        rowKey={(r) => r.id}
        columns={[
          {
            id: "lines",
            header: "Lines",
            sortable: true,
            value: (r) => r.lines,
            cell: (r) => r.lines,
          },
        ]}
      />
    ),
  });
  const index = createRoute({ getParentRoute: () => root, path: "/" });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/?view=sessions"] }),
  });
  render(<RouterProvider router={router} />);
  const sort = await screen.findByRole("button", { name: "Lines" });
  fireEvent.click(sort);
  await waitFor(() =>
    expect(router.state.location.search.tableSort).toBe("lines"),
  );
  expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "1",
    "2",
  ]);
  await router.navigate({
    to: "/",
    search: { view: "sessions", tableSort: "-lines" },
  });
  await waitFor(() =>
    expect(screen.getAllByRole("cell").map((cell) => cell.textContent)).toEqual(
      ["2", "1"],
    ),
  );
  cleanup();
});

it("writes persisted defaults to URLs and gives copied preferences precedence", async () => {
  const { useViewPreference } = await import("../src/route-state");
  const prefs = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => prefs.get(key) ?? null,
    setItem: (key: string, value: string) => {
      prefs.set(key, value);
    },
    removeItem: (key: string) => {
      prefs.delete(key);
    },
  });
  localStorage.setItem("test.preference", "1");
  function Preference() {
    const [value, setValue] = useViewPreference<boolean>(
      "hideAuto",
      "test.preference",
      false,
    );
    return (
      <button onClick={() => setValue(!value)}>
        {value ? "Hide automatic" : "Show automatic"}
      </button>
    );
  }
  const root = createRootRoute({ validateSearch, component: Preference });
  const index = createRoute({ getParentRoute: () => root, path: "/" });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/?view=firebase"] }),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.location.search.hideAuto).toBe(true));
  await router.navigate({
    to: "/",
    search: { view: "firebase", hideAuto: false },
  });
  expect(
    await screen.findByRole("button", { name: "Show automatic" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show automatic" }));
  await waitFor(() => expect(router.state.location.search.hideAuto).toBe(true));
  cleanup();
  localStorage.removeItem("test.preference");
});
