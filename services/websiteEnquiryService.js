import Act from "../models/actModel.js";
import Receipt from "../models/websiteEnquiryReceipt.js";
import crypto from "node:crypto";
import Enquiry from "../models/enquiryBoardItem.js";
import User from "../models/userModel.js";
import { normalizeAttribution, attributionSource } from '../utils/marketingAttribution.js';

export function websiteEnquiryIdentity(payload = {}, now = new Date()) {
  const email = String(payload.clientEmail || "").trim().toLowerCase();
  const date = String(payload.dateISO || payload.date || "").slice(0, 10);
  const address = String(payload.formattedAddress || payload.address || "").trim();
  const event = new Date(`${date}T12:00:00Z`);
  const today = now.toISOString().slice(0, 10);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !payload.actId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(event.getTime()) ||
      event.toISOString().slice(0, 10) !== date || date < today ||
      address.length < 3 || /^(tbc|unknown)$/i.test(address)) return null;
  const postcode = address.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/)?.[0];
  const location = (postcode || address).toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = crypto.createHash("sha256").update([email, date, location].join("|")).digest("hex");
  return { email, date, address, id: `enquiry:${key}`, websiteKey: `${key}:${payload.actId}` };
}

export async function recordWebsiteEnquiry(payload, { EnquiryModel = Enquiry, UserModel = User, ReceiptModel = Receipt, ActModel = Act, now = new Date() } = {}) {
  let clientEmail = payload.clientEmail || "";
  let clientName = payload.clientName || "";
  if (payload.userId || payload.clientUserId) {
    const user = await UserModel.findById(payload.userId || payload.clientUserId).select("email firstName surname").lean();
    if (user) { clientEmail = user.email; clientName = `${user.firstName || ""} ${user.surname || ""}`.trim(); }
  }
  const identity = websiteEnquiryIdentity({ ...payload, clientEmail }, now);
  if (!identity || payload.isDeputy) return null;
  const act = await ActModel.findById(payload.actId).select("name tscName lineups").lean();
  const lineup = payload.lineupId ? act?.lineups?.find(item => String(item._id || item.lineupId) === String(payload.lineupId)) : act?.lineups?.[0];
  if (!act || !lineup) throw new Error("Please select a valid band and lineup.");
  const lineupId = String(lineup._id || lineup.lineupId);
  payload.lineupId = lineupId;
  identity.websiteKey += `:${lineupId}`;

  let receipt;
  const attribution = normalizeAttribution(payload.attribution, now);
  try {
    receipt = await ReceiptModel.findOneAndUpdate({ _id: identity.id }, {
      $setOnInsert: { _id: identity.id, key: identity.id, receiptId: `enquiry:${crypto.randomUUID()}`, ...(attribution ? { attribution } : {}) },
    }, { upsert: true, new: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    receipt = await ReceiptModel.findOne({ _id: identity.id });
    if (!receipt) throw error;
  }
  const ref = `WEB-${identity.id.slice(8, 28)}-${String(payload.actId).slice(-6)}-${lineupId.slice(-6)}`;
  const savedAttribution = receipt.attribution || attribution;
  const enquiryMongoId = crypto.createHash("sha256").update(identity.websiteKey).digest("hex").slice(0, 24);
  const row = await EnquiryModel.findOneAndUpdate({ _id: enquiryMongoId, websiteKey: identity.websiteKey }, {
    $setOnInsert: { websiteKey: identity.websiteKey, enquiryRef: ref, enquiryDateISO: now.toISOString().slice(0, 10),
      clientEmail: identity.email, clientName, eventDateISO: identity.date,
      address: identity.address, actId: payload.actId, actName: act.name || "", actTscName: act.tscName || act.name || "",
      lineupId, bandSize: lineup.bandMembers?.length || 0,
      agent: "TSC Direct", status: "open", measurementId: receipt.receiptId,
      marketingSource: attributionSource(savedAttribution) || 'Direct / unknown',
      ...(savedAttribution ? { attribution: savedAttribution } : {}) },
  }, { upsert: true, new: true });
  return { enquiryRef: row.enquiryRef, measurement: { kind: "enquiry", id: receipt.receiptId } };
}

// Match server-owned enquiry records. A client cannot attach another person's
// enquiry reference to their checkout or override its recorded acquisition source.
export async function linkBookingEnquiries({ email, date, address, actsSummary, attribution }, { EnquiryModel = Enquiry, now = new Date() } = {}) {
  const rows = [];
  for (const act of actsSummary || []) {
    const identity = websiteEnquiryIdentity({ clientEmail: email, dateISO: String(date || '').slice(0, 10),
      formattedAddress: address, actId: act.actId }, now);
    if (!identity || !act.lineupId) continue;
    const row = await EnquiryModel.findOne({ websiteKey: `${identity.websiteKey}:${act.lineupId}` })
      .select('enquiryRef measurementId attribution').lean();
    if (row) rows.push(row);
  }
  const savedAttribution = rows.find(row => row.attribution)?.attribution || normalizeAttribution(attribution, now);
  return {
    linkedEnquiryRefs: [...new Set(rows.map(row => row.enquiryRef).filter(Boolean))],
    linkedMeasurementIds: [...new Set(rows.map(row => row.measurementId).filter(Boolean))],
    ...(savedAttribution ? { attribution: savedAttribution } : {}),
  };
}
