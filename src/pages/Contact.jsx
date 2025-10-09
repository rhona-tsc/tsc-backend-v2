import React, { useState } from 'react'
import Title from '../components/Title'
import { assets } from '../assets/assets'
import NewsletterBox from '../components/NewsletterBox'
import ActSubmissionForm from '../components/ActSubmissionForm';

const Contact = () => {
  const [showActForm, setShowActForm] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    promoLinks: '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });

  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  const api = (p) => `${backendUrl}${p.startsWith('/') ? p : `/${p}`}`;

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const onSubmitAct = async (e) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);
    if (!form.firstName || !form.lastName || !emailOk) {
      setMsg({ type: 'error', text: 'Please provide first name, last name and a valid email.' });
      return;
    }

    try {
      setBusy(true);
      await fetch(api('api/act-submission'), {
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
      setMsg({ type: 'ok', text: 'Thanks! We got your submission — we’ll be in touch.' });
      setForm({ firstName: '', lastName: '', email: '', phone: '', promoLinks: '' });
      setShowActForm(false);
    } catch (err) {
      setMsg({ type: 'error', text: 'Sorry, something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>

      <div className='text-center text-2xl pt-10 border-t'>
        <Title text1={'CONTACT'} text2={'US'} />
      </div>

<div className="my-10 flex flex-col md:flex-row gap-10 mb-28 items-start">
  <img className="w-full md:w-[480px] h-auto object-cover rounded" src={assets.contact_img} alt="" />
  <div className="flex flex-col justify-start items-start gap-6 w-full md:max-w-[560px]">
          <p className=' font-semibold text-xl text-gray-600'>Registered Address</p>
          <p className=' text-gray-500'>Cramond, Reeves Lane <br /> Roydon, Essex, CM19 5LE</p>
          <p className=' text-gray-500'>WhatsApp:   <a 
    href="https://api.whatsapp.com/send/?phone=447594223200&text&type=phone_number&app_absent=0" 
    target="_blank" 
    rel="noopener noreferrer"
    className="text-gray-500 hover:text-[#ff6677]"
  >
    (+44) 759 422 3200
  </a> 
  <br /> 
  Phone: (+44) 203 576 5322
  <br /> 
  Email: hello@thesupremecollective.co.uk</p>
          <p className=' font-semibold text-xl text-gray-600'>Join The Supreme Collective</p>
          <p className=' text-gray-500'>Think you've got what it takes to join our roster? Submit a pre-screening here and we'll be in touch if you've got the stuff!</p>
          <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSexd29rLAi1tCajAPLwGgyZlBUllDoeRz9Yctcwhu4Becu3IQ/viewform?usp=sf_link"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-black px-8 py-4 text-sm hover:bg-black hover:text-white transition-all duration-500 inline-block"
          >
            Submit Myself as a Musician
          </a>

          <a 
  href="https://docs.google.com/forms/d/e/1FAIpQLScRfAehCuEBRq6OmfXtTCj2EfmpYHQkTDwGf0-clUp3PlsmIQ/viewform?usp=dialog"
  target="_blank"
  rel="noopener noreferrer"
  className="border border-black px-8 py-4 text-sm hover:bg-black hover:text-white transition-all duration-500 inline-block text-center"
>
  Submit My Act
</a>

        {showActForm && (
  <ActSubmissionForm onSuccess={() => setShowActForm(false)} className="mt-4" />
)}

        </div>
      </div>

      <NewsletterBox />

    </div>
  )
}

export default Contact
