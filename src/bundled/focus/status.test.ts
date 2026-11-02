import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RelayData } from "../../features/relay/service";
import type { StatusInput, UserStatus } from "../../features/relay/user-status";
import { createFocus } from "./state";
import { FOCUS_STATUS, bindFocusStatus, soloConversation } from "./status";

const NOW = Date.UTC(2026, 10, 2, 20);
const at = (seconds: number) => Math.floor(NOW / 1000) + seconds;
const flush = () => vi.advanceTimersByTimeAsync(0);

function relay(initial?: StatusInput) {
  let published: UserStatus | undefined = initial && {
    ...initial,
    userId: "viewer",
    updatedAt: at(-100),
  };
  const save = vi.fn(async (input: StatusInput) => {
    published =
      input.text || input.emoji
        ? { ...input, userId: "viewer", updatedAt: at(0) }
        : undefined;
  });
  const listeners = new Set<() => void>();
  let state = {
    status: "ready",
    scope: "wss://a:viewer",
    viewer: "viewer",
    session: {
      statuses: {
        writable: true,
        save,
        current: vi.fn(async () => published),
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
  };
  const data = {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as RelayData;
  return {
    data,
    save,
    get published() {
      return published;
    },
    set published(value: UserStatus | undefined) {
      published = value;
    },
    select(scope: string) {
      state = { ...state, scope };
      for (const listener of listeners) listener();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

it("sets the telescope until the deadline and restores the previous status", async () => {
  const lunch = { text: "Lunch", emoji: "🥪", expiresAt: at(9000) };
  const community = relay(lunch);
  const focus = createFocus(undefined);
  const stop = bindFocusStatus(focus, community.data);
  focus.start(at(3600));
  await flush();
  expect(community.save).toHaveBeenLastCalledWith({
    ...FOCUS_STATUS,
    expiresAt: at(3600),
  });
  expect(focus.snapshot().status).toEqual({
    until: at(3600),
    scope: "wss://a:viewer",
    previous: lunch,
  });
  focus.end();
  await flush();
  expect(community.save).toHaveBeenLastCalledWith(lunch);
  expect(focus.snapshot().status).toBeUndefined();
  stop();
});

it("clears the telescope when there was no previous status", async () => {
  const community = relay();
  const focus = createFocus(undefined);
  bindFocusStatus(focus, community.data);
  focus.start(at(60));
  await flush();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(community.save).toHaveBeenLastCalledWith({ text: "", emoji: "" });
});

it("leaves a status the person changed during Focus alone", async () => {
  const community = relay({ text: "Lunch", emoji: "🥪" });
  const focus = createFocus(undefined);
  bindFocusStatus(focus, community.data);
  focus.start(at(60));
  await flush();
  community.published = {
    text: "Travelling",
    emoji: "✈️",
    userId: "viewer",
    updatedAt: at(1),
  };
  focus.end();
  await flush();
  expect(community.save).toHaveBeenCalledTimes(1);
  expect(focus.snapshot().status).toBeUndefined();
});

it("restores after the telescope already expired, but not a stale status", async () => {
  const community = relay({ text: "Lunch", emoji: "🥪", expiresAt: at(30) });
  const focus = createFocus(undefined);
  bindFocusStatus(focus, community.data);
  focus.start(at(60));
  await flush();
  // The relay dropped both by their NIP-40 expirations.
  community.published = undefined;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(community.save).toHaveBeenCalledTimes(1);
  expect(focus.snapshot().status).toBeUndefined();
});

it("waits for the community it changed before restoring", async () => {
  const community = relay({ text: "Lunch", emoji: "🥪" });
  const focus = createFocus(undefined);
  bindFocusStatus(focus, community.data);
  focus.start(at(60));
  await flush();
  community.select("wss://b:viewer");
  focus.end();
  await flush();
  expect(community.save).toHaveBeenCalledTimes(1);
  community.select("wss://a:viewer");
  await flush();
  expect(community.save).toHaveBeenLastCalledWith({
    text: "Lunch",
    emoji: "🥪",
  });
});

it("a later Focus elsewhere still sets the telescope", async () => {
  const community = relay({ text: "Lunch", emoji: "🥪" });
  const focus = createFocus(undefined);
  bindFocusStatus(focus, community.data);
  focus.start(at(60));
  await flush();
  community.select("wss://b:viewer");
  focus.end();
  await flush();
  focus.start(at(120));
  await flush();
  expect(community.save).toHaveBeenLastCalledWith({
    ...FOCUS_STATUS,
    expiresAt: at(120),
  });
  expect(focus.snapshot().status).toMatchObject({
    until: at(120),
    scope: "wss://b:viewer",
  });
});

it("does not retry a failed set for the same Focus", async () => {
  const community = relay();
  community.save.mockRejectedValueOnce(new Error("offline"));
  const report = vi.fn();
  const focus = createFocus(undefined);
  bindFocusStatus(focus, community.data, report);
  focus.start(at(60));
  await flush();
  community.select("wss://a:viewer");
  await flush();
  expect(report).toHaveBeenCalledTimes(1);
  expect(community.save).toHaveBeenCalledTimes(1);
  expect(focus.snapshot().status).toBeUndefined();
});

it("recognises only listed Solo conversations", () => {
  const { data } = relay();
  expect(
    soloConversation(data, { kind: "conversation", channelId: "solo" }),
  ).toBe(true);
  expect(
    soloConversation(data, { kind: "conversation", channelId: "team" }),
  ).toBe(false);
  expect(soloConversation(data, { kind: "page" })).toBe(false);
});
