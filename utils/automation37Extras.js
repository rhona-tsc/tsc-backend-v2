import { AUTOMATION_37_TIMING } from "./automation37Schedule.js";

const clean = (value) => String(value || "").trim();
const positiveAmount = (value) => Math.max(0, Number(value) || 0);

export const AUTOMATION_37_TAGS = {
  subject: "{{event_details_reminder_subject}}",
  payment: "{{extras_invoice_reminder}}",
  completion: "{{event_details_completion_reminder}}",
};

// These are extras invoice fields only. A main invoice or a card payment link
// must never be substituted for the issued extras PDF.
export const extrasInvoicePdfUrl = (row = {}) => {
  const pdfUrl = clean(row.extrasInvoicePdfUrl) || clean(row.payments?.extrasInvoicePdfUrl);
  if (pdfUrl) return pdfUrl;
  const legacyUrl = clean(row.extrasInvoiceUrl);
  return /\.pdf(?:[?#].*)?$/i.test(legacyUrl) ? legacyUrl : "";
};

export function automation37ExtrasState(row = {}, rule = {}) {
  const invoiceUrl = extrasInvoicePdfUrl(row);
  const extras = row.extras ?? row.bookingDetails?.extras ?? row.actsSummary?.[0]?.selectedExtras;
  const extrasTotal = Array.isArray(extras) && extras.length
    ? extras.filter(extra => extra.includeOnExtrasInvoice !== false)
      .reduce((sum, extra) => sum + positiveAmount(extra.price) * positiveAmount(extra.quantity ?? 1), 0)
    : Math.max(positiveAmount(row.extrasAccounting?.extrasTotal), positiveAmount(row.extrasAccounting?.gross));
  const paid = row.extrasPaid === true || clean(row.extrasStatus).toLowerCase() === "paid"
    || row.payments?.extrasPaymentReceived === true || row.payments?.extrasInvoicePaid === true;
  const hasOutstandingExtras = !paid && (extrasTotal > 0 || Boolean(invoiceUrl));
  return {
    invoiceUrl,
    hasOutstandingExtras,
    shouldAttachInvoice: hasOutstandingExtras && Boolean(invoiceUrl) && rule.attachInvoice !== false,
  };
}

export const isEventDetailsExtrasReminder = (rule = {}) => [37, 38].includes(Number(rule.sourceNumber));
export const eventDetailsExtrasState = automation37ExtrasState;

// Keep both reminders' conditional wording together. Only Automation 37 uses
// the advance Thursday rule; Automation 38 retains its deadline-day schedule.
export function prepareEventDetailsReminderRule(rule = {}) {
  if (!isEventDetailsExtrasReminder(rule)) return rule;
  const dueToday = Number(rule.sourceNumber) === 38;
  const standardSubject = dueToday
    ? /^(?:Reminder: Advanced Requests, Event Sheet & Balance|Automated Reminder: Event Sheet(?: & Spotify Playlist\(\/s\)|, Spotify Playlist\(\/s\)\s*& ['‘’"]?Extras['‘’"]? Balance)) Due Today$/i
    : /^(?:Reminder: Advanced Requests, Event Sheet & Balance Due|Automated Reminder: Event Sheet(?: & Spotify Playlist\(\/s\)|, Spotify Playlist\(\/s\)\s*& Extras Balance) Due Soon)$/i;
  return {
    ...rule,
    ...(dueToday ? {} : { timing: { ...rule.timing, ...AUTOMATION_37_TIMING } }),
    subject: standardSubject.test(clean(rule.subject)) ? AUTOMATION_37_TAGS.subject : rule.subject,
    body: String(rule.body || "")
      .replace(/^(?:And\s+)?finally,\s+the\s+(?:['‘’"]?extras['‘’"]?\s+)?balance[^\n]*(?:\n\s*\n(?:\{pulse\.link7\}|\{\{invoice_link\}\}|Invoice attached)[ \t]*)?/gim, AUTOMATION_37_TAGS.payment)
      .replace(/^If you have already submitted your playlist link\(s\),[^\n]*please disregard this email\.[ \t]*/gim, AUTOMATION_37_TAGS.completion),
    attachInvoice: rule.attachInvoice ?? true,
  };
}

export function renderEventDetailsReminderConditions(template, row, rule = {}) {
  if (!isEventDetailsExtrasReminder(rule)) return String(template || "");
  const dueToday = Number(rule.sourceNumber) === 38;
  const { hasOutstandingExtras, shouldAttachInvoice } = automation37ExtrasState(row, rule);
  const values = {
    [AUTOMATION_37_TAGS.subject]: hasOutstandingExtras
      ? (dueToday
        ? "Automated Reminder: Event Sheet, Spotify Playlist(/s) & 'Extras' Balance Due Today"
        : "Automated Reminder: Event Sheet, Spotify Playlist(/s) & Extras Balance Due Soon")
      : `Automated Reminder: Event Sheet & Spotify Playlist(/s) Due ${dueToday ? "Today" : "Soon"}`,
    [AUTOMATION_37_TAGS.payment]: shouldAttachInvoice
      ? `Finally, the 'extras' balance should also be settled ${dueToday ? "today" : "by this date"}. The issued invoice is attached and includes the BACS details.`
      : "",
    [AUTOMATION_37_TAGS.completion]: hasOutstandingExtras
      ? "If you have already submitted your playlist link(s), completed the Event Sheet, and paid the 'extras' balance, please disregard this email."
      : "If you have already submitted your playlist link(s), and completed the Event Sheet, please disregard this email.",
  };
  return Object.entries(values).reduce((output, [tag, value]) => output.split(tag).join(value), String(template || ""))
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n");
}


// Retain the existing Automation 37 API for its callers and regression tests.
export const prepareAutomation37Rule = (rule = {}) => Number(rule.sourceNumber) === 37
  ? prepareEventDetailsReminderRule(rule) : rule;
export const renderAutomation37Conditions = (template, row, rule = {}) => Number(rule.sourceNumber) === 37
  ? renderEventDetailsReminderConditions(template, row, rule) : String(template || "");
