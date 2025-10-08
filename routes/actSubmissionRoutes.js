// components/ActSubmissionForm.jsx
import React, { useState } from 'react';

export default function ActSubmissionForm({ onSuccess, className = '' }) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', promoLinks: '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await fetch('/api/act-submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'act_submission',
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          promoLinks: form.promoLinks,
        }),
      });
      setMsg({ type: 'ok', text: 'Thanks! We got your submission.' });
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
    </form>
  );
}