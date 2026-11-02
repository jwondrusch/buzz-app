// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import type { HeldNotification } from "../../features/notifications/service";
import { HELD_KEY, createHeld } from "./held";

afterEach(() => localStorage.clear());

const alert = (at: number): HeldNotification => ({
  category: "mention",
  label: "Mentions",
  target: { version: 1, kind: "settings", section: "about" },
  title: `Alert ${at}`,
  body: "Body",
  at,
});

it("keeps the newest 200 alerts on this device and restores them", () => {
  const held = createHeld();
  for (let at = 1; at <= 205; at++) held.add(alert(at));
  expect(held.snapshot()).toHaveLength(200);
  expect(held.snapshot()[0]?.at).toBe(205);
  held.dispose();
  const again = createHeld();
  expect(
    again
      .snapshot()
      .map((item) => item.at)
      .slice(0, 2),
  ).toEqual([205, 204]);
  again.remove(again.snapshot()[0] as HeldNotification);
  expect(again.snapshot()[0]?.at).toBe(204);
  again.clear();
  expect(localStorage.getItem(HELD_KEY)).toBeNull();
  again.dispose();
});

it("drops malformed saved alerts and follows other windows", () => {
  localStorage.setItem(
    HELD_KEY,
    JSON.stringify([alert(1), { ...alert(2), target: { kind: "nope" } }, 7]),
  );
  const held = createHeld();
  expect(held.snapshot().map((item) => item.at)).toEqual([1]);
  localStorage.setItem(HELD_KEY, JSON.stringify([alert(3)]));
  window.dispatchEvent(
    new StorageEvent("storage", { key: HELD_KEY, storageArea: localStorage }),
  );
  expect(held.snapshot().map((item) => item.at)).toEqual([3]);
  held.dispose();
});

it("reports when the device refuses to save", () => {
  const held = createHeld({
    localStorage: {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
      removeItem() {},
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Window);
  held.add(alert(1));
  expect(held.snapshot()).toHaveLength(1);
  expect(held.error()).toMatch(/could not be saved/);
  held.dispose();
});

it("lists and clears only the signed-in account's alerts", () => {
  let viewer = "alice";
  const listeners = new Set<() => void>();
  const held = createHeld(window, {
    viewer: () => viewer,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  held.add(alert(1));
  viewer = "bob";
  for (const listener of listeners) listener();
  expect(held.snapshot()).toEqual([]);
  held.add(alert(2));
  held.clear();
  viewer = "alice";
  expect(held.snapshot().map((item) => item.at)).toEqual([1]);
  held.dispose();
});

it("stays due for a summary until one has mentioned the alerts", () => {
  const held = createHeld();
  expect(held.due()).toBe(false);
  held.add(alert(1));
  expect(held.due()).toBe(true);
  held.dispose();
  const again = createHeld();
  expect(again.due()).toBe(true);
  again.summarized();
  expect(again.due()).toBe(false);
  expect(again.snapshot()).toHaveLength(1);
  again.dispose();
});
