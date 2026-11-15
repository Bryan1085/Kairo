import type { ContactCategory, NoteFolder, TaskPriority, TaskQuadrant } from '../types';

export function getLocalDateStr(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTomorrowDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return getLocalDateStr(d);
}

export function formatDisplayDate(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function formatLongDate(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function parseEventDateTime(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export function addMinutesToTime(timeStr: string, minutesToAdd: number): string {
  const [hh, mm] = timeStr.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, hh * 60 + mm + minutesToAdd));
  const outH = String(Math.floor(total / 60)).padStart(2, '0');
  const outM = String(total % 60).padStart(2, '0');
  return `${outH}:${outM}`;
}

export function normalizePhoneForWhatsApp(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

export function isValidPhone(phone: string): boolean {
  const trimmed = phone.trim();
  return trimmed.length >= 7 && trimmed.length <= 24 && /^\+?[0-9\s\-()]{7,24}$/.test(trimmed);
}

export function buildWhatsAppLink(phone: string, text: string): string {
  const digits = normalizePhoneForWhatsApp(phone);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function buildConfirmationMessage(params: {
  contactName: string;
  title: string;
  date: string;
  startTime: string;
  location: string;
}): string {
  const greetingName = params.contactName ? ` ${params.contactName}` : '';
  const dateLabel = formatLongDate(params.date);
  const locationPart = params.location ? ` en ${params.location}` : '';
  return `Hola${greetingName}, te recuerdo nuestra cita "${params.title}" programada para mañana ${dateLabel} a las ${params.startTime}${locationPart}. ¿Me confirmas tu asistencia?`;
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
};

export const QUADRANT_LABELS: Record<TaskQuadrant, { title: string; subtitle: string }> = {
  hacer_ya: { title: 'Hacer ya', subtitle: 'Urgente e importante' },
  planificar: { title: 'Planificar', subtitle: 'Importante, no urgente' },
  delegar: { title: 'Delegar', subtitle: 'Urgente, menor impacto' },
  eliminar: { title: 'Evaluar / Posponer', subtitle: 'Baja prioridad' },
};

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  trabajo: 'Trabajo',
  cliente: 'Cliente',
  personal: 'Personal',
  familia: 'Familia',
};

export const NOTE_FOLDER_LABELS: Record<NoteFolder, string> = {
  general: 'General',
  reuniones: 'Reuniones',
  ideas: 'Ideas',
  pendientes: 'Pendientes',
};

export function clampString(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}
