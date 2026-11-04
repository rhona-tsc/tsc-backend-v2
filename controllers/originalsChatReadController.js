import Project from '../models/originalProjectModel.js';
import { getOriginalsUserId } from '../services/originalsPolicyService.js';
import { originalChatUnreadCount, markOriginalChatRead } from '../services/originalsChatReadService.js';

export async function getOriginalChatUnread(req, res) {
  try {
    if (!await Project.exists({ _id: req.params.id })) return res.status(404).json({ success: false, message: 'Project not found' });
    const unreadCount = await originalChatUnreadCount({ projectId: req.params.id, musicianId: getOriginalsUserId(req.user) });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, unreadCount });
  } catch { return res.status(500).json({ success: false, message: 'Could not check unread chat messages' }); }
}
export async function readOriginalChat(req, res) {
  try {
    if (!await Project.exists({ _id: req.params.id })) return res.status(404).json({ success: false, message: 'Project not found' });
    const unreadCount = await markOriginalChatRead({ projectId: req.params.id, musicianId: getOriginalsUserId(req.user), messageId: req.body?.messageId });
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, unreadCount });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not save your chat read position' }); }
}
