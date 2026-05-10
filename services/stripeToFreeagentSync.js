import Stripe from "stripe";
import axios from "axios";
import Booking from "../models/bookingModel.js";
import StripeLedgerSync from "../models/stripeLedgerSyncModel.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const FA_BASE = process.env.FREEAGENT_BASE_URL || "https://api.freeagent.com";
const FA_BANK_ACCOUNT_URL = process.env.FA_BANK_ACCOUNT_URL;
const FA_CAT_CLEARING = process.env.FA_CATEGORY_STRIPE_CLEARING_URL;
const FA_CAT_COMMISSION = process.env.FA_CATEGORY_COMMISSION_INCOME_URL;
const FA_CAT_VAT = process.env.FA_CATEGORY_VAT_OUTPUT_URL;
const FA_CAT_FEES = process.env.FA_CATEGORY_STRIPE_FEES_URL;
const FA_CAT_CLIENT_FUNDS = process.env.FA_CATEGORY_CLIENT_FUNDS_HELD_URL;

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

// FreeAgent journal: debit_value uses negatives for credits (see examples).  [oai_citation:5‡dev.freeagent.com](https://dev.freeagent.com/docs/journal_sets)
const faDebit = (amt) => String(money(Math.abs(amt)));
const faCredit = (amt) => String(-money(Math.abs(amt)));

async function getFreeAgentAccessToken() {
  // Refresh token flow (access tokens expire; refresh tokens don’t).  [oai_citation:6‡dev.freeagent.com](https://dev.freeagent.com/docs/oauth?utm_source=chatgpt.com)
  const tokenUrl = `${FA_BASE}/v2/token_endpoint`;
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.FREEAGENT_REFRESH_TOKEN,
    client_id: process.env.FREEAGENT_CLIENT_ID,
    client_secret: process.env.FREEAGENT_CLIENT_SECRET,
  });

  const { data } = await axios.post(tokenUrl, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return data.access_token;
}

async function faRequest(accessToken, method, path, body) {
  const url = `${FA_BASE}${path}`;
  const { data } = await axios({
    method,
    url,
    data: body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  return data;
}

async function findBankTxnForPayout(accessToken, { datedOnISO, amount, payoutId }) {
  // FreeAgent bank txns are per bank account.  [oai_citation:7‡FreeAgent API Discussion Forum](https://api-discuss.freeagent.com/t/access-to-bank-transactions-via-api/6543?utm_source=chatgpt.com)
  const qs = new URLSearchParams({ bank_account: FA_BANK_ACCOUNT_URL }).toString();
  const data = await faRequest(accessToken, "GET", `/v2/bank_transactions?${qs}`);

  // Heuristic match: same date + amount and description contains Stripe/payout
  const txns = data.bank_transactions || [];
  const targetMinor = Math.round(amount * 100);

  const match = txns.find((t) => {
    const txnMinor = Math.round(Number(t.amount || 0) * 100);
    const sameAmt = txnMinor === targetMinor;
    const sameDate = String(t.dated_on || "") === datedOnISO;
    const desc = String(t.description || "").toLowerCase();
    const looksStripe = desc.includes("stripe") || desc.includes("payout") || desc.includes(payoutId.toLowerCase());
    return sameAmt && sameDate && looksStripe;
  });

  return match || null;
}

async function explainBankTxnToClearing(accessToken, bankTxnUrl, payoutId) {
  // Create bank transaction explanation.  [oai_citation:8‡dev.freeagent.com](https://dev.freeagent.com/docs/bank_transaction_explanations)
  const payload = {
    bank_transaction_explanation: {
      bank_transaction: bankTxnUrl,
      category: FA_CAT_CLEARING,
      description: `Stripe payout ${payoutId} (to clearing)`,
    },
  };

  return faRequest(accessToken, "POST", `/v2/bank_transaction_explanations`, payload);
}

async function createJournalSet(accessToken, { datedOnISO, payoutId, totals }) {
  const { commissionNet, commissionVat, passThrough, fees } = totals;

  // Balance journal entries against clearing:
  // Debits: fees expense, client funds held (if you treat it as increasing liability, it’s a CREDIT; see below)
  // Credits: commission income (net), VAT output, clearing.
  //
  // For liability “Client funds held”: increasing liability is a CREDIT.
  // In journal terms: credit_value == negative debit_value. So we use faCredit(passThrough).

  const entries = [];

  if (money(commissionNet) !== 0) {
    entries.push({ category: FA_CAT_COMMISSION, description: `Commission income (net)`, debit_value: faCredit(commissionNet) });
  }
  if (money(commissionVat) !== 0) {
    entries.push({ category: FA_CAT_VAT, description: `VAT output on commission`, debit_value: faCredit(commissionVat) });
  }
  if (money(passThrough) !== 0) {
    entries.push({ category: FA_CAT_CLIENT_FUNDS, description: `Client funds held for musicians`, debit_value: faCredit(passThrough) });
  }
  if (money(fees) !== 0) {
    entries.push({ category: FA_CAT_FEES, description: `Stripe fees`, debit_value: faDebit(fees) });
  }

  // Clearing is the balancing debit:
  // clearing_debit = commissionNet + commissionVat + passThrough - fees
  const clearingDebit = money(commissionNet + commissionVat + passThrough - fees);
  if (money(clearingDebit) !== 0) {
    entries.push({ category: FA_CAT_CLEARING, description: `Stripe clearing (balance)`, debit_value: faDebit(clearingDebit) });
  }

  const payload = {
    journal_set: {
      dated_on: datedOnISO,
      description: `Stripe payout ${payoutId}`,
      tag: `stripe_payout_${payoutId}`, // makes it easy to search on FA side  [oai_citation:9‡dev.freeagent.com](https://dev.freeagent.com/docs/journal_sets)
      journal_entries: entries,
    },
  };

  return faRequest(accessToken, "POST", `/v2/journal_sets`, payload); //  [oai_citation:10‡dev.freeagent.com](https://dev.freeagent.com/docs/journal_sets)
}

export async function syncStripePayoutsToFreeAgent({ startDateISO }) {
  const accessToken = await getFreeAgentAccessToken();

  // List payouts since start date
  const startUnix = Math.floor(new Date(startDateISO).getTime() / 1000);

  let startingAfter = undefined;
  while (true) {
    const page = await stripe.payouts.list({
      limit: 50,
      starting_after: startingAfter,
      created: { gte: startUnix },
    });

    for (const payout of page.data) {
      const existing = await StripeLedgerSync.findOne({ payoutId: payout.id }).lean();
      if (existing?.status === "synced") continue;

      try {
        const datedOnISO = new Date(payout.arrival_date * 1000).toISOString().slice(0, 10);
        const payoutAmount = money(payout.amount / 100); // stripe payouts are in minor units
        const payoutId = payout.id;

        // Aggregate from balance transactions
        let commissionNet = 0, commissionVat = 0, passThrough = 0, fees = 0;

        let btStartingAfter = undefined;
        while (true) {
          const bts = await stripe.balanceTransactions.list({
            payout: payoutId,
            limit: 100,
            starting_after: btStartingAfter,
          });

          for (const bt of bts.data) {
            const amt = money(bt.amount / 100);
            const fee = money(bt.fee / 100);

            // fees (Stripe fee field exists on many balance txns)
            if (fee) fees += fee;

            if (bt.type === "charge") {
              // bt.source is usually the Charge id; retrieve charge to get payment_intent
              const charge = await stripe.charges.retrieve(bt.source);
              const piId = charge.payment_intent;

              if (piId) {
                const booking = await Booking.findOne({ paymentIntentId: piId }).lean();
                if (booking?.accounting) {
                  commissionNet += money(booking.accounting.commissionNet);
                  commissionVat += money(booking.accounting.commissionVat);
                  passThrough += money(booking.accounting.passThroughGross);
                } else {
                  // fallback: use PI metadata if booking not found
                  const pi = await stripe.paymentIntents.retrieve(piId);
                  commissionNet += money(Number(pi.metadata?.commission_net || 0));
                  commissionVat += money(Number(pi.metadata?.commission_vat || 0));
                  passThrough += money(Number(pi.metadata?.pass_through_gross || 0));
                }
              }
            }

            if (bt.type === "refund") {
              // Simplest MVP: treat refunds as reducing the same buckets proportionally
              const refund = await stripe.refunds.retrieve(bt.source);
              const charge = await stripe.charges.retrieve(refund.charge);
              const piId = charge.payment_intent;
              const grossRefund = Math.abs(amt);

              if (piId) {
                const booking = await Booking.findOne({ paymentIntentId: piId }).lean();
                const grossOriginal = money(charge.amount / 100);
                const ratio = grossOriginal ? money(grossRefund / grossOriginal) : 1;

                const baseCommissionNet = booking?.accounting?.commissionNet ?? Number(charge.metadata?.commission_net ?? 0);
                const baseCommissionVat = booking?.accounting?.commissionVat ?? Number(charge.metadata?.commission_vat ?? 0);
                const basePassThrough = booking?.accounting?.passThroughGross ?? Number(charge.metadata?.pass_through_gross ?? 0);

                commissionNet -= money(baseCommissionNet * ratio);
                commissionVat -= money(baseCommissionVat * ratio);
                passThrough -= money(basePassThrough * ratio);
              }
            }
          }

          if (!bts.has_more) break;
          btStartingAfter = bts.data[bts.data.length - 1]?.id;
        }

        // 1) Find & explain the bank transaction (payout deposit) to clearing
        const bankTxn = await findBankTxnForPayout(accessToken, {
          datedOnISO,
          amount: payoutAmount,
          payoutId,
        });

        let explanationUrl = null;
        let bankTxnUrl = bankTxn?.url || null;

        if (bankTxnUrl) {
          const exp = await explainBankTxnToClearing(accessToken, bankTxnUrl, payoutId);
          explanationUrl = exp?.bank_transaction_explanation?.url || null;
        }

        // 2) Create journal set (clearing -> income/vat/fees/liability)
        const js = await createJournalSet(accessToken, {
          datedOnISO,
          payoutId,
          totals: { commissionNet, commissionVat, passThrough, fees },
        });

        const journalSetUrl = js?.journal_set?.url || null;

        await StripeLedgerSync.updateOne(
          { payoutId },
          {
            $set: {
              payoutId,
              payoutDateISO: datedOnISO,
              payoutAmount,
              freeagentJournalSetUrl: journalSetUrl,
              freeagentBankTransactionUrl: bankTxnUrl,
              freeagentExplanationUrl: explanationUrl,
              status: bankTxnUrl ? "synced" : "partial",
              error: bankTxnUrl ? "" : "Bank transaction not found to explain (still journaled).",
              meta: { commissionNet, commissionVat, passThrough, fees },
            },
          },
          { upsert: true },
        );
      } catch (err) {
        await StripeLedgerSync.updateOne(
          { payoutId: payout.id },
          { $set: { status: "failed", error: err?.message || String(err) } },
          { upsert: true },
        );
      }
    }

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
  }
}