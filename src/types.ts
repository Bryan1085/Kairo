import type { Timestamp } from 'firebase/firestore';

export type TaskPriority = 'alta' | 'media' | 'baja';
export type TaskQuadrant = 'hacer_ya' | 'planificar' | 'delegar' | 'eliminar';
export type ContactCategory = 'trabajo' | 'cliente' | 'personal' | 'familia';
export type NoteFolder = 'general' | 'reuniones' | 'ideas' | 'pendientes';
export type ThemePreference = 'light' | 'dark' | 'system';
export type ActiveTab =
  | 'overview'
  | 'assistant'
  | 'whatsapp'
  | 'calendar'
  | 'tasks'
  | 'contacts'
  | 'notes'
  | 'settings';
export type VoiceName = 'Kore' | 'Zephyr' | 'Puck' | 'Charon' | 'Fenrir';

export interface AssistantActionLog {
  id: string;
  toolName: string;
  summary: string;
  ok: boolean;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  actions?: AssistantActionLog[];
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  defaultReminderMinutes: number;
  alarmSoundEnabled: boolean;
  whatsappAutoSendEnabled: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  location: string;
  isImportant: boolean;
  reminderMinutes: number;
  alarmDismissed: boolean;
  contactId: string;
  contactName: string;
  whatsappReminderEnabled: boolean;
  whatsappConfirmationSent: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface DailyTask {
  id: string;
  userId: string;
  title: string;
  notes: string;
  dueDate: string; // YYYY-MM-DD
  priority: TaskPriority;
  quadrant: TaskQuadrant;
  estimatedMinutes: number;
  orderIndex: number;
  completed: boolean;
  aiReason: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Contact {
  id: string;
  userId: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  category: ContactCategory;
  notes: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface QuickNote {
  id: string;
  userId: string;
  title: string;
  content: string;
  rawText: string;
  folder: NoteFolder;
  tags: string[];
  pinned: boolean;
  isOrganized: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type WhatsAppConnectionStatus = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'error';

export interface WhatsAppState {
  status: WhatsAppConnectionStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  errorMessage: string | null;
}

export type WhatsAppMessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
export type WhatsAppMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'system';

export interface WhatsAppQuotedPreview {
  id: string;
  senderName: string;
  text: string;
  fromMe: boolean;
}

export interface WhatsAppChatMessage {
  id: string;
  jid: string;
  fromMe: boolean;
  senderName: string;
  senderJid?: string;
  timestamp: number;
  type: WhatsAppMessageType;
  text: string;
  caption?: string;
  mediaMime?: string;
  fileName?: string;
  hasMedia?: boolean;
  status: WhatsAppMessageStatus;
  quoted?: WhatsAppQuotedPreview;
}

export interface WhatsAppChatThread {
  jid: string;
  phone: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  lastMessageText: string;
  lastMessageFromMe: boolean;
  lastMessageStatus?: WhatsAppMessageStatus;
  lastMessageTimestamp: number;
  presence?: 'available' | 'composing' | 'recording' | 'unavailable';
  archived?: boolean;
  pinned?: boolean;
}

export interface SmartCaptureResult {
  intent: 'event' | 'task' | 'note';
  event?: {
    title: string;
    description: string;
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    isImportant: boolean;
    contactName: string;
    whatsappReminderEnabled: boolean;
  };
  task?: {
    title: string;
    notes: string;
    dueDate: string;
    priority: TaskPriority;
    quadrant: TaskQuadrant;
    estimatedMinutes: number;
  };
  note?: {
    title: string;
    content: string;
    folder: NoteFolder;
    tags: string[];
  };
}
