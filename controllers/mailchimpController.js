// mailchimpController.js
import mailchimp from '@mailchimp/mailchimp_marketing';

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_DC, // e.g., 'us21'
});

export const subscribeToVoucher = async (req, res) => {
  try {
    const { email, firstName, lastName } = req.body || {};
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });

    const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;

    // Use lowercased email as subscriberHash when needed; here we use add/update
    const response = await mailchimp.lists.addListMember(audienceId, {
      email_address: email,
      status: 'subscribed',       // use 'pending' if you want double opt-in
      merge_fields: {
        FNAME: firstName || '',
        LNAME: lastName || '',
      },
      tags: ['voucher-£50'],
    });

    return res.json({ success: true, id: response.id });
  } catch (err) {
    // If member exists, update & ensure tag is set
    if (err?.response?.body?.title === 'Member Exists') {
      try {
        const crypto = await import('node:crypto');
        const hash = crypto.createHash('md5').update(String(req.body.email).toLowerCase()).digest('hex');
        const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;

        // Add tag via update
        await mailchimp.lists.updateListMemberTags(audienceId, hash, {
          tags: [{ name: 'voucher-£50', status: 'active' }],
        });

        return res.json({ success: true, message: 'Already subscribed; tag added' });
      } catch (e2) {
        return res.status(500).json({ success: false, message: 'Update failed' });
      }
    }

    return res.status(500).json({ success: false, message: 'Subscription failed' });
  }
};