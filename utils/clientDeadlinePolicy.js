import {balanceDueISO,isExternallySettledSource} from './balanceDueDate.js';
export const UNIFIED_CLIENT_DEADLINE='unified-client-deadline-v1';
export const hasUnifiedClientDeadline=row=>row?.clientDeadlinePolicy===UNIFIED_CLIENT_DEADLINE;
export function initialClientDeadlineFields(row) {
 if(row.introEmailSentAt || row.importMetadata?.introAlreadySent || row.importMetadata?.paymentTermsCommunicatedAt)return {};
 if(isExternallySettledSource(row.agent||row.source))return {secureClientUploads:true};
 const due=balanceDueISO(row);
 return due?{clientDeadlinePolicy:UNIFIED_CLIENT_DEADLINE,clientDeadlineISO:due,songSuggestionsDueDateISO:due,secureClientUploads:true}:{};
}
