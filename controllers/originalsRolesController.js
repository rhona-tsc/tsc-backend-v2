import { validateOriginalRecordingOrder } from '../services/originalsRecordingPlanService.js';
import Project from '../models/originalProjectModel.js';
import Event from '../models/originalEventModel.js';
import { requireOriginalProjectManager } from '../services/originalsAccessService.js';
import { getOriginalsUserId } from '../services/originalsPolicyService.js';
import { loadOriginalMembership } from '../services/originalsMembershipService.js';
import { originalRoleManagement, originalRoleName, sameOriginalRole } from '../services/originalsRoleManagementService.js';

export async function changeOriginalProjectRole(req, res) {
  try {
    const project = await requireOriginalProjectManager(req, res, req.params.id);
    if (!project) return;
    const { action } = req.body || {};
    if (!['add', 'remove', 'set_order'].includes(action)) return res.status(400).json({ success: false, message: 'Choose whether to add, remove or reorder parts.' });
    const name = action === 'set_order' ? '' : originalRoleName(req.body?.roleName);
    const management = originalRoleManagement(await loadOriginalMembership(project));
    if (!management.canEdit) return res.status(409).json({ success: false, message: management.reason });
    const roles = (project.requestedRoles || []).map(role => ({ name: role.name, order: role.order, foundationEligible: role.foundationEligible === true, ...(role.recordingOrder != null ? { recordingOrder: role.recordingOrder } : {}) }));
    const existing = roles.find(role => sameOriginalRole(role.name, name));
    if (action === 'add') {
      if (existing) return res.status(409).json({ success: false, message: 'This part is already in the project.' });
      if (roles.length >= 30) return res.status(409).json({ success: false, message: 'A project can have up to 30 parts.' });
      roles.push({ name, order: roles.length, foundationEligible: false });
    } else if (action === 'remove') {
      if (!existing) return res.status(409).json({ success: false, message: 'This part has already been removed. Refresh the project.' });
      const rule = management.roles.find(role => sameOriginalRole(role.name, existing.name));
      if (!rule?.canRemove) return res.status(409).json({ success: false, message: rule?.removeReason || 'This part cannot be removed.' });
      roles.splice(roles.indexOf(existing), 1);
    }
    if (action === 'set_order') {
      const plan = req.body.recordingOrder;
      if (!Array.isArray(plan) || plan.length !== roles.length || roles.some(role => plan.filter(item => sameOriginalRole(role.name, item?.name)).length !== 1) || plan.some(item => !roles.some(role => sameOriginalRole(role.name, item?.name)))) {
        return res.status(409).json({ success: false, message: 'The project roles changed. Refresh before saving the recording order.' });
      }
      const validated = validateOriginalRecordingOrder(roles.map(role => ({ ...role, recordingOrder: plan.find(item => sameOriginalRole(item.name, role.name)).recordingOrder })));
      roles.splice(0, roles.length, ...validated);
    }
    const requestedRoles = roles.map((role, order) => ({ ...role, order }));
    // Compare the plan and stage as well as the version, so stale owner tabs
    // cannot overwrite another edit or a newly opened stage.
    const saved = await Project.findOneAndUpdate({ _id: project._id, __v: project.__v ?? 0, requestedRoles: project.requestedRoles, state: project.state, currentRoundId: project.currentRoundId || null, currentCreditVersionId: project.currentCreditVersionId || null }, { $set: { requestedRoles }, $inc: { __v: 1 } }, { new: true, runValidators: true }).lean();
    if (!saved) return res.status(409).json({ success: false, message: 'The project changed. Refresh it before updating its parts.' });
    await Event.create({ projectId: project._id, type: action === 'set_order' ? 'project_recording_order_updated' : action === 'add' ? 'project_role_added' : 'project_role_removed', actorId: getOriginalsUserId(req.user), actorRole: String(req.user?.role || req.user?.userrole || ''), metadata: { roleName: existing?.name || name, previousRoles: project.requestedRoles, requestedRoles } });
    return res.json({ success: true, requestedRoles, message: action === 'set_order' ? 'Preferred recording order saved.' : action === 'add' ? `${name} added for a future round.` : `${existing.name} removed from the project plan.` });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not update the project parts.' });
  }
}
