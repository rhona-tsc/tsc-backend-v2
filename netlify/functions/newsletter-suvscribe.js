// netlify/functions/newsletter-subscribe.js
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, message: 'Invalid email' }) };
    }

    // --- Mailchimp optional (set env vars in Netlify UI) ---
    const { MAILCHIMP_API_KEY, MAILCHIMP_DC, MAILCHIMP_LIST_ID } = process.env;

    if (MAILCHIMP_API_KEY && MAILCHIMP_DC && MAILCHIMP_LIST_ID) {
      const url = `https://${MAILCHIMP_DC}.api.mailchimp.com/3.0/lists/${MAILCHIMP_LIST_ID}/members`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `apikey ${MAILCHIMP_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email_address: email, status: 'subscribed' })
      });

      // Mailchimp returns 400 if already subscribed; treat that as success for UX
      if (!res.ok && res.status !== 400) {
        const txt = await res.text().catch(() => '');
        return { statusCode: 502, body: JSON.stringify({ success: false, message: 'Mailchimp error', detail: txt }) };
      }
    }
    // -------------------------------------------------------

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: 'Server error' }) };
  }
};