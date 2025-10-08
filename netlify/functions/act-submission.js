// CommonJS Netlify function
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body || '{}');
    // basic shape check
    if (data.type !== 'act_submission' || !data.firstName || !data.lastName || !data.email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, message: 'Missing required fields' })
      };
    }

    // TODO: save to DB / Google Sheet / email, etc.
    // For now, echo back.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, received: data })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: 'Server error' })
    };
  }
};