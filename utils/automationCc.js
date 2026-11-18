export const automationCc = (row = {}, recipient = row.clientEmail) => [...new Set(
  (Array.isArray(row.automationCcEmails) ? row.automationCcEmails : [])
    .map(value => String(value || '').trim().toLowerCase())
    .filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value !== String(recipient || '').trim().toLowerCase()),
)];
