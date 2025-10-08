// backend/services/remindersQueue.js
// Tiny, dependency-free scheduler using an in-memory list + setInterval.
// Named exports: enqueueReminder, startRemindersPoller

const _reminders = []; // [{ type, data:{ bookingId, whenISO, kind, ... } }]

/**
 * Queue a reminder to run at/after `whenISO`.
 * @param {string} type - e.g. "BALANCE_REMINDER"
 * @param {{bookingId:string, whenISO:string|Date, kind?:string}} data
 */
export async function enqueueReminder(type, data) {
  if (!data?.bookingId || !data?.whenISO) {
    throw new Error("enqueueReminder: bookingId and whenISO are required");
  }
  const when = new Date(data.whenISO);
  _reminders.push({ type, data: { ...data, whenISO: when.toISOString() } });
  // Sort so we can break early in the poller
  _reminders.sort((a, b) => new Date(a.data.whenISO) - new Date(b.data.whenISO));
  return true;
}

let _started = false;

/**
 * Start the poller. It dynamically imports the worker to avoid circular deps.
 * @param {{intervalMs?:number}} opts
 */
export function startRemindersPoller({ intervalMs = 30000 } = {}) {
  if (_started) return;
  _started = true;

  const tick = async () => {
    const now = Date.now();

    for (let i = _reminders.length - 1; i >= 0; i--) {
      const job = _reminders[i];
      const due = new Date(job.data.whenISO).getTime();
      if (due <= now) {
        _reminders.splice(i, 1);
        try {
          const mod = await import("./reminderWorker.js").catch(() => null);
          const handleBalanceReminder =
            mod?.handleBalanceReminder ||
            (async (payload) => console.log("🔔 (fallback) Reminder:", payload));

          // Normalize to the worker’s expected shape
          if (job.type === "BALANCE_REMINDER") {
            await handleBalanceReminder({ data: { bookingId: job.data.bookingId, kind: job.data.kind } });
          } else {
            await handleBalanceReminder({ data: job.data });
          }
        } catch (err) {
          console.error("Reminder execution failed:", err?.message || err);
        }
      } else {
        // list is time-sorted — nothing else due yet
        break;
      }
    }
  };

  setTimeout(tick, 2000);
  const interval = setInterval(tick, intervalMs);
  interval.unref?.();
}