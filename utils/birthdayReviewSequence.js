export const BIRTHDAY_REVIEW_NUMBER = 41;
export const isBirthdayBooking = (row = {}) => /^birthday(?: party)?$/i.test(String(row.eventType || "").trim());

// Enrolment is explicit: the template can be shared without opting in other bookings.
export const birthdayReviewPlan = (now = new Date()) => ({
  enabled: true,
  exclusive: true,
  configuredAt: now,
  items: [
    { automationNumber: 13, offsetDays: 3 },
    { automationNumber: 15, offsetDays: 10 },
    { automationNumber: BIRTHDAY_REVIEW_NUMBER, offsetDays: 17 },
  ],
});

export const birthdayReviewRule = () => ({
  id: "birthday-review-41",
  sourceNumber: BIRTHDAY_REVIEW_NUMBER,
  name: "Birthday review — final follow-up",
  subject: "WE LOVED PERFORMING FOR YOU 💖",
  body: "Hi {{client_first_name}},\n\nI hope you and your guests have lovely memories of the birthday celebrations! {{act_name}} really enjoyed performing for you.\n\nThis is a final gentle reminder that we would love to hear what you thought. If you can spare a moment to leave a Google review for The Supreme Collective, which {{act_name}} is part of, it would mean a lot to us:\n\nhttps://g.page/r/CesVpcolTfSxEB0/review\n\nIf you have any feedback you would prefer to share directly, please reply to this email.\n\nWarmest wishes,\nRhona ✨ & {{act_name}}",
  enabled: true,
  attachInvoice: false,
  status: "reviewed",
  filters: { eventTypes: ["Birthday Party"], reviewPermission: "allowed", weddingStatus: "", bookedDj: "any", bookedPlaylist: "any", reviewStatus: "any" },
  timing: { strategy: "birthday_review_sequence", reference: "eventDate", offsetDays: 17, label: "17 days after the event, in the saved birthday review sequence" },
});
