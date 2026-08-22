export const energyLevels = ['low', 'medium', 'high'];
export const estimateOptions = [5, 10, 15, 25, 45, 60];
export const focusDurationOptions = [5, 10, 15, 25];
export const subjectOptions = ['general', 'maths', 'science', 'english', 'social-science', 'other'];
export const priorityOptions = ['normal', 'important', 'soon'];
export const recurrenceOptions = ['none', 'weekly'];
export const maxTitleLength = 110;
export const maxFirstStepLength = 180;
export const maxWaitingOnLength = 160;
export const maxHandoffLength = 180;
export const maxChecklistItemLength = 140;
export const maxChecklistItems = 12;

export function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function normalizeTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function normalizeDueDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    ? value
    : null;
}

export function normalizeTask(candidate, { now = Date.now(), createId = () => crypto.randomUUID() } = {}) {
  const text = normalizeWhitespace(candidate?.text);
  const estimatedMinutes = Number(candidate?.estimatedMinutes);
  if (!text) {
    return null;
  }

  return {
    id: typeof candidate.id === 'string' ? candidate.id : createId(),
    text,
    energy: energyLevels.includes(candidate.energy) ? candidate.energy : 'medium',
    done: Boolean(candidate.done),
    createdAt: normalizeTimestamp(candidate.createdAt) ?? now,
    estimatedMinutes: estimateOptions.includes(estimatedMinutes) ? estimatedMinutes : null,
    firstStep: normalizeWhitespace(candidate.firstStep).slice(0, maxFirstStepLength) || null,
    waitingOn: normalizeWhitespace(candidate.waitingOn).slice(0, maxWaitingOnLength) || null,
    waitingUntil: normalizeDueDate(candidate.waitingUntil),
    handoff: normalizeWhitespace(candidate.handoff).slice(0, maxHandoffLength) || null,
    handoffAt: normalizeTimestamp(candidate.handoffAt),
    snoozedUntil: normalizeTimestamp(candidate.snoozedUntil),
    completedAt: normalizeTimestamp(candidate.completedAt),
    dueDate: normalizeDueDate(candidate.dueDate),
    subject: subjectOptions.includes(candidate.subject) ? candidate.subject : 'general',
    priority: priorityOptions.includes(candidate.priority) ? candidate.priority : 'normal',
    recurrence: recurrenceOptions.includes(candidate.recurrence) ? candidate.recurrence : 'none',
    checklist: Array.isArray(candidate.checklist)
      ? candidate.checklist
          .map((item) => {
            const itemText = normalizeWhitespace(item?.text).slice(0, maxChecklistItemLength);
            return itemText ? { id: typeof item.id === 'string' ? item.id : createId(), text: itemText, done: Boolean(item.done) } : null;
          })
          .filter(Boolean)
          .slice(0, maxChecklistItems)
      : [],
  };
}

export function normalizePersonalSettings(candidate, { maxWorkspaceNameLength = 40, maxPersonalNoteLength = 140 } = {}) {
  return {
    workspaceName: normalizeWhitespace(candidate?.workspaceName).slice(0, maxWorkspaceNameLength) || '',
    personalNote: normalizeWhitespace(candidate?.personalNote).slice(0, maxPersonalNoteLength) || '',
    focusMinutes: focusDurationOptions.includes(Number(candidate?.focusMinutes))
      ? Number(candidate.focusMinutes)
      : 10,
  };
}
