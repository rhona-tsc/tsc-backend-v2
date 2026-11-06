import { previousWorkingDayISO } from "./finalDetailsDueDate.js";

// Use the calendar Thursday two weeks before the event's week. Subtracting
// seven days from an already-adjusted invoice deadline would be a day early
// when Christmas Eve moves the deadline from Thursday to Wednesday.
export function automation37SendISO(row = {}) {
  const eventISO = String(row.eventDateISO || row.eventDate || row.date || "")
    .trim().match(/^(\d{4}-\d{2}-\d{2})(?=$|T|\s)/)?.[1];
  if (!eventISO) return "";
  const date = new Date(`${eventISO}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday - 11);
  return previousWorkingDayISO(date.toISOString().slice(0, 10));
}

export const AUTOMATION_37_TIMING = {
  strategy: "final_details_advance",
  reference: "eventDate",
  offsetDays: -14,
  label: "Thursday two calendar weeks before the event; earlier if closed",
};
