import type { PluginModule } from "../../plugins/api";
import { TelescopeIcon } from "../../shared/design-system/icons/index";
import {
  FocusBanner,
  FocusDialog,
  lastFocusDuration,
  lastFocusMode,
  startFocus,
} from "./FocusDialog";
import { createHeld } from "./held";
import { HELD_PAGE, HeldPage } from "./HeldPage";
import { createFocus, type FocusMode } from "./state";
import { bindFocusStatus, soloConversation } from "./status";

export const inject = [
  "accountActions",
  "notifications",
  "sidebarScope",
  "relay",
  "pages",
  "navigation",
  "shortcuts",
];

export const apply: PluginModule["apply"] = (ctx) => {
  const relay = ctx.relay;
  const navigation = ctx.navigation;
  const focus = createFocus();
  const held = createHeld(undefined, {
    viewer: () => relay.snapshot().viewer,
    subscribe: relay.subscribe,
  });
  const summary = ctx.notifications.register({
    id: "summary",
    label: "Focus summary",
  });
  // Turning the plugin off mid-Focus ends Focus and restores the status it
  // replaced. Quitting the app or updating the plugin keeps Focus running.
  ctx.effect(() => {
    const status = bindFocusStatus(focus, relay);
    return async () => {
      try {
        if (ctx.pluginOwner?.retiring?.() === "disabled") {
          focus.end();
          await status.settle();
        } else status();
      } finally {
        focus.dispose();
        held.dispose();
      }
    };
  });
  const review = () => void navigation.open(HELD_PAGE);
  const banner = () => <FocusBanner focus={focus} held={held} />;
  // Hold the gate and the sidebar restriction only while Focus is on, so
  // disabling the plugin releases both even mid-Focus.
  ctx.effect(() => {
    let release: (() => void) | undefined;
    let active: FocusMode | undefined;
    let sending = false;
    // Once Focus is off, say how many alerts wait: when it ends, or on the
    // next start if it ended while Buzz was closed.
    const summarize = () => {
      const count = held.snapshot().length;
      if (release || sending || !held.due() || !count) return;
      sending = true;
      void summary
        .submit({
          sourceKey: `focus-ended:${held.snapshot()[0]?.at}`,
          target: HELD_PAGE,
          title: "Focus ended",
          body: `${count} ${count === 1 ? "alert" : "alerts"} waiting for you.`,
        })
        .then((shown) => {
          if (shown) held.summarized();
        })
        .catch((error) => console.warn("Focus summary", error))
        .finally(() => {
          sending = false;
        });
    };
    const sync = () => {
      const { until, mode } = focus.snapshot();
      const next = until === undefined ? undefined : mode;
      if (next !== active) {
        release?.();
        release = undefined;
      }
      active = next;
      if (next && !release) {
        const ungate = ctx.notifications.gate({
          id: "solo",
          allows: (target) => soloConversation(relay, target),
          hold: (alert) => held.add(alert),
        });
        // Quiet sidebar hides the rest but still lets search and links open it.
        const unrestrict = ctx.sidebarScope.restrict({
          id: "focus",
          scope: "solo",
          reach: next === "sidebar" ? "any" : "solo",
          banner,
        });
        release = () => {
          ungate();
          unrestrict();
        };
      }
      summarize();
    };
    const stop = focus.subscribe(sync);
    // Categories work only once the plugin is active, and the account may
    // connect later, so a due summary retries as the connection changes.
    const stopRelay = relay.subscribe(summarize);
    sync();
    return () => {
      stop();
      stopRelay();
      release?.();
    };
  });
  ctx.pages.register({
    id: HELD_PAGE.pageId,
    title: "Focus alerts",
    component: () => (
      <HeldPage held={held} focus={focus} navigation={navigation} />
    ),
  });
  ctx.shortcuts.register({
    id: "toggle",
    title: "Start or end Focus",
    binding: { key: "f", mod: true, shift: true },
    allowInEditable: true,
    run: () => {
      if (focus.snapshot().until !== undefined) focus.end();
      else startFocus(focus, lastFocusDuration(), lastFocusMode());
    },
  });
  ctx.accountActions.register({
    id: "focus",
    title: "Focus",
    icon: <TelescopeIcon size={17} />,
    component: (props) => (
      <FocusDialog {...props} focus={focus} held={held} onReview={review} />
    ),
  });
};
