import { getLocalDatePart } from './queueclear-storage.mjs';

export function formatFocusTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return minutes + ':' + String(remainingSeconds).padStart(2, '0');
}

export function formatSnoozeTime(timestamp, locale = undefined) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return '';
  }
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function getSnoozeTime(option, baseDate = new Date()) {
  const date = new Date(baseDate.getTime());
  if (option === 'later') {
    const laterToday = new Date(date.getTime());
    laterToday.setHours(Math.min(date.getHours() + 3, 20), 0, 0, 0);
    if (laterToday > date) {
      return laterToday.getTime();
    }
    date.setDate(date.getDate() + 1);
  } else if (option === 'next-week') {
    date.setDate(date.getDate() + 7);
  } else {
    date.setDate(date.getDate() + 1);
  }
  date.setHours(8, 0, 0, 0);
  return date.getTime();
}

export function formatDueDate(dueDate, baseDate = new Date()) {
  if (!dueDate || typeof dueDate !== 'string') {
    return '';
  }

  const today = getLocalDatePart(baseDate);
  const tomorrowDate = new Date(baseDate.getTime());
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = getLocalDatePart(tomorrowDate);

  if (dueDate < today) {
    return 'Overdue: ' + dueDate;
  }
  if (dueDate === today) {
    return 'Due today';
  }
  if (dueDate === tomorrow) {
    return 'Due tomorrow';
  }
  return 'Due ' + dueDate;
}

export function isDueToday(task, baseDate = new Date()) {
  return Boolean(task && task.dueDate === getLocalDatePart(baseDate));
}

export function getWaitingReviewDate(option, baseDate = new Date()) {
  if (option !== 'tomorrow' && option !== 'next-week') {
    return null;
  }

  const reviewDate = new Date(baseDate.getTime());
  reviewDate.setDate(reviewDate.getDate() + (option === 'tomorrow' ? 1 : 7));
  return getLocalDatePart(reviewDate);
}
