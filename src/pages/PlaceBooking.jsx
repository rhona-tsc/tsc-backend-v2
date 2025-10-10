/ frontend/src/pages/PlaceBooking.jsx
// npm install react-signature-canvas
import React, { useContext, useState, useEffect } from "react";
import Title from "../components/Title";
import CartTotal from "../components/CartTotal";
import { ShopContext } from "../context/ShopContext";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import calculateActPricing from "../pages/utils/pricing";
import SignaturePad from "react-signature-canvas";

/* ----------------------------- helpers ----------------------------- */

// readable booking id (stable per session)
const generateBookingId = (dateStr, lastName) => {
  const date = new Date(dateStr);
  const yymmdd = date.toISOString().slice(2, 10).replace(/-/g, "");
  const randomDigits = Math.floor(10000 + Math.random() * 90000);
  return `${yymmdd}-${(lastName || "TSC").toUpperCase()}-${randomDigits}`;
};

const looksLikeTrue = (v) =>
  v === true || v === "true" || v === 1 || v === "1";

const slugLooksTesty = (s) => /(^|[^a-z])test([-_ ]|$)/i.test(String(s || ""));

// Decide if cart should use TEST checkout (based on DB flags or slug/name)
const isTestCart = (actsSummary = [], fullActs = []) => {
  const byId = Object.fromEntries(
    (fullActs || []).map((a) => [String(a._id), a])
  );
  return (actsSummary || []).some((a) => {
    const act = byId[String(a.actId)] || {};
    return (
      looksLikeTrue(act.isTest) ||
      looksLikeTrue(a.isTest) ||
      slugLooksTesty(act.slug) ||
      slugLooksTesty(a.actSlug) ||
      slugLooksTesty(a.tscName) ||
      slugLooksTesty(a.actName)
    );
  });
};

/* --------------------------- component ---------------------------- */

const PlaceBooking = () => {
  const { cartItems, acts, selectedAddress, selectedDate, backendUrl } =
    useContext(ShopContext);

  const [eventType] = useState("Wedding");
  const [userAddress, setUserAddress] = useState({
    firstName: "",
    lastName: "",
    email: JSON.parse(localStorage.getItem("user") || "{}")?.email || "",
    phone: "",
    street: "",
    city: "",
    county: "",
    postcode: "",
    country: "",
  });
  const [signaturePad, setSignaturePad] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [signaturePreview, setSignaturePreview] = useState(null);
  const [bookingId, setBookingId] = useState("");

  const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
  const userId = storedUser?._id || null;
  const userEmail = storedUser?.email || null;

  const navigate = useNavigate();

  // scroll top on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, []);

  // generate human booking ref when we have last name + date
  useEffect(() => {
    if (userAddress.lastName && selectedDate && !bookingId) {
      setBookingId(generateBookingId(selectedDate, userAddress.lastName));
    }
  }, [userAddress.lastName, selectedDate, bookingId]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setUserAddress((prev) => ({ ...prev, [name]: value }));
  };

  /* ------------------------------ submit ------------------------------ */

  const handleSubmit = async () => {
    const daysUntil = (dateStr) => {
      if (!dateStr) return null;
      const now = new Date();
      const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const ev = new Date(dateStr);
      const d1 = new Date(ev.getFullYear(), ev.getMonth(), ev.getDate());
      return Math.ceil((d1 - d0) / (1000 * 60 * 60 * 24));
    };

    const dte = daysUntil(selectedDate);
    const clientWantsFull = dte != null && dte <= 28;

    if (!termsAccepted) {
      alert("Please accept the terms and conditions before booking.");
      return;
    }
    if (!signaturePad || signaturePad.isEmpty()) {
      alert("Please provide a signature before booking.");
      return;
    }

    const items = [];
    const actsSummary = [];
    let performanceTimesTop = null;

    try {
      const getAct = (id) => acts.find((a) => String(a._id) === String(id));
      const selectedCounty =
        selectedAddress?.split(",").slice(-2)[0]?.trim() || "";

      for (const actId in cartItems) {
        const act = getAct(actId);
        if (!act) continue;

        for (const lineupId in cartItems[actId]) {
          const cartLine = cartItems[actId][lineupId] || {};
          const {
            quantity = 1,
            selectedExtras = [],
            selectedAfternoonSets = [],
            dismissedExtras = [],
            formattedPrice,
          } = cartLine;

          const lineup =
            (act.lineups || []).find(
              (l) =>
                String(l._id) === String(lineupId) ||
                String(l.lineupId) === String(lineupId)
            ) || null;
          if (!lineup) continue;

          // lineup snapshot
          const lineupSnapshot = lineup
            ? {
                lineupId: String(lineup._id || lineup.lineupId || lineupId),
                actSize:
                  lineup.actSize ||
                  (Array.isArray(lineup.bandMembers)
                    ? `${lineup.bandMembers.length}-Piece`
                    : ""),
                bandMembers: Array.isArray(lineup.bandMembers)
                  ? lineup.bandMembers.map((m) => ({
                      firstName: m.firstName || "",
                      lastName: m.lastName || "",
                      instrument: m.instrument || "",
                      isEssential: !!m.isEssential,
                      additionalRoles: Array.isArray(m.additionalRoles)
                        ? m.additionalRoles.map((r) => ({
                            role: r.role || "",
                            isEssential: !!r.isEssential,
                          }))
                        : [],
                    }))
                  : [],
              }
            : null;

          // pricing
          let fee = 0,
            travel = 0,
            total = 0,
            travelCalculated = false;
          try {
            const res = await calculateActPricing(
              act,
              selectedCounty,
              selectedAddress,
              selectedDate,
              lineup
            );
            fee = Number(res?.fee || 0);
            travel = Number(res?.travel || 0);
            total = Number(res?.total || res?.price || 0);
            travelCalculated = !!res?.travelCalculated;
          } catch {
            total = Number(formattedPrice || 0);
            fee = Math.round(total * 0.75);
            travel = Math.max(0, total - fee);
          }

          if (total > 0) {
            items.push({
              name: `Booking: ${act.tscName} - ${lineup.actSize || "Lineup"}`,
              price: total,
              quantity: Number(quantity) || 1,
            });
          } else {
            console.warn(
              `⚠️ Skipping zero-price lineup item for ${act.tscName} (${lineupId}).`
            );
          }

          // extras
          (selectedExtras || []).forEach((ex) => {
            const exPrice = Number(ex?.price || 0);
            const exQty = Number(ex?.quantity || 1);
            if (exQty > 0 && exPrice > 0) {
              items.push({
                name: `${ex.name}${exQty > 1 ? ` x ${exQty}` : ""}`,
                price: exPrice,
                quantity: 1,
              });
            }
          });

          // performance block
          const cartPerf = cartItems[actId][lineupId]?.performance || {};
          const toInt = (v, def = 0) => {
            const n = Number(v);
            return Number.isInteger(n) ? n : def;
          };
          const perf = {
            arrivalTime: cartPerf.arrivalTime || "",
            setupAndSoundcheckedBy: cartPerf.setupAndSoundcheckedBy || "",
            startTime: cartPerf.startTime || "",
            finishTime: cartPerf.finishTime || "",
            finishDayOffset: toInt(cartPerf.finishDayOffset, 0),

            planIndex: Number.isFinite(Number(cartPerf.planIndex))
              ? Number(cartPerf.planIndex)
              : undefined,
            plan: cartPerf.plan
              ? {
                  sets: Number(cartPerf.plan?.sets) || undefined,
                  length: Number(cartPerf.plan?.length) || undefined,
                  minInterval: Number(cartPerf.plan?.minInterval) || undefined,
                }
              : undefined,

            paLightsFinishTime: cartPerf.paLightsFinishTime || "",
            paLightsFinishDayOffset: toInt(cartPerf.paLightsFinishDayOffset, 0),
          };

          // actsSummary row (add isTest for convenience)
          actsSummary.push({
            actId,
            actName: act.name,
            tscName: act.tscName,
            actSlug: act.slug || null,
            isTest: looksLikeTrue(act.isTest),
            image: act?.profileImage?.[0] || act?.images?.[0] || null,

            lineupId: String(lineupId),
            lineupLabel: lineup?.actSize || "",
            lineup: lineupSnapshot,
            bandMembersCount: Array.isArray(lineup?.bandMembers)
              ? lineup.bandMembers.length
              : null,

            quantity: Number(quantity) || 1,

            prices: {
              base: fee,
              travel,
              subtotalWithMargin: fee + travel,
              adjustedTotal: fee + travel,
              travelCalculated,
            },

            selectedExtras: (selectedExtras || []).map((ex) => ({
              key: ex.key,
              name: ex.name,
              quantity: Number(ex.quantity || 0),
              price: Number(ex.price || 0),
              finishTime: ex.finishTime || null,
              arrivalTime: ex.arrivalTime || null,
            })),
            selectedAfternoonSets: (selectedAfternoonSets || []).map((s) => ({
              key: s.key,
              name: s.name,
              type: s.type || null,
              price: Number(s.price || 0),
            })),
            dismissedExtras: Array.isArray(dismissedExtras)
              ? [...dismissedExtras]
              : [],

            performance: perf,
            venueAddress: selectedAddress || "",
            eventDate: selectedDate || null,
          });
        }
      }

      console.log("🧾 Raw cartDetails:", items);
      console.log("🗒️ actsSummary snapshot:", actsSummary);

      const validItems = items.filter(
        (i) =>
          typeof i.price === "number" &&
          !Number.isNaN(i.price) &&
          i.price > 0 &&
          (i.quantity || 1) > 0
      );
      if (validItems.length === 0) {
        alert(
          "We couldn't create your checkout because no paid items were found.\n\n" +
            "Please check:\n• You’ve selected a lineup\n• Your date and venue are set (so pricing can calculate)\n• The act shows a price on the previous page"
        );
        return;
      }

      // totals
      const fullAmount = actsSummary.reduce((sum, item) => {
        const perUnit =
          Number(item?.prices?.adjustedTotal || 0) +
          (item.selectedExtras || []).reduce(
            (s, ex) => s + (Number(ex.price) || 0),
            0
          );
        return sum + perUnit * (item.quantity || 1);
      }, 0);

      const calcDeposit = (gross) =>
        gross <= 0 ? 0 : Math.ceil((gross - 50) * 0.2) + 50;

      const depositAmount = clientWantsFull ? fullAmount : calcDeposit(fullAmount);
      const signatureImage =
        signaturePad.getTrimmedCanvas().toDataURL("image/png");

      // decide route (TEST vs LIVE)
      const useTest = isTestCart(actsSummary, acts);

      /* ---------- TEST MODE (Stripe test key) ---------- */
      if (useTest) {
        const amountToCharge = Math.max(
          100, // clamp min £1 in test
          Math.round(clientWantsFull ? fullAmount : depositAmount)
        );

        const first = actsSummary[0] || {};
        const endpoint = `${backendUrl}/api/payments/test-act-checkout`;
        const body = {
          actId: first.actId,
          actSlug: first.actSlug,
          amount: amountToCharge, // integer pence
          currency: "gbp",
          bookingId,
          description: `Test booking: ${(actsSummary || [])
            .map((a) => a.tscName || a.actName || "Act")
            .join(" + ")} on ${new Date(selectedDate).toLocaleDateString(
            "en-GB"
          )}`,
          metadata: { bookingId, mode: clientWantsFull ? "full" : "deposit" },
        };

        console.log("📡 POST (TEST)", endpoint, body);
        const resp = await axios.post(endpoint, body);
        if (resp.data?.url) {
          window.location.href = resp.data.url;
          return;
        }
        alert("We couldn’t start test checkout — no redirect URL returned.");
        return;
      }

      /* ---------- LIVE MODE (your current create-checkout-session) ---------- */
      const endpoint = `${backendUrl}/api/booking/create-checkout-session`;
      const performanceTimesTop =
        actsSummary[0]?.performance
          ? { ...actsSummary[0].performance }
          : null;

      const payload = {
        cartDetails: validItems,
        actsSummary,
        performanceTimes: performanceTimesTop || undefined,

        eventType,
        date: selectedDate,
        venueAddress: selectedAddress,
        venue: selectedAddress, // compat
        customer: userAddress,
        signature: signatureImage,
        paymentMode: clientWantsFull ? "full" : "deposit",
        totals: {
          fullAmount,
          depositAmount,
          isLessThanFourWeeks: clientWantsFull,
          currency: "GBP",
        },
        cartMeta: {
          selectedAddress,
          selectedDate,
          currency: "GBP",
        },
        bookingId,
        userId,
        userEmail,
      };

      console.log("📡 POST (LIVE)", endpoint, {
        items: validItems.length,
        actsSummary: actsSummary.length,
        eventType,
        date: selectedDate,
        venueAddress: selectedAddress,
        userId,
        userEmail,
      });

      const stripeResponse = await axios.post(endpoint, payload);
      if (stripeResponse.data?.url) {
        window.location.href = stripeResponse.data.url;
        return;
      }
      alert("We couldn’t start checkout — no redirect URL returned.");
    } catch (err) {
      const serverMsg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message;
      console.error("❌ Booking failed:", serverMsg, err?.response?.data || {});
      alert(`Booking failed.\n\nDetails: ${serverMsg || "Unknown error"}`);
    }
  };

  /* ------------------------------ render ------------------------------ */

  const formattedDate = new Date(selectedDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const bookedActs = Object.keys(cartItems)
    .map((actId) => {
      const act = acts.find((a) => String(a._id) === String(actId));
      return act?.tscName || act?.name || "";
    })
    .filter(Boolean)
    .join(" + ");

  return (
    <div className="flex flex-col sm:flex-row justify-between gap-4 pt-5 sm:pt-14 min-h-[80vh] border-t pb-24 sm:pb-0">
      {/* Left - User Address */}
      <div className="flex flex-col gap-4 w-full sm:max-w-[480px]">
        <div className="text-xl sm:text-2xl my-3">
          <Title text1={"YOUR"} text2={"DETAILS"} />
        </div>

        <div className="flex gap-3">
          <input
            name="firstName"
            value={userAddress.firstName}
            onChange={handleInputChange}
            className="border border-gray-300 rounded py-1.5 px-3.5 w-full"
            type="text"
            placeholder="First name"
          />
          <input
            name="lastName"
            value={userAddress.lastName}
            onChange={handleInputChange}
            className="border border-gray-300 rounded py-1.5 px-3.5 w-full"
            type="text"
            placeholder="Last name"
          />
        </div>
        <input
          name="email"
          value={userAddress.email}
          onChange={handleInputChange}
          className="border border-gray-300 rounded py-1.5 px-3.5 w-full"
          type="email"
          placeholder="Email address"
        />
        <input
          name="street"
          value={userAddress.street}
          onChange={handleInputChange}
          className="border border-gray-300 rounded py-1.5 px-3.5 w-full"
          type="text"
          placeholder="Street"
        />
        <div className="flex gap-3">
          <input
            name="city"
            value={userAddress.city}
            onChange={handleInputChange}
            className="border border-gray-300 rounded py-1.5 px-3.5 w-full"
            type="text"
            placeholder="City"
          />
          <input
            name="county"
            value={userAddress.county}
            onChange={handleInputChange}
            className="border border-gray-300 rounded py-1.5 px-3.5 w-full"
            type="text"
            placeholder="County"
          />
        </div>
        <div className="flex gap-3">
          <input
            name="postcode"
            value={userAddress.postcode}
            onChange={handleInputChange}
            className="border border-gray-300 rounded py-1.5 px-3.5 w-full"
            type="text"
            placeholder="Postcode"
          />
          <input
            name="country"
            value={userAddress.country}
            onChange={handleInputChange}
            className="border border-gray-300 rounded py-1.5 px-3.5 w-full"
            type="text"
            placeholder="Country"
          />
        </div>
        <input
          name="phone"
          value={userAddress.phone}
          onChange={handleInputChange}
          className="border border-gray-300 rounded py-1.5 px-3.5 w-full"
          type="text"
          placeholder="Phone"
        />
      </div>

      {/* Contract / signature */}
      <div className="flex flex-col gap-4 w-full sm:max-w-[480px]">
        <div className="text-xl sm:text-2xl my-3">
          <Title text1={"THE"} text2={"CONTRACT"} />
        </div>

        <div className="border border-gray-300 rounded max-h-[16rem] sm:max-h-[28rem] overflow-y-auto p-3 text-sm text-gray-700 bg-white contract-section">
          <div aria-label="Booking contract terms" className="contract-section">
            <p>
              <strong>Key Points</strong>
            </p>
            <ul>
              <li>
                This Contract is subject to Bamboo Music Management's Terms and
                Conditions.
              </li>
              <li>
                The Client must complete the Event Sheet four weeks prior to the
                event to ensure the finer details of the performance can be
                processed in a timely fashion.
              </li>
              <li>
                Point of contact numbers should be provided on the Event Sheet.
              </li>
              <li>
                The Client must provide the Artist with a reasonable free supply
                of soft drinks, hot meal or hot buffet (for bookings when artist
                is on site for 3 hours or more), free parking for all vehicles,
                a secure changing area, and a safe, level, dry, covered
                performance area, unless otherwise noted.
              </li>
            </ul>

            <p>
              <strong>Client Authorisation</strong>
            </p>
            <p>
              By signing below, you confirm that you are the authorised
              signatory for contract {bookingId || "TBC"} ({bookedActs},{" "}
              {formattedDate}) and agree to be bound by Bamboo Music
              Management’s Terms and Conditions of booking.
            </p>

            <p>
              <strong>Agent Authorisation</strong>
            </p>
            <p>
              Company Name: The Supreme Collective
              <br />
              Artist Name(/s): {bookedActs}
            </p>

            <p>
              <strong>
                Bamboo Music Management - Terms and Conditions of Booking
              </strong>
            </p>

            <p>
              If you do not understand any part of these Terms and Conditions,
              please check in with Bamboo Music Management or seek legal advice
              before agreeing to them and confirming a booking.
            </p>

            {/* ... (rest of your contract text unchanged) ... */}
            <p>
              <strong>16 | Terms Acceptance</strong>
            </p>
            <p>
              By signing the contract, you agree to all Terms and Conditions
              listed above.
            </p>
          </div>
        </div>

        <label className="inline-flex items-start gap-2 text-sm text-gray-700 mt-3">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            className="accent-[#ff6667]"
            required
          />
          I have read and understand the booking terms and conditions.
        </label>

        <div className="mt-4">
          <label className="block text-sm text-gray-700 mb-1">
            Signature (sign below)
          </label>
          <div className="border border-gray-300 rounded bg-white">
            <SignaturePad
              ref={(ref) => setSignaturePad(ref)}
              canvasProps={{
                width: 400,
                height: 150,
                className: "sigCanvas",
                onMouseUp: () => {
                  if (signaturePad && !signaturePad.isEmpty()) {
                    setSignaturePreview(
                      signaturePad.getTrimmedCanvas().toDataURL("image/png")
                    );
                  }
                },
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              if (signaturePad) {
                signaturePad.clear();
                setSignaturePreview(null);
              }
            }}
            className="mt-2 text-sm text-gray-600 underline"
          >
            Clear Signature
          </button>
        </div>
      </div>

      {/* Right - totals & CTA */}
      <div className="flex flex-col gap-4 w-full sm:max-w-[480px]">
        <div className="text-xl sm:text-2xl my-3">
          <CartTotal />
        </div>

        <div className="mt-12">
          <Title text1={"PAYMENT"} text2={"METHOD"} />
          <p className="mt-2 text-sm text-gray-600">
            Stripe is our secure payment provider.
          </p>

          {/* Desktop */}
          <div className="hidden sm:block w-full text-end mt-8">
            <button
              onClick={handleSubmit}
              className="bg-black rounded hover:bg-[#ff6667] text-white px-16 py-3 text-sm"
            >
              PLACE BOOKING
            </button>
          </div>

          {/* Mobile fixed bar */}
          <div className="sm:hidden">
            <div className="fixed inset-x-0 bottom-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200 px-4 py-3">
              <button
                onClick={handleSubmit}
                className="w-full bg-black rounded hover:bg-[#ff6667] text-white py-3 text-base"
              >
                PLACE BOOKING
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaceBooking;