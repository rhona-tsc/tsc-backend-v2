// PDF text is evidence only. This parser does not follow links, execute document
// instructions, contact anyone, assign musicians or purchase quoted extras.
const tidy = value => String(value || '').replace(/\r/g, '').trim();
const line = value => tidy(value).replace(/\s+/g, ' ');
const unique = values => [...new Set(values.filter(Boolean))];
const money = (text, label) => {
  const found = text.match(new RegExp(`${label}\\s*:?\\s*-?\\s*£\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'));
  return found ? Number(found[1].replace(/,/g, '')) : null;
};

export function encoreConversation(text) {
  // Browser prints include a left sidebar containing OTHER clients and dates.
  // Only retain the selected thread; never use sidebar content as booking data.
  const selected = tidy(text).split(/Hide event details\s*/i)[1];
  if (!selected) return '';
  return tidy(selected.split(/\n\d+\s*(?:piece|[-–]piece)\b[\s\S]{0,180}?needed for/i)[0]
    .split(/\nQuoted as\s*:/i)[0]);
}

const documentDetails = document => {
  const text = tidy(document.text);
  const inbox = /Hide event details/i.test(text);
  const booking = /Job reference\s*:/i.test(text);
  const accepted = /Booking accepted\s*:|Thank you for accepting your booking|Encore bookings\s*</i.test(text);
  const detail = inbox ? text.split(/Quoted as\s*:/i)[1] || '' : text;
  const contact = booking ? text.split(/Contact details\s*:/i)[1]?.split(/Line-up\s*:/i)[0] || '' : '';
  // Repair words wrapped inside an email address without swallowing the next field.
  const contactEmail = contact.match(/\n([^\n]*@[^\n]+(?:\n[a-z.]+(?=\n|$))?)/i)?.[1];
  const email = inbox ? detail.match(/\nEmail\s*\n([^\n]+(?:\n[a-z.]+(?=\n|$))?)/i)?.[1] : contactEmail;
  const reference = text.match(/Job reference\s*:\s*([a-z0-9-]+?)(?=What's|\s|$)/i)?.[1]
    || (accepted ? text.match(/Booking accepted[^\n]*\[([a-z0-9-]+)\]/i)?.[1] : '');
  const act = booking ? text.match(/Booked as\s*:\s*\n?([^\n]+)/i)?.[1]
    : inbox ? detail.split('\n').find(value => value.trim())
      : text.match(/Hi\s+([^,\n]+),/i)?.[1];
  const eventDate = booking ? text.match(/\nDate\s*:\s*\n([^\n]+)/i)?.[1]
    : (inbox ? text.slice(text.lastIndexOf('View full details') - 250, text.lastIndexOf('View full details')) : text.split(/Booking details/i)[1] || '').match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i)?.[1];
  return {
    ...document, text, inbox, booking, accepted, detail, contact,
    reference: line(reference),
    act: line(act).replace(/Cancel booking.*$/i, '').trim(),
    email: tidy(email).replace(/\s+/g, ''),
    eventDate: line(eventDate),
    conversation: inbox ? encoreConversation(text) : '',
  };
};

export function parseEncoreBookingDocuments(documents, { parseDate, parseTime, splitName }) {
  const docs = documents.map(documentDetails);
  if (!docs.length || docs.length > 8) throw new Error('Choose between one and eight Encore PDFs for one booking.');
  if (docs.some(doc => !doc.booking && !doc.accepted && !doc.inbox)) {
    throw new Error('One of these PDFs is not a recognised Encore booking, acceptance email or conversation. Remove it and try again.');
  }
  const bookings = docs.filter(doc => doc.booking);
  const accepted = docs.filter(doc => doc.accepted);
  const inboxes = docs.filter(doc => doc.inbox);
  const ordered = [...bookings, ...accepted, ...inboxes];
  const refs = unique(docs.map(doc => doc.reference.toLowerCase()));
  const dates = unique(docs.map(doc => parseDate(doc.eventDate)));
  const acts = unique(docs.map(doc => doc.act.toLowerCase()));
  if (refs.length > 1 || dates.length > 1 || acts.length > 1) {
    throw new Error('These PDFs appear to belong to different Encore bookings. Upload documents for one booking at a time.');
  }
  const reference = ordered.find(doc => doc.reference)?.reference || '';
  const actName = ordered.find(doc => doc.act)?.act || '';
  const primary = bookings[0]?.text || '';
  const acceptance = accepted.map(doc => doc.text).join('\n');
  const detail = inboxes[0]?.detail || '';
  const combined = ordered.map(doc => doc.text).join('\n');
  const clientName = line(bookings[0]?.contact.split('\n').find(value => value.trim()));
  const clientEmail = ordered.find(doc => doc.email)?.email || '';
  const phone = line(bookings[0]?.contact.match(/\b(0\d(?:[\s-]?\d){9,10})\b/)?.[1]
    || detail.match(/Phone number\s*\n([^\n]+)/i)?.[1]).replace(/[\s-]/g, '');
  // Only compare the selected-thread contact block, not email sender/header data.
  if (unique(docs.map(doc => doc.email.toLowerCase())).length > 1) {
    throw new Error('The client email addresses in these Encore PDFs do not match. Check that they belong to the same booking.');
  }
  const bookingDate = acceptance.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+at\s+\d{1,2}:\d{2}/i)?.[1]
    || primary.match(/(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})\s*You accepted this booking/i)?.[1];
  const enquiryDate = primary.match(/(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})\s*[^\n]{1,80}?requested a quote/i)?.[1];
  // The booking print can contain a map/help block before its real address.
  const addressBlocks = [...primary.matchAll(/Location\s*:\s*\n([\s\S]*?)\nDate\s*:/gi)];
  const bookingAddress = addressBlocks.at(-1)?.[1]?.split(/\nLocation\s*:\s*\n/i).at(-1);
  const acceptedAddress = acceptance.split(/Booking details/i)[1]?.match(/needed\s+for[^\n]*\n(?:for[^\n]*\n)?([\s\S]*?)\n(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i)?.[1];
  const inboxAddress = detail.match(/\nLocation\s*\n([\s\S]*?)\nEmergency contact/i)?.[1];
  const venueNote = line(primary.match(/Client note\s*:\s*["“]([\s\S]*?)["”]/i)?.[1]
    || inboxAddress?.match(/["“]([\s\S]*?)["”]/)?.[1]);
  let address = line(bookingAddress || acceptedAddress || inboxAddress?.replace(/["“][\s\S]*?["”]/, '') || '');
  // Repair postcodes broken by narrow print columns, e.g. "CM14\n4TS".
  address = address.replace(/\s*,\s*/g, ', ');
  const lineup = line(primary.match(/Line-up\s*:\s*\n([^\n]+)/i)?.[1]);
  const bandSize = Number(lineup.match(/(\d+)\s*musicians?/i)?.[1]
    || inboxes.map(doc => doc.text.match(/\b(?:a\s+)?(\d+)[- ]piece band\b/i)?.[1]).find(Boolean) || 0);
  const performanceFee = money(acceptance, 'Performance fee') ?? money(primary || detail, 'You quoted') ?? 0;
  const earnings = money(acceptance || primary, 'Your earnings') ?? money(primary, 'Your earnings');
  const explicitServiceFee = money(acceptance, 'Service fee');
  const serviceFee = explicitServiceFee ?? (earnings !== null && performanceFee ? Math.round((performanceFee - earnings) * 100) / 100 : 0);
  for (const [label, values] of [
    ['performance fee', docs.filter(doc => doc.booking || doc.accepted).map(doc => money(doc.text, 'Performance fee') ?? money(doc.text, 'You quoted'))],
    ['artist earnings', docs.filter(doc => doc.booking || doc.accepted).map(doc => money(doc.text, 'Your earnings'))],
    ['service fee', accepted.map(doc => money(doc.text, 'Service fee'))],
  ]) {
    if (new Set(values.filter(value => value !== null)).size > 1) throw new Error(`The Encore ${label} differs between PDFs. Check which document is current before importing.`);
  }
  const warnings = [];
  if (!performanceFee) warnings.push('The booking fee was not found. Check the price before saving.');
  if (earnings === null && explicitServiceFee === null) warnings.push('The artist earnings and service fee were not found. Verify the fee breakdown before saving.');
  if (serviceFee < 0 || (earnings !== null && earnings > performanceFee)) throw new Error('Encore earnings exceed the booking fee. Check the fee breakdown before importing.');
  if (earnings !== null && explicitServiceFee !== null && Math.abs(performanceFee - serviceFee - earnings) > 0.02) {
    throw new Error('Encore performance fee, service fee and earnings do not reconcile. Check the PDFs before importing.');
  }
  const originalFee = earnings ?? (explicitServiceFee !== null ? Math.round((performanceFee - serviceFee) * 100) / 100 : 0);
  const arrivalTime = parseTime(primary.match(/\nArrive\s*\n([^\n]+)/i)?.[1]);
  const slot = (acceptance || detail).match(/(\d{1,2}[:.]\d{2}\s*(?:am|pm))\s+for\s+(\d+(?:\.\d+)?)\s+hours?/i);
  const startTime = parseTime(slot?.[1]);
  const performance = combined.match(/\b(\d+)\s*x\s*(\d+)\s*min(?:utes?)?\s*(?:sets)?/i)
    || primary.match(/\b(\d+)\s*sets\s*of\s*(\d+)\s*mins?/i);
  const performancePlan = performance ? `${performance[1]} x ${performance[2]} minute sets` : '';
  const conversationDocs = inboxes.filter((doc, index, all) => doc.conversation && all.findIndex(other => other.conversation === doc.conversation) === index);
  const conversations = conversationDocs.map(doc => `[${doc.filename || 'Encore conversation'}]\n${doc.conversation}`).join('\n\n');
  if (/30\s*min(?:ute)?s?\s+after\s+midnight/i.test(conversations)) warnings.push('Messages discuss staying until 00:30 on the following day. Confirm the finish time; the booking summary lists a different duration.');
  if (/photograph|\bbrass\b|\bsax\b/i.test(conversations)) warnings.push('Photography/brass are discussed in the messages. Confirm which extras were accepted; no extra charges have been added.');
  if (/vocalist|front the band|first choice/i.test(conversations)) warnings.push('Review the vocalist preference and availability in the conversation. No musician has been assigned.');
  if (arrivalTime && arrivalTime === startTime) warnings.push('Encore lists the same time for arrival and the event slot. Confirm setup, arrival and first-set timings.');
  const clientDepositPaidToEncore = /Deposit paid\s*-\s*Encore Pay/i.test(primary);
  if (clientDepositPaidToEncore) warnings.push('Payment arranged through Encore. The client deposit and Encore service fee are excluded from your receivable; only your earnings form the original booking fee.');
  if (!bookings.length) warnings.push('Add the Encore booking overview to capture the booking reference, full client name, lineup and booking history.');
  if (!accepted.length) warnings.push('Add the booking acceptance email to verify the fee breakdown and acceptance date.');
  if (venueNote) warnings.push(`Venue note: ${venueNote}. Check the full street address before saving.`);
  const notes = [
    venueNote && `Venue/access note: ${venueNote}`,
    warnings.length && `Encore import - review\n${warnings.map(value => `- ${value}`).join('\n')}`,
    conversations && `Encore conversation evidence (requests and quotes require review)\n${conversations}`,
  ].filter(Boolean).join('\n\n');
  const incompleteFields = [!originalFee && 'grossValue', earnings === null && explicitServiceFee === null && 'feeBreakdown', !bandSize && 'bandSize', !clientName && 'clientName', !clientEmail && 'clientEmail', !phone && 'clientPhone', !address && 'venueAddress', !arrivalTime && 'arrivalTime', !startTime && 'startTime', 'finishTime', 'clientAddress'].filter(Boolean);
  return {
    bookerName: clientName, clientFirstNames: splitName(clientName).firstName,
    clientLastName: splitName(clientName).lastName, clientEmail, clientPhone: phone, clientAddress: '',
    bookingRef: reference, eventDateISO: dates[0] || '', enquiryDateISO: parseDate(enquiryDate), bookingDateISO: parseDate(bookingDate),
    eventType: /birthday party/i.test(primary || detail || acceptance) ? 'Birthday Party' : /wedding/i.test(primary || detail || acceptance) ? 'Wedding' : '',
    agent: 'Encore', actName, actTscName: actName, address,
    grossValue: originalFee, originalBookingTotal: originalFee, commissionGross: 0, passThroughGross: originalFee,
    vatRate: 0, invoiceCompany: 'TSC', currency: 'GBP',
    lineupSelected: lineup || (bandSize ? `${bandSize} musicians` : ''), lineupComposition: [], bandSize,
    arrivalTime, startTime, finishTime: '', performancePlan, notes,
    accounting: { invoiceCompany: 'TSC', paymentStage: '', vatRate: 0, commissionGross: 0, commissionVat: 0, commissionNet: 0, passThroughGross: originalFee, currency: 'GBP' },
    // A client deposit paid to Encore is not evidence of an artist payment received.
    payments: { depositAmount: 0, depositChargedAmount: 0, balancePaymentReceived: false, bandPaymentsSent: false },
    importMetadata: {
      source: 'encore_pdf', contractFilename: bookings[0]?.filename || '', invoiceFilename: accepted[0]?.filename || '',
      documents: docs.map(doc => ({ filename: doc.filename || '', kind: doc.booking ? 'booking' : doc.accepted ? 'acceptance' : 'conversation' })),
      importedAt: new Date().toISOString(), incompleteFields, warnings,
      encore: { earnings: originalFee, performanceFee, serviceFee, clientDepositPaidToEncore, venueNote, eventSlotHours: slot ? Number(slot[2]) : null, serviceFeeInferred: explicitServiceFee === null && earnings !== null },
    },
  };
}
