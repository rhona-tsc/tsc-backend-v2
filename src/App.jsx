import React from "react";
import { jwtDecode } from "jwt-decode";
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
import { useState, useEffect   } from "react";

// 👇 helper to decode token once
function parseToken(t) {
  if (!t) return {};
  try {
    const d = jwtDecode (t);
    const user = {
      firstName: d?.firstName || "",
      lastName: d?.lastName || "",
      email: d?.email || "",
      phone: d?.phone || "",
      userId: d?.userId || d?.id || "",
      userRole: d?.role || "",
      password: d?.password || "",
    };
    // hardcoded override
    if (d?.id === "68123dcda79759339808b578") {
      user.userRole = "agent";
    }
    return user;
  } catch {
    return {};
  }
}

const App = () => {
  const initialToken = localStorage.getItem("token") || "";
  const initialUser = parseToken(initialToken);

 // ✅ hydrate initial state from token so first render is correct
  const [token, setToken] = useState(initialToken);
  const [firstName, setFirstName] = useState(initialUser.firstName || "");
  const [lastName, setLastName] = useState(initialUser.lastName || "");
  const [phone, setPhone] = useState(initialUser.phone || "");
  const [userId, setUserId] = useState(initialUser.userId || "");
  const [email, setEmail] = useState(initialUser.email || "");
  const [userRole, setUserRole] = useState(initialUser.userRole || "");
  const [password, setPassword] = useState(initialUser.password || "");
  const [hydrated, setHydrated] = useState(true); 

  const handleLogout = () => {
    setToken("");
    localStorage.clear();
    setFirstName("");
    setLastName("");
    setPhone("");
    setUserId("");
    setEmail("");
    setUserRole("");
    setPassword("");
  };

  // If token changes at runtime (login), re-hydrate fields
  useEffect(() => {
    if (!token) return;
    const d = parseToken(token);
    setFirstName(d.firstName || "");
    setLastName(d.lastName || "");
    setEmail(d.email || "");
    setPhone(d.phone || "");
    setUserId(d.userId || "");
    setUserRole(d.userRole || "");
    setPassword(d.password || "");
    setHydrated(true);
  }, [token]);

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
            <Route path="/acts" element={<Acts email={email}
                userRole={userRole}
                firstName={firstName}
                lastName={lastName}
                phone={phone}
                password={password}
                userId={userId}
                />} />
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
