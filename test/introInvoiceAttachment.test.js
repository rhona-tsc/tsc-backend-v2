import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIntroInvoiceAttachments,
  createPinnedLookup,
  downloadIssuedInvoicePdf,
  getIntroInvoiceUrl,
  getIssuedInvoiceDownloadUrl,
  parseCloudinaryInvoiceUrl,
} from "../utils/introInvoiceAttachment.js";

const cloudName = "dvcgr3fyd";
const storedCloudinaryUrl =
  `https://res.cloudinary.com/${cloudName}/raw/upload/v1792095870/` +
  "booking-board-invoices/invoice-BBM%20497%20DESIGN-1792095869008.pdf";
const fullPublicId =
  "booking-board-invoices/invoice-BBM 497 DESIGN-1792095869008.pdf";
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

const makeCloudinaryClient = (capture = {}) => ({
  config: () => ({ cloud_name: cloudName }),
  utils: {
    private_download_url: (publicId, format, options) => {
      Object.assign(capture, { publicId, format, options });
      return `https://api.cloudinary.com/v1_1/${cloudName}/raw/download?signature=test`;
    },
  },
});

test("intro email consistently selects the issued board invoice URL", () => {
  assert.equal(
    getIntroInvoiceUrl({
      invoicePdfUrl: ` ${storedCloudinaryUrl} `,
      invoiceUrl: "https://invoices.example.com/legacy.pdf",
      payments: { boardInvoicePdfUrl: "https://invoices.example.com/nested.pdf" },
    }),
    storedCloudinaryUrl,
  );
});

test("Cloudinary URL parsing preserves the exact raw public ID including .pdf", () => {
  assert.deepEqual(
    parseCloudinaryInvoiceUrl(storedCloudinaryUrl, cloudName),
    { publicId: fullPublicId, version: "1792095870", format: "pdf" },
  );
});

test("Cloudinary URL parsing rejects non-canonical asset paths", () => {
  assert.throws(
    () => parseCloudinaryInvoiceUrl(`${storedCloudinaryUrl}?download=1`, cloudName),
    /canonical/i,
  );
  assert.throws(
    () => parseCloudinaryInvoiceUrl(
      storedCloudinaryUrl.replace("booking-board-invoices/", "booking-board-invoices%2Finjected/"),
      cloudName,
    ),
    /asset path/i,
  );
});

test("Cloudinary download URL is short-lived and signed for the raw upload", () => {
  const capture = {};
  const downloadUrl = getIssuedInvoiceDownloadUrl(storedCloudinaryUrl, {
    cloudinaryClient: makeCloudinaryClient(capture),
    now: () => 1_800_000_000_000,
  });

  assert.match(downloadUrl, /^https:\/\/api\.cloudinary\.com\//);
  assert.equal(capture.publicId, fullPublicId);
  assert.equal(capture.format, null);
  assert.deepEqual(capture.options, {
    resource_type: "raw",
    type: "upload",
    expires_at: 1_800_000_300,
  });
});

test("intro email attaches the exact issued bytes and never invokes a renderer", async () => {
  const exactIssuedBytes = Buffer.concat([
    Buffer.from("%PDF-1.7\n"),
    Buffer.from([0, 1, 2, 127, 128, 254, 255]),
    Buffer.from("\n%%EOF"),
  ]);
  const capture = {};
  let requestedUrl = "";
  let rendererCalled = false;

  const attachments = await buildIntroInvoiceAttachments(
    { bookingRef: "BBM 497 DESIGN", invoicePdfUrl: storedCloudinaryUrl },
    {
      cloudinaryClient: makeCloudinaryClient(capture),
      now: () => 1_800_000_000_000,
      resolveHostname: publicLookup,
      fetchImpl: async (url) => {
        requestedUrl = url;
        return new Response(exactIssuedBytes, {
          status: 200,
          headers: { "content-length": String(exactIssuedBytes.length) },
        });
      },
      renderInvoicePdf: async () => {
        rendererCalled = true;
        return Buffer.from("%PDF-regenerated");
      },
    },
  );

  assert.match(requestedUrl, /^https:\/\/api\.cloudinary\.com\//);
  assert.equal(capture.publicId, fullPublicId);
  assert.equal(rendererCalled, false);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].filename, "BBM 497 DESIGN-invoice.pdf");
  assert.deepEqual(attachments[0].content, exactIssuedBytes);
  assert.equal(attachments[0].contentType, "application/pdf");
  assert.equal("path" in attachments[0], false);
});

test("safe non-Cloudinary invoice URLs still download into a buffer", async () => {
  const pdf = Buffer.from("%PDF-1.4 imported invoice");
  const sourceUrl = "https://invoices.example.com/imported/issued-document";
  let requestedUrl = "";

  const attachments = await buildIntroInvoiceAttachments(
    { invoiceUrl: sourceUrl },
    {
      resolveHostname: publicLookup,
      fetchImpl: async (url) => {
        requestedUrl = url;
        return new Response(pdf, { status: 200 });
      },
    },
  );

  assert.equal(requestedUrl, sourceUrl);
  assert.deepEqual(attachments[0].content, pdf);
});

test("production downloader pins the validated address and requests identity bytes", async () => {
  const pdf = Buffer.from("%PDF-1.4 pinned transport");
  let requestOptions = null;

  const content = await downloadIssuedInvoicePdf(
    "https://invoices.example.com/issued.pdf",
    {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestImpl: async (_url, options) => {
        requestOptions = options;
        return new Response(pdf, { status: 200 });
      },
    },
  );

  assert.deepEqual(content, pdf);
  assert.equal(requestOptions.address, "93.184.216.34");
  assert.equal(requestOptions.family, 4);
  assert.equal(requestOptions.headers["accept-encoding"], "identity");
});

test("pinned DNS lookup supports Node's all-address request mode", async () => {
  const lookup = createPinnedLookup("93.184.216.34", 4);
  const all = await new Promise((resolve, reject) => {
    lookup("invoices.example.com", { all: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses));
  });
  const one = await new Promise((resolve, reject) => {
    lookup("invoices.example.com", { all: false }, (error, address, family) =>
      error ? reject(error) : resolve({ address, family }));
  });

  assert.deepEqual(all, [{ address: "93.184.216.34", family: 4 }]);
  assert.deepEqual(one, { address: "93.184.216.34", family: 4 });
});

test("invoice downloads reject private network targets before fetch", async () => {
  let fetchCalled = false;

  await assert.rejects(
    downloadIssuedInvoicePdf("https://127.0.0.1/invoice.pdf", {
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response(Buffer.from("%PDF"));
      },
    }),
    /public address/i,
  );
  assert.equal(fetchCalled, false);
});

test("invoice redirects are revalidated before the next request", async () => {
  let fetchCalls = 0;

  await assert.rejects(
    downloadIssuedInvoicePdf("https://invoices.example.com/invoice.pdf", {
      resolveHostname: publicLookup,
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/internal.pdf" },
        });
      },
    }),
    /public address/i,
  );
  assert.equal(fetchCalls, 1);
});

test("invoice downloads enforce the attachment size limit", async () => {
  await assert.rejects(
    downloadIssuedInvoicePdf("https://invoices.example.com/invoice.pdf", {
      maxBytes: 10,
      resolveHostname: publicLookup,
      fetchImpl: async () => new Response(Buffer.from("%PDF too large"), {
        status: 200,
        headers: { "content-length": "14" },
      }),
    }),
    /too large/i,
  );
});

test("invoice downloads enforce the size limit while streaming", async () => {
  await assert.rejects(
    downloadIssuedInvoicePdf("https://invoices.example.com/invoice.pdf", {
      maxBytes: 10,
      resolveHostname: publicLookup,
      fetchImpl: async () => new Response(Buffer.from("%PDF-123456789"), {
        status: 200,
      }),
    }),
    /too large/i,
  );
});

test("invoice downloads reject non-success responses", async () => {
  await assert.rejects(
    downloadIssuedInvoicePdf("https://invoices.example.com/invoice.pdf", {
      resolveHostname: publicLookup,
      fetchImpl: async () => new Response("unauthorised", { status: 401 }),
    }),
    /HTTP 401/i,
  );
});

test("invoice downloads reject non-PDF responses", async () => {
  await assert.rejects(
    downloadIssuedInvoicePdf("https://invoices.example.com/invoice.pdf", {
      resolveHostname: publicLookup,
      fetchImpl: async () => new Response("not a PDF", { status: 200 }),
    }),
    /not a valid PDF/i,
  );
});

test("invoice download timeout includes DNS resolution", async () => {
  let requestCalled = false;
  await assert.rejects(
    downloadIssuedInvoicePdf("https://invoices.example.com/invoice.pdf", {
      timeoutMs: 5,
      resolveHostname: async () => new Promise(() => {}),
      requestImpl: async () => {
        requestCalled = true;
        return new Response(Buffer.from("%PDF-1.4"));
      },
    }),
    /timed out/i,
  );
  assert.equal(requestCalled, false);
});

test("intro email does not fetch an attachment before an invoice is issued", async () => {
  let fetchCalled = false;
  const attachments = await buildIntroInvoiceAttachments(
    { bookingRef: "TSC 124 TEST" },
    {
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response(Buffer.from("%PDF"));
      },
    },
  );

  assert.deepEqual(attachments, []);
  assert.equal(fetchCalled, false);
});

test("Cloudinary invoice URLs from another account are rejected", () => {
  const otherCloudUrl = storedCloudinaryUrl.replace(cloudName, "other-cloud");
  assert.throws(
    () => getIssuedInvoiceDownloadUrl(otherCloudUrl, {
      cloudinaryClient: makeCloudinaryClient(),
    }),
    /does not match/i,
  );
});
