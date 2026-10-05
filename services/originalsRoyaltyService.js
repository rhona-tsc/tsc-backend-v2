const key = (value) => String(value || "");

const addShare = (map, recipientType, recipientId, role, percent) => {
  if (!percent) return;
  const mapKey = `${recipientType}:${key(recipientId)}:${role}`;
  map.set(mapKey, { recipientType, recipientId: recipientId || null, role, percent });
};

export const calculateOriginalsSplits = ({ project, acceptedSubmissions = [] }) => {
  const contributions = acceptedSubmissions.filter((item) => item.category === "contribution" || !item.category);
  const mixes = acceptedSubmissions.filter((item) => item.category === "mix");
  const masters = acceptedSubmissions.filter((item) => item.category === "master");
  if (!contributions.length) throw new Error("At least one accepted contribution is required");
  if (mixes.length !== 1) throw new Error("Exactly one accepted mix is required");
  if (masters.length !== 1) throw new Error("Exactly one accepted master is required");

  const master = new Map();
  addShare(master, "tsc", null, "TSC", 20);
  addShare(master, "owner", project.ownerId, "Project owner", 20);
  const contributorPercent = 40 / contributions.length;
  contributions.forEach((item) => addShare(master, "musician", item.musicianId, item.roleName, contributorPercent));
  addShare(master, "musician", mixes[0].musicianId, "Mix producer", 10);
  addShare(master, "musician", masters[0].musicianId, "Mastering engineer", 10);

  const composition = new Map();
  const claimers = contributions.filter((item) => item.songwritingChoice === "songwriting_claim");
  if (project.ownerSongwritingClaim === true || (project.ownerSongwritingClaim == null && project.hasInitialStem)) {
    const totalUnits = contributions.length + 1;
    const unit = 100 / totalUnits;
    const ownerUnits = 1 + contributions.filter((item) => item.songwritingChoice !== "songwriting_claim").length;
    addShare(composition, "owner", project.ownerId, "Songwriter", unit * ownerUnits);
    claimers.forEach((item) => addShare(composition, "musician", item.musicianId, `Songwriter — ${item.roleName}`, unit));
  } else {
    const recipients = claimers.length ? claimers : contributions;
    const unit = 100 / recipients.length;
    recipients.forEach((item) => addShare(composition, "musician", item.musicianId, `Songwriter — ${item.roleName}`, unit));
  }

  const round = (value) => Math.round((value + Number.EPSILON) * 1000000) / 1000000;
  return {
    master: [...master.values()].map((item) => ({ ...item, percent: round(item.percent) })),
    composition: [...composition.values()].map((item) => ({ ...item, percent: round(item.percent) })),
  };
};

export const totalPercent = (shares = []) =>
  Math.round(shares.reduce((sum, share) => sum + Number(share.percent || 0), 0) * 1000000) / 1000000;
