import React, { useContext, useEffect, useState, useMemo } from 'react';
import Title from './Title';
import { ShopContext } from '../context/ShopContext';
import calculateActPricing from '../pages/utils/pricing';

const CartTotal = () => {
  const {
    acts,
    cartItems,
    selectedAddress,
    selectedDate,
    currency,
  } = useContext(ShopContext);

  const [totalAmount, setTotalAmount] = useState(0);
  const [summaryItems, setSummaryItems] = useState([]);

  // --- helpers ----------------------------------------------------
  const daysUntilEvent = useMemo(() => {
    if (!selectedDate) return null;
    const now = new Date();
    const event = new Date(selectedDate);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(event.getFullYear(), event.getMonth(), event.getDate());
    const diffMs = end.getTime() - start.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }, [selectedDate]);

  const requiresFullPayment = useMemo(() => {
    if (daysUntilEvent == null) return false;
    return daysUntilEvent <= 28;
  }, [daysUntilEvent]);

  const getSafeBaseFee = (lineup) => {
    // try to match by actSize
    const bySize =
      lineup?.base_fee?.find(
        (fee) => fee?.act_size === lineup?.actSize || fee?.act_size === lineup?.act_size
      )?.total_fee;

    // fall back to first entry if any
    const first = lineup?.base_fee?.[0]?.total_fee;

    return Number(bySize ?? first ?? 0) || 0;
  };

  const getEssentialRolesTotal = (lineup) => {
    const roles = (lineup?.bandMembers || []).flatMap((m) =>
      (m?.additionalRoles || []).filter(
        (r) => r?.isEssential && typeof r?.additionalFee === 'number'
      )
    );
    return roles.reduce((sum, r) => sum + (r?.additionalFee || 0), 0);
  };

  // ---------------------------------------------------------------

  useEffect(() => {
    const loadTotal = async () => {
      if (!acts || acts.length === 0 || !cartItems || Object.keys(cartItems).length === 0) {
        setSummaryItems([]);
        setTotalAmount(0);
        return;
      }

      const selectedCounty = selectedAddress?.split(",").slice(-2)[0]?.trim() || "";
      let grand = 0;
      const summary = [];

      for (const actId of Object.keys(cartItems)) {
        const act = acts.find((a) => a._id === actId);
        if (!act) {
          continue;
        }

        for (const lineupId of Object.keys(cartItems[actId])) {
          const cartNode = cartItems[actId][lineupId] || {};
          const quantity = Number(cartNode.quantity || 1);
          const selectedExtras = Array.isArray(cartNode.selectedExtras)
            ? cartNode.selectedExtras
            : cartNode.selectedExtras
              ? [cartNode.selectedExtras]
              : [];
          const afternoonExtras = Array.isArray(cartNode.selectedAfternoonSets)
            ? cartNode.selectedAfternoonSets
            : [];

          const lineup = act.lineups.find(
            (l) => String(l._id || l.lineupId) === String(lineupId)
          );
          if (!lineup) {
            continue;
          }

          // Try calculateActPricing first (this includes travel + margin in your util)
          let calc = null;
          try {
            calc = await calculateActPricing(
              act,
              selectedCounty,
              selectedAddress,
              selectedDate,
              lineup
            );
          } catch (err) {
          }

          const calcTotal = Number(calc?.total);
          const baseFee = getSafeBaseFee(lineup);
          const essentialRoles = getEssentialRolesTotal(lineup);
          const rawBase = baseFee + essentialRoles;
          const fallbackGross = rawBase > 0 ? Math.ceil(rawBase / 0.75) : 0;

          // If calcTotal is valid and > 0, use it. Otherwise fallback.
          const subtotalWithMargin =
            Number.isFinite(calcTotal) && calcTotal > 0 ? calcTotal : fallbackGross;

          // Sum extras (defensively treat missing/strings)
          const extrasTotal =
            selectedExtras.reduce(
              (sum, ex) => sum + (Number(ex?.price) || 0),
              0
            ) || 0;
          const afternoonExtrasTotal =
            afternoonExtras.reduce(
              (sum, set) => sum + (Number(set?.price) || 0),
              0
            ) || 0;

          const combinedExtrasTotal = extrasTotal + afternoonExtrasTotal;
          const lineTotal = (subtotalWithMargin + combinedExtrasTotal) * quantity;

  

          grand += lineTotal;

          summary.push({
            actName: act.name,
            tscName: act.tscName,
            lineupName: lineup.actSize,
            basePrice: subtotalWithMargin,
            extras: selectedExtras,
            quantity,
          });
        }
      }

      setSummaryItems(summary);
      setTotalAmount(grand);
    };

    loadTotal();
  }, [JSON.stringify(cartItems), acts, selectedAddress, selectedDate]);

  // Same formula as server-side
  const deposit = totalAmount === 0 ? 0 : Math.ceil((totalAmount - 50) * 0.2) + 50;

  return (
    <div className='w-full'>
      <div className='text-2xl mb-4'>
        <Title text1={'CART'} text2={'TOTAL'} />
      </div>

      {summaryItems.map((item, index) => (
        <div key={index} className='mb-4 text-sm border p-3 rounded bg-gray-50'>
          <div className='flex justify-between'>
            <p className='font-semibold'>{item.tscName} – {item.lineupName}</p>
            <p>{currency}{item.basePrice.toFixed(2)}</p>
          </div>
          {item.extras.length > 0 && (
            <div className='mt-1'>
              <p className='text-gray-600 text-xs'>Extras:</p>
              <ul className='list-disc list-inside'>
                {item.extras.map((extra, i) => (
                  <li key={i} className='flex justify-between'>
                    <span>{extra.name}</span>
                    <span>{currency}{Number(extra.price || 0).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}

      <div className='mt-10 text-sm border-t pt-4'>
        <div className={`flex justify-between ${requiresFullPayment ? 'font-extrabold text-gray-900' : ''}`}>
          <p>Total</p>
          <p>{currency}{totalAmount.toFixed(2)}</p>
        </div>

        {requiresFullPayment ? (
          <p className='mt-2 text-xs text-grey-700'>
            Full payment required as your event is 28 days or less away.
          </p>
        ) : (
          <>
            <hr className='my-2' />
            <div className='flex justify-between font-bold'>
              <p>Deposit</p>
              <p>{currency}{deposit.toFixed(2)}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CartTotal;