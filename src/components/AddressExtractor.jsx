import React, { useEffect } from "react";

const AddressExtractor = ({ place, setFormData }) => {
  useEffect(() => {
    if (!place) return;

    const addressDetails = {
      street_number: "",
      street: "",
      town: "",
      county: "",
      postcode: "",
      country: "",
    };

    if (place.address) {
      addressDetails.street = place.address.street || "";
      addressDetails.town = place.address.city || "";
      addressDetails.county = place.address.state || "";
      addressDetails.postcode = place.address.postalCode || "";
      addressDetails.country = place.address.countryName || "";
    }

    setFormData((prev) => ({ ...prev, ...addressDetails }));
  }, [place, setFormData]);

  return null;
};

export default AddressExtractor;