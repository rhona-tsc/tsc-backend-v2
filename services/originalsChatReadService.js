import Read from '../models/originalChatReadModel.js';
import Message from '../models/originalMessageModel.js';

const cursorPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([a-f\d]{24})$/;
export function originalChatUnreadQuery({ projectId, musicianId, readThroughKey }) {
  const query = { projectId, authorId: { $ne: musicianId } };
  const cursor = cursorPattern.exec(String(readThroughKey || ''));
  if (cursor && Number.isFinite(new Date(cursor[1]).getTime()) && new Date(cursor[1]).toISOString() === cursor[1]) query.$or = [
    { createdAt: { $gt: new Date(cursor[1]) } },
    { createdAt: new Date(cursor[1]), _id: { $gt: cursor[2] } },
  ];
  return query;
}
export async function originalChatUnreadCount({ projectId, musicianId }) {
  const read = await Read.findOne({ projectId, musicianId }).select('readThroughKey').lean();
  return Message.countDocuments(originalChatUnreadQuery({ projectId, musicianId, readThroughKey: read?.readThroughKey }));
}
export async function markOriginalChatRead({ projectId, musicianId, messageId }) {
  if (typeof messageId !== 'string' || !/^[a-f\d]{24}$/i.test(messageId)) throw Object.assign(new Error('Choose a valid last-viewed message'), { status: 400 });
  // Never trust a client timestamp or a cursor belonging to a different project.
  const message = await Message.findOne({ _id: messageId, projectId }).select('_id createdAt').lean();
  if (!message) throw Object.assign(new Error('Message not found in this project'), { status: 404 });
  const timestamp = new Date(message.createdAt);
  if (!message.createdAt || !Number.isFinite(timestamp.getTime())) throw Object.assign(new Error('This message has no valid read position'), { status: 409 });
  const readThroughKey = `${timestamp.toISOString()}|${String(message._id).toLowerCase()}`;
  const filter = { projectId, musicianId };
  const update = { $max: { readThroughKey } };
  // $max advances the complete cursor, including equal-time ObjectIds. A slow tab
  // cannot move another tab/device's read position backwards or acknowledge a newer message.
  try { await Read.updateOne(filter, update, { upsert: true, collation: { locale: 'simple' } }); }
  catch (error) { if (error.code !== 11000) throw error; await Read.updateOne(filter, update, { collation: { locale: 'simple' } }); }
  return originalChatUnreadCount({ projectId, musicianId });
}
