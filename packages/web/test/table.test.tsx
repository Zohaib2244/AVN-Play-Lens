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
