import React from "react";
import { assets } from "../assets/assets";
import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <div>
      <div className="flex flex-col sm:grid grid-cols-[3fr_1fr_1fr] gap-14 my-10 mt-5 text-sm">
        <div>
          <img src={assets.logo} className="mb-5 w-60" alt="" />
          <p className="w-full md:w-2/3 text-gray-600">
            Live bands and live music for weddings | parties | corporate events
            | awards ceremonies | summer balls | winter staff parties |
            anniversaries | memorials | Israeli weddings | bar & batmitzvahs |
            ceremonies | drinks receptions | evening receptions | club nights |
            birthday parties | retirement parties | product launches | sporting
            events | festivals | NYE celebrations & more
          </p>
        </div>

        <div>
          <p className="text-xl font-medium mb-5">COMPANY</p>
          <ul className="flex flex-col gap-1 text-gray-600">
             <li><Link to="/">Home</Link></li>
  <li><Link to="/about">About Us</Link></li>
  <li><Link to="/terms">Terms & Conditions</Link></li>
  <li><Link to="/privacy">Privacy Policy</Link></li>
          </ul>
        </div>

        <div>
          <p className="text-xl font-medium mb-5">GET IN TOUCH</p>
          <ul className="flex flex-col gap-1 text-gray-600">
            <li>+44 203 576 5322</li>
            <li>+44 7594 223200</li>
            <li>hello@thesupremecollective.co.uk</li>
          </ul>
        </div>
      </div>

      <div>
        <hr />
        <p className="py-5 text-sm text-center">
          Copyright 2025@ thesupremecollective.co.uk - All Rights Reserved
        </p>
      </div>
    </div>
  );
};

export default Footer;
