import type { RelayData } from "../../features/relay/service";
import type { StatusInput, UserStatus } from "../../features/relay/user-status";
import type { Focus } from "./state";

export const FOCUS_STATUS = Object.freeze({ text: "Focusing", emoji: "🔭" });

const isFocusStatus = (status: UserStatus | undefined) =>
  status?.text === FOCUS_STATUS.text && status.emoji === FOCUS_STATUS.emoji;

/** Sets the telescope status in the selected community when Focus starts and
 * puts back what it replaced when Focus ends, unless the status changed since.
 * The status expires on its own at the deadline even if this app is closed. */
export function bindFocusStatus(
  focus: Focus,
  relay: RelayData,
  report: (error: unknown) => void = (error) =>
    console.warn("Focus status", error),
) {
  let closed = false;
  let running = false;
  let again = false;
  // One attempt per Focus deadline: a failed set is not retried on every
  // relay change, and ending Focus still restores whatever was recorded.
  let failedUntil: number | undefined;
  const step = async () => {
    const { session, status, scope, viewer, cached } = relay.snapshot();
    if (status !== "ready" || cached || !scope || !viewer) return;
    const statuses = session.statuses;
    if (!statuses.writable) return;
    const { until, status: record } = focus.snapshot();
    // A record from an earlier Focus that never got back to its community
    // does not block this one.
    if (
      until !== undefined &&
      record?.until !== until &&
      failedUntil !== until
    ) {
      failedUntil = until;
      const current = await statuses.current(viewer);
      if (closed || focus.snapshot().until !== until) return;
      const previous: StatusInput | null =
        current && !isFocusStatus(current) && (current.text || current.emoji)
          ? {
              text: current.text,
              emoji: current.emoji,
              ...(current.expiresAt === undefined
                ? {}
                : { expiresAt: current.expiresAt }),
            }
          : null;
      // Remember first: a crash after saving still restores the old status.
      focus.recordStatus({ until, scope, previous });
      try {
        await statuses.save({ ...FOCUS_STATUS, expiresAt: until });
        failedUntil = undefined;
      } catch (error) {
        focus.recordStatus(undefined);
        throw error;
      }
    } else if (until === undefined && record?.scope === scope) {
      const current = await statuses.current(viewer);
      if (closed || focus.snapshot().until !== undefined) return;
      const previous = record.previous;
      const live =
        previous &&
        (previous.expiresAt === undefined ||
          previous.expiresAt > Date.now() / 1000)
          ? previous
          : undefined;
      if (isFocusStatus(current))
        await statuses.save(live ?? { text: "", emoji: "" });
      else if (!current && live) await statuses.save(live);
      focus.recordStatus(undefined);
    }
  };
  const sync = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          await step();
        } catch (error) {
          if (!closed) report(error);
        }
      } while (again && !closed);
    } finally {
      running = false;
    }
  };
  const stopFocus = focus.subscribe(() => void sync());
  const stopRelay = relay.subscribe(() => void sync());
  void sync();
  return () => {
    closed = true;
    stopFocus();
    stopRelay();
  };
}

/** Focus lets through only conversations the selected community lists as Solo. */
export function soloConversation(
  relay: RelayData,
  target: { kind: string; channelId?: string },
) {
  if (target.kind !== "conversation" || !target.channelId) return false;
  const { status, session } = relay.snapshot();
  return (
    status === "ready" &&
    session.channels
      .list()
      .channels.some(
        (channel) =>
          channel.id === target.channelId && channel.channelType === "solo",
      )
  );
}
