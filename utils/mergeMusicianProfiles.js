const object = value => value && typeof value === 'object' && !Array.isArray(value)
  && !(value instanceof Date) && !value._bsontype && !Buffer.isBuffer(value);
const meaningful = value => {
  if (Array.isArray(value)) return value.some(meaningful);
  if (object(value)) return Object.entries(value).some(([key, child]) => key !== '_id' && meaningful(child));
  return value !== undefined && value !== null && value !== '' && value !== false && value !== 0;
};
const comparable = value => {
  if (Array.isArray(value)) return value.map(comparable);
  if (object(value)) return Object.fromEntries(Object.entries(value).filter(([key]) => key !== '_id').sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, comparable(child)]));
  return value;
};
const itemKey = item => {
  if (object(item) && item.instrument) return `instrument:${String(item.instrument).toLowerCase().replace(/^acoustic drums$/, 'drums')}`;
  if (object(item) && item.url) return `url:${item.url}`;
  return JSON.stringify(comparable(item));
};

// Current account values win conflicts; the complete source is separately
// backed up and retained as an archived record. Lists preserve unique details.
export function mergeProfileValues(primary, source) {
  if (Array.isArray(primary) || Array.isArray(source)) {
    const result = [];
    for (const item of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(source) ? source : [])]) {
      if (!meaningful(item)) continue;
      const index = result.findIndex(existing => itemKey(existing) === itemKey(item));
      if (index < 0) result.push(item);
      else if (object(item)) result[index] = mergeProfileValues(result[index], item);
    }
    return result;
  }
  if (object(primary) || object(source)) {
    const result = { ...(object(primary) ? primary : {}) };
    for (const [key, value] of Object.entries(object(source) ? source : {})) {
      result[key] = mergeProfileValues(result[key], value);
    }
    return result;
  }
  return meaningful(primary) ? primary : (source ?? primary);
}

export function removeRejectedImage(value, publicId) {
  if (typeof value === 'string') return value.includes(publicId) ? null : value;
  if (Array.isArray(value)) return value.map(item => removeRejectedImage(item, publicId)).filter(item => item !== null);
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, removeRejectedImage(child, publicId)]));
  return value;
}

export const ACCOUNT_FIELDS = ['_id', 'musicianId', 'musicianSlug', 'email', 'phone', 'phoneNumber', 'phoneNormalized',
  'password', 'role', 'status', 'profileDeletedAt', 'privateTestProfile', 'dateRegistered', '__v',
  'inviteTokenHash', 'inviteTokenExpires', 'resetTokenHash', 'resetTokenExpires', 'mustChangePassword',
  'hasSetPassword', 'passwordLastChangedAt', 'lastLoginAt', 'onboardingStatus', 'onboardingInvitedAt',
  'onboardingReminderCount', 'onboardingLastRemindedAt', 'stripeConnect', 'socialConnections'];
