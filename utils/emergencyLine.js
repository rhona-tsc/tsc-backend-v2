// Current Twilio-owned line already configured with the event-code forwarding webhook.
export const EMERGENCY_LINE = '+447882963384';
export const RETIRED_EMERGENCY_LINE = '+447426726648';
export function sharedEmergencyNumber(env = process.env) {
  const configured = String(env.TWILIO_SHARED_IVR_NUMBER || '').trim();
  return !configured || configured === RETIRED_EMERGENCY_LINE ? EMERGENCY_LINE : configured;
}
