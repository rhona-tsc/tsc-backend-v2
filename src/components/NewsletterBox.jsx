import React from 'react';

const NewsletterBox = () => {
  return (
    <div className="text-center">
      <p className="text-2xl font-medium text-gray-800">
        Subscribe now & get a £50 discount
      </p>
      <p className="text-gray-400 mt-3">
        Join our mailing list and we&apos;ll send expert planning tips—plus your £50 voucher.
      </p>

      {/* Direct Mailchimp form */}
      <form
        action="https://thesupremecollective.us9.list-manage.com/subscribe/post?u=ac54b4ff139ba0b31e835d996&amp;id=9037c964e7&amp;f_id=0024d5e3f0"
        method="POST"
        target="_blank"
        noValidate
        className="w-full sm:w-1/2 flex items-center gap-3 mx-auto my-6 border pl-3 rounded"
      >
        <input
          type="email"
          name="EMAIL"
          placeholder="Enter your email address"
          required
          className="w-full sm:flex-1 outline-none py-3"
        />
        <button
          type="submit"
          className="bg-black text-white text-xs px-10 py-4"
        >
          SUBSCRIBE
        </button>
      </form>

      <p className="text-gray-500">
        Your £50 voucher will be valid for 7 days from today. One per customer, new subscribers only.
      </p>
    </div>
  );
};

export default NewsletterBox;