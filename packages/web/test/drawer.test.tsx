// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Drawer } from "@avn/ui";

it("keeps focus in the details during live parent updates and uses the latest close callback", () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const originalClose = vi.fn();
  const latestClose = vi.fn();
  const details = (onClose: () => void) => (
    <Drawer open onClose={onClose} title="Device details">
      <button>Copy serial</button>
    </Drawer>
  );
  const view = render(details(originalClose));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Close" }),
  );
  const copy = screen.getByRole("button", { name: "Copy serial" });
  copy.focus();
  view.rerender(details(latestClose));
  expect(document.activeElement).toBe(copy);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(latestClose).toHaveBeenCalledOnce();
  expect(originalClose).not.toHaveBeenCalled();
  cleanup();
  vi.unstubAllGlobals();
});
