// Legacy accounting rows can describe either the entire fee or only the balance.
// Deduct a deposit only when the displayed invoice includes the entire fee.
export const resolveInvoiceAmounts = ({ storedGross, calculatedGross, depositPaid, adjustments = 0 }) => {
  const pence = (n) => Math.round(Number(n || 0) * 100);
  const full = pence(storedGross);
  const displayed = pence(calculatedGross);
  const deposit = Math.max(0, pence(depositPaid));
  const balanceOnly = full > 0 && deposit > 0 && displayed > 0 &&
    displayed !== full && displayed === Math.max(0, full - deposit);
  const includesSeparateAdjustments = displayed === full + pence(adjustments);
  const gross = balanceOnly || displayed >= full || includesSeparateAdjustments
    ? displayed : full > 0 ? full : displayed;
  const deducted = balanceOnly ? 0 : deposit;
  return {
    gross: gross / 100,
    depositPaid: deducted / 100,
    amountDue: Math.max(0, gross - deducted) / 100,
    balanceOnly,
    // Avoid presenting a misleading accounting allocation when it does not
    // reconcile with either the fee or the known outstanding balance.
    totalOnly: !balanceOnly && displayed !== gross,
  };
};
