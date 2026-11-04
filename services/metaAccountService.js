const REQUIRED_SCOPES = ["pages_show_list", "pages_read_engagement", "instagram_basic"];

// Some business-managed Pages are omitted from /me/accounts even though the
// login grant explicitly authorises them. Resolve only IDs in that grant.
export async function resolveMetaAccount({ token, appId, appSecret, version = "v23.0", getJson }) {
  const graph = (path, params = {}) => {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  };
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const permissions = await getJson(graph("me/permissions"), auth);
  const granted = new Set((permissions.data || []).filter(p => p.status === "granted").map(p => p.permission));
  const missing = REQUIRED_SCOPES.filter(scope => !granted.has(scope));
  if (missing.length) throw new Error(`Meta permissions missing: ${missing.join(", ")}. Reconnect and approve access.`);

  const fields = "id,name,access_token,instagram_business_account";
  const seenCursors = new Set();
  let after;
  do {
    const result = await getJson(graph("me/accounts", { fields, ...(after ? { after } : {}) }), auth);
    const page = (result.data || []).find(p => p.instagram_business_account?.id);
    if (page) return { page, scopes: [...granted] };
    after = result.paging?.next ? result.paging?.cursors?.after : undefined;
    if (seenCursors.has(after)) break;
    seenCursors.add(after);
  } while (after);

  const debug = await getJson(graph("debug_token", { input_token: token }), {
    headers: { Authorization: `Bearer ${appId}|${appSecret}` },
  });
  if (!debug.data?.is_valid || String(debug.data.app_id) !== String(appId)) {
    throw new Error("Meta login has expired or belongs to another app. Please reconnect.");
  }
  const pageIds = [...new Set((debug.data.granular_scopes || [])
    .filter(scope => ["pages_show_list", "pages_read_engagement"].includes(scope.scope))
    .flatMap(scope => scope.target_ids || []))];
  for (const id of pageIds) {
    const page = await getJson(graph(encodeURIComponent(id), { fields }), auth);
    if (page.instagram_business_account?.id) return { page, scopes: [...granted] };
  }
  throw new Error(pageIds.length
    ? "The authorised Pages did not expose an Instagram professional account. Check Instagram access in Meta and reconnect."
    : "Meta returned no authorised Pages. Reconnect and select the Facebook Page linked to your Instagram account.");
}
