// utils/availabilityV2.js (create if you don’t have one)
export async function triggerLeadAvailabilityV2({ actId, lineupId, date, address }) {
      console.log(`🩵 (utils/availabilityV2.js) triggerLeadAvailabilityV2 START at ${new Date().toISOString()}`, { });

  try {
    const res = await fetch("/api/availability/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actId, lineupId, date, address }),
    });
    return await res.json();
  } catch (e) {
    console.warn("[availabilityV2] trigger error", e);
    return { success:false, error:String(e?.message||e) };
  }
}