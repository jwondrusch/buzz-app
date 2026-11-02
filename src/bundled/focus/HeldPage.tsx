import { useSyncExternalStore } from "react";
import type { Navigation } from "../../features/navigation/controller";
import { relativeTimestamp } from "../../shared/relative-timestamp";
import { TelescopeIcon } from "../../shared/design-system/icons/index";
import { Button } from "../../shared/design-system/ui/Button";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { FullPageSurface } from "../../shared/design-system/ui/FullPageSurface";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { useFocus } from "./FocusDialog";
import type { Held, KeptAlert } from "./held";
import type { Focus } from "./state";
import styles from "./Focus.module.css";

export const HELD_PAGE = Object.freeze({
  version: 1,
  kind: "page",
  pluginId: "buzz.focus",
  pageId: "held",
} as const);

/** Alerts Focus kept for later. Opening one removes it from the list. In
 * Solo only mode they open once Focus ends, since it keeps their
 * conversations closed; Quiet sidebar lets them open any time. */
export function HeldPage({
  held,
  focus,
  navigation,
}: {
  held: Held;
  focus: Focus;
  navigation: Navigation;
}) {
  const items = useSyncExternalStore(held.subscribe, held.snapshot);
  const error = useSyncExternalStore(held.subscribe, held.error);
  const state = useFocus(focus);
  const focusing = state.until !== undefined && state.mode === "isolated";
  const open = (item: KeptAlert) => {
    held.remove(item);
    void navigation.open(item.target);
  };
  return (
    <FullPageSurface aria-label="Focus alerts">
      <div data-buzz-ui="" className={styles.page}>
        <PanelHeader
          title={
            <PanelHeaderLabel
              title="Focus alerts"
              icon={<TelescopeIcon size="1rem" />}
            />
          }
          actions={
            items.length > 0 && (
              <Button size="sm" variant="ghost" onClick={held.clear}>
                Clear all
              </Button>
            )
          }
        />
        {error && (
          <p role="alert" className={styles.notice}>
            {error}
          </p>
        )}
        {focusing && items.length > 0 && (
          <div className={styles.banner}>
            <span className="text-body-sm text-subtle">
              These open when Focus ends.
            </span>
            <Button size="sm" variant="ghost" onClick={focus.end}>
              End focus
            </Button>
          </div>
        )}
        {items.length ? (
          <ul className={styles.list} aria-label="Held alerts">
            {items.map((item) => (
              <li key={`${item.at}:${item.title}:${item.body}`}>
                <NavigationItem
                  multiline
                  disabled={focusing}
                  onClick={() => open(item)}
                  label={
                    <span className={styles.alert}>
                      <span className="text-label">{item.title}</span>
                      <span className="text-body-sm text-subtle">
                        {item.body}
                      </span>
                    </span>
                  }
                  trailing={
                    <span className="text-caption text-subtle">
                      {item.label} · {relativeTimestamp(item.at / 1000)}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<TelescopeIcon size={24} />}
            title="Nothing waiting"
            description="Alerts that arrive while you focus wait here until you open them."
          />
        )}
      </div>
    </FullPageSurface>
  );
}
