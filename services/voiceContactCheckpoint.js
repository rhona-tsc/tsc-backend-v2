import { normalizeCallbackPhone, VoiceEnquiryValidationError } from './incomingEnquiryAssistant.js';

const fields = ['clientEmail', 'clientPhone'];
const negative = text => /\b(no|nope|wrong|incorrect|isn['’]?t|not correct|not right|not quite|neither|both.*wrong)\b/i.test(text);
const affirmative = text => !negative(text) && /^(?:(?:yes|yeah|yep|yup|correct|right|that['’]?s right|that['’]?s correct|it is|exactly|absolutely|spot on|okay|ok)[\s,.!]*)+$/i.test(text.trim().replace(/[,\s]*(?:thank you|thanks|please)[.!]?$/i,''));
const refused = text => /\b(?:don['’]?t|do not|rather not|prefer not to|won['’]?t)\b.*\b(?:give|share|provide|leave)\b.*\b(?:contact|email|number|details)\b/i.test(text);

// Parse only explicit contact text from this caller's transcript, never caller ID,
// prior customers or a model's inferred spelling. Unclear speech stays unconfirmed.
export function extractVoiceContacts(text = '') {
  let spoken = String(text).toLowerCase();
  // Transcribers commonly write a spelled-out word as R-H-O-N-A. In an
  // explicit spelling passage those marks separate letters; a spoken "hyphen"
  // remains a real character. Do not remove literal hyphens from other emails.
  if (/\b(?:spell(?:ed|ing)?|letter by letter)\b/i.test(text)) {
    spoken = spoken.replace(/\b(?:[a-z0-9][\s,]*[-–—][\s,]*){2,}[a-z0-9]\b/g,
      value => value.replace(/[\s,–—-]/g, ''));
  }
  spoken = spoken.replace(/\bat\b/g, '@').replace(/\bdot\b/g, '~DOT~')
    .replace(/\bunderscore\b/g, '~UNDER~').replace(/\b(?:hyphen|dash)\b/g, '~DASH~');
  spoken = spoken.replace(/\b(?:[a-z][\s,]+){2,}[a-z]\b/g, value => value.replace(/[\s,]+/g, ''));
  spoken = spoken.replace(/\s*@\s*/g, '@').replace(/\s*~DOT~\s*/g, '.')
    .replace(/\s*~UNDER~\s*/g, '_').replace(/\s*~DASH~\s*/g, '-');
  const emails = [...spoken.matchAll(/[a-z0-9_%+-]+(?:\.[a-z0-9_%+-]+)*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g)];
  let email = emails.at(-1)?.[0] || '';
  if (email && /\b(?:no|without|not a|there(?:['’]s| is) no)\s+(?:a\s+)?dot\b/i.test(text)) {
    const [local, domain] = email.split('@'); email = `${local.replaceAll('.', '')}@${domain}`;
  }
  const digits = String(text).replace(/\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/gi,
    word => ({zero:'0',oh:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9'})[word.toLowerCase()]);
  const phones = [...digits.matchAll(/(?:\+44|0044|0)(?:[\s(),.-]*\d){9,10}\b/g)]
    .map(match => normalizeCallbackPhone(match[0].replaceAll(',', ''))).filter(Boolean);
  return { ...(email ? {clientEmail:email} : {}), ...(phones.length ? {clientPhone:phones.at(-1)} : {}) };
}

export function contactReadback(field, value) {
  if (field === 'clientPhone') {
    const local = value.startsWith('+44') ? `0${value.slice(3)}` : value;
    return `Your callback number is ${[...local].join(', ')}. Is that correct?`;
  }
  const [local, domain] = value.split('@');
  const spell = part => [...part].map(char => ({'.':'dot','_':'underscore','-':'hyphen','+':'plus'})[char] || char).join(', ');
  return `Your email is ${spell(local)}, at ${domain.replaceAll('.', ' dot ')}. Is that correct?`;
}

export function createVoiceContactCheckpoint() {
  const contacts = new Map(), abandoned = new Set(); let turn = 0, pending = '', lastText = '', nameRequested = false;
  const next = () => fields.find(field => contacts.has(field) && !contacts.get(field).confirmed) || '';
  return {
    observeAssistant(text) {
      if (/\b(?:what(?:['’]s| is) your name|(?:may|can|could)\b[^?]{0,25}\byour name|your name[^?]{0,10}\bplease|who am i speaking to)\b/i.test(text || '')) nameRequested = true;
    },
    acceptUser(text) {
      turn++; lastText = String(text || '').slice(0, 12000);
      const supplied = extractVoiceContacts(lastText), captured = {};
      if (nameRequested) {
        nameRequested = false;
        const name = lastText.trim().replace(/^(?:my name is|it['’]s|i am|i['’]m)\s+/i,'').replace(/[?.!]+$/,'').trim();
        if (/^[\p{L}][\p{L}'’ .-]{0,119}$/u.test(name) && name.split(/\s+/).length <= 6 &&
          !/^(?:no|yes|can|could|would|please|i|skip|rather|don['’]?t)\b/i.test(name)) captured.clientName = name;
      }
      let previous = contacts.get(pending);
      if (previous?.switchOfferedTurn != null && turn > previous.switchOfferedTurn) {
        const alternate = pending === 'clientEmail' ? 'clientPhone' : 'clientEmail';
        const agreesToSwitch = affirmative(lastText) || (!negative(lastText) &&
          /\b(?:yes|yeah|yep|let['’]?s|i['’]?ll|give you|use|prefer)\b/i.test(lastText) &&
          (alternate === 'clientPhone' ? /\b(?:phone|callback|mobile|number)\b/i : /\bemail\b/i).test(lastText));
        if (agreesToSwitch || supplied[alternate]) {
          captured[pending] = ''; // Remove the rejected value from the draft too.
          abandoned.add(pending);
          contacts.delete(pending);
          if (!contacts.has(alternate)) contacts.set(alternate, {value:'',confirmed:false,readbackTurn:null,needsRepeat:true,awaitingValue:true,failures:0});
          pending = alternate; previous = contacts.get(pending);
        } else if (negative(lastText)) {
          // The rejection below records this as the first fresh correction.
          previous.switchOfferedTurn = null; previous.failures = 0;
        }
      }
      if (previous?.needsRepeat && Object.keys(supplied).some(field => field !== pending) && !supplied[pending]) {
        contacts.delete(pending); pending = '';
      }
      if (pending && refused(lastText)) {
        for (const [field, contact] of contacts) if (!contact.confirmed) contacts.delete(field);
        pending = ''; return {...captured,contactDeclined:true};
      }
      if (previous && negative(lastText)) {
        const rejected = /\bboth\b|\bneither\b/i.test(lastText) ? fields : [pending];
        for (const field of rejected) if (contacts.has(field)) {
          const contact = contacts.get(field);
          contact.confirmed = false; contact.readbackTurn = null; contact.needsRepeat = true; contact.failures++;
        }
      } else if (previous && previous.readbackTurn !== null && turn > previous.readbackTurn &&
        !Object.keys(supplied).length && affirmative(lastText)) {
        previous.confirmed = true; previous.needsRepeat = false; pending = '';
      }
      for (const [field, value] of Object.entries(supplied)) {
        abandoned.delete(field);
        const old = contacts.get(field);
        if (!old || old.value !== value || old.needsRepeat) contacts.set(field, {
          value, confirmed:false, readbackTurn:null, needsRepeat:false, awaitingValue:false, failures:old?.failures || 0,
        });
      }
      pending = next();
      return {...captured,...supplied};
    },
    response() {
      const contact = contacts.get(pending);
      if (!contact) return null;
      const label = pending === 'clientEmail' ? 'email address' : 'callback number';
      const offeringAlternative = contact.needsRepeat && !contact.awaitingValue && contact.failures >= 2;
      const wording = contact.awaitingValue ? `What's your ${label}?` : contact.needsRepeat
        ? (contact.failures >= 2
          ? `I'm having trouble confirming your ${label}. Would you prefer to use ${pending === 'clientEmail' ? 'a callback number' : 'an email address'} instead?`
          : `Sorry, let's correct just your ${label}. Could you ${pending === 'clientEmail' ? 'spell it, including any dots' : 'repeat the digits slowly'}?`)
        : contactReadback(pending, contact.value);
      return {field:pending, value:contact.value, readback:!contact.needsRepeat, offeringAlternative, wording,
        event:{type:'response.create',response:{tool_choice:'none',instructions:
          `Contact confirmation checkpoint. Say ONLY the following, in a natural British accent, then STOP and WAIT for the caller's next answer. Do not add a preamble, 'please hold', 'one moment', or filler. Do not introduce yourself, acknowledge a save, ask another question, mention another contact detail, or continue to event questions. ${wording}`}}};
    },
    delivered(plan) {
      const contact = contacts.get(plan?.field);
      if (plan?.readback && contact && contact.value === plan.value) contact.readbackTurn = turn;
      if (plan?.offeringAlternative && contact && contact.value === plan.value) contact.switchOfferedTurn = turn;
    },
    interrupted() { const contact = contacts.get(pending); if (contact) contact.readbackTurn = null; },
    draftInput(input = {}) {
      const draft = {...input};
      for (const field of fields) if (Object.hasOwn(draft, field) && draft[field]) {
        if (abandoned.has(field)) throw new VoiceEnquiryValidationError(`The caller switched away from ${field}. Leave it empty and use their separately confirmed alternative contact.`);
        const value = field === 'clientPhone' ? normalizeCallbackPhone(draft[field]) : String(draft[field]).trim().toLowerCase();
        if (contacts.get(field)?.value !== value) throw new VoiceEnquiryValidationError(
          `Do not infer or change the caller's ${field === 'clientEmail' ? 'email spelling or punctuation' : 'phone digits'}. Ask them to repeat or spell that detail by itself.`);
      }
      return draft;
    },
    assertConfirmed(input = {}) {
      for (const field of fields) if (input[field]) {
        const value = field === 'clientPhone' ? normalizeCallbackPhone(input[field]) : String(input[field]).trim().toLowerCase();
        const contact = contacts.get(field);
        if (!contact?.confirmed || contact.value !== value) throw new VoiceEnquiryValidationError(
          `Read back and separately confirm the ${field === 'clientEmail' ? 'email' : 'callback number'}, then wait for a new caller answer before saving a confirmed enquiry.`);
      }
    },
    context() {
      const confirmed = Object.fromEntries([...contacts].filter(([,contact]) => contact.confirmed).map(([field,contact]) => [field,contact.value]));
      return `The greeting has already been delivered. Never greet or introduce yourself again. Ask one brief question, then stop and wait. Contact details separately confirmed in this call: ${JSON.stringify(confirmed)}. Preserve their exact spelling and digits; do not re-confirm these unless the caller changes them. Contact fields the caller switched away from: ${JSON.stringify([...abandoned])}; omit these or leave them empty when saving, and do not ask for them again unless the caller volunteers them. A 'no' or correction refers to your last question; do not assume it means an undecided venue. Most recent caller transcript (may contain recognition errors): ${JSON.stringify(lastText)}.`;
    },
    get pending() { return pending; },
  };
}
