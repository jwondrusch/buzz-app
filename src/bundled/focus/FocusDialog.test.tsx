// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FocusDialog } from "./FocusDialog";
import { createHeld } from "./held";
import { createPreferences } from "./preferences";
import { createFocus } from "./state";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

it("starts Focus for the chosen duration and offers End while it is on", async () => {
  const user = userEvent.setup();
  const focus = createFocus();
  const onOpenChange = vi.fn();
  const held = createHeld();
  const dialog = (
    <FocusDialog
      open
      onOpenChange={onOpenChange}
      focus={focus}
      held={held}
      preferences={createPreferences()}
      onReview={() => {}}
    />
  );
  const view = render(dialog);
  await user.click(screen.getByRole("button", { name: "Duration: 1 hour" }));
  await user.click(
    await screen.findByRole("menuitemradio", { name: "30 minutes" }),
  );
  // Hold the clock so the deadline is exact.
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  await user.click(screen.getByRole("button", { name: "Start focus" }));
  expect(focus.snapshot().until).toBe(Math.floor(now / 1000) + 1800);
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  view.rerender(dialog);
  expect(screen.getByText(/^Focusing until/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "End focus" }));
  expect(focus.snapshot().until).toBeUndefined();
  focus.dispose();
});

it("starts in the chosen mode without changing the default", async () => {
  const user = userEvent.setup();
  const focus = createFocus();
  const preferences = createPreferences();
  const dialog = (
    <FocusDialog
      open
      onOpenChange={() => {}}
      focus={focus}
      held={createHeld()}
      preferences={preferences}
      onReview={() => {}}
    />
  );
  const view = render(dialog);
  await user.click(screen.getByRole("button", { name: "Mode: Solo only" }));
  await user.click(
    await screen.findByRole("menuitemradio", { name: "Quiet sidebar" }),
  );
  expect(screen.getByText(/Search and links still open/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Start focus" }));
  expect(focus.snapshot().mode).toBe("sidebar");
  expect(preferences.snapshot().mode).toBe("isolated");
  view.rerender(dialog);
  expect(screen.getByText(/^Focusing until/)).toHaveTextContent(
    "Search and links still open",
  );
  focus.dispose();
});

it("rejects a custom end time that has already passed", async () => {
  const user = userEvent.setup();
  const focus = createFocus();
  const held = createHeld();
  render(
    <FocusDialog
      open
      onOpenChange={() => {}}
      focus={focus}
      held={held}
      preferences={createPreferences()}
      onReview={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Duration: 1 hour" }));
  await user.click(
    await screen.findByRole("menuitemradio", { name: "Custom" }),
  );
  expect(screen.getByRole("button", { name: "Focus end time" })).toBeVisible();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86_400_000);
  await user.click(screen.getByRole("button", { name: "Start focus" }));
  expect(screen.getByRole("alert")).toHaveTextContent("future");
  expect(focus.snapshot().until).toBeUndefined();
  focus.dispose();
});

it("starts from the defaults in Settings and links to waiting alerts", async () => {
  const user = userEvent.setup();
  const preferences = createPreferences();
  preferences.set({ length: "7200", mode: "sidebar" });
  const focus = createFocus();
  const held = createHeld();
  held.add({
    category: "mention",
    label: "Mentions",
    target: { version: 1, kind: "settings", section: "about" },
    title: "Ana",
    body: "Hi",
    at: Date.now(),
  });
  const onOpenChange = vi.fn();
  const onReview = vi.fn();
  render(
    <FocusDialog
      open
      onOpenChange={onOpenChange}
      focus={focus}
      held={held}
      preferences={preferences}
      onReview={onReview}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Duration: 2 hours" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Mode: Quiet sidebar" }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Review 1 alert waiting" }),
  );
  expect(onReview).toHaveBeenCalled();
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  focus.dispose();
  held.dispose();
});
