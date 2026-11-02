import type { PluginModule } from "../../plugins/api";
import { TelescopeIcon } from "../../shared/design-system/icons/index";
import { FocusBanner, FocusDialog } from "./FocusDialog";
import { createFocus } from "./state";
import { bindFocusStatus, soloConversation } from "./status";

export const inject = [
  "accountActions",
  "notifications",
  "sidebarScope",
  "relay",
];

export const apply: PluginModule["apply"] = (ctx) => {
  const relay = ctx.relay;
  const focus = createFocus();
  ctx.effect(() => () => focus.dispose());
  ctx.effect(() => bindFocusStatus(focus, relay));
  const banner = () => <FocusBanner focus={focus} />;
  // Hold the gate and the sidebar restriction only while Focus is on, so
  // disabling the plugin releases both even mid-Focus.
  ctx.effect(() => {
    let release: (() => void) | undefined;
    const sync = () => {
      const on = focus.snapshot().until !== undefined;
      if (on && !release) {
        const ungate = ctx.notifications.gate({
          id: "solo",
          allows: (target) => soloConversation(relay, target),
        });
        const unrestrict = ctx.sidebarScope.restrict({
          id: "focus",
          scope: "solo",
          banner,
        });
        release = () => {
          ungate();
          unrestrict();
        };
      } else if (!on && release) {
        release();
        release = undefined;
      }
    };
    const stop = focus.subscribe(sync);
    sync();
    return () => {
      stop();
      release?.();
    };
  });
  ctx.accountActions.register({
    id: "focus",
    title: "Focus",
    icon: <TelescopeIcon size={17} />,
    component: (props) => <FocusDialog {...props} focus={focus} />,
  });
};
