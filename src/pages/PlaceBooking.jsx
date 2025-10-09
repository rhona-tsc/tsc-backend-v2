// Make sure to install react-signature-canvas:
// npm install react-signature-canvas
import React, { useContext, useState, useEffect } from 'react';
import Title from '../components/Title';
import CartTotal from '../components/CartTotal';
import { ShopContext } from '../context/ShopContext';
import { useNavigate } from "react-router-dom";
import axios from "axios";
import calculateActPricing from "../pages/utils/pricing";
import SignaturePad from 'react-signature-canvas';

// Static booking ID generator: persists same ID for session
const generateBookingId = (dateStr, lastName) => {
  const date = new Date(dateStr);
  const yymmdd = date.toISOString().slice(2, 10).replace(/-/g, '');
  const randomDigits = Math.floor(10000 + Math.random() * 90000);
  return `${yymmdd}-${(lastName || 'TSC').toUpperCase()}-${randomDigits}`;
};

const PlaceBooking = () => {
  const {
    cartItems,
    acts,
    selectedAddress,
    selectedDate,
    backendUrl
  } = useContext(ShopContext);

  const [eventType, setEventType] = useState("Wedding");
  const navigate = useNavigate();

  // Always start at the top when this page mounts
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, []);

  // Logged-in user snapshot (from localStorage)
  const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
  const userId = storedUser?._id || null;
  const userEmail = storedUser?.email || null;
  console.log("👤 PlaceBooking userId:", userId);

  // Client details to include in contract & booking doc
  const [userAddress, setUserAddress] = useState({
    firstName: '',
    lastName: '',
    email: userEmail || '',
    phone: '',
    street: '',
    city: '',
    county: '',
    postcode: '',
    country: '',
  });

  const [signaturePad, setSignaturePad] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [signaturePreview, setSignaturePreview] = useState(null);
  const [bookingId, setBookingId] = useState('');

  // Auto-generate a readable bookingId once we have last name + date
  useEffect(() => {
    if (userAddress.lastName && selectedDate && !bookingId) {
      setBookingId(generateBookingId(selectedDate, userAddress.lastName));
    }
  }, [userAddress.lastName, selectedDate, bookingId]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setUserAddress(prev => ({ ...prev, [name]: value }));
  };

  // ---- Submit (create Stripe session + persist booking) ----
const handleSubmit = async () => {
  // helper: days until event (date-only, avoids TZ off-by-one)
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

  // 1) Simple Stripe items
  const items = [];
  // 2) Rich snapshot for your Booking model / event sheet
  const actsSummary = [];
  // 3) Top-level performance block (mirror from first lineup’s times)
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

        // Create a lineup snapshot for actsSummary
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

        // 💰 pricing snapshot
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
        } catch (e) {
          // fallback: use formatted/base figure if present
          total = Number(formattedPrice || 0);
          fee = Math.round(total * 0.75);
          travel = Math.max(0, total - fee);
        }

        // push a single “base” line (extras are added below)
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

        // extras → Stripe items (positive only)
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

        // 🔧 Build the canonical performance block (now includes plan fields)
        // inside the for (const lineupId...) loop in PlaceBooking
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

          // pass through selected set plan (Evening Set Configuration)
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

      

        // actsSummary snapshot for booking/event sheet
        actsSummary.push({
          actId,
          actName: act.name,
          tscName: act.tscName,

          actSlug: act.slug || null,
          image: act?.profileImage?.[0] || act?.images?.[0] || null,

          lineupId: String(lineupId),
          lineupLabel: lineup?.actSize || "",
          lineup: lineupSnapshot,
          bandMembersCount: Array.isArray(lineup?.bandMembers)
            ? lineup.bandMembers.length
            : null,

          quantity: Number(quantity) || 1,

          prices: {
            base: fee, // gross base (incl. margin)
            travel, // gross travel (incl. margin)
            subtotalWithMargin: fee + travel, // equals total without extras
            adjustedTotal: fee + travel, // keep both for compatibility
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

          // 🔑 store as `performance` (NOT `timings`)
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

    // Compute full amount & deposit from the snapshot we’ll store
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

    const signatureImage = signaturePad.getTrimmedCanvas().toDataURL("image/png");

    const endpoint = `${backendUrl}/api/booking/create-checkout-session`;
    console.log("📡 POST", endpoint, {
      items: validItems.length,
      actsSummary: actsSummary.length,
      eventType,
      date: selectedDate,
      venueAddress: selectedAddress,
      userId,
      userEmail,
    });

    const performanceTimesTop =
  actsSummary[0]?.performance
    ? { ...actsSummary[0].performance }
    : null;

    const stripeResponse = await axios.post(endpoint, {
      cartDetails: validItems,            // Stripe line_items (if needed)
      actsSummary,                        // rich snapshot persisted in DB
      // 🔝 send top-level performance block too
      performanceTimes: performanceTimesTop || undefined,

      eventType,
      date: selectedDate,
      venueAddress: selectedAddress,      // store as venueAddress
      venue: selectedAddress,             // backward compat if API used "venue"
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
      bookingId,                          // optional: if you want server to use this
      userId,
      userEmail,
    });

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

  const formattedDate = new Date(selectedDate).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const bookedActs = Object.keys(cartItems)
    .map((actId) => {
      const act = acts.find((a) => String(a._id) === String(actId));
      return act?.tscName || act?.name || "";
    })
    .filter(Boolean)
    .join(" + ");



  return (
    <div className='flex flex-col sm:flex-row justify-between gap-4 pt-5 sm:pt-14 min-h-[80vh] border-t pb-24 sm:pb-0'>
      {/* Left - User Address */}
      <div className='flex flex-col gap-4 w-full sm:max-w-[480px]'>
        <div className='text-xl sm:text-2xl my-3'>
          <Title text1={'YOUR'} text2={'DETAILS'} />
        </div>

        <div className='flex gap-3'>
          <input name="firstName" value={userAddress.firstName} onChange={handleInputChange} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='First name' />
          <input name="lastName" value={userAddress.lastName} onChange={handleInputChange} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='Last name' />
        </div>
        <input name="email" value={userAddress.email} onChange={handleInputChange} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="email" placeholder='Email address' />
        <input name="street" value={userAddress.street} onChange={handleInputChange} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='Street' />
        <div className='flex gap-3'>
          <input name="city" value={userAddress.city} onChange={handleInputChange} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='City' />
          <input name="county" value={userAddress.county} onChange={handleInputChange} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='County' />
        </div>
        <div className='flex gap-3'>
          <input name="postcode" value={userAddress.postcode} onChange={handleInputChange} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='Postcode' />
          <input name="country" value={userAddress.country} onChange={handleInputChange} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='Country' />
        </div>
        <input name="phone" value={userAddress.phone} onChange={handleInputChange} className='border border-gray-300 rounded py-1.5 px-3.5 w-full' type="text" placeholder='Phone' />
      </div>

       {/* Left - User Address */}
       <div className='flex flex-col gap-4 w-full sm:max-w-[480px]'>
        <div className='text-xl sm:text-2xl my-3'>
          <Title text1={'THE'} text2={'CONTRACT'} />
        </div>

        <div className="border border-gray-300 rounded max-h-[16rem] sm:max-h-[28rem] overflow-y-auto p-3 text-sm text-gray-700 bg-white contract-section">    

<div aria-label="Booking contract terms"  className="contract-section">

<p><strong>Key Points</strong></p>
<ul>
<li>This Contract is subject to Bamboo Music Management's Terms and Conditions.</li>
<li>The Client must complete the Event Sheet four weeks prior to the event to ensure the finer details of the performance can be processed in a timely fashion.</li>
<li>Point of contact numbers should be provided on the Event Sheet.</li>
<li>The Client must provide the Artist with a reasonable free supply of soft drinks, hot meal or hot buffet (for bookings when artist is on site for 3 hours or more), free parking for all vehicles, a secure changing area, and a safe, level, dry, covered performance area, unless otherwise noted.</li>
</ul>

<p><strong>Client Authorisation</strong></p>
<p>
  By signing below, you confirm that you are the authorised signatory for contract {bookingId || 'TBC'}
  ({bookedActs}, {formattedDate}) and agree to be bound by Bamboo Music Management’s Terms and Conditions of booking.
</p>

<p><strong>Agent Authorisation</strong></p>
<p>
  Company Name: The Supreme Collective
  <br />
  Artist Name(/s): {bookedActs}
</p>

<p><strong>Bamboo Music Management - Terms and Conditions of Booking</strong></p>

<p>If you do not understand any part of these Terms and Conditions, please check in with Bamboo Music Management or seek legal advice before agreeing to them and confirming a booking.</p>

<p><strong>Definition</strong></p>
<p>The following definitions refer to the 'Contract' (Bamboo Music Management Booking Contract) and these 'Terms and Conditions'. Bamboo Music Management, Company No. 09318270, is the 'Agent', the proposed entertainment booker is the 'Client' and the proposed entertainment act is the 'Artist'.</p>

<p><strong>1 | Introduction</strong></p>
<p>This booking contract is provided by the Agent and is made between the Client and Agent on behalf of the Artist. In issuing this Contract, the Agent is acting as an employment agency for the Artist, and is responsible for ensuring all band members are allocated, and fully briefed in a timely manner in the run-up to the event, and the Artist is responsible for all preparation for the event, and performance on the day. Artist, Client, and Agent responsibilities are detailed within this contract. Any breach of contract can fall upon the Artist, or Client depending upon the item being breached.</p>

<p><strong>2 | Booking</strong></p>
<ul>
<li>All bookings are confirmed immediately upon signing of this contract and with complete payment of the deposit. The booking is then confirmed.</li>
<li>A copy of the contract will be shared with the Client. The Agent will file completed contracts and will store until 4 years after the contract completion date.</li>
<li>The Contract may be modified/changed upon agreement from both parties in advance of the event date.</li>
<li>Changes must be notified to the Agent who will re-issue the contract if necessary.</li>
<li>The agreed total cost and Deposit amount may change with any alterations agreed by both the Client and Artist.</li>
<li>The Agent will act as negotiator until the date of the event and completion of the contract.</li>
</ul>

<p><strong>3 | Payment of Booking Fees</strong></p>
<ul>
<li>The Deposit payment is due upon booking.</li>
<li>The Balance (remaining fee owed) is due one week before the event day and must also be paid to the Agent.</li>
</ul>

<p><strong>4 | Late/Failure Payment of Balance</strong></p>
<ul>
<li>The Client must pay the Balance within the specified time.</li>
<li>If the Client fails to do so, the Agent has the right to terminate the Contract without penalty. The Client would still be subject to the cancellation fee specified in Clause 6.1.1.</li>
<li>The Agent has the right to claim interest of 20% on the balance of any late payments.</li>
<li>Late payments will incur a £50 administration fee, payable by the Client to the Agent within 14 days.</li>
<li>If full payment is not made within 14 days the debt may be passed to a Debt Recovery Firm by the Artist, possibly incurring additional costs.</li>
</ul>

<p><strong>5 | Cancellation</strong></p>
<ul>
<li>Termination of the Contract is only allowed in cases of 'Force Majeure' or if all parties mutually agree.</li>
<li>In the event of mutual cancellation, the Deposit will not be refunded.</li>
</ul>

<p><strong>6 | Client Cancellation</strong></p>
<ul>
<li>If the Client cancels for any reason other than Force Majeure, cancellation fees apply.</li>
</ul>

<table>
  <thead>
    <tr><th>Cancellation Timescale</th><th>Cancellation Fee</th></tr>
  </thead>
  <tbody>
    <tr><td>More than 365 days before event</td><td>Nil</td></tr>
    <tr><td>Less than 24 hours after confirmation (8+ days before event)</td><td>Nil</td></tr>
    <tr><td>Less than 24 hours after confirmation within 7 days of event</td><td>Full Fee</td></tr>
    <tr><td>More than 90 days before event</td><td>60% of Full Fee</td></tr>
    <tr><td>Between 61-90 days before event</td><td>80% of Full Fee</td></tr>
    <tr><td>60 days or less before event</td><td>Full Fee</td></tr>
  </tbody>
</table>

<p><strong>7 | Artist Cancellation</strong></p>
<ul>
<li>The Agent cannot cancel on behalf of the Artist unless for Force Majeure.</li>
<li>If Force Majeure applies, the Agent must present a replacement if possible, and refund 50% of the Deposit if not possible.</li>
<li>If the Artist cancels improperly, the Client may seek legal recourse against the Artist.</li>
<li>If a replacement Artist is secured and accepted, the Deposit is not refunded but transferred to the new act.</li>
</ul>

<p><strong>8 | Complaints</strong></p>
<ul>
<li>Complaints must be made in writing within 30 days of the incident.</li>
<li>Payment obligations remain despite complaints.</li>
<li>Any unnotified changes agreed between Client and Artist are to be dealt with directly between them.</li>
</ul>

<p><strong>9 | Responsibilities of the Client</strong></p>
<ul>
<li>Ensuring the venue provides safe, dry, and licensed conditions.</li>
<li>Provide refreshments and hot meals for the Artist if required, as well as the appropriate number of chairs for the Artist.</li>
<li>Free parking, which must be available, or parking expenses reimbursed.</li>
<li>Changing area, which must be secure and adequate.</li>
<li>Electrical sockets, as per the Artist's requirements.</li>
<li>Ensure the Artist's equipment is safe from spillages and from guests.</li>
<li>Ensure the Artist's is able to perform in a safe environment with no agression or violence towards them.</li>

</ul>

<p><strong>10 | Responsibilities of the Agent</strong></p>
<ul>
<li>Provide a service for Clients to find an Artist that is not double-booked through the company.</li>
<li>Ensure Artist quality, professionalism, and safety compliance.</li>
<li>Provide the Event Sheet and reminders to ensure both parties have all of the information they need so that the artist can carry out a successful performance.</li>
</ul>

<p><strong>11 | Expenses</strong></p>
<p>Client is only liable for additional expenses if agreed in advance.</p>

<p><strong>12 | Artist Equipment</strong></p>
<p>Artist equipment must not be used by guests. Client is liable for any damage caused.</p>

<p><strong>13 | Changes to Performance Schedule</strong></p>
<ul>
<li>Changes can be made on the Event Sheet up to one month before the performance date.</li>
<li>Overruns by the Client do not extend Artist time unless agreed and paid for additionally.</li>
</ul>

<p><strong>14 | Deputies</strong></p>
<p>The Agent may substitute musicians of similar ability without notice.</p>

<p><strong>15 | Force Majeure</strong></p>
<ul>
<li>Force Majeure includes natural disasters, illness, war, terrorism, etc.</li>
<li>Evidence must be provided to justify Force Majeure claims.</li>
</ul>

<p><strong>16 | Terms Acceptance</strong></p>
<p>By signing the contract, you agree to all Terms and Conditions listed above.</p>

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
        <label className="block text-sm text-gray-700 mb-1">Signature (sign below)</label>
        <div className="border border-gray-300 rounded bg-white">
          <SignaturePad
            ref={(ref) => setSignaturePad(ref)}
            canvasProps={{
              width: 400,
              height: 150,
              className: 'sigCanvas',
              onMouseUp: () => {
                if (signaturePad && !signaturePad.isEmpty()) {
                  setSignaturePreview(signaturePad.getTrimmedCanvas().toDataURL('image/png'));
                }
              }
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

      {/* Right - Cart Total + Payment */}
      <div className='flex flex-col gap-4 w-full sm:max-w-[480px]'>
        <div className='text-xl sm:text-2xl my-3'>
          <CartTotal />
        </div>

        {/* Payment Methods */}
        <div className='mt-12'>
          <Title text1={'PAYMENT'} text2={'METHOD'} />
          <p className="mt-2 text-sm text-gray-600">Stripe is our secure payment provider.</p>
          {/* Submit button */}
          {/* Desktop & tablet */}
          <div className="hidden sm:block w-full text-end mt-8">
            <button
              onClick={handleSubmit}
              className="bg-black rounded hover:bg-[#ff6667] text-white px-16 py-3 text-sm"
            >
              PLACE BOOKING
            </button>
          </div>

          {/* Mobile-only fixed bottom action bar */}
          <div className="sm:hidden">
            {/* Spacer is handled by pb-24 on the page container */}
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