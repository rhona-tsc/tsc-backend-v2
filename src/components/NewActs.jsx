import React, { useContext, useEffect, useState } from "react";
import { ShopContext } from "../context/ShopContext";
import Title from "./Title";
import ActItem from "./ActItem";

const NewActs = () => {
  const { acts, userId, shortlistAct, shortlistItems } =
    useContext(ShopContext);
  const [newestActs, setNewestActs] = useState([]);

  const isShortlisted = (actId) => shortlistItems.includes(actId);

  useEffect(() => {
    const approvedActs = acts.filter(
      (act) =>
        act.status === "approved" || act.status === "Approved, changes pending"
    );

    // Use same price calculation logic as BestSeller.jsx
    const calculatePrice = (act) => {
      if (!act || !Array.isArray(act.lineups) || act.lineups.length === 0)
        return null;
      // Sort by number of members and pick the smallest lineup
      const sortedLineups = [...act.lineups].sort(
        (a, b) => (a.bandMembers?.length || 0) - (b.bandMembers?.length || 0)
      );
      const smallestLineup = sortedLineups[0];
      if (!smallestLineup || !Array.isArray(smallestLineup.bandMembers))
        return null;
      const essentialFees = smallestLineup.bandMembers.reduce((acc, member) => {
        if (member.isEssential && typeof member.fee === "number") {
          acc.push(member.fee);
        }
        if (Array.isArray(member.additionalRoles)) {
          member.additionalRoles.forEach((role) => {
            if (role.isEssential && typeof role.additionalFee === "number") {
              acc.push(role.additionalFee);
            }
          });
        }
        return acc;
      }, []);
      const totalFee = essentialFees.reduce((sum, fee) => sum + fee, 0);
      return totalFee ? Math.ceil(totalFee / 0.75) : null;
    };

    const updatedActs = approvedActs
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map((act) => ({
        ...act,
        formattedPrice: calculatePrice(act),
      }));
    const actIds = updatedActs.map((act) => act._id);

    setNewestActs(updatedActs);
  }, [acts]);

  return (
    <div className="my-10">
      <div className="text-center py-8 text-3xl">
        <Title text1={"NEW"} text2={"ACTS"} />
        <p className="w-3.4 m-auto text-xs sm:text-md md:text-base text-gray-600">
          Our most recent additions to The Supreme Collective, raring to make
          your event stellar.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 gap-y-6">
        {newestActs.map(
          (item, index) =>
            item &&
            item.lineups &&
            item.lineups.length > 0 && (
           <ActItem
  key={item._id}
  actData={item}
  isShortlisted={isShortlisted(item._id)}
  onShortlistToggle={() => shortlistAct(userId, item._id)}
  price={item.formattedPrice}
/>
            )
        )}
      </div>
    </div>
  );
};

export default NewActs;
