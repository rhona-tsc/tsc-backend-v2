import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import Title from "../components/Title";
import { ShopContext } from "../context/ShopContext";

/** Helpers */
const currencySymbol = (code) => {
  if (!code) return "£";
  const map = { GBP: "£", USD: "$", EUR: "€" };
  return map[code] || "£";
};

const safeImage = (img) => {
  if (!img) return "";
  if (typeof img === "string") return img;
  if (Array.isArray(img)) return img[0] || "";
  if (typeof img === "object") return img.url || "";
  return "";
};

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return iso;
  }
};

const lineupLabelFromItem = (item) => {
  // Prefer ceremony/afternoon summary if present
  if (Array.isArray(item?.selectedAfternoonSets) && item.selectedAfternoonSets.length) {
    return item.selectedAfternoonSets.map((s) => s.name).join(" • ");
  }
  return (
    item?.lineupLabel ||
    item?.lineupName ||
    item?.actSize ||
    (item?.bandMembersCount ? `${item.bandMembersCount}-Piece` : "—")
  );
};

const sumExtras = (arr = []) =>
  (Array.isArray(arr) ? arr : []).reduce((s, e) => s + (Number(e?.price) || 0), 0);

/** Page */
const Bookings = () => {
  const { user, currency: shopCurrency } = useContext(ShopContext);

  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  // Resolve user id (context first, localStorage fallback)
  const resolvedUserId =
    user?._id ||
    (() => {
      try {
        const raw = localStorage.getItem("user");
        return raw ? JSON.parse(raw)?._id || null : null;
      } catch {
        return null;
      }
    })();

  const cur = useMemo(() => currencySymbol(shopCurrency || "GBP"), [shopCurrency]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr("");

        if (!resolvedUserId) {
          setErr("Please sign in to view your bookings.");
          setBookings([]);
          return;
        }

        console.log("📥 Bookings.jsx fetching for user:", resolvedUserId);

        // Try GET route
        let list = [];
        try {
          const resp = await axios.get(`${backendUrl}/api/booking/user/${resolvedUserId}`);
          const data = resp?.data;
          list = Array.isArray(data)
            ? data
            : Array.isArray(data?.bookings)
            ? data.bookings
            : Array.isArray(data?.data)
            ? data.data
            : [];
          console.log("✅ GET bookings count:", list.length);
        } catch (e) {
          console.warn("GET /api/booking/user/:id failed, will try POST:", e?.message);
        }

        // Fallback POST route
        if (list.length === 0) {
          try {
            const resp = await axios.post(`${backendUrl}/api/booking/user`, { userId: resolvedUserId });
            const data = resp?.data;
            list = Array.isArray(data)
              ? data
              : Array.isArray(data?.bookings)
              ? data.bookings
              : Array.isArray(data?.data)
              ? data.data
              : [];
            console.log("✅ POST bookings count:", list.length);
          } catch (e) {
            console.warn("POST /api/booking/user failed:", e?.message);
          }
        }

        if (!cancelled) setBookings(Array.isArray(list) ? list : []);
      } catch (e) {
        console.error("❌ Bookings.jsx load error:", e);
        if (!cancelled) setErr("Could not load your bookings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [backendUrl, resolvedUserId]);

  // Normalize each booking to a row the UI can render safely
  const rows = useMemo(() => {
    return bookings.map((b) => {
      const items = Array.isArray(b.actsSummary) ? b.actsSummary : Array.isArray(b.items) ? b.items : [];
      const firstItem = items[0] || {};

      // compute total with fallbacks
      const itemTotals = items.map((it) => {
        const base =
          Number(it?.prices?.adjustedTotal ?? NaN) ||
          Number(it?.prices?.subtotalWithMargin ?? NaN) ||
          Number(it?.adjustedTotal ?? NaN) ||
          Number(it?.subtotalWithMargin ?? NaN) ||
          Number(it?.price ?? NaN) ||
          Number(it?.total ?? NaN) ||
          0;
        const ex = sumExtras(it?.selectedExtras);
        const aft = sumExtras(it?.selectedAfternoonSets);
        return base + ex + aft;
      });

      const bookingTotal =
        Number(b?.totals?.fullAmount ?? NaN) ||
        (itemTotals.length ? itemTotals.reduce((s, n) => s + (n || 0), 0) : 0);

      return {
        _id: b._id || b.bookingId,
        bookingRef: b.bookingId || b._id,
        actName:
          firstItem?.actName ||
          firstItem?.tscName ||
          (typeof firstItem?.name === "string"
            ? firstItem.name.replace(/^Booking:\s*/, "").split(" - ")[0]
            : b.actName || "Act"),
        image: safeImage(firstItem?.image),
        lineup: lineupLabelFromItem(firstItem),
        venue: b.venue || b.venueAddress || "—",
        date: b.date,
        createdAt: b.createdAt || b.updatedAt,
        eventType: b.eventType || "—",
        eventSheetDone: !!b?.eventSheet?.submitted,
        total: bookingTotal,
        currency: b?.totals?.currency || b?.cartMeta?.currency || shopCurrency || "GBP",
        hasEventSheet: true,
      };
    });
  }, [bookings, shopCurrency]);

  if (loading) {
    return (
      <div className="border-t pt-16">
        <div className="text-2xl">
          <Title text1={"MY"} text2={"BOOKINGS"} />
        </div>
        <div className="mt-6 text-gray-600">Loading your bookings…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="border-t pt-16">
        <div className="text-2xl">
          <Title text1={"MY"} text2={"BOOKINGS"} />
        </div>
        <div className="mt-6 text-red-600">{err}</div>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="border-t pt-16">
        <div className="text-2xl">
          <Title text1={"MY"} text2={"BOOKINGS"} />
        </div>
        <div className="mt-6 text-gray-700">No bookings found.</div>
      </div>
    );
  }

  return (
    <div className="border-t pt-16">
      <div className="text-2xl">
        <Title text1={"MY"} text2={"BOOKINGS"} />
      </div>

      <div className="mt-4 space-y-4">
        {rows.map((r) => (
          <div
            key={r._id}
            className="py-4 border rounded text-gray-700 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          >
            <div className="flex items-start gap-4 text-sm p-3">
              {r.image ? (
                <img className="w-16 sm:w-20 h-16 sm:h-20 object-cover rounded" src={r.image} alt={r.actName} />
              ) : (
                <div className="w-16 sm:w-20 h-16 sm:h-20 bg-gray-200 rounded" />
              )}
              <div>
                <p className="sm:text-base font-semibold">
                  {r.actName}{" "}
                  <span className="font-normal text-gray-500">({r.bookingRef})</span>
                </p>
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3 mt-1 text-sm text-gray-700">
                  <p className="font-medium">{r.lineup}</p>
                  <p>
                    Total:{" "}
                    <span className="font-semibold">
                      {currencySymbol(r.currency)}
                      {Number(r.total).toFixed(2)}
                    </span>
                  </p>
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  <p>
                    Confirmed: <span className="text-gray-700">{formatDate(r.createdAt)}</span>
                  </p>
                  <p>
                    Event Date: <span className="text-gray-700">{formatDate(r.date)}</span>
                  </p>
                  <p>
                    Venue: <span className="text-gray-700">{r.venue}</span>
                  </p>
                  <p>
                    Event Type: <span className="text-gray-700">{r.eventType}</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="md:w-1/2 flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${r.eventSheetDone ? "bg-green-500" : "bg-gray-300"}`}
                />
                <p className="text-sm md:text-base">
                  {r.eventSheetDone ? "Event Sheet Completed" : "Event Sheet To Be Completed"}
                </p>
              </div>

              {r.hasEventSheet ? (
                <Link
                  to={`/event-sheet/${r.bookingRef}`}
                  className="border px-4 py-2 text-sm font-medium rounded-sm hover:bg-gray-100"
                >
                  Event Sheet
                </Link>
              ) : (
                <button
                  className="border px-4 py-2 text-sm font-medium rounded-sm opacity-60 cursor-not-allowed "
                  disabled
                >
                  Event Sheet
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Bookings;