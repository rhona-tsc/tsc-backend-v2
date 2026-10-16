import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;
const CLOUDINARY_DELIVERY_HOST = "res.cloudinary.com";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const cleanString = (value) => String(value || "").trim();

const remoteIpv4BlockList = new BlockList();
[
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].forEach(([address, prefix]) => {
  remoteIpv4BlockList.addSubnet(address, prefix, "ipv4");
});
const remoteIpv6BlockList = new BlockList();
[
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
].forEach(([address, prefix]) => {
  remoteIpv6BlockList.addSubnet(address, prefix, "ipv6");
});

const defaultResolveHostname = (hostname) => dnsLookup(hostname, {
  all: true,
  verbatim: true,
});

const getHostnameWithoutBrackets = (hostname) =>
  hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

const isBlockedRemoteAddress = (address) => {
  const family = isIP(address);
  if (!family) return true;
  return family === 4
    ? remoteIpv4BlockList.check(address, "ipv4")
    : remoteIpv6BlockList.check(address, "ipv6");
};

export const getIntroInvoiceUrl = (row) => cleanString(
  row?.invoicePdfUrl || row?.invoiceUrl || row?.payments?.boardInvoicePdfUrl,
);

export const parseCloudinaryInvoiceUrl = (value, expectedCloudName) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The issued invoice URL is invalid.");
  }

  if (parsed.hostname.toLowerCase() !== CLOUDINARY_DELIVERY_HOST) return null;
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    throw new Error("The Cloudinary invoice URL is not safe to download.");
  }

  if (parsed.search || parsed.hash) {
    throw new Error("The Cloudinary invoice URL is not canonical.");
  }

  const pathParts = parsed.pathname.split("/");
  if (pathParts[0] !== "" || pathParts.slice(1).some((segment) => !segment)) {
    throw new Error("The Cloudinary invoice asset path is invalid.");
  }
  const segments = pathParts.slice(1);
  const [cloudName, resourceType, deliveryType, version, ...encodedPublicId] = segments;
  if (
    !expectedCloudName ||
    cloudName !== expectedCloudName ||
    resourceType !== "raw" ||
    deliveryType !== "upload" ||
    !/^v\d+$/.test(version || "") ||
    !encodedPublicId.length
  ) {
    throw new Error("The Cloudinary invoice URL does not match the configured PDF asset.");
  }

  let decodedPublicIdSegments;
  try {
    decodedPublicIdSegments = encodedPublicId.map(decodeURIComponent);
  } catch {
    throw new Error("The Cloudinary invoice asset path is invalid.");
  }

  if (decodedPublicIdSegments.some((segment) =>
    segment.includes("/") ||
    segment.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(segment) ||
    segment === "." ||
    segment === ".."
  )) {
    throw new Error("The Cloudinary invoice asset path is invalid.");
  }

  const publicId = decodedPublicIdSegments.join("/");
  if (
    !publicId.toLowerCase().endsWith(".pdf") ||
    !publicId
  ) {
    throw new Error("The Cloudinary invoice asset path is invalid.");
  }

  return { publicId, version: version.slice(1), format: "pdf" };
};

export const getIssuedInvoiceDownloadUrl = (
  invoiceUrl,
  { cloudinaryClient, now = Date.now } = {},
) => {
  let parsed;
  try {
    parsed = new URL(invoiceUrl);
  } catch {
    throw new Error("The issued invoice URL is invalid.");
  }

  if (
    parsed.hostname.toLowerCase().endsWith(".cloudinary.com") &&
    parsed.hostname.toLowerCase() !== CLOUDINARY_DELIVERY_HOST
  ) {
    throw new Error("The Cloudinary invoice host is not supported.");
  }

  if (parsed.hostname.toLowerCase() !== CLOUDINARY_DELIVERY_HOST) {
    return parsed.href;
  }

  const config = cloudinaryClient?.config?.();
  const cloudName = cleanString(config?.cloud_name);
  const asset = parseCloudinaryInvoiceUrl(parsed.href, cloudName);
  if (!asset || typeof cloudinaryClient?.utils?.private_download_url !== "function") {
    throw new Error("Cloudinary invoice download is not configured.");
  }

  return cloudinaryClient.utils.private_download_url(asset.publicId, null, {
    resource_type: "raw",
    type: "upload",
    expires_at: Math.floor(now() / 1000) + 300,
  });
};

const resolveSafeRemoteTarget = async (
  value,
  { resolveHostname = defaultResolveHostname } = {},
) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The issued invoice download URL is invalid.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    throw new Error("The issued invoice must use a safe HTTPS URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    !hostname ||
    hostname.endsWith(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa")
  ) {
    throw new Error("The issued invoice host is not allowed.");
  }

  const literalAddress = getHostnameWithoutBrackets(hostname);
  const resolved = isIP(literalAddress)
    ? [{ address: literalAddress }]
    : await resolveHostname(hostname);
  const addresses = [resolved]
    .flat()
    .map((entry) => cleanString(entry?.address || entry))
    .filter(Boolean);

  if (!addresses.length || addresses.some(isBlockedRemoteAddress)) {
    throw new Error("The issued invoice host does not resolve to a public address.");
  }

  const address = addresses[0];
  return { url: parsed, address, family: isIP(address) };
};

export const assertSafeRemoteUrl = async (value, options = {}) =>
  (await resolveSafeRemoteTarget(value, options)).url;

const getResponseHeader = (headers, name) => {
  const value = headers?.[String(name).toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value == null ? null : String(value);
};

export const createPinnedLookup = (address, family) =>
  (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };

const requestPinnedHttps = (url, {
  address,
  family,
  headers,
  signal,
}) => new Promise((resolve, reject) => {
  const request = httpsRequest(url, {
    method: "GET",
    headers,
    signal,
    lookup: createPinnedLookup(address, family),
  }, (response) => {
    const status = Number(response.statusCode || 0);
    resolve({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name) => getResponseHeader(response.headers, name) },
      body: response,
    });
  });
  request.on("error", reject);
  request.end();
});

const readBoundedResponse = async (response, maxBytes) => {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    if (typeof response.body?.cancel === "function") {
      await response.body.cancel();
    } else {
      response.body?.destroy?.();
    }
    throw new Error("The issued invoice PDF is too large to attach.");
  }

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error("The issued invoice PDF is too large to attach.");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, totalBytes);
  }

  if (response.body?.[Symbol.asyncIterator]) {
    const chunks = [];
    let totalBytes = 0;
    for await (const value of response.body) {
      const chunk = Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        response.body.destroy?.();
        throw new Error("The issued invoice PDF is too large to attach.");
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, totalBytes);
  }

  if (typeof response.arrayBuffer === "function") {
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > maxBytes) {
      throw new Error("The issued invoice PDF is too large to attach.");
    }
    return content;
  }

  throw new Error("The issued invoice PDF response could not be read.");
};

const discardResponseBody = async (body) => {
  if (typeof body?.cancel === "function") {
    await body.cancel();
  } else {
    body?.destroy?.();
  }
};

export const downloadIssuedInvoicePdf = async (
  initialUrl,
  {
    fetchImpl = null,
    requestImpl = requestPinnedHttps,
    resolveHostname = defaultResolveHostname,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
  } = {},
) => {
  if (typeof fetchImpl !== "function" && typeof requestImpl !== "function") {
    throw new Error("Invoice PDF download is not available.");
  }

  const controller = new AbortController();
  let didTimeout = false;
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      reject(new Error("Invoice download deadline exceeded."));
    }, timeoutMs);
  });
  const beforeDeadline = (operation) => Promise.race([operation, deadline]);

  try {
    let currentUrl = initialUrl;
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const target = await beforeDeadline(
        resolveSafeRemoteTarget(currentUrl, { resolveHostname }),
      );
      const headers = {
        accept: "application/pdf,application/octet-stream;q=0.9",
        "accept-encoding": "identity",
      };
      const request = typeof fetchImpl === "function"
        ? fetchImpl(target.url.href, {
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers,
          })
        : requestImpl(target.url, {
            address: target.address,
            family: target.family,
            signal: controller.signal,
            headers,
          });
      const response = await beforeDeadline(request);

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers?.get?.("location");
        await beforeDeadline(discardResponseBody(response.body));
        if (!location || redirectCount === maxRedirects) {
          throw new Error("The issued invoice PDF redirected too many times.");
        }
        currentUrl = new URL(location, target.url).href;
        continue;
      }

      if (!response.ok) {
        await beforeDeadline(discardResponseBody(response.body));
        throw new Error(
          `The issued invoice PDF could not be downloaded (HTTP ${response.status}).`,
        );
      }

      const content = await beforeDeadline(readBoundedResponse(response, maxBytes));
      if (!content.length || content.slice(0, 5).toString() !== "%PDF-") {
        throw new Error("The issued invoice download is not a valid PDF.");
      }
      return content;
    }

    throw new Error("The issued invoice PDF redirected too many times.");
  } catch (error) {
    if (didTimeout) {
      throw new Error("The issued invoice PDF download timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const buildIntroInvoiceAttachments = async (
  row,
  options = {},
) => {
  const invoiceUrl = getIntroInvoiceUrl(row);
  if (!invoiceUrl) return [];

  const downloadUrl = getIssuedInvoiceDownloadUrl(invoiceUrl, options);
  const content = await downloadIssuedInvoicePdf(downloadUrl, options);

  return [{
    filename: `${cleanString(row?.bookingRef) || "booking"}-invoice.pdf`,
    content,
    contentType: "application/pdf",
  }];
};
