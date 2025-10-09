import React, { useEffect } from 'react';
import Title from '../components/Title';
import { assets } from '../assets/assets';
import NewsletterBox from '../components/NewsletterBox';

const Privacy = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const effectiveDate = '03 October 2025'; // update when you materially change the policy

  return (
    <div>
      <div className="text-2xl text-center pt-8 border-t">
        <Title text1="PRIVACY" text2="POLICY" />
      </div>

      <div className="my-10 flex flex-col md:flex-row gap-16">
        <img
          className="w-full md:w-auto md:max-w-[450px] h-auto object-cover rounded"
          src={assets.hero_no_logo
          }
          alt="Musicians performing"
        />

        <div className="flex flex-col justify-center gap-4 md:w-2/4 text-gray-700 leading-relaxed">
          <p className="text-sm uppercase tracking-wide text-gray-500">Effective date: {effectiveDate}</p>

          <p>
            The Supreme Collective ("we", "us", "our") is committed to protecting your privacy. This Privacy
            Policy explains how we collect, use, share and safeguard your personal information when you use our
            website <span className="whitespace-nowrap">thesupremecollective.co.uk</span> (the "Site"), contact us,
            subscribe to our mailing list, make a booking, or apply to join our roster.
          </p>

          <h2 className="text-xl font-semibold mt-4">1. Information We Collect</h2>
          <p className="mb-1">We may collect the following information you provide to us:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Contact details</span>: name, email address, phone number, postal address.</li>
            <li><span className="font-medium">Event details</span>: date, time, location, type of event, guest count, budget, preferences.</li>
            <li><span className="font-medium">Booking information</span>: act/line‑up preferences, requested services (e.g. DJ, lighting), notes and special requests.</li>
            <li><span className="font-medium">Musician/Act applications</span>: links to promotional material, experience and any other details you submit.</li>
            <li><span className="font-medium">Marketing preferences</span>: your subscription status and communication choices.</li>
          </ul>
          <p className="mt-2">We also collect some information automatically when you visit the Site:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Usage data</span>: IP address, browser, device type, pages viewed, referrer and timestamps.</li>
            <li><span className="font-medium">Cookies & similar tech</span>: used to run the Site, remember preferences and understand performance. You can control cookies via your browser settings.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-4">2. How We Use Your Information</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Provide and manage our services, respond to enquiries and process bookings.</li>
            <li>Coordinate with performers and suppliers to deliver your event.</li>
            <li>Operate, secure and improve our Site and services, including analytics.</li>
            <li>Send updates, offers and newsletters where you have opted in (you can unsubscribe at any time).</li>
            <li>Comply with legal obligations and enforce our terms.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-4">3. Legal Bases (UK GDPR)</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Contract</span>: to perform a contract or take steps at your request (e.g. arranging a booking).</li>
            <li><span className="font-medium">Legitimate interests</span>: to run and improve our business and communicate with you about similar services.</li>
            <li><span className="font-medium">Consent</span>: for marketing emails and where otherwise required. You may withdraw consent at any time.</li>
            <li><span className="font-medium">Legal obligation</span>: for tax, accounting and compliance requirements.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-4">4. Sharing Your Information</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-medium">Performers/Suppliers</span>: we share only what is necessary to deliver your event (e.g. date, venue, schedule, contact details).</li>
            <li><span className="font-medium">Service providers</span>: trusted partners such as payment processors (e.g. Stripe), email and newsletter tools (e.g. Mailchimp), analytics and hosting. They act under contract and only process data on our instructions.</li>
            <li><span className="font-medium">Legal/Protection</span>: where required by law or to protect our rights, users or the public.</li>
          </ul>
          <p className="mt-2">We do not sell your personal information.</p>

          <h2 className="text-xl font-semibold mt-4">5. International Transfers</h2>
          <p>
            Some providers (for example, Mailchimp) may process data outside the UK/EEA. Where this occurs we use appropriate
            safeguards (such as Standard Contractual Clauses) as provided by applicable law.
          </p>

          <h2 className="text-xl font-semibold mt-4">6. Retention</h2>
          <p>
            We keep personal information only as long as needed for the purposes above and to meet legal/accounting requirements.
            Typically this is up to 6 years for booking records. Marketing data is kept until you unsubscribe or we delete inactive
            subscribers.
          </p>

          <h2 className="text-xl font-semibold mt-4">7. Your Rights</h2>
          <p className="mb-1">Under UK GDPR you may have the right to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Access a copy of your data.</li>
            <li>Rectify inaccurate or incomplete data.</li>
            <li>Erase data (where applicable) or restrict processing.</li>
            <li>Object to certain processing, including direct marketing.</li>
            <li>Data portability for information you provided to us.</li>
          </ul>
          <p className="mt-2">
            To exercise these rights, email us at{' '}
            <a href="mailto:hello@thesupremecollective.co.uk" className="text-grey-500 hover:text-[#ff6677]">
              hello@thesupremecollective.co.uk
            </a>.
          </p>

          <h2 className="text-xl font-semibold mt-4">8. Children</h2>
          <p>
            Our services are not intended for children under 18 and we do not knowingly collect information from children. If you
            believe a child has provided us with personal data, please contact us so we can delete it.
          </p>

          <h2 className="text-xl font-semibold mt-4">9. Security</h2>
          <p>
            We use reasonable technical and organisational measures to protect personal data, including access controls and
            encryption in transit where appropriate. No system is 100% secure.
          </p>

          <h2 className="text-xl font-semibold mt-4">10. Changes to this Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. The latest version will always be available on this page and the
            effective date will be updated above.
          </p>
        </div>
      </div>

     

      <NewsletterBox />
    </div>
  );
};

export default Privacy;
