import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

const Client_Dashboard = () => {
  const [bookings, setBookings] = useState([]);
  const userId = localStorage.getItem('userId'); // Or use context if you store it there

  useEffect(() => {
    const fetchBookings = async () => {
      try {
        const response = await axios.get(`${import.meta.env.VITE_BACKEND_URL}/api/booking/user/${userId}`);
        setBookings(response.data);
      } catch (err) {
        console.error("Failed to fetch bookings:", err.message);
      }
    };

    if (userId) {
      fetchBookings();
    }
  }, [userId]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">🎉 Booking Confirmed!</h1>
      <p className="text-gray-700 mb-4">
        Thank you for your booking. You’ll find your confirmed acts and links to their event sheets below.
      </p>

      <ul className="list-disc list-inside text-gray-600">
        {bookings.map((booking, index) => (
          <li key={index}>
            Act: {booking.actName} –{" "}
           <Link to={`/event-sheet/${booking.bookingId || booking._id}`}>View Event Sheet</Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Client_Dashboard;