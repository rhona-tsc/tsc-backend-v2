import React, { useEffect } from 'react';
import Title from '../components/Title';
import { assets } from '../assets/assets';
import NewsletterBox from '../components/NewsletterBox';

const Terms = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []); // runs once when component mounts

  return (
    <div>
      <div className="text-2xl text-center pt-8 border-t">
        <Title text1="TERMS &" text2="CONDITIONS" />
      </div>

      <div className="my-10 flex flex-col md:flex-row gap-16">
        <img
          className="w-full md:w-auto md:max-w-[450px] h-auto object-cover"
          src={assets.Funk_Royale}
          alt=""
        />
        <div className="flex flex-col justify-center gap-6 md:w-2/4 text-gray-600">
          <h2 className="text-xl font-semibold mt-4">Introduction</h2>
          <p>
            Welcome to The Supreme Collective website. By accessing or using our site,
            you agree to the following terms.
          </p>

          <h2 className="text-xl font-semibold mt-4">Use of Website</h2>
          <p>
            This site is intended to provide information about our live music services.
            You may not misuse the site, attempt to breach security, or copy content
            without permission.
          </p>

          <h2 className="text-xl font-semibold mt-4">Intellectual Property</h2>
          <p>
            All logos, images, text, and media are owned by The Supreme Collective and
            may not be used without permission.
          </p>

          <h2 className="text-xl font-semibold mt-4">Booking Disclaimer</h2>
          <p>
            Information on this site is for reference only. All bookings are subject to
            written confirmation and a signed booking contract, which takes precedence
            over these website terms.
          </p>

          <h2 className="text-xl font-semibold mt-4">Liability</h2>
          <p>
            We are not responsible for errors on the website or downtime. We are not
            liable for any indirect loss arising from use of the site.
          </p>

          <h2 className="text-xl font-semibold mt-4">External Links</h2>
          <p>
            Our website may contain links to third-party sites. We are not responsible
            for their content or practices.
          </p>

          <h2 className="text-xl font-semibold mt-4">Changes</h2>
          <p>
            We may update these terms from time to time. Continued use of the site
            indicates your acceptance of changes.
          </p>

          <h2 className="text-xl font-semibold mt-4">Governing Law</h2>
          <p>
            These terms are governed by UK law and disputes will be subject to the
            jurisdiction of UK courts.
          </p>
        </div>
      </div>

      <div className="text-xl py-4">
        <Title text1="BOOKING" text2="CONTRACT" />
      </div>

      <div className="flex flex-col md:flex-row text-sm mb-20">
        <div className="border px-10 md:px-16 py-8 sm:py-20 flex flex-col gap-5">
          <p><strong>Key Points</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              This Contract is subject to Bamboo Music Management&apos;s Terms and Conditions.
            </li>
            <li>
              The Client must complete the Event Sheet four weeks prior to the event to
              ensure the finer details of the performance can be processed in a timely fashion.
            </li>
            <li>
              Point of contact numbers should be provided on the Event Sheet.
            </li>
            <li>
              The Client must provide the Artist with a reasonable free supply of soft drinks,
              a hot meal or hot buffet (for bookings when the artist is on site for 3 hours or more),
              free parking for all vehicles, a secure changing area, and a safe, level, dry, covered
              performance area, unless otherwise noted.
            </li>
          </ul>

          <p><strong>Client Authorisation</strong></p>
          <p>
            By signing the booking contract you confirm that you are the authorised signatory
            for this booking and agree to be bound by Bamboo Music Management’s Terms and
            Conditions of booking.
          </p>

          <p><strong>Agent Authorisation</strong></p>
          <p>
            Company Name: The Supreme Collective<br />
            Artist Name(s): as per booking confirmation
          </p>

          <p><strong>Bamboo Music Management - Terms and Conditions of Booking</strong></p>
          <p>
            If you do not understand any part of these Terms and Conditions, please check in
            with Bamboo Music Management or seek legal advice before agreeing to them and
            confirming a booking.
          </p>

          <p><strong>Definition</strong></p>
          <p>
            The following definitions refer to the &apos;Contract&apos; (Bamboo Music Management
            Booking Contract) and these &apos;Terms and Conditions&apos;. Bamboo Music Management,
            Company No. 09318270, is the &apos;Agent&apos;, the proposed entertainment booker is
            the &apos;Client&apos; and the proposed entertainment act is the &apos;Artist&apos;.
          </p>

          <p><strong>1 | Introduction</strong></p>
          <p>
            This booking contract is provided by the Agent and is made between the Client and
            Agent on behalf of the Artist. In issuing this Contract, the Agent is acting as an
            employment agency for the Artist, and is responsible for ensuring all band members
            are allocated and fully briefed in a timely manner in the run-up to the event, and
            the Artist is responsible for all preparation for the event and performance on the day.
            Artist, Client, and Agent responsibilities are detailed within this contract. Any breach
            of contract can fall upon the Artist or Client depending upon the item being breached.
          </p>

          <p><strong>2 | Booking</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>All bookings are confirmed immediately upon signing of this contract and payment of the deposit.</li>
            <li>A copy of the contract will be shared with the Client. The Agent will retain completed contracts for up to 4 years after completion.</li>
            <li>The Contract may be modified upon agreement from both parties in advance of the event date.</li>
            <li>Changes must be notified to the Agent who will re‑issue the contract if necessary.</li>
            <li>The agreed total cost and Deposit may change with any agreed alterations.</li>
            <li>The Agent will act as negotiator until the date of the event and completion of the contract.</li>
          </ul>

          <p><strong>3 | Payment of Booking Fees</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>The Deposit is due upon booking.</li>
            <li>The Balance (remaining fee owed) is due one week before the event day and is paid to the Agent.</li>
          </ul>

          <p><strong>4 | Late/Failure Payment of Balance</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>If the Client fails to pay the Balance on time, the Agent may terminate the Contract without penalty. The Client remains liable for applicable cancellation fees.</li>
            <li>The Agent may charge interest of up to 20% on late payments.</li>
            <li>Late payments may incur a £50 administration fee, payable within 14 days.</li>
            <li>Unpaid balances after 14 days may be referred to a Debt Recovery Firm and may incur additional costs.</li>
          </ul>

          <p><strong>5 | Cancellation</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Termination is only permitted in cases of Force Majeure or if all parties mutually agree.</li>
            <li>In the event of mutual cancellation, the Deposit is non‑refundable.</li>
          </ul>

          <p><strong>6 | Client Cancellation</strong></p>
          <p>If the Client cancels for any reason other than Force Majeure, the following fees apply:</p>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border px-3 py-2 text-left">Cancellation Timescale</th>
                  <th className="border px-3 py-2 text-left">Cancellation Fee</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="border px-3 py-2">More than 365 days before event</td><td className="border px-3 py-2">Nil</td></tr>
                <tr><td className="border px-3 py-2">Less than 24 hours after confirmation (8+ days before event)</td><td className="border px-3 py-2">Nil</td></tr>
                <tr><td className="border px-3 py-2">Less than 24 hours after confirmation within 7 days of event</td><td className="border px-3 py-2">Full Fee</td></tr>
                <tr><td className="border px-3 py-2">More than 90 days before event</td><td className="border px-3 py-2">60% of Full Fee</td></tr>
                <tr><td className="border px-3 py-2">Between 61–90 days before event</td><td className="border px-3 py-2">80% of Full Fee</td></tr>
                <tr><td className="border px-3 py-2">60 days or less before event</td><td className="border px-3 py-2">Full Fee</td></tr>
              </tbody>
            </table>
          </div>

          <p><strong>7 | Artist Cancellation</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>The Agent cannot cancel on behalf of the Artist except for Force Majeure.</li>
            <li>If Force Majeure applies and no suitable replacement can be provided, up to 50% of the Deposit may be refunded.</li>
            <li>If a replacement Artist is secured and accepted, the Deposit is transferred to the new booking and is not refunded.</li>
          </ul>

          <p><strong>8 | Complaints</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Complaints must be made in writing within 30 days of the incident.</li>
            <li>Payment obligations remain despite complaints.</li>
            <li>Any unnotified changes agreed directly between Client and Artist are to be resolved between those parties.</li>
          </ul>

          <p><strong>9 | Responsibilities of the Client</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Ensure the venue provides safe, dry and licensed conditions.</li>
            <li>Provide refreshments and hot meals for the Artist if required, plus adequate chairs.</li>
            <li>Provide free parking, or reimburse parking expenses.</li>
            <li>Provide a secure and adequate changing area.</li>
            <li>Provide sufficient electrical sockets as per the Artist’s requirements.</li>
            <li>Protect the Artist’s equipment from spillages and guest interference.</li>
            <li>Ensure a safe environment free from aggression or violence towards the Artist.</li>
          </ul>

          <p><strong>10 | Responsibilities of the Agent</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Provide a service for Clients to find an Artist that is not double‑booked through the company.</li>
            <li>Ensure Artist quality, professionalism, and safety compliance.</li>
            <li>Provide the Event Sheet and reminders so both parties have the information needed for a successful performance.</li>
          </ul>

          <p><strong>11 | Expenses</strong></p>
          <p>Client is only liable for additional expenses if agreed in advance.</p>

          <p><strong>12 | Artist Equipment</strong></p>
          <p>Artist equipment must not be used by guests. Client is liable for any damage caused.</p>

          <p><strong>13 | Changes to Performance Schedule</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Changes can be made on the Event Sheet up to one month before the performance date.</li>
            <li>Overruns by the Client do not extend Artist time unless agreed and paid for additionally.</li>
          </ul>

          <p><strong>14 | Deputies</strong></p>
          <p>The Agent may substitute musicians of similar ability without notice.</p>

          <p><strong>15 | Force Majeure</strong></p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Force Majeure includes natural disasters, illness, war, terrorism, etc.</li>
            <li>Evidence must be provided to justify Force Majeure claims.</li>
          </ul>

          <p><strong>16 | Terms Acceptance</strong></p>
          <p>By signing the contract, you agree to all Terms and Conditions listed above.</p>
        </div>
      </div>

      <NewsletterBox />
    </div>
  );
};

export default Terms;
