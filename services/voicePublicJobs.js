// Read the same unauthenticated advert feed as the public portal. Never send auth headers.
const clean = (value, max = 160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const list = value => Array.isArray(value) ? value.map(item => clean(item)).filter(Boolean).slice(0, 12) : [];
export function matchVoicePublicJobs(jobs, input = {}, now = new Date()) {
  const query = clean(input.query).toLowerCase();
  const jobId = clean(input.jobId, 24);
  const date = clean(input.eventDateISO, 10);
  if (jobId && !/^[a-f\d]{24}$/i.test(jobId)) throw new Error('Use the exact job reference returned by the public job board.');
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(date).getTime()) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('Confirm the job date including the year.');
  const safe = [];
  for (const job of jobs || []) {
    const id = String(job._id || '');
    const dateISO = clean(job.eventDate || job.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !/^[a-f\d]{24}$/i.test(id) || job.status !== 'open' || job.isReadyForApplications !== true || job.isTest === true || job.previewMode === true || dateISO < now.toISOString().slice(0, 10)) continue;
    if (jobId && jobId !== id) continue;
    if (date && dateISO !== date) continue;
    const roles = [...new Set([...list(job.requiredInstruments), ...list(job.essentialRoles), ...(job.roleRequirements || []).map(item => clean(item.role)).filter(Boolean), clean(job.instrument)].filter(Boolean))].slice(0, 12);
    if (query && ![job.title, ...roles, job.county].map(value => clean(value)).join(' ').toLowerCase().includes(query)) continue;
    const fee = Number(job.fee);
    safe.push({ jobId: id, title: clean(job.title), dateISO, endDateISO: clean(job.eventEndDate || job.endDate, 10),
      roles, county: clean(job.county), callTime: clean(job.callTime || job.startTime, 40), finishTime: clean(job.finishTime || job.endTime, 40),
      advertisedFee: Number.isFinite(fee) && fee > 0 ? fee : null, currency: clean(job.currency, 3) || 'GBP', feeBasis: job.feeBasis === 'per_day' ? 'per_day' : 'full_engagement',
      jobType: job.jobType === 'enquiry' ? 'enquiry_only' : 'confirmed_job_advert', profile: `https://admin.thesupremecollective.co.uk/deputy-jobs/${id}` });
  }
  return { jobs: safe.slice(0, 3), totalMatches: safe.length, publicAdvertsOnly: true, applicationMade: false, identityVerified: false,
    note: 'These are public adverts, not a job offer or a guarantee a role is still unfilled. Apply through the portal; personal application status and private job queries need management.' };
}

export async function lookupVoicePublicJobs(input) {
  // Fixed own-service URL: callers cannot choose a host or URL, request private views or add credentials.
  const response = await fetch('https://tsc-backend-v2.onrender.com/api/deputy-jobs', { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('The public job board is unavailable.');
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error('The public job board needs staff review.');
  const data = JSON.parse(raw);
  if (data.success !== true || !Array.isArray(data.jobs)) throw new Error('The public job board is unavailable.');
  return matchVoicePublicJobs(data.jobs, input);
}
