import { useState, useSyncExternalStore } from "react";
import { TelescopeIcon } from "../../shared/design-system/icons/index";
import { Button } from "../../shared/design-system/ui/Button";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { FieldButton } from "../../shared/design-system/ui/FieldButton";
import {
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRoot,
  MenuTrigger,
} from "../../shared/design-system/ui/Menu";
import { StatusExpiration } from "../../features/user-status/StatusExpiration";
import { statusDeadline } from "../../features/user-status/status-duration";
import type { Focus } from "./state";
import styles from "./Focus.module.css";

export const focusDurations = [
  ["1800", "30 minutes"],
  ["3600", "1 hour"],
  ["7200", "2 hours"],
  ["today", "Rest of today"],
  ["custom", "Custom"],
] as const;
type Duration = (typeof focusDurations)[number][0];

export function useFocus(focus: Focus) {
  return useSyncExternalStore(focus.subscribe, focus.snapshot);
}

/** "3:30 PM" today, otherwise "Tue 3:30 PM". */
export function focusUntilLabel(until: number, now = new Date()) {
  const date = new Date(until * 1000);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return date.toDateString() === now.toDateString()
    ? time
    : `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** Sidebar banner while Focus is on: what is held, until when, and End. */
export function FocusBanner({ focus }: { focus: Focus }) {
  const { until } = useFocus(focus);
  if (until === undefined) return null;
  return (
    <div className={styles.banner}>
      <span className={`${styles.label} text-label-sm`}>
        <TelescopeIcon size={16} aria-hidden="true" />
        Focusing until {focusUntilLabel(until)}
      </span>
      <Button size="sm" variant="ghost" onClick={focus.end}>
        End
      </Button>
    </div>
  );
}

/** The profile-menu action: start Focus for a duration, or end it early. */
export function FocusDialog({
  open,
  onOpenChange,
  focus,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  focus: Focus;
}) {
  const state = useFocus(focus);
  const [duration, setDuration] = useState<Duration>("3600");
  const [custom, setCustom] = useState(() => {
    const date = new Date(Date.now() + 3600_000);
    date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0);
    return date;
  });
  const [error, setError] = useState("");
  const close = () => onOpenChange(false);
  const on = state.until !== undefined;
  const start = () => {
    const now = Math.floor(Date.now() / 1000);
    try {
      focus.start(
        duration === "custom"
          ? Math.floor(custom.getTime() / 1000)
          : statusDeadline(duration, now),
      );
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const durationLabel =
    focusDurations.find(([value]) => value === duration)?.[1] ?? "";
  return (
    <Dialog
      size="compact"
      open={open}
      onOpenChange={onOpenChange}
      title="Focus"
      closeLabel="Close Focus"
      description={
        on
          ? `Focusing until ${focusUntilLabel(state.until as number)}. Only Solo chats are shown and can alert you.`
          : "Show only your Solo chats. Nothing else alerts you until Focus ends; unread messages wait for you."
      }
      actions={
        on ? (
          <Button
            variant="prominent"
            onClick={() => {
              focus.end();
              close();
            }}
          >
            End focus
          </Button>
        ) : (
          <Button variant="prominent" onClick={start}>
            Start focus
          </Button>
        )
      }
    >
      {!on && (
        <div className={styles.fields}>
          <div className={styles.section}>
            <span className="text-label-sm text-subtle">Duration</span>
            <MenuRoot>
              <MenuTrigger
                aria-label={`Duration: ${durationLabel}`}
                render={<FieldButton />}
              >
                {durationLabel}
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuRadioGroup
                  value={duration}
                  onValueChange={(value) => {
                    setDuration(value as Duration);
                    setError("");
                  }}
                  aria-label="Duration"
                >
                  {focusDurations.map(([value, label]) => (
                    <MenuRadioItem key={value} value={value} closeOnClick>
                      {label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </MenuRoot>
          </div>
          {duration === "custom" && (
            <StatusExpiration
              label="Focus end"
              value={custom}
              disabled={false}
              onChange={(next) => {
                setCustom(next);
                setError("");
              }}
            />
          )}
        </div>
      )}
      {(error || state.error) && (
        <p role="alert" className="text-body-sm text-danger">
          {error || state.error}
        </p>
      )}
    </Dialog>
  );
}
