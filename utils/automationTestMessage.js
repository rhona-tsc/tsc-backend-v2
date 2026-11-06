import mongoose from "mongoose";
import {
  automation37ExtrasState,
  prepareAutomation37Rule,
  renderAutomation37Conditions,
} from "./automation37Extras.js";

const invalidRequest = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

// Resolve conditional wording from the persisted booking, so an old browser
// preview cannot attach the main invoice or chase extras already marked paid.
export async function prepareAutomationTestMessage(input, {
  loadBooking,
  buildMainAttachments,
  buildExtrasAttachments,
}) {
  const isExtrasReminder = Number(input.automationNumber) === 37;
  let attachments = [];
  let row;
  if (isExtrasReminder || input.attachInvoice === true) {
    if (!mongoose.isValidObjectId(input.bookingId)) {
      throw invalidRequest("Select a valid booking before testing an invoice reminder.");
    }
    row = await loadBooking(input.bookingId);
    if (!row) throw invalidRequest("Booking not found.", 404);
  }
  let subject = String(input.subject || "").trim();
  let body = String(input.body || "").trim();
  if (isExtrasReminder) {
    const rule = prepareAutomation37Rule({
      sourceNumber: 37, subject, body, attachInvoice: input.attachInvoice !== false,
    });
    subject = renderAutomation37Conditions(rule.subject, row, rule);
    body = renderAutomation37Conditions(rule.body, row, rule);
    if (automation37ExtrasState(row, rule).shouldAttachInvoice) {
      attachments = await buildExtrasAttachments(row);
      if (!attachments.length) throw new Error("The issued extras invoice PDF could not be attached.");
    }
  } else if (input.attachInvoice === true) {
    attachments = await buildMainAttachments(row);
  }
  return { subject, body, attachments };
}
