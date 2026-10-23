import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import bcryptjs from "bcryptjs";
import nodemailer from "nodemailer";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { readSpreadsheetRows, spreadsheetSerialDate } from "../utils/spreadsheetImport.js";
import { google } from "googleapis";
import puppeteer from "puppeteer";

test("updated password library still accepts existing bcrypt hashes", async () => {
  const hash = await bcryptjs.hash("synthetic-compatibility-password", 4);
  assert.equal(await bcrypt.compare("synthetic-compatibility-password", hash), true);
  assert.equal(await bcrypt.compare("wrong-password", hash), false);
  assert.equal(await bcryptjs.compare("synthetic-compatibility-password", await bcrypt.hash("synthetic-compatibility-password", 4)), true);
});

test("email upgrade supports our HTML, text and invoice attachment format without sending mail", async () => {
  const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const result = await transporter.sendMail({
    from: "test@example.com", to: "client@example.com", subject: "Synthetic invoice test",
    text: "Your invoice", html: "<p>Your invoice</p>",
    attachments: [{ filename: "invoice.pdf", content: Buffer.from("%PDF-1.4 synthetic") }],
  });
  const message = result.message.toString();
  assert.match(message, /multipart\/mixed/);
  assert.match(message, /invoice\.pdf/);
  assert.match(message, /Synthetic invoice test/);
});

test("CSV parsing preserves finance import columns and quoted currency", () => {
  assert.deepEqual(parse('Date,Amount,Description\r\n2026-10-23,"1,200.50",Deposit\r\n', { columns: true, skip_empty_lines: true, trim: true }), [
    { Date: "2026-10-23", Amount: "1,200.50", Description: "Deposit" },
  ]);
});

test("replacement spreadsheet reader preserves dates, blank columns, formulas and rich text", async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Bookings");
  sheet.addRow(["Name", "Date", "Blank", "Amount", "Venue"]);
  sheet.addRow(["Synthetic booking", new Date("2026-10-23T00:00:00Z"), null, { formula: "100+20", result: 120 }, { richText: [{ text: "Test " }, { text: "Hall" }] }]);
  sheet.getCell("B2").numFmt = "yyyy-mm-dd";
  sheet.addConditionalFormatting({ ref: "D2", rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF00FF00" } }] });
  const rows = await readSpreadsheetRows(await workbook.xlsx.writeBuffer());
  assert.deepEqual(rows[0], ["Name", "Date", "Blank", "Amount", "Venue"]);
  assert.equal(rows[1][1].toISOString(), "2026-10-23T00:00:00.000Z");
  assert.deepEqual(rows[1].slice(2), ["", 120, "Test Hall"]);
  assert.equal(spreadsheetSerialDate(46318).toISOString().slice(0, 10), "2026-10-23");
});

test("Google Calendar, Search Console and YouTube clients retain request compatibility without network access", async () => {
  const auth = new google.auth.OAuth2("synthetic-client", "synthetic-secret", "https://example.com/callback");
  const requests = [];
  auth.request = async options => { requests.push(options); return { data: { items: [], rows: [] } }; };
  const calendar = google.calendar({ version: "v3", auth });
  await calendar.events.list({ calendarId: "primary", maxResults: 1 });
  await calendar.events.insert({ calendarId: "primary", requestBody: { summary: "Synthetic", start: { date: "2027-01-01" }, end: { date: "2027-01-02" } } });
  await google.youtube({ version: "v3", auth }).videos.list({ part: ["snippet"], id: ["synthetic"] });
  await google.searchconsole({ version: "v1", auth }).searchanalytics.query({ siteUrl: "https://example.com", requestBody: { startDate: "2026-10-01", endDate: "2026-10-02" } });
  assert.equal(requests.length, 4);
  assert.equal(String(requests[0].method).toUpperCase(), "GET");
  assert.equal(String(requests[1].method).toUpperCase(), "POST");
  assert.match(String(requests[0].url), /calendars\/primary\/events/);
});

test("updated browser generates a synthetic PDF without bookings or external requests", { timeout: 30000 }, async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body><h1>Synthetic invoice</h1><p>Compatibility test only.</p></body></html>");
    const pdf = Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 1000);
  } finally { await browser.close(); }
});
