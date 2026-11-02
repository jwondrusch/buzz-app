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
import { PluginRuntime } from "../../plugins/runtime";
import * as focusPlugin from "./index";
import { FOCUS_KEY } from "./state";

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

function setup() {
  const ctx = new Context();
  contexts.push(ctx);
  const runtime = new PluginRuntime(ctx, async () => focusPlugin);
  ctx.effect(() => () => runtime.dispose());
  const navigation = provideNavigation(ctx).navigation;
  const notifications = new NotificationsService(
    ctx,
    navigation,
    {
      label: "Test",
      permission: async () => "granted",
      requestPermission: async () => "granted",
      show: async () => {},
      dispose() {},
    },
    createNotificationPreferences(),
  );
  const sidebarScope = new SidebarScopeService(ctx);
  const accountActions = new AccountActionsService(ctx);
  ctx.provide("relay", {
    snapshot: () => ({
      status: "ready",
      cached: false,
      scope: "wss://one.example:viewer",
      viewer: scope.viewer,
      session: {
        statuses: { writable: false },
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
    subscribe: () => () => {},
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
    notifications,
    sidebarScope,
    accountActions,
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

it("disabling the plugin mid-Focus releases the sidebar and alerts", async () => {
  localStorage.setItem(
    FOCUS_KEY,
    JSON.stringify({ until: Math.floor(Date.now() / 1000) + 600 }),
  );
  const t = setup();
  t.enable();
  await vi.waitFor(() => expect(t.sidebarScope.snapshot()).toHaveLength(1));
  act(() => t.disable());
  await vi.waitFor(() => expect(t.sidebarScope.snapshot()).toEqual([]));
  expect(t.notifications.gated(conversation("team"))).toBe(true);
});
