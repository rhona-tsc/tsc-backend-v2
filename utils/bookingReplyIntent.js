export const classifyBookingReply = (value = "") => {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;

  if (
    text === "yes" ||
    text === "yes, book me in!" ||
    text.includes("book me in") ||
    text === "yesbook" ||
    text.startsWith("yesbook_")
  ) {
    return "YES";
  }

  if (
    text === "no" ||
    text === "i'm already booked!" ||
    text === "im already booked!" ||
    text.includes("already booked") ||
    text === "nobook" ||
    text.startsWith("nobook_")
  ) {
    return "NO_BOOKED";
  }

  if (
    text === "noloc" ||
    text === "no thanks" ||
    text === "no thanks!" ||
    text.includes("can't do this location") ||
    text.includes("cant do this location")
  ) {
    return "NO_LOC";
  }

  return null;
};

export const resolveBookingReplyIntent = ({
  buttonText = "",
  buttonPayload = "",
  bodyText = "",
  usedQuickReply = false,
} = {}) => {
  const encodedPayload = [buttonPayload, bodyText].find((value) =>
    /^(?:YESBOOK|NOBOOK)_\S+$/i.test(String(value || "").trim()),
  );
  const quickReply = usedQuickReply
    ? classifyBookingReply(buttonText) || classifyBookingReply(buttonPayload)
    : null;
  const encodedReply = encodedPayload ? classifyBookingReply(encodedPayload) : null;

  return {
    looksExplicit: Boolean(encodedPayload || quickReply),
    reply: encodedReply || quickReply || null,
  };
};
