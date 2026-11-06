export const REVIEW_AUTOMATION_NUMBERS = [3, 13, 15, 26, 30];
const iso = value => value instanceof Date && !Number.isNaN(value.getTime())
  ? value.toISOString().slice(0, 10)
  : String(value || "").match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || "";
const shift = (value, days) => {
  const date = new Date(`${iso(value)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export const exclusiveReviewPlan = row => row?.reviewRequestPlan?.exclusive === true;
export const reviewPlanItems = (row = {}) => row.reviewRequestPlan?.enabled === true
  ? (row.reviewRequestPlan.items || []).filter(item => [3, 13, 15].includes(Number(item.automationNumber))
    && Number.isInteger(item.offsetDays) && item.offsetDays > 0 && item.offsetDays <= 90)
    .slice(0, 3).sort((a, b) => a.offsetDays - b.offsetDays)
  : [];
export const reviewPlanItem = (row, number) => reviewPlanItems(row)
  .find(item => Number(item.automationNumber) === Number(number));
export const reviewPlanStopReason = (row = {}) => {
  if (row.siteAutomationsEnabled === false) return "site_automations_off";
  if (row.bookingStatus === "cancelled") return "booking_cancelled";
  if (row.review?.doNotRequest === true) return "review_requests_off";
  if (row.review?.source === "google" || row.review?.googleReceivedAt) return "google_review_received";
  return "";
};
const sentReviews = history => (history || []).filter(item => item.status === "sent"
  && REVIEW_AUTOMATION_NUMBERS.includes(Number(item.automationNumber)));

export function reviewPlanSendISO(row, number, history = row?.automationDeliveries || []) {
  const items = reviewPlanItems(row);
  const index = items.findIndex(item => Number(item.automationNumber) === Number(number));
  if (index < 0) return "";
  const planned = shift(row.eventDateISO || row.eventDate || row.date, items[index].offsetDays);
  if (!planned) return "";
  const sent = sentReviews(history);
  const ownSent = sent.find(item => Number(item.automationNumber) === Number(number));
  if (ownSent && iso(ownSent.sentAt)) return iso(ownSent.sentAt);
  const lastSentDay = sent.map(item => iso(item.sentAt)).filter(Boolean).sort().at(-1);
  const earliest = lastSentDay ? shift(lastSentDay, 7) : "";
  return earliest > planned ? earliest : planned;
}

export function reviewPlanSchedule(row, number, todayISO, history = row?.automationDeliveries || []) {
  const items = reviewPlanItems(row);
  const index = items.findIndex(item => Number(item.automationNumber) === Number(number));
  const plannedISO = reviewPlanSendISO(row, number, history);
  const stopped = reviewPlanStopReason(row);
  const blocked = reason => ({ eligible: false, reason, plannedISO });
  if (index < 0) return blocked("no_review_plan");
  if (stopped) return blocked(stopped);
  if (!plannedISO) return blocked("missing_event_date");
  if (iso(todayISO) > shift(row.eventDateISO || row.eventDate || row.date, 90)) return blocked("review_window_closed");
  const sent = sentReviews(history);
  if (sent.some(item => Number(item.automationNumber) === Number(number))) return blocked("already_sent");
  if (sent.length >= 3) return blocked("review_limit_reached");
  if (items.slice(0, index).some(item => !sent.some(delivery => Number(delivery.automationNumber) === Number(item.automationNumber)))) {
    return blocked("awaiting_previous_review_request");
  }
  if (!iso(todayISO) || iso(todayISO) < plannedISO) return blocked("not_due");
  return { eligible: true, reason: iso(todayISO) === plannedISO ? "planned_date" : "catch_up", plannedISO, sendISO: iso(todayISO) };
}

export function reviewPlanTemplate(rule = {}, row = {}) {
  const item = reviewPlanItem(row, rule.sourceNumber);
  return item ? { ...rule, subject: item.subject || rule.subject, body: item.body || rule.body } : rule;
}

export function renderReviewPlanEmail(rule, row, actName) {
  const template = reviewPlanTemplate(rule, row);
  const names = String(row.clientFirstNames || row.bookerName || row.clientName || "there");
  const firstName = names.split(/\s+|&/)[0];
  const values = {
    "{{client_first_name}}": firstName, "{pulse.text7}": firstName,
    "{{client_names}}": names,
    "{{act_name}}": actName, "{pulse.dropdown}": actName,
    "{{event_type}}": row.eventType || "event", "{pulse.dup__of_event_type}": row.eventType || "event",
  };
  const render = value => Object.entries(values).reduce((result, [tag, replacement]) => result.split(tag).join(replacement), String(value || ""));
  const subject = render(template.subject);
  const text = render(template.body);
  if (!subject || !text || /\{\{[^}]+\}\}|\{pulse\.[^}]+\}/.test(`${subject}\n${text}`)) {
    throw new Error("The review request template is incomplete or has unresolved tags.");
  }
  return { subject, text };
}
