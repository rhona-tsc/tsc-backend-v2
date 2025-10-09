import React, { useEffect, useRef } from "react";

const GoogleAutocomplete = ({ setAddress, setCounty, ...props }) => {
  const inputRef = useRef(null);

  useEffect(() => {
    let autocomplete;

    function init() {
      if (
        !window.google ||
        !window.google.maps ||
        !window.google.maps.places ||
        !inputRef.current
      ) {
        return false;
      }

      autocomplete = new window.google.maps.places.Autocomplete(
        inputRef.current,
        {
          types: ["geocode"],
          componentRestrictions: { country: "gb" }, // ✅ use GB
        }
      );

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place || !place.formatted_address) return;

        const address = place.formatted_address;
        const components = place.address_components || [];
        const countyComponent = components.find((c) =>
          c.types.includes("administrative_area_level_2")
        );
        const county = countyComponent?.long_name || "";

        setAddress(address);
        setCounty(county);
      });

      return true;
    }

    // Try immediately, then retry a few times while the script loads.
    if (!init()) {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (init() || Date.now() - t0 > 8000) clearInterval(timer);
      }, 250);
      return () => clearInterval(timer);
    }
  }, [setAddress, setCounty]);

  return (
    <input
      type="text"
      ref={inputRef}
      placeholder="Enter venue..."
      className="border rounded p-2 w-full"
      onChange={(e) => setAddress?.(e.target.value)} // keep value usable even before Maps loads
      {...props}
    />
  );
};

export default GoogleAutocomplete;