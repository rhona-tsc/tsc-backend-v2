// Public job adverts are intentional. Contact, applicant and payment records are not.
const normalise = value => String(value || '').trim().toLowerCase();
const idOf = value => String(value?._id || value || '');
const pick = (source, fields) => Object.fromEntries(fields.filter(key => source?.[key] !== undefined).map(key => [key, source[key]]));

export function canManageDeputyJob(job, user) {
  if (!user) return false;
  const email = normalise(user.email || user.useremail);
  const id = idOf(user.id || user._id || user.userId);
  return email === 'hello@thesupremecollective.co.uk' ||
    ['admin', 'agent', 'superadmin', 'tsc_admin'].includes(normalise(user.role || user.userrole)) ||
    Boolean(id && id === idOf(job.createdBy)) ||
    Boolean(email && [job.createdByEmail, job.managerEmail].map(normalise).includes(email));
}

const publicFields = [
  '_id', 'title', 'instrument', 'requiredInstruments', 'roleRequirements', 'isVocalSlot',
  'date', 'eventDate', 'eventEndDate', 'endDate', 'callTime', 'startTime', 'finishTime', 'endTime',
  'venue', 'locationName', 'location', 'county', 'postcode', 'genres', 'tags',
  'essentialRoles', 'requiredSkills', 'desiredRoles', 'secondaryInstruments', 'setLengths',
  'whatsIncluded', 'whatsIncludedOther', 'claimableExpenses', 'claimableExpensesOther',
  'fee', 'feeBasis', 'currency', 'deputyNetAmount', 'status', 'workflowStage', 'jobType',
  'isEnquiryOnly', 'previewMode', 'applicationCount', 'createdAt', 'updatedAt',
];

export function visibleDeputyJob(job, user) {
  const source = typeof job.toObject === 'function' ? job.toObject() : job;
  if (canManageDeputyJob(source, user)) return source;
  const safe = pick(source, publicFields);
  const userId = idOf(user?.id || user?._id || user?.userId);
  safe.postedByLabel = normalise(source.createdByEmail) === 'hello@thesupremecollective.co.uk'
    ? 'The Supreme Collective' : 'A Supreme Collective Member';
  // Preserve the existing advert eligibility rule without publishing Stripe identifiers.
  safe.isReadyForApplications = normalise(source.jobType) === 'enquiry' ||
    normalise(source.paymentStatus) === 'not_required' || safe.postedByLabel === 'The Supreme Collective' ||
    Boolean(source.defaultPaymentMethodId) ||
    ['ready_to_charge', 'charge_pending', 'paid'].includes(normalise(source.paymentStatus));
  safe.roleRequirements = (source.roleRequirements || []).map(role => pick(role, ['role', 'quantity']));
  safe.roleAllocations = (source.roleAllocations || []).map(role => ({
    ...pick(role, ['role', 'slotNumber', 'status']),
    ...(userId && idOf(role.musicianId) === userId ? { musicianId: userId } : {}),
  }));
  const ownApplication = userId && source.myApplication && idOf(source.myApplication.musicianId) === userId
    ? source.myApplication : null;
  safe.myApplication = ownApplication ? pick(ownApplication, [
    'musicianId', 'appliedAt', 'appliedRoles', 'presentedRoles', 'allocatedRoles', 'status',
  ]) : null;
  return safe;
}
