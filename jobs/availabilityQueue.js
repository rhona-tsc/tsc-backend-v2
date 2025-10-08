// backend/jobs/availabilityQueue.js
import Availability from "../models/availabilityModel.js";
import DeferredAvailability from "../models/deferredAvailabilityModel.js";
import { sendWAOrSMS } from "../utils/twilioClient.js";
import { pingDeputiesFor } from "../controllers/availabilityController.js"; // export it if not already

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// ---------- helpers (keep local here so this job is self-contained) ----------

// Normalise first-name display so we never show "there" when we have a name
const safeFirst = (s) => {
  const v = String(s || "").trim();
  return v ? v.split(/\s+/)[0] : "there";
};

// Minimal first-name extractor for objects/strings
const firstNameOfLoose = (p) => {
  if (!p) return "";
  if (typeof p === "string") return safeFirst(p);
  const direct =
    p.firstName ||
    p.FirstName ||
    p.first_name ||
    p.firstname ||
    p.givenName ||
    p.given_name ||
    "";
  if (String(direct).trim()) return safeFirst(direct);
  const full = p.name || p.fullName || p.displayName || "";
  return String(full).trim() ? safeFirst(full) : "";
};

// Build the exact SMS text we want for reminders/fallbacks
function buildAvailabilitySMS({ firstName, formattedDate, formattedAddress, fee, duties, actName }) {
  const feeTxt = String(fee ?? "").replace(/^[£$]/, "");
  return ( //  (not used for booking confirmations)

    `Hi 7${safeFirst(firstName)}, you've received an enquiry for a gig on ` +
    `${formattedDate || "the date discussed"} in ${formattedAddress || "the area"} ` +
    `at a rate of £${feeTxt || "TBC"} for ${duties || "performance"} duties ` +
    `with ${actName || "the band"}. Please indicate your availability 💫 ` +
    `Reply YES / NO.`
  );
}

// Quiet hours for reminders: 21:00–08:59 local server time
const isQuietHours = () => {
  const now = new Date();
  const hour = now.getHours();
  return hour >= 21 || hour < 9;
};

export async function processAvailabilityQueue() {
  // 1) One-time reminder after 3h (respect quiet hours)
  const pendings = await Availability.find({ reply: null }).lean();

  for (const p of pendings) {
    const age = Date.now() - new Date(p.updatedAt || p.createdAt).getTime();

    // 3h reminder
    if (age > THREE_HOURS_MS && !p.reminderSent) {
      if (isQuietHours()) continue; // skip reminder during quiet hours

      try {
        // Build a full, personalised SMS fallback body
        const smsBody = buildAvailabilitySMS({
          firstName: p.contactName || firstNameOfLoose(p) || p.musicianName || "",
          formattedDate: p.formattedDate,
          formattedAddress: p.formattedAddress,
          fee: p.fee,
          duties: p.duties,
          actName: p.actName,
        });

        await sendWAOrSMS({
          to: p.phone,
          templateParams: {
            FirstName: safeFirst(p.contactName || firstNameOfLoose(p) || p.musicianName),
            FormattedDate: p.formattedDate,
            FormattedAddress: p.formattedAddress,
            Fee: p.fee,
            Duties: p.duties,
            ActName: p.actName,
          },
          smsBody,
        });

        await Availability.updateOne(
          { _id: p._id },
          { $set: { reminderSent: true, updatedAt: new Date() } }
        );

        // Release next deferred (so new enquiries can flow)
        const next = await DeferredAvailability.findOne({ phone: p.phone }).sort({ createdAt: 1 });
        if (next) {
          // Hydrate template params with sensible fallbacks; require date+address before sending
          const tp = { ...(next.payload?.templateParams || {}) };

          const ensure = (v, fb = "") => (String(v || "").trim() ? v : fb);

          const hydrated = {
            FirstName: ensure(tp.FirstName, next.contactName || firstNameOfLoose(next) || ""),
            FormattedDate: ensure(tp.FormattedDate, next.formattedDate || ""),
            FormattedAddress: ensure(tp.FormattedAddress, next.formattedAddress || ""),
            Fee: ensure(tp.Fee, next.fee || "TBC"),
            Duties: ensure(tp.Duties, next.duties || "performance"),
            ActName: ensure(tp.ActName, next.actName || "the band"),
          };

          // If we still don't have the critical Date+Address, skip sending to avoid a "generic" blast
          if (!hydrated.FormattedDate || !hydrated.FormattedAddress) {
            console.warn("⚠️ Skipping deferred send due to missing date/address; dropping zombie deferred.", {
              FirstName: hydrated.FirstName, date: hydrated.FormattedDate, addr: hydrated.FormattedAddress
            });
            await DeferredAvailability.deleteOne({ _id: next._id });
          } else {
            const smsBody =
              next.payload?.smsBody ||
              buildAvailabilitySMS({
                firstName: hydrated.FirstName,
                formattedDate: hydrated.FormattedDate,
                formattedAddress: hydrated.FormattedAddress,
                fee: hydrated.Fee,
                duties: hydrated.Duties,
                actName: hydrated.ActName,
              });

            const payload = {
              to: next.payload?.to || next.phone,
              templateParams: hydrated,
              smsBody,
            };

            await sendWAOrSMS(payload);
            await DeferredAvailability.deleteOne({ _id: next._id });
          }
        }
      } catch (e) {
        console.warn("⚠️ reminder/send/dequeue failed:", e?.message || e);
      }
    }

    // 2) Lead-silent escalation after 24h → start pinging deputies + email client
    if (age > TWENTY_FOUR_HOURS_MS && !p.deputyEscalated) {
      try {
        await pingDeputiesFor(p.actId, p.lineupId, p.dateISO, p.formattedAddress, p.duties);

        // (Optional) email the client here

        await Availability.updateOne(
          { _id: p._id },
          { $set: { deputyEscalated: true, updatedAt: new Date() } }
        );
      } catch (e) {
        console.warn("⚠️ 24h deputy escalation failed:", e?.message || e);
      }
    }
  }
}