// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FocusDialog } from "./FocusDialog";
import { createFocus } from "./state";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("starts Focus for the chosen duration and offers End while it is on", async () => {
  const user = userEvent.setup();
  const focus = createFocus();
  const onOpenChange = vi.fn();
  const view = render(
    <FocusDialog open onOpenChange={onOpenChange} focus={focus} />,
  );
  await user.click(screen.getByRole("button", { name: "Duration: 1 hour" }));
  await user.click(
    await screen.findByRole("menuitemradio", { name: "30 minutes" }),
  );
  const before = Math.floor(Date.now() / 1000);
  await user.click(screen.getByRole("button", { name: "Start focus" }));
  const until = focus.snapshot().until ?? 0;
  expect(until - before).toBeGreaterThanOrEqual(1799);
  expect(until - before).toBeLessThanOrEqual(1801);
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  view.rerender(<FocusDialog open onOpenChange={onOpenChange} focus={focus} />);
  expect(screen.getByText(/^Focusing until/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "End focus" }));
  expect(focus.snapshot().until).toBeUndefined();
  focus.dispose();
});

it("rejects a custom end time that has already passed", async () => {
  const user = userEvent.setup();
  const focus = createFocus();
  render(<FocusDialog open onOpenChange={() => {}} focus={focus} />);
  await user.click(screen.getByRole("button", { name: "Duration: 1 hour" }));
  await user.click(
    await screen.findByRole("menuitemradio", { name: "Custom" }),
  );
  expect(screen.getByRole("button", { name: "Focus end time" })).toBeVisible();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86_400_000);
  await user.click(screen.getByRole("button", { name: "Start focus" }));
  expect(screen.getByRole("alert")).toHaveTextContent("future");
  expect(focus.snapshot().until).toBeUndefined();
  vi.restoreAllMocks();
  focus.dispose();
});
