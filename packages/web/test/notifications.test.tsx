// @vitest-environment jsdom
import { StrictMode } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NotificationList, ToastProvider, useToast } from "@avn/ui";

it("keeps one notification for repeated alerts under StrictMode", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  function Notifications() {
    const { toast } = useToast();
    return (
      <>
        <button
          onClick={() =>
            toast({
              kind: "bad",
              title: "Capture error",
              message: "Check the phone",
            })
          }
        >
          Alert
        </button>
        <section aria-label="History">
          <NotificationList />
        </section>
      </>
    );
  }
  render(
    <StrictMode>
      <ToastProvider>
        <Notifications />
      </ToastProvider>
    </StrictMode>,
  );
  fireEvent.click(screen.getByText("Alert"));
  fireEvent.click(screen.getByText("Alert"));
  expect(
    screen.getByRole("region", { name: "History" }).querySelectorAll(".note-i"),
  ).toHaveLength(1);
  cleanup();
});
