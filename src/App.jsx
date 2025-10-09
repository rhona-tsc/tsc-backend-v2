import React from "react";
import { BrowserRouter } from "react-router-dom"; // Import BrowserRouter
import { ToastContainer } from "react-toastify";
import Navbar from "./components/Navbar";
import SearchBox from "./components/SearchBox";
import Footer from "./components/Footer";
import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import About from "./pages/About";
import Act from "./pages/Act";
import Acts from "./pages/Acts";
import Bookings from "./pages/Bookings";
import Cart from "./pages/Cart";
import Client_Dashboard from "./pages/Client_Dashboard";
import Contact from "./pages/Contact";
import Login from "./pages/Login";
import MusicianDashboard from "./pages/MusicianDashboard";
import Musician_Login from "./pages/Musician_Login";
import Musician from "./pages/Musician";
import PlaceBooking from "./pages/PlaceBooking";
import Shortlist from "./pages/Shortlist";
import ShopProvider from './context/ShopContext';
import ViewEventSheet from "./pages/ViewEventSheet";
import BookingSuccess from './pages/BookingSuccess';
import BookingCancelled from './pages/BookingCancelled';
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";

const App = () => {
  const token = localStorage.getItem("adminToken");

  return (
    <>
      <ToastContainer
        position="top-right"
        autoClose={2000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        style={{ marginTop: "3.5rem" }}
        closeButton={false}
        
      />

      <div className="px-4 sm:px-[5vw] md:px-[7vw] lg:px-[4vw]">
        <Navbar />
        <SearchBox />
        <div className="mt-16">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/acts" element={<Acts />} />
            <Route path="/about" element={<About />} />
            <Route path="/act/:actId" element={<Act />} />
            <Route path="/bookings" element={<Bookings />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/client-dashboard" element={<Client_Dashboard />} />
            <Route path="/contact" element={<Contact />} />
              <Route path="/event-sheet/:bookingId" element={<ViewEventSheet />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />

            <Route path="/login" element={<Login />} />
            <Route path="/musician/:musicianId" element={<Musician />} />
            <Route path="/musician-dashboard" element={<MusicianDashboard />} />
             <Route path="/booking-success" element={<BookingSuccess />} />
  <Route path="/booking-cancelled" element={<BookingCancelled />} />
            <Route path="/musician-login" element={<Musician_Login />} />
            <Route path="/place-booking" element={<PlaceBooking />} />
            <Route path="/shortlist" element={<Shortlist />} />
          </Routes>
        </div>
        <Footer />
      </div>
    </>
  );
};

export default App;
