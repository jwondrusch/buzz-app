// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Context } from "@deepseek-ai/cordis";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AccountActionsService } from "../../features/account-actions/service";
import { SidebarScopeService } from "../../features/channel-navigation/sidebar-scope-service";
import { provideNavigation } from "../../features/navigation/service";
import type { OpenTarget } from "../../features/navigation/targets";
import { createNotificationPreferences } from "../../features/notifications/preferences";
import { NotificationsService } from "../../features/notifications/service";
import { PagesService } from "../../features/pages/service";
import type { StatusInput, UserStatus } from "../../features/relay/user-status";
import { ShortcutsService } from "../../features/shortcuts/service";
import { PluginRuntime } from "../../plugins/runtime";
import * as focusPlugin from "./index";
import { HELD_DUE_KEY, HELD_KEY } from "./held";
import { HELD_PAGE } from "./HeldPage";
import { FOCUS_KEY } from "./state";
import { FOCUS_STATUS } from "./status";

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  localStorage.clear();
});

const scope = { viewer: "a".repeat(64), communityOrigin: "wss://one.example" };
const conversation = (channelId: string): OpenTarget => ({
  version: 1,
  kind: "conversation",
  scope,
  channelId,
});

function setup(initial?: StatusInput) {
  const ctx = new Context();
  contexts.push(ctx);
  const runtime = new PluginRuntime(ctx, async () => focusPlugin);
  ctx.effect(() => () => runtime.dispose());
  const navigation = provideNavigation(ctx).navigation;
  const show = vi.fn(async () => {});
  const notifications = new NotificationsService(
    ctx,
    navigation,
    {
      label: "Test",
      permission: async () => "granted",
      requestPermission: async () => "granted",
      show,
      dispose() {},
    },
    createNotificationPreferences(),
    () => true,
    () => {},
  );
  notifications.selectViewer(scope.viewer);
  const pages = new PagesService(ctx);
  new ShortcutsService(ctx, undefined);
  let published: UserStatus | undefined = initial && {
    ...initial,
    userId: scope.viewer,
    updatedAt: 1,
  };
  const save = vi.fn(async (input: StatusInput) => {
    published =
      input.text || input.emoji
        ? { ...input, userId: scope.viewer, updatedAt: 2 }
        : undefined;
  });
  const relayListeners = new Set<() => void>();
  const sidebarScope = new SidebarScopeService(ctx);
  const accountActions = new AccountActionsService(ctx);
  ctx.provide("relay", {
    snapshot: () => ({
      status: "ready",
      cached: false,
      scope: "wss://one.example:viewer",
      viewer: scope.viewer,
      session: {
        statuses: {
          writable: true,
          save,
          current: async () => published,
        },
        channels: {
          list: () => ({
            channels: [
              { id: "solo", channelType: "solo" },
              { id: "team", channelType: "stream" },
            ],
          }),
        },
      },
    }),
    subscribe: (listener: () => void) => {
      relayListeners.add(listener);
      return () => relayListeners.delete(listener);
    },
  });
  const plugin = {
    manifest: { id: "buzz.focus", name: "Focus", apiVersion: 1 as const },
    enabled: true,
    source: "bundled" as const,
    revision: "bundled",
    previous: null,
    reloadable: false,
    error: null,
  };
  return {
    ctx,
    /** The connection publishes a change, as it does once it is up. */
    relayChanged: () => {
      for (const listener of relayListeners) listener();
    },
    show,
    save,
    pages,
    notifications,
    sidebarScope,
    accountActions,
    alert: (sourceKey: string, channelId: string) =>
      notifications.admit(
        "mention",
        "Mentions",
        { sourceKey, target: conversation(channelId) },
        () => true,
        () => true,
      ),
    enable: () => runtime.reconcile([plugin]),
    // The manager passes the runtime only the enabled plugins.
    disable: () => runtime.reconcile([]),
  };
}

it("adds a profile-menu action and leaves alerts and the sidebar alone while off", async () => {
  const t = setup();
  t.enable();
  await vi.waitFor(() =>
    expect(t.accountActions.snapshot().map((a) => a.title)).toEqual(["Focus"]),
  );
  expect(t.sidebarScope.snapshot()).toEqual([]);
  expect(t.notifications.gated(conversation("team"))).toBe(true);
});

it("resumes a saved Focus, lets only Solo alert, and releases everything on End", async () => {
  const until = Math.floor(Date.now() / 1000) + 600;
  localStorage.setItem(FOCUS_KEY, JSON.stringify({ until }));
  const t = setup();
  t.enable();
  await vi.waitFor(() => expect(t.sidebarScope.snapshot()).toHaveLength(1));
  expect(t.notifications.gated(conversation("solo"))).toBe(true);
  expect(t.notifications.gated(conversation("team"))).toBe(false);
  expect(
    t.notifications.gated({ version: 1, kind: "settings", section: "about" }),
  ).toBe(false);
  const Banner = t.sidebarScope.snapshot()[0]?.banner;
  if (!Banner) throw new Error("No banner");
  render(<Banner />);
  expect(screen.getByText(/^Focusing until/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "End" }));
  expect(t.sidebarScope.snapshot()).toEqual([]);
  expect(t.notifications.gated(conversation("team"))).toBe(true);
  expect(localStorage.getItem(FOCUS_KEY)).toBeNull();
});

it("disabling the plugin mid-Focus releases everything and restores the earlier status", async () => {
  const lunch = { text: "Lunch", emoji: "🥪" };
  localStorage.setItem(
    FOCUS_KEY,
    JSON.stringify({ until: Math.floor(Date.now() / 1000) + 600 }),
  );
  const t = setup(lunch);
  t.enable();
  await vi.waitFor(() =>
    expect(t.save).toHaveBeenLastCalledWith(
      expect.objectContaining(FOCUS_STATUS),
    ),
  );
  act(() => t.disable());
  await vi.waitFor(() => expect(t.save).toHaveBeenLastCalledWith(lunch));
  expect(t.sidebarScope.snapshot()).toEqual([]);
  expect(t.notifications.gated(conversation("team"))).toBe(true);
  expect(localStorage.getItem(FOCUS_KEY)).toBeNull();
});

it("closing the app keeps Focus and its status for next time", async () => {
  localStorage.setItem(
    FOCUS_KEY,
    JSON.stringify({ until: Math.floor(Date.now() / 1000) + 600 }),
  );
  const t = setup({ text: "Lunch", emoji: "🥪" });
  t.enable();
  await vi.waitFor(() => expect(t.save).toHaveBeenCalledTimes(1));
  await t.ctx.fiber.dispose();
  expect(t.save).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(localStorage.getItem(FOCUS_KEY) ?? "{}").until,
  ).toBeDefined();
});

it("saves alerts Focus stops, and says how many wait when Focus ends", async () => {
  localStorage.setItem(
    FOCUS_KEY,
    JSON.stringify({ until: Math.floor(Date.now() / 1000) + 600 }),
  );
  const t = setup();
  t.enable();
  await vi.waitFor(() => expect(t.sidebarScope.snapshot()).toHaveLength(1));
  expect(t.pages.snapshot().map((page) => page.title)).toContain(
    "Focus alerts",
  );
  expect(await t.alert("team-1", "team")).toBe(false);
  expect(await t.alert("solo-1", "solo")).toBe(true);
  const saved = JSON.parse(localStorage.getItem(HELD_KEY) ?? "[]");
  expect(saved).toEqual([
    expect.objectContaining({
      label: "Mentions",
      target: expect.objectContaining({ channelId: "team" }),
    }),
  ]);
  const Banner = t.sidebarScope.snapshot()[0]?.banner;
  if (!Banner) throw new Error("No banner");
  render(<Banner />);
  expect(screen.getByText(/1 waiting/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "End" }));
  await vi.waitFor(() =>
    expect(t.show).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Focus ended",
        body: "1 alert waiting for you.",
      }),
      expect.any(Function),
      expect.any(Function),
    ),
  );
  expect(HELD_PAGE.pageId).toBe("held");
});

it("says how many alerts wait when Focus ended while Buzz was closed", async () => {
  localStorage.setItem(
    HELD_KEY,
    JSON.stringify([
      {
        category: "mention",
        label: "Mentions",
        title: "Buzz",
        body: "New mentions",
        at: Date.now(),
        target: conversation("team"),
        viewer: scope.viewer,
      },
    ]),
  );
  localStorage.setItem(HELD_DUE_KEY, "1");
  const t = setup();
  t.enable();
  await vi.waitFor(() =>
    expect(t.accountActions.snapshot().map((a) => a.title)).toEqual(["Focus"]),
  );
  // Categories are ready only once the plugin is active, so the summary
  // goes out with the connection's next change.
  t.relayChanged();
  await vi.waitFor(() =>
    expect(t.show).toHaveBeenCalledWith(
      expect.objectContaining({ body: "1 alert waiting for you." }),
      expect.any(Function),
      expect.any(Function),
    ),
  );
  await vi.waitFor(() => expect(localStorage.getItem(HELD_DUE_KEY)).toBeNull());
  expect(localStorage.getItem(HELD_KEY)).not.toBeNull();
});
