// components/ActSubmissionForm.jsx
import React, { useState } from 'react';
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (window?.location?.hostname?.includes('netlify.app') ? '/.netlify/functions' : '/api');

export default function ActSubmissionForm({ onSuccess, className = '' }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', promoLinks: '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [submitted, setSubmitted] = useState(null);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);

    // hold a copy before we clear anything
    const payload = {
      type: 'act_submission',
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      promoLinks: form.promoLinks.trim(),
      sendConfirmation: true, // hint to backend to email a copy
    };

    try {
      const res = await fetch(`${API_BASE}/act-submission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('request_failed');
      let data = null;
      try { data = await res.json(); } catch {}

      setSubmitted(payload); // show what was sent

      const emailEcho = (data && (data.confirmationEmail || data.email || payload.email)) || payload.email;
      setMsg({ type: 'ok', text: `Thanks! We got your submission. A confirmation has been emailed to ${emailEcho}.` });

      setForm({ firstName: '', lastName: '', email: '', phone: '', promoLinks: '' });
      onSuccess?.();
    } catch (err) {
      setMsg({ type: 'error', text: 'Sorry, something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className={`grid grid-cols-1 sm:grid-cols-2 gap-4 border rounded p-4 ${className}`}>
      <input name="firstName" value={form.firstName} onChange={onChange} placeholder="First name" required className="border rounded px-3 py-2" />
      <input name="lastName" value={form.lastName} onChange={onChange} placeholder="Last name" required className="border rounded px-3 py-2" />
      <input type="email" name="email" value={form.email} onChange={onChange} placeholder="Email" required className="border rounded px-3 py-2" />
      <input name="phone" value={form.phone} onChange={onChange} placeholder="Phone" className="border rounded px-3 py-2" />
      <textarea name="promoLinks" value={form.promoLinks} onChange={onChange} rows={3} placeholder="Video links" className="border rounded px-3 py-2 sm:col-span-2" />
      {msg && (
        <div className={`text-sm sm:col-span-2 ${msg.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
          {msg.text}
        </div>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={busy} className="bg-black text-white px-6 py-3 rounded disabled:opacity-60">
          {busy ? 'Submitting…' : 'Send submission'}
        </button>
      </div>
      {submitted && msg?.type === 'ok' && (
        <div className="sm:col-span-2 mt-2 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <p className="font-medium mb-2">Submission summary</p>
          <ul className="space-y-1">
            <li><span className="font-semibold">Name:</span> {submitted.firstName} {submitted.lastName}</li>
            <li><span className="font-semibold">Email:</span> {submitted.email}</li>
            {submitted.phone && (<li><span className="font-semibold">Phone:</span> {submitted.phone}</li>)}
            {submitted.promoLinks && (
              <li>
                <span className="font-semibold">Promo links:</span>
                <div className="whitespace-pre-wrap break-words">{submitted.promoLinks}</div>
              </li>
            )}
          </ul>
        </div>
      )}
    </form>
  );
}