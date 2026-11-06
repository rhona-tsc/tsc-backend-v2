export function originalReviewStatus(submissions = []) {
  const pending = submissions.filter(item => item.state === 'submitted').map(item => [String(item._id), Number(item.revision || 1), ...(item.revisionSession?.id || item.revisionRequest?.id ? [item.revisionSession?.status || '', item.revisionRequest?.id || '', item.revisionRequest?.status || '', item.revisionRequest?.escalatedAt || ''] : [])]).sort((a, b) => a[0].localeCompare(b[0]));
  return { pendingCount: pending.length, signature: JSON.stringify(pending) };
}
