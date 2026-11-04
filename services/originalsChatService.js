export const CHAT_FILE_LIMIT = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_LIMIT = 5;
export const chatAttachmentMimes = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/aiff', 'audio/x-aiff',
  'audio/flac', 'audio/x-flac', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/opus',
  'video/mp4', 'video/quicktime',
]);
export const chatUploadError = (kind, file) => {
  if (!['chat_attachment', 'voice_note'].includes(kind)) return '';
  if (file.size > CHAT_FILE_LIMIT) return 'Chat files must be 10 MB or smaller';
  const mime = String(file.mimetype || '').split(';')[0].toLowerCase();
  if (kind === 'voice_note' ? !mime.startsWith('audio/') || !chatAttachmentMimes.has(mime) : !chatAttachmentMimes.has(mime)) return 'Choose an image, PDF, Word document, text file, audio or MP4/MOV video';
  return '';
};
export const chatDisplayName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${Array.from(parts.at(-1))[0]}.` : parts[0] || 'Project participant';
};
export const sharedChatAssetIds = (messages = []) => new Set(messages.flatMap(message => [String(message.voiceAssetId || ''), ...(message.attachmentIds || []).map(asset => String(asset?._id || asset))]).filter(Boolean));
