import crypto from "node:crypto";

const getKey = () => {
  const raw = String(process.env.SOCIAL_OAUTH_ENCRYPTION_KEY || "").trim();
  if (!raw) throw new Error("SOCIAL_OAUTH_ENCRYPTION_KEY is not configured");
  return crypto.createHash("sha256").update(raw).digest();
};

export const encryptSocialToken = (value = "") => {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
};

export const decryptSocialToken = (value = "") => {
  if (!value) return "";
  const [ivPart, tagPart, encryptedPart] = String(value).split(".");
  if (!ivPart || !tagPart || !encryptedPart) throw new Error("Invalid encrypted social token");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};
