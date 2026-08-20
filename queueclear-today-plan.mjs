export function restoreTaskIdToTodayPlan(taskIds, taskId, originalIndex, maxTasks) {
  const currentTaskIds = Array.isArray(taskIds) ? taskIds : [];

  if (
    !Number.isInteger(originalIndex) ||
    originalIndex < 0 ||
    typeof taskId !== 'string' ||
    currentTaskIds.includes(taskId) ||
    currentTaskIds.length >= maxTasks
  ) {
    return { taskIds: currentTaskIds, restored: false };
  }

  const restoredTaskIds = currentTaskIds.slice();
  restoredTaskIds.splice(Math.min(originalIndex, restoredTaskIds.length), 0, taskId);
  return { taskIds: restoredTaskIds, restored: true };
}
