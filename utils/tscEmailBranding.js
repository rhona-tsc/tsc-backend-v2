const GOOGLE_REVIEWS_URL = "https://g.page/r/CesVpcolTfSxEB0/review";
const SIGNATURE_GIF_URL =
  "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777045559/TSC_Signature_2026_svgxr5.gif";
const WHATSAPP_URL =
  "https://api.whatsapp.com/send/?phone=447594223200&text&type=phone_number&app_absent=0";
const INSTAGRAM_URL = "https://instagram.com/thesupremecollective";
const YOUTUBE_URL =
  "https://www.youtube.com/channel/UC6HhRZA4XLVajrz5vk5vn2A";
const WEBSITE_URL = "https://thesupremecollective.co.uk";
const INSTAGRAM_ICON_URL =
  "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777056960/instagram-icon_rtespa.png";
const YOUTUBE_ICON_URL =
  "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777056960/1_lo9yf6.png";
const WEBSITE_ICON_URL =
  "https://res.cloudinary.com/dvcgr3fyd/image/upload/v1777207820/website-icon_nuahjk.png";

export const escapeEmailHtml = (value = "") =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const buildTscEmailFooter = () => `
  <div style="margin:24px 0 0;padding:22px;background:#fafafa;border:1px solid #ececec;border-radius:22px;text-align:center;">
    <a href="${GOOGLE_REVIEWS_URL}" style="display:block;text-decoration:none;">
      <img src="${SIGNATURE_GIF_URL}" width="600" alt="The Supreme Collective" style="display:block;width:100%;max-width:600px;height:auto;border:0;margin:0 auto;" />
    </a>
    <a href="${WHATSAPP_URL}" style="display:inline-block;margin-top:16px;padding:12px 24px;border-radius:999px;background:#25D366;color:#ffffff;text-decoration:none;font-size:17px;font-weight:700;">Chat on WhatsApp</a>
    <div style="margin-top:22px;padding-top:20px;border-top:1px solid #e3e3e3;text-align:left;">
      <h3 style="margin:0 0 14px;font-size:16px;color:#111111;">Find us online</h3>
      <p style="margin:0 0 18px;">
        <a href="${INSTAGRAM_URL}" style="display:inline-block;margin-right:12px;text-decoration:none;"><img src="${INSTAGRAM_ICON_URL}" width="32" height="32" alt="Instagram" style="border:0;" /></a>
        <a href="${YOUTUBE_URL}" style="display:inline-block;margin-right:12px;text-decoration:none;"><img src="${YOUTUBE_ICON_URL}" width="32" height="32" alt="YouTube" style="border:0;" /></a>
        <a href="${WEBSITE_URL}" style="display:inline-block;text-decoration:none;"><img src="${WEBSITE_ICON_URL}" width="32" height="32" alt="The Supreme Collective website" style="border:0;" /></a>
      </p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#555555;">Keep your profile up to date at <a href="https://admin.thesupremecollective.co.uk" style="color:#ff6667;text-decoration:none;font-weight:700;">admin.thesupremecollective.co.uk</a></p>
      <p style="margin:0 0 8px;font-size:12px;line-height:1.7;color:#777777;">Copyright © ${new Date().getFullYear()} The Supreme Collective Ltd. All rights reserved.</p>
      <p style="margin:0;font-size:12px;line-height:1.7;color:#777777;">Registered Office: 71-75 Shelton Street, Covent Garden, London, WC2H 9JQ, United Kingdom | Company Number: 16883956</p>
    </div>
  </div>
`;

export const buildBandEventSheetEmailHtml = ({
  firstName,
  bandName,
  eventDate,
  role,
  eventSheetUrl,
}) => `
  <div style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111111;">
    <div style="max-width:720px;margin:0 auto;padding:28px 16px;">
      <div style="background:#111111;border-radius:28px 28px 0 0;overflow:hidden;text-align:center;">
        <div style="padding:18px 28px 8px;"><p style="margin:0;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#ff6667;font-weight:700;">The Supreme Collective</p></div>
        <div style="padding:0 28px 30px;"><h1 style="margin:8px 0 10px;font-size:34px;line-height:1.05;color:#ffffff;font-weight:800;">Your Event Sheet</h1><p style="margin:0;font-size:16px;line-height:1.7;color:#f3f3f3;">Everything you need for the performance.</p></div>
      </div>
      <div style="background:#ffffff;border:1px solid #e8e8e8;border-top:0;border-radius:0 0 28px 28px;padding:30px 28px;box-shadow:0 10px 30px rgba(0,0,0,0.04);">
        <p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:#333333;">Hi ${escapeEmailHtml(firstName || "there")},</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#444444;">The completed event sheet for <strong>${escapeEmailHtml(bandName)}</strong> on <strong>${escapeEmailHtml(eventDate)}</strong> is attached.</p>
        <p style="margin:0 0 22px;font-size:15px;line-height:1.8;color:#444444;">Your role: <strong>${escapeEmailHtml(role)}</strong>.</p>
        <p style="margin:0 0 12px;text-align:center;"><a href="${escapeEmailHtml(eventSheetUrl)}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#ff6667;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;">Open the latest event sheet PDF</a></p>
        <p style="margin:0 0 24px;color:#666666;font-size:13px;text-align:center;">Please read it before the event and let Rhona know if anything is unclear.</p>
        <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#444444;">Warmest wishes,<br /><strong>The Supreme Collective</strong></p>
        ${buildTscEmailFooter()}
      </div>
    </div>
  </div>
`;
