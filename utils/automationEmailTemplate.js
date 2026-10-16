import { escapeEmailHtml } from "./tscEmailBranding.js";

const linkStyle = "color:#ff6667;font-weight:700;";

const linkifyUrls = (value) => escapeEmailHtml(value).replace(
  /(https?:\/\/[^\s<]+)/g,
  `<a href="$1" style="${linkStyle}">$1</a>`,
);

export const automationBodyToHtml = (body) => {
  const source = String(body || "");
  const labelledLink = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let cursor = 0;
  let html = "";
  let match;

  while ((match = labelledLink.exec(source))) {
    html += linkifyUrls(source.slice(cursor, match.index));
    html += `<a href="${escapeEmailHtml(match[2])}" style="${linkStyle}">${escapeEmailHtml(match[1])}</a>`;
    cursor = match.index + match[0].length;
  }

  html += linkifyUrls(source.slice(cursor));
  return html
    .replace(/\n\n+/g, '</p><p style="margin:0 0 20px;font-size:16px;line-height:1.7;">')
    .replace(/\n/g, "<br />");
};
