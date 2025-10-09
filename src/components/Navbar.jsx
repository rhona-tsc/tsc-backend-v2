import React, { useContext, useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { assets } from '../assets/assets';
import { ShopContext } from '../context/ShopContext';

const Navbar = () => {
  const navigate = useNavigate();
  const {
    setShowSearch,
    getCartCount,
    getShortlistCount,
    cartUpdated,
    token,
    setToken,
    setCartItems,
  } = useContext(ShopContext);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dropdownRef = useRef(null);
  const drawerRef = useRef(null);

  const logout = () => {
    localStorage.removeItem('token');
    setToken('');
    setCartItems({});
    navigate('/login');
  };

  // Close dropdown on outside click / ESC
  useEffect(() => {
    const onClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    const onEsc = (e) => e.key === 'Escape' && setDropdownOpen(false);
    if (dropdownOpen) {
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onEsc);
    }
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [dropdownOpen]);

  // Lock body scroll when drawer open + close on ESC
  useEffect(() => {
    const onEsc = (e) => e.key === 'Escape' && setDrawerOpen(false);
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', onEsc);
    } else {
      document.body.style.overflow = '';
    }
    return () => document.removeEventListener('keydown', onEsc);
  }, [drawerOpen]);

  return (
    <header className="w-full fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur shadow-sm">
      <nav className="h-16 w-full grid grid-cols-[auto_1fr_auto] items-center pl-2 pr-2 sm:px-4 bg-white">
                {/* Logo:
           - <lg: Agent logo (small)
           - lg+: Desktop logo
        */}
        <Link to="/" className="flex-shrink-0" aria-label="Home">
          <img
            src={assets.agent_icon}
            alt="Logo"
            className="h-20 w-auto block lg:hidden"
          />
          <img
            src={assets.logo}
            alt="Logo"
            className="h-10 w-auto hidden lg:block"
          />
        </Link>

        {/* Center links — only on lg and up (hidden earlier to free space for icons) */}
        <ul className="hidden lg:flex justify-center gap-10 text-sm text-gray-700">
                    <NavLink to="/" className="group flex flex-col items-center gap-1">
            <p>HOME</p>
            <span className="w-3/4 h-px bg-[#ff6677] opacity-0 group-hover:opacity-100 transition-opacity" />
          </NavLink>
          <NavLink to="/acts" className="group flex flex-col items-center gap-1">
            <p>ACTS</p>
            <span className="w-3/4 h-px bg-[#ff6677] opacity-0 group-hover:opacity-100 transition-opacity" />
          </NavLink>
          <NavLink to="/about" className="group flex flex-col items-center gap-1">
            <p>ABOUT</p>
            <span className="w-3/4 h-px bg-[#ff6677] opacity-0 group-hover:opacity-100 transition-opacity" />
          </NavLink>
          <NavLink to="/contact" className="group flex flex-col items-center gap-1">
            <p>CONTACT</p>
            <span className="w-3/4 h-px bg-[#ff6677] opacity-0 group-hover:opacity-100 transition-opacity" />
          </NavLink>
        </ul>

        {/* Right icon cluster — visible normally; hide under 390px */}
        <div className="justify-self-end flex items-center gap-4 sm:gap-6 max-[389px]:hidden">
                    {/* Search */}
          <button
            onClick={() => { setShowSearch(true); navigate('/acts'); }}
            className="relative p-2 rounded hover:bg-gray-100 active:scale-95"
            aria-label="Search"
          >
            <img src={assets.search_icon} alt="" className="w-5 h-5" />
          </button>

          {/* Profile dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="relative p-2 rounded hover:bg-gray-100 active:scale-95"
              aria-haspopup="menu"
              aria-expanded={dropdownOpen}
              aria-label="Account"
            >
              <img src={assets.profile_icon} alt="" className="w-5 h-5" />
            </button>
            {dropdownOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 bg-white shadow-lg rounded-lg w-44 py-2 text-gray-700 ring-1 ring-black/5"
              >
                {token && (
                  <>
                    <button
                      role="menuitem"
                      onClick={() => { /* navigate('/profile') */ }}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100"
                    >
                      My Profile
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => navigate('/bookings')}
                      className="w-full text-left px-4 py-2 hover:bg-gray-100"
                    >
                      Bookings
                    </button>
                  </>
                )}
                <button
                  role="menuitem"
                  onClick={logout}
                  className="w-full text-left px-4 py-2 hover:bg-gray-100"
                >
                  {token ? 'Logout' : 'Login'}
                </button>
              </div>
            )}
          </div>

          {/* Shortlist */}
          <Link to="/shortlist" className="relative p-2 rounded hover:bg-gray-100 active:scale-95">
            <img src={assets.shortlist_icon} alt="Shortlist" className="w-5 h-5" />
            <span className="absolute -right-1.5 -bottom-1.5 min-w-4 px-1 text-center bg-black text-white rounded-full text-[10px] leading-4">
              {getShortlistCount()}
            </span>
          </Link>

          {/* Cart */}
          <Link to="/cart" className="relative p-2 rounded hover:bg-gray-100 active:scale-95">
            <img src={assets.cart_icon} alt="Cart" className="w-5 h-5" />
            <span className="absolute -right-1.5 -bottom-1.5 min-w-4 px-1 text-center bg-black text-white rounded-full text-[10px] leading-4">
              {getCartCount()}
            </span>
            {cartUpdated && (
              <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white animate-ping" />
            )}
          </Link>
        </div>

        {/* Hamburger — visible below lg (i.e., as soon as we switch logos) */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="justify-self-end p-2 rounded hover:bg-gray-100 active:scale-95 lg:hidden"
          aria-label="Open menu"
        >
          <img src={assets.menu_icon} alt="" className="w-6 h-6" />
        </button>
      </nav>

      {/* Mobile drawer + backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        className={`fixed z-50 top-0 right-0 h-full w-[85%] max-w-xs bg-white shadow-xl transform transition-transform duration-300
          ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}
        aria-label="Mobile menu"
      >
        <div className="h-16 px-4 flex items-center justify-between border-b bg-white">
          <span className="text-sm font-medium">MENU</span>
          <button
            className="p-2 rounded hover:bg-gray-100"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          >
            <img src={assets.dropdown_icon} className="h-4 rotate-180" alt="" />
          </button>
        </div>
        <div className="py-2 bg-white">
          <NavLink onClick={() => setDrawerOpen(false)} to="/" className="block px-6 py-3 border-b">
            HOME
          </NavLink>
          <NavLink onClick={() => setDrawerOpen(false)} to="/acts" className="block px-6 py-3 border-b">
            ACTS
          </NavLink>
          <NavLink onClick={() => setDrawerOpen(false)} to="/about" className="block px-6 py-3 border-b">
            ABOUT
          </NavLink>
          <NavLink onClick={() => setDrawerOpen(false)} to="/contact" className="block px-6 py-3 border-b">
            CONTACT
          </NavLink>
        </div>
      </aside>
    </header>
  );
};

export default Navbar;