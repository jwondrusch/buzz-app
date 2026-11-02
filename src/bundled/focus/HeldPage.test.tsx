// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { Navigation } from "../../features/navigation/controller";
import { createHeld } from "./held";
import { HeldPage } from "./HeldPage";
import { createFocus } from "./state";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const target = {
  version: 1,
  kind: "conversation",
  scope: { viewer: "a".repeat(64), communityOrigin: "https://one.example" },
  channelId: "team",
} as const;

it("lists held alerts, opens one and removes it, and clears the rest", async () => {
  const user = userEvent.setup();
  const held = createHeld();
  held.add({
    category: "mention",
    label: "Mentions",
    target,
    title: "Ana",
    body: "Ship it?",
    at: Date.now(),
  });
  held.add({
    category: "reminders",
    label: "Reminders",
    target,
    title: "Standup",
    body: "Now",
    at: Date.now(),
  });
  const open = vi.fn(async () => {});
  const focus = createFocus();
  focus.start(Math.floor(Date.now() / 1000) + 600);
  render(
    <HeldPage
      held={held}
      focus={focus}
      navigation={{ open } as unknown as Navigation}
    />,
  );
  // Focus keeps their conversations closed, so they wait until it ends.
  expect(screen.getByRole("button", { name: /Ana/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "End focus" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: /Ana/ }));
  expect(open).toHaveBeenCalledWith(target);
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Clear all" }));
  expect(screen.getByText("Nothing waiting")).toBeVisible();
  held.dispose();
  focus.dispose();
});

it("opens held alerts during Quiet sidebar Focus, which lets them open", async () => {
  const user = userEvent.setup();
  const held = createHeld();
  held.add({
    category: "mention",
    label: "Mentions",
    target,
    title: "Ana",
    body: "Ship it?",
    at: Date.now(),
  });
  const open = vi.fn(async () => {});
  const focus = createFocus();
  focus.start(Math.floor(Date.now() / 1000) + 600, "sidebar");
  render(
    <HeldPage
      held={held}
      focus={focus}
      navigation={{ open } as unknown as Navigation}
    />,
  );
  expect(screen.queryByText("These open when Focus ends.")).toBeNull();
  await user.click(screen.getByRole("button", { name: /Ana/ }));
  expect(open).toHaveBeenCalledWith(target);
  held.dispose();
  focus.dispose();
});
