// src/pages/BookingSuccess.jsx
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import axios from 'axios';

const BookingSuccess = () => {
  const location = useLocation();
  const [booking, setBooking] = useState(null);
  const [eventSheetDue, setEventSheetDue] = useState(null);
  const [balanceDue, setBalanceDue] = useState(null);

  // 1) One-shot server finalize (guarded + cleans URL)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (!sessionId) return;

    // idempotency: guard per-sessionId so back/refresh doesn't re-trigger
    const guardKey = `bookingComplete:${sessionId}`;
    if (sessionStorage.getItem(guardKey) === '1') return;

    (async () => {
      try {
        await fetch(
          `${import.meta.env.VITE_BACKEND_URL}/api/booking/booking-complete?session_id=${encodeURIComponent(sessionId)}`,
          { method: 'GET', credentials: 'include' }
        );
        sessionStorage.setItem(guardKey, '1');
      } catch (e) {
        console.warn('booking-complete call failed:', e);
      } finally {
        // remove session_id from the URL so back/forward won't call again
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    })();
  }, []);

  // 2) Load the newest booking for the logged-in user (or by ref in state)
  useEffect(() => {
    const stateRef = location.state?.bookingRef || location.state?.bookingId || null;
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const userId = user?._id;

    (async () => {
      try {
        let b = null;

        if (stateRef) {
          // try by human bookingRef first, then by _id
          try {
            const r = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/booking/by-ref/${stateRef}`);
            b = r?.data?.booking || Array.isArray(r?.data) ? r.data[0] : r?.data;
          } catch {}
          if (!b && /^[0-9a-f]{24}$/i.test(stateRef)) {
            const r = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/booking/booking/${stateRef}`);
            b = r?.data || null;
          }
        }

        if (!b && userId) {
          const r = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/booking/user/${userId}`);
          const list = Array.isArray(r?.data) ? r.data : (r?.data?.bookings || r?.data?.data || []);
          b = list?.[0] || null; // newest
        }

        if (b?.date) {
          const event = new Date(b.date);
          const d1 = new Date(event);
          d1.setMonth(d1.getMonth() - 1);
          setEventSheetDue(d1.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }));
          const d2 = new Date(event);
          d2.setDate(d2.getDate() - 14);
          setBalanceDue(d2.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }));
        }

        setBooking(b || null);
      } catch (e) {
        console.warn('Failed to load booking for success page', e?.message);
      }
    })();
  }, [location.state]);

  return (
    <div className="p-10 text-center max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">🎉 Booking Confirmed!</h1>
      <p className="mb-4">
        Thank you for your payment. Your confirmation and signed contract have been sent to your email.
      </p>
      <p className="mb-4">
        When you’re ready, head to your Event Sheet to add key details — it auto-saves and keeps everyone aligned.
      </p>

      {/* Use the same link pattern as Client_Dashboard */}
      {booking ? (
        <div className="mb-6">
          <Link
            to={`/event-sheet/${booking.bookingId || booking._id}`}
            className="inline-block bg-black text-white px-4 py-2 rounded hover:bg-gray-800"
          >
            Take Me to the Event Sheet
          </Link>
        </div>
      ) : (
        <p className="text-sm text-gray-500 mb-6">Loading your booking…</p>
      )}

      {/* (Removed the Dashboard button on mobile & desktop as requested) */}

      <div className="text-center mt-6 border-t pt-4 text-sm">
        <p className="font-semibold mb-2">Key Dates for Your Diary:</p>
        <ul className="list-disc list-inside">
          <li>Event Sheet due: <strong>{eventSheetDue || '4 weeks before your event'}</strong></li>
          <li>Balance payment due: <strong>{balanceDue || '2 weeks before your event'}</strong></li>
        </ul>
      </div>

      <p className="mt-6 font-medium">
        Warmest wishes,<br/>The Supreme Collective
      </p>
    </div>
  );
};

export default BookingSuccess;