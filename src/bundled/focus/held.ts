import type { HeldNotification } from "../../features/notifications/service";
import { parseOpenTarget } from "../../features/navigation/targets";

/** Alerts Focus stopped, kept on this device until opened or cleared. */
export const HELD_KEY = "buzz-focus-held.v1";
/** Set when alerts arrive; cleared once a Focus-ended summary mentioned them. */
export const HELD_DUE_KEY = "buzz-focus-held-due.v1";
const LIMIT = 200;

/** A held alert and the account it arrived for. */
export type KeptAlert = HeldNotification & Readonly<{ viewer?: string }>;
/** The signed-in account; only its held alerts are listed. */
export type HeldAccount = Readonly<{
  viewer(): string | undefined;
  subscribe(listener: () => void): () => void;
}>;
const NO_ACCOUNT: HeldAccount = {
  viewer: () => undefined,
  subscribe: () => () => {},
};

function parse(raw: string | null): readonly KeptAlert[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    try {
      const { category, label, title, body, at, target, viewer } = item ?? {};
      if (
        [category, label, title, body].some((v) => typeof v !== "string") ||
        !Number.isSafeInteger(at) ||
        (viewer !== undefined && typeof viewer !== "string")
      )
        return [];
      return [
        Object.freeze({
          category,
          label,
          title,
          body,
          at,
          target: parseOpenTarget(target),
          ...(viewer ? { viewer } : {}),
        }),
      ];
    } catch {
      return [];
    }
  });
}

export function createHeld(
  host: Window | undefined = typeof window === "undefined" ? undefined : window,
  account: HeldAccount = NO_ACCOUNT,
) {
  let items: readonly KeptAlert[] = [];
  let due = false;
  let error: string | null = null;
  let view = {
    items,
    viewer: undefined as string | undefined,
    list: items,
  };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const save = (next: readonly KeptAlert[], nextDue = due) => {
    items = Object.freeze(next.slice(0, LIMIT));
    due = nextDue && items.length > 0;
    error = null;
    try {
      if (items.length)
        host?.localStorage.setItem(HELD_KEY, JSON.stringify(items));
      else host?.localStorage.removeItem(HELD_KEY);
      if (due) host?.localStorage.setItem(HELD_DUE_KEY, "1");
      else host?.localStorage.removeItem(HELD_DUE_KEY);
    } catch {
      error = "Held alerts could not be saved on this device.";
    }
    notify();
  };
  const restore = () => {
    try {
      items = Object.freeze(
        parse(host?.localStorage.getItem(HELD_KEY) ?? null),
      );
      due = host?.localStorage.getItem(HELD_DUE_KEY) === "1";
    } catch {
      items = [];
      due = false;
    }
    notify();
  };
  const onStorage = (event: StorageEvent) => {
    if (
      event.storageArea === host?.localStorage &&
      (event.key === HELD_KEY || event.key === HELD_DUE_KEY)
    )
      restore();
  };
  host?.addEventListener("storage", onStorage);
  restore();
  const mine = (item: KeptAlert, viewer = account.viewer()) =>
    !item.viewer || item.viewer === viewer;
  return {
    /** This account's alerts, newest first. */
    snapshot(): readonly KeptAlert[] {
      const viewer = account.viewer();
      if (view.items !== items || view.viewer !== viewer)
        view = {
          items,
          viewer,
          list: Object.freeze(items.filter((item) => mine(item, viewer))),
        };
      return view.list;
    },
    error: () => error,
    /** Whether alerts arrived that no Focus-ended summary has mentioned. */
    due: () => due,
    subscribe(listener: () => void) {
      listeners.add(listener);
      const stop = account.subscribe(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
    add(alert: HeldNotification) {
      const viewer = account.viewer();
      save(
        [Object.freeze({ ...alert, ...(viewer ? { viewer } : {}) }), ...items],
        true,
      );
    },
    remove(alert: KeptAlert) {
      save(items.filter((item) => item !== alert));
    },
    /** Clears this account's alerts. */
    clear() {
      save(items.filter((item) => !mine(item)));
    },
    summarized() {
      save(items, false);
    },
    dispose() {
      host?.removeEventListener("storage", onStorage);
      listeners.clear();
    },
  };
}

export type Held = ReturnType<typeof createHeld>;
