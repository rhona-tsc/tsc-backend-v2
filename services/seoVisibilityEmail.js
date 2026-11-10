import { safeCitationUrl } from "./seoAiVisibilityService.js";

const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const AI_LABELS = { chatgpt: "ChatGPT search", google_ai_overview: "Google AI Overviews" };
export const AI_STATUS_LABELS = {
  not_configured: "Awaiting the AI search provider connection. No AI checks have run.",
  disabled: "AI checks are switched off.",
  not_sampled: "No AI sample has been collected for this report yet.",
  collecting: "AI checks are still running. Results will appear after collection completes.",
  unavailable: "AI checks are unavailable. No absence of mentions has been inferred.",
};
export const renderAiVisibilityEmail = visibility => {
  if (!visibility || visibility.status !== "complete") return `<h2>AI search visibility</h2><p>${escape(AI_STATUS_LABELS[visibility?.status] || AI_STATUS_LABELS.not_sampled)}</p>`;
  const rows = (visibility.summary || []).map(row => {
    const previous = visibility.previousSummary?.find(item => item.platform === row.platform);
    const comparable = previous && row.comparable;
    const delta = comparable ? `${row.mentions - previous.mentions >= 0 ? "+" : ""}${row.mentions - previous.mentions} mentions` : "No comparable baseline";
    return `<tr><td>${escape(AI_LABELS[row.platform])}</td><td>${row.mentions}/${row.observed}</td><td>${row.citations}/${row.citationChecks}</td><td>${row.noOverview}</td><td>${row.unavailable}</td><td>${escape(delta)}</td></tr>`;
  }).join("");
  const evidence = (visibility.samples || []).map(sample => `<li><strong>${escape(AI_LABELS[sample.platform])}</strong>: ${escape(sample.prompt)} — ${escape(sample.status === "observed" ? `brand ${sample.mentioned ? "mentioned" : "not mentioned"}; site ${sample.cited == null ? "citation unresolved" : sample.cited ? "cited" : "not cited"}` : sample.status === "no_overview" ? "No AI Overview appeared" : "Check unavailable")}${sample.artistMentions?.length ? `<br>Artist names detected: ${sample.artistMentions.map(escape).join(", ")}` : ""}${sample.citations?.length ? `<br>${sample.citations.filter(item => safeCitationUrl(item.url)).slice(0, 5).map(item => `<a href="${escape(safeCitationUrl(item.url))}">${escape(item.title || new URL(item.url).hostname)}</a>`).join(" · ")}` : ""}</li>`).join("");
  return `<h2>AI search visibility</h2><p>Point-in-time UK English sample checked ${escape(visibility.checkedAt ? new Date(visibility.checkedAt).toISOString().slice(0, 10) : "date unavailable")}; this is not an average for the organic reporting month.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th>Platform</th><th>Brand mentions / answers</th><th>Site citations / resolved answers</th><th>No overview</th><th>Unavailable</th><th>Comparison</th></tr></thead><tbody>${rows}</tbody></table>
    <p>Brand means The Supreme Collective; citations mean links to thesupremecollective.co.uk. These are sampled answers, not universal rankings, traffic or conversions. Results vary by time and user. No overview and failed checks are excluded from mention rates. The first completed sample establishes the baseline.</p>
    <h3>Questions and source links</h3><ul>${evidence}</ul>`;
};
