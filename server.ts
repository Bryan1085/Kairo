import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GoogleGenAI,
  Modality,
  Type,
  type Content,
  type FunctionDeclaration,
  type LiveServerMessage,
} from '@google/genai';
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  extractMessageContent,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  useMultiFileAuthState,
  WAMessageStatus,
  type AnyMessageContent,
  type WAMessage,
  type WAMessageKey,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const SESSIONS_ROOT = path.resolve(__dirname, '.wa-sessions');

if (!fs.existsSync(SESSIONS_ROOT)) {
  fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
}

function getGeminiClient(apiVersion: 'v1' | 'v1beta' | 'v1alpha' = 'v1beta'): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada en el servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractReadableError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : fallback;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // not JSON
  }
  return raw || fallback;
}

function isRetryableGeminiError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err || '');
  return /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|ECONNRESET|ETIMEDOUT|rate.?limit|quota/i.test(
    raw
  );
}

async function withGeminiRetry<T>(operation: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryableGeminiError(err)) {
        throw err;
      }
      const baseDelay = Math.min(5000, 600 * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
    }
  }
  throw lastErr;
}

async function generateContentWithFallback(
  ai: GoogleGenAI,
  primaryModel: string,
  fallbackModel: string,
  buildParams: (model: string) => Parameters<GoogleGenAI['models']['generateContent']>[0]
) {
  try {
    return await withGeminiRetry(() => ai.models.generateContent(buildParams(primaryModel)), 4);
  } catch (err) {
    if (fallbackModel && fallbackModel !== primaryModel && isRetryableGeminiError(err)) {
      console.warn(`Primary model ${primaryModel} saturated, falling back to ${fallbackModel}`);
      return await withGeminiRetry(() => ai.models.generateContent(buildParams(fallbackModel)), 3);
    }
    throw err;
  }
}

function splitTextForTts(text: string, maxLen = 1200): string[] {
  const clean = text.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > maxLen) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      const words = sentence.split(/\s+/);
      for (const word of words) {
        if ((current + ' ' + word).trim().length > maxLen) {
          if (current) chunks.push(current.trim());
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      continue;
    }

    if ((current + ' ' + sentence).trim().length > maxLen) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

function mergeWavBase64Chunks(base64Chunks: string[]): string {
  if (base64Chunks.length === 1) return base64Chunks[0];
  let firstHeader: Buffer | null = null;
  const pcmParts: Buffer[] = [];

  for (const b64 of base64Chunks) {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
      continue;
    }
    const dataIdx = buf.indexOf(Buffer.from('data'), 12);
    if (dataIdx === -1 || dataIdx + 8 > buf.length) {
      continue;
    }
    if (!firstHeader) {
      firstHeader = Buffer.from(buf.subarray(0, dataIdx + 8));
    }
    pcmParts.push(buf.subarray(dataIdx + 8));
  }

  if (!firstHeader || pcmParts.length === 0) {
    return base64Chunks[0];
  }

  const combinedPcm = Buffer.concat(pcmParts);
  firstHeader.writeUInt32LE(firstHeader.length - 8 + combinedPcm.length, 4);
  firstHeader.writeUInt32LE(combinedPcm.length, firstHeader.length - 4);
  return Buffer.concat([firstHeader, combinedPcm]).toString('base64');
}

const ASSISTANT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'create_event',
    description:
      'Agenda una nueva cita o reunión en el calendario del usuario. Usa siempre formato YYYY-MM-DD para date y HH:MM 24h para startTime/endTime.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Título de la cita.' },
        description: { type: Type.STRING, description: 'Detalles u objetivo de la cita.' },
        date: { type: Type.STRING, description: 'Fecha en formato YYYY-MM-DD.' },
        startTime: { type: Type.STRING, description: 'Hora de inicio HH:MM (24h).' },
        endTime: { type: Type.STRING, description: 'Hora de fin HH:MM (24h).' },
        location: { type: Type.STRING, description: 'Lugar físico o enlace de videollamada.' },
        isImportant: { type: Type.BOOLEAN, description: 'Si la cita es prioritaria/urgente.' },
        reminderMinutes: {
          type: Type.INTEGER,
          description: 'Minutos antes de la cita para la alarma (por defecto 15).',
        },
        contactName: {
          type: Type.STRING,
          description: 'Nombre del contacto participante si se menciona.',
        },
        whatsappReminderEnabled: {
          type: Type.BOOLEAN,
          description: 'Si se debe recordar 1 día antes por WhatsApp.',
        },
      },
      required: ['title', 'date', 'startTime', 'endTime'],
    },
  },
  {
    name: 'create_task',
    description: 'Crea una nueva tarea diaria en la lista del usuario.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Título de la tarea.' },
        notes: { type: Type.STRING, description: 'Notas o contexto adicional.' },
        dueDate: { type: Type.STRING, description: 'Fecha objetivo YYYY-MM-DD.' },
        priority: {
          type: Type.STRING,
          description: 'Prioridad: alta, media o baja.',
        },
        quadrant: {
          type: Type.STRING,
          description: 'Cuadrante Eisenhower: hacer_ya, planificar, delegar o eliminar.',
        },
        estimatedMinutes: {
          type: Type.INTEGER,
          description: 'Duración estimada en minutos (por defecto 30).',
        },
      },
      required: ['title', 'dueDate', 'priority', 'quadrant'],
    },
  },
  {
    name: 'complete_task',
    description: 'Marca una tarea existente como completada usando su ID exacto del contexto.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: 'ID exacto de la tarea a completar.' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'create_note',
    description: 'Guarda una nota rápida organizada en una carpeta.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Título breve de la nota.' },
        content: { type: Type.STRING, description: 'Contenido completo de la nota.' },
        folder: {
          type: Type.STRING,
          description: 'Carpeta: general, reuniones, ideas o pendientes.',
        },
        tags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Hasta 5 etiquetas cortas.',
        },
        pinned: { type: Type.BOOLEAN, description: 'Si se debe fijar arriba.' },
      },
      required: ['title', 'content', 'folder'],
    },
  },
  {
    name: 'create_contact',
    description: 'Guarda un nuevo contacto en el directorio.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Nombre completo.' },
        phone: {
          type: Type.STRING,
          description: 'Número de teléfono con código de país (ej. +502 5555 1234).',
        },
        email: { type: Type.STRING, description: 'Correo electrónico opcional.' },
        role: { type: Type.STRING, description: 'Cargo o empresa.' },
        category: {
          type: Type.STRING,
          description: 'Categoría: trabajo, cliente, personal o familia.',
        },
        notes: { type: Type.STRING, description: 'Notas sobre el contacto.' },
      },
      required: ['name', 'phone', 'category'],
    },
  },
  {
    name: 'list_whatsapp_chats',
    description:
      'Obtiene la lista actualizada de chats y grupos de WhatsApp vinculados (nombre, jid, teléfono, mensajes no leídos y último mensaje). Úsala cuando el usuario pregunte por sus chats o mensajes recientes de WhatsApp.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        onlyUnread: {
          type: Type.BOOLEAN,
          description: 'Si es true, filtra solo los chats con mensajes sin leer.',
        },
        search: {
          type: Type.STRING,
          description: 'Texto opcional para filtrar chats por nombre, número o contenido.',
        },
      },
    },
  },
  {
    name: 'read_whatsapp_chat',
    description:
      'Lee los mensajes recientes de un chat o grupo específico de WhatsApp para resumirlos o responder preguntas sobre lo que escribieron.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        jid: {
          type: Type.STRING,
          description: 'JID exacto del chat de WhatsApp si aparece en el contexto (ej. 50255551234@s.whatsapp.net o 120363...@g.us).',
        },
        chatName: {
          type: Type.STRING,
          description: 'Nombre del contacto o grupo en WhatsApp si no se tiene el jid exacto.',
        },
        phone: {
          type: Type.STRING,
          description: 'Número de teléfono opcional.',
        },
        limit: {
          type: Type.INTEGER,
          description: 'Cantidad máxima de mensajes recientes a leer (por defecto 15).',
        },
      },
    },
  },
  {
    name: 'send_whatsapp_message',
    description:
      'Envía un mensaje de WhatsApp a cualquier chat, grupo o contacto. Usa el jid exacto del chat si aparece en whatsappChats (ideal para chats existentes y grupos) o el nombre/teléfono.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        jid: {
          type: Type.STRING,
          description: 'JID exacto del chat o grupo de WhatsApp (ej. ...@s.whatsapp.net o ...@g.us). Preferido cuando el chat ya existe en whatsappChats.',
        },
        chatName: {
          type: Type.STRING,
          description: 'Nombre del chat o grupo en WhatsApp.',
        },
        contactName: { type: Type.STRING, description: 'Nombre del destinatario.' },
        phone: { type: Type.STRING, description: 'Número de teléfono con código de país.' },
        message: { type: Type.STRING, description: 'Texto del mensaje a enviar.' },
      },
      required: ['message'],
    },
  },
  {
    name: 'open_whatsapp_chat',
    description: 'Abre una conversación específica de WhatsApp en la interfaz visual.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        jid: { type: Type.STRING, description: 'JID exacto del chat.' },
        chatName: { type: Type.STRING, description: 'Nombre del chat o grupo.' },
        phone: { type: Type.STRING, description: 'Número de teléfono.' },
      },
    },
  },
  {
    name: 'navigate_to',
    description: 'Cambia la vista activa de Kairo cuando el usuario pide abrir una sección.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tab: {
          type: Type.STRING,
          description: 'Sección: overview, whatsapp, calendar, tasks, contacts, notes o settings.',
        },
      },
      required: ['tab'],
    },
  },
];

function buildAssistantSystemInstruction(
  context: Record<string, unknown> | undefined,
  todayDate?: string,
  currentTime?: string,
  forVoice = false
): string {
  const nowDate = todayDate || new Date().toISOString().slice(0, 10);
  const nowTime = currentTime || new Date().toTimeString().slice(0, 5);
  return `Eres Kairo, la asistente personal ejecutiva inteligente del usuario.
Hablas siempre en español natural, cálido, claro y directo.
Fecha local actual: ${nowDate}. Hora local actual: ${nowTime}.
${
  forVoice
    ? 'Estás en una conversación de voz en vivo: responde de forma concisa y conversacional (idealmente 1 a 3 frases claras, sin listas largas ni símbolos Markdown como asteriscos o guiones).'
    : 'Responde de forma clara, estructurada y útil. Puedes ejecutar acciones reales en la agenda, tareas, notas, contactos y WhatsApp usando las herramientas disponibles cuando el usuario lo pida.'
}

Datos actuales del espacio de trabajo del usuario:
${JSON.stringify(context || {}, null, 2)}

Reglas importantes:
- Si el usuario pregunta por su agenda, tareas, contactos, notas o chats de WhatsApp (whatsappChats), responde usando exactamente los datos del contexto y las herramientas.
- Para leer mensajes dentro de un chat o grupo de WhatsApp, usa read_whatsapp_chat con el jid o chatName correspondiente.
- Para enviar un mensaje por WhatsApp, busca primero el chat en whatsappChats (por nombre, grupo o teléfono) o en contacts, y usa send_whatsapp_message pasando su jid exacto (o phone si es un número nuevo).
- Cuando ejecutes una herramienta (agendar cita, crear tarea, completar tarea, guardar nota, crear contacto o enviar WhatsApp), confirma exactamente lo realizado con destinatario, fecha, hora o detalles clave.
- Nunca inventes datos que no estén en el contexto ni confirmes un envío si la herramienta devolvió error.`;
}

type WAStatus = 'disconnected' | 'connecting' | 'qr' | 'connected' | 'error';
type WAMsgStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
type WAMsgType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'system';

interface StoredWAMessage {
  id: string;
  jid: string;
  fromMe: boolean;
  senderName: string;
  senderJid?: string;
  timestamp: number;
  type: WAMsgType;
  text: string;
  caption?: string;
  mediaMime?: string;
  fileName?: string;
  hasMedia?: boolean;
  status: WAMsgStatus;
  quoted?: {
    id: string;
    senderName: string;
    text: string;
    fromMe: boolean;
  };
}

interface StoredWAChat {
  jid: string;
  phone: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  lastMessageText: string;
  lastMessageFromMe: boolean;
  lastMessageStatus?: WAMsgStatus;
  lastMessageTimestamp: number;
  presence?: 'available' | 'composing' | 'recording' | 'unavailable';
  archived?: boolean;
  pinned?: boolean;
}

interface StoredWAContact {
  name?: string;
  notify?: string;
  verifiedName?: string;
}

interface UserWASession {
  userId: string;
  sock: WASocket | null;
  status: WAStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  displayName: string | null;
  errorMessage: string | null;
  clients: Set<WebSocket>;
  reconnectTimer: NodeJS.Timeout | null;
  persistTimer: NodeJS.Timeout | null;
  chats: Map<string, StoredWAChat>;
  messages: Map<string, StoredWAMessage[]>;
  contacts: Map<string, StoredWAContact>;
  lidToPn: Map<string, string>;
  rawMessages: Map<string, WAMessage>;
  avatarCache: Map<string, string | null>;
}

const waSessions = new Map<string, UserWASession>();
const logger = pino({ level: 'silent' });
const MAX_MESSAGES_PER_CHAT = 250;

function sanitizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

function getStorePath(safeId: string): string {
  return path.join(SESSIONS_ROOT, safeId, 'store.json');
}

function loadSessionStore(session: UserWASession) {
  const storePath = getStorePath(session.userId);
  if (!fs.existsSync(storePath)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as {
      chats?: Array<[string, StoredWAChat]>;
      messages?: Array<[string, StoredWAMessage[]]>;
      contacts?: Array<[string, StoredWAContact]>;
      lidToPn?: Array<[string, string]>;
    };
    if (Array.isArray(raw.chats)) {
      session.chats = new Map(raw.chats);
    }
    if (Array.isArray(raw.messages)) {
      session.messages = new Map(raw.messages);
    }
    if (Array.isArray(raw.contacts)) {
      session.contacts = new Map(raw.contacts);
    }
    if (Array.isArray(raw.lidToPn)) {
      session.lidToPn = new Map(raw.lidToPn);
    }
  } catch (err) {
    console.warn('No se pudo cargar store de WhatsApp:', err);
  }
}

function schedulePersistStore(session: UserWASession) {
  if (session.persistTimer) return;
  session.persistTimer = setTimeout(() => {
    session.persistTimer = null;
    try {
      const sessionDir = path.join(SESSIONS_ROOT, session.userId);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      const payload = {
        chats: Array.from(session.chats.entries()),
        messages: Array.from(session.messages.entries()),
        contacts: Array.from(session.contacts.entries()),
        lidToPn: Array.from(session.lidToPn.entries()),
      };
      fs.writeFileSync(getStorePath(session.userId), JSON.stringify(payload));
    } catch (err) {
      console.warn('No se pudo guardar store de WhatsApp:', err);
    }
  }, 800);
}

function getOrCreateSession(userId: string): UserWASession {
  const safeId = sanitizeUserId(userId);
  let session = waSessions.get(safeId);
  if (!session) {
    session = {
      userId: safeId,
      sock: null,
      status: 'disconnected',
      qrDataUrl: null,
      phoneNumber: null,
      displayName: null,
      errorMessage: null,
      clients: new Set<WebSocket>(),
      reconnectTimer: null,
      persistTimer: null,
      chats: new Map(),
      messages: new Map(),
      contacts: new Map(),
      lidToPn: new Map(),
      rawMessages: new Map(),
      avatarCache: new Map(),
    };
    loadSessionStore(session);
    waSessions.set(safeId, session);
  }
  return session;
}

function serializeSessionState(session: UserWASession) {
  return {
    status: session.status,
    qrDataUrl: session.qrDataUrl,
    phoneNumber: session.phoneNumber,
    displayName: session.displayName,
    errorMessage: session.errorMessage,
  };
}

function broadcastToUserClients(session: UserWASession, type: string, data: unknown) {
  const payload = JSON.stringify({ type, data });
  for (const ws of session.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function broadcastSessionState(session: UserWASession) {
  broadcastToUserClients(session, 'whatsapp:state', serializeSessionState(session));
}

function formatPhoneFromJid(jid: string): string {
  const user = jid.split('@')[0]?.split(':')[0] || '';
  if (!user || jid.endsWith('@g.us')) return '';
  return /^\d{7,16}$/.test(user) ? `+${user}` : user;
}

function resolveCanonicalJid(session: UserWASession, rawJid: string): string {
  if (!rawJid) return '';
  if (rawJid === 'status@broadcast' || rawJid.endsWith('@newsletter') || rawJid.endsWith('@broadcast')) {
    return '';
  }
  let normalized = rawJid;
  try {
    normalized = jidNormalizedUser(rawJid);
  } catch {
    // keep rawJid
  }
  if (normalized.endsWith('@lid')) {
    const mapped = session.lidToPn.get(normalized);
    if (mapped) {
      try {
        return jidNormalizedUser(mapped);
      } catch {
        return mapped;
      }
    }
  }
  return normalized;
}

function resolveDisplayName(session: UserWASession, jid: string, fallbackName?: string | null): string {
  const contact = session.contacts.get(jid);
  const existing = session.chats.get(jid);
  const candidates = [
    contact?.name,
    contact?.verifiedName,
    contact?.notify,
    fallbackName,
    existing?.name,
  ];
  for (const c of candidates) {
    if (c && c.trim() && c.trim() !== jid && !c.endsWith('@s.whatsapp.net') && !c.endsWith('@g.us')) {
      return c.trim();
    }
  }
  const phone = formatPhoneFromJid(jid);
  return phone || jid.split('@')[0] || 'Chat';
}

function mapWAStatusToUi(status: number | null | undefined, fromMe: boolean): WAMsgStatus {
  if (!fromMe) return 'delivered';
  if (status === WAMessageStatus.ERROR) return 'failed';
  if (status === WAMessageStatus.PENDING) return 'pending';
  if (status === WAMessageStatus.SERVER_ACK) return 'sent';
  if (status === WAMessageStatus.DELIVERY_ACK) return 'delivered';
  if (status === WAMessageStatus.READ || status === WAMessageStatus.PLAYED) return 'read';
  return 'sent';
}

function toEpochMs(ts: unknown): number {
  if (typeof ts === 'number') {
    return ts < 1e12 ? ts * 1000 : ts;
  }
  if (ts && typeof ts === 'object' && 'toNumber' in ts && typeof (ts as { toNumber: () => number }).toNumber === 'function') {
    const num = (ts as { toNumber: () => number }).toNumber();
    return num < 1e12 ? num * 1000 : num;
  }
  return Date.now();
}

function parseProtoTextPreview(content: proto.IMessage | null | undefined): {
  type: WAMsgType;
  text: string;
  caption?: string;
  mediaMime?: string;
  fileName?: string;
  hasMedia?: boolean;
} | null {
  if (!content) return null;
  const extracted = extractMessageContent(content);
  if (!extracted) return null;

  if (extracted.conversation) {
    return { type: 'text', text: extracted.conversation };
  }
  if (extracted.extendedTextMessage?.text) {
    return { type: 'text', text: extracted.extendedTextMessage.text };
  }
  if (extracted.imageMessage) {
    return {
      type: 'image',
      text: extracted.imageMessage.caption || '',
      caption: extracted.imageMessage.caption || undefined,
      mediaMime: extracted.imageMessage.mimetype || 'image/jpeg',
      hasMedia: true,
    };
  }
  if (extracted.videoMessage) {
    return {
      type: 'video',
      text: extracted.videoMessage.caption || '',
      caption: extracted.videoMessage.caption || undefined,
      mediaMime: extracted.videoMessage.mimetype || 'video/mp4',
      hasMedia: true,
    };
  }
  if (extracted.audioMessage) {
    return {
      type: 'audio',
      text: extracted.audioMessage.ptt ? 'Nota de voz' : 'Audio',
      mediaMime: extracted.audioMessage.mimetype || 'audio/ogg',
      hasMedia: true,
    };
  }
  if (extracted.documentMessage) {
    const fn = extracted.documentMessage.fileName || extracted.documentMessage.title || 'Documento';
    return {
      type: 'document',
      text: extracted.documentMessage.caption || fn,
      caption: extracted.documentMessage.caption || undefined,
      fileName: fn,
      mediaMime: extracted.documentMessage.mimetype || 'application/octet-stream',
      hasMedia: true,
    };
  }
  if (extracted.stickerMessage) {
    return {
      type: 'sticker',
      text: 'Sticker',
      mediaMime: extracted.stickerMessage.mimetype || 'image/webp',
      hasMedia: true,
    };
  }
  if (extracted.reactionMessage?.text) {
    return {
      type: 'system',
      text: `Reaccionó con ${extracted.reactionMessage.text}`,
    };
  }
  if (extracted.locationMessage) {
    return {
      type: 'text',
      text: extracted.locationMessage.name || extracted.locationMessage.address || 'Ubicación compartida',
    };
  }
  if (extracted.contactMessage) {
    return {
      type: 'text',
      text: `Contacto: ${extracted.contactMessage.displayName || 'Tarjeta'}`,
    };
  }
  return null;
}

function previewLabelForChat(msg: StoredWAMessage): string {
  if (msg.type === 'image') return msg.caption ? `Imagen: ${msg.caption}` : 'Foto';
  if (msg.type === 'video') return msg.caption ? `Video: ${msg.caption}` : 'Video';
  if (msg.type === 'audio') return msg.text || 'Nota de voz';
  if (msg.type === 'document') return `Documento: ${msg.fileName || msg.text}`;
  if (msg.type === 'sticker') return 'Sticker';
  return msg.text;
}

function upsertStoredMessage(
  session: UserWASession,
  waMsg: WAMessage,
  options: { incrementUnread?: boolean } = {}
): { chat: StoredWAChat; message: StoredWAMessage } | null {
  const rawJid = waMsg.key?.remoteJid || '';
  const jid = resolveCanonicalJid(session, rawJid);
  if (!jid || !waMsg.key?.id) return null;

  const parsed = parseProtoTextPreview(waMsg.message);
  if (!parsed) return null;

  const fromMe = Boolean(waMsg.key.fromMe);
  const timestamp = toEpochMs(waMsg.messageTimestamp);
  const isGroup = jid.endsWith('@g.us');
  const participantJid = waMsg.key.participant
    ? resolveCanonicalJid(session, waMsg.key.participant)
    : undefined;

  if (!fromMe && !isGroup && waMsg.pushName) {
    const existingContact = session.contacts.get(jid) || {};
    if (!existingContact.notify) {
      session.contacts.set(jid, { ...existingContact, notify: waMsg.pushName });
    }
  }

  let quoted: StoredWAMessage['quoted'];
  const extContext = extractMessageContent(waMsg.message)?.extendedTextMessage?.contextInfo ||
    extractMessageContent(waMsg.message)?.imageMessage?.contextInfo ||
    extractMessageContent(waMsg.message)?.documentMessage?.contextInfo;

  if (extContext?.stanzaId && extContext.quotedMessage) {
    const quotedParsed = parseProtoTextPreview(extContext.quotedMessage);
    const quotedSender = extContext.participant
      ? resolveDisplayName(session, resolveCanonicalJid(session, extContext.participant))
      : 'Tú';
    quoted = {
      id: extContext.stanzaId,
      senderName: quotedSender,
      text: quotedParsed?.text || quotedParsed?.fileName || 'Mensaje',
      fromMe: !extContext.participant || extContext.participant === session.sock?.user?.id,
    };
  }

  const storedMsg: StoredWAMessage = {
    id: waMsg.key.id,
    jid,
    fromMe,
    senderName: fromMe
      ? 'Tú'
      : isGroup && participantJid
        ? resolveDisplayName(session, participantJid, waMsg.pushName)
        : resolveDisplayName(session, jid, waMsg.pushName),
    senderJid: participantJid,
    timestamp,
    type: parsed.type,
    text: parsed.text,
    caption: parsed.caption,
    mediaMime: parsed.mediaMime,
    fileName: parsed.fileName,
    hasMedia: parsed.hasMedia,
    status: mapWAStatusToUi(waMsg.status, fromMe),
    quoted,
  };

  if (parsed.hasMedia) {
    session.rawMessages.set(`${jid}::${storedMsg.id}`, waMsg);
  } else {
    session.rawMessages.set(`${jid}::${storedMsg.id}`, waMsg);
  }

  const list = session.messages.get(jid) || [];
  const existingIdx = list.findIndex((m) => m.id === storedMsg.id);
  if (existingIdx >= 0) {
    list[existingIdx] = { ...list[existingIdx], ...storedMsg };
  } else {
    list.push(storedMsg);
    list.sort((a, b) => a.timestamp - b.timestamp);
    if (list.length > MAX_MESSAGES_PER_CHAT) {
      list.splice(0, list.length - MAX_MESSAGES_PER_CHAT);
    }
  }
  session.messages.set(jid, list);

  const existingChat = session.chats.get(jid);
  const latestMsg = list[list.length - 1] || storedMsg;
  const chatName = resolveDisplayName(session, jid, !fromMe && !isGroup ? waMsg.pushName : undefined);

  const updatedChat: StoredWAChat = {
    jid,
    phone: formatPhoneFromJid(jid),
    name: chatName,
    isGroup,
    unreadCount:
      existingChat?.unreadCount !== undefined
        ? options.incrementUnread && !fromMe
          ? existingChat.unreadCount + 1
          : existingChat.unreadCount
        : options.incrementUnread && !fromMe
          ? 1
          : 0,
    lastMessageText: previewLabelForChat(latestMsg),
    lastMessageFromMe: latestMsg.fromMe,
    lastMessageStatus: latestMsg.status,
    lastMessageTimestamp: latestMsg.timestamp,
    presence: existingChat?.presence,
    archived: existingChat?.archived,
    pinned: existingChat?.pinned,
  };

  session.chats.set(jid, updatedChat);
  schedulePersistStore(session);
  return { chat: updatedChat, message: storedMsg };
}

function getSortedChats(session: UserWASession): StoredWAChat[] {
  return Array.from(session.chats.values()).sort(
    (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.lastMessageTimestamp - a.lastMessageTimestamp
  );
}

function hasSavedCredentials(safeId: string): boolean {
  return fs.existsSync(path.join(SESSIONS_ROOT, safeId, 'creds.json'));
}

function ensureAutoResumeSession(userId: string) {
  const safeId = sanitizeUserId(userId);
  if (!safeId) return;
  const session = getOrCreateSession(safeId);
  if (
    session.status === 'disconnected' &&
    !session.sock &&
    hasSavedCredentials(safeId)
  ) {
    void startWhatsAppSocket(safeId);
  }
}

async function startWhatsAppSocket(userId: string): Promise<UserWASession> {
  const safeId = sanitizeUserId(userId);
  const session = getOrCreateSession(safeId);

  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }

  if (session.sock) {
    try {
      session.sock.end(undefined);
    } catch {
      // ignore close errors
    }
    session.sock = null;
  }

  const sessionDir = path.join(SESSIONS_ROOT, safeId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  session.status = 'connecting';
  session.errorMessage = null;
  session.qrDataUrl = null;
  broadcastSessionState(session);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ['Kairo Asistente', 'Chrome', '1.0.0'],
      syncFullHistory: true,
      markOnlineOnConnect: true,
    });

    session.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messaging-history.set', ({ chats, contacts, messages, lidPnMappings }) => {
      if (Array.isArray(lidPnMappings)) {
        for (const mapping of lidPnMappings) {
          if (mapping.lid && mapping.pn) {
            session.lidToPn.set(mapping.lid, mapping.pn);
          }
        }
      }

      if (Array.isArray(contacts)) {
        for (const c of contacts) {
          const cJid = resolveCanonicalJid(session, c.id);
          if (!cJid) continue;
          const prev = session.contacts.get(cJid) || {};
          session.contacts.set(cJid, {
            name: c.name || prev.name,
            notify: c.notify || prev.notify,
            verifiedName: c.verifiedName || prev.verifiedName,
          });
        }
      }

      if (Array.isArray(chats)) {
        for (const c of chats) {
          const jid = resolveCanonicalJid(session, c.id || '');
          if (!jid) continue;
          const prev = session.chats.get(jid);
          const ts = toEpochMs(c.conversationTimestamp || prev?.lastMessageTimestamp || Date.now());
          session.chats.set(jid, {
            jid,
            phone: formatPhoneFromJid(jid),
            name: resolveDisplayName(session, jid, c.name),
            isGroup: jid.endsWith('@g.us'),
            unreadCount: typeof c.unreadCount === 'number' ? Math.max(0, c.unreadCount) : prev?.unreadCount || 0,
            lastMessageText: prev?.lastMessageText || '',
            lastMessageFromMe: prev?.lastMessageFromMe ?? false,
            lastMessageStatus: prev?.lastMessageStatus,
            lastMessageTimestamp: ts,
            archived: Boolean(c.archived),
            pinned: Boolean(c.pinned),
          });
        }
      }

      if (Array.isArray(messages)) {
        for (const m of messages) {
          upsertStoredMessage(session, m, { incrementUnread: false });
        }
      }

      schedulePersistStore(session);
      broadcastToUserClients(session, 'whatsapp:chats_sync', getSortedChats(session));
    });

    sock.ev.on('lid-mapping.update', (mapping) => {
      if (mapping.lid && mapping.pn) {
        session.lidToPn.set(mapping.lid, mapping.pn);
        schedulePersistStore(session);
      }
    });

    sock.ev.on('contacts.upsert', (contacts) => {
      let changed = false;
      for (const c of contacts) {
        const cJid = resolveCanonicalJid(session, c.id);
        if (!cJid) continue;
        const prev = session.contacts.get(cJid) || {};
        session.contacts.set(cJid, {
          name: c.name || prev.name,
          notify: c.notify || prev.notify,
          verifiedName: c.verifiedName || prev.verifiedName,
        });
        const chat = session.chats.get(cJid);
        if (chat) {
          chat.name = resolveDisplayName(session, cJid, c.name);
          session.chats.set(cJid, chat);
        }
        changed = true;
      }
      if (changed) {
        schedulePersistStore(session);
        broadcastToUserClients(session, 'whatsapp:chats_sync', getSortedChats(session));
      }
    });

    sock.ev.on('contacts.update', (updates) => {
      let changed = false;
      for (const c of updates) {
        if (!c.id) continue;
        const cJid = resolveCanonicalJid(session, c.id);
        if (!cJid) continue;
        const prev = session.contacts.get(cJid) || {};
        session.contacts.set(cJid, {
          name: c.name || prev.name,
          notify: c.notify || prev.notify,
          verifiedName: c.verifiedName || prev.verifiedName,
        });
        const chat = session.chats.get(cJid);
        if (chat) {
          chat.name = resolveDisplayName(session, cJid, c.name);
          session.chats.set(cJid, chat);
        }
        changed = true;
      }
      if (changed) {
        schedulePersistStore(session);
        broadcastToUserClients(session, 'whatsapp:chats_sync', getSortedChats(session));
      }
    });

    sock.ev.on('chats.upsert', (chats) => {
      for (const c of chats) {
        const jid = resolveCanonicalJid(session, c.id || '');
        if (!jid) continue;
        const prev = session.chats.get(jid);
        session.chats.set(jid, {
          jid,
          phone: formatPhoneFromJid(jid),
          name: resolveDisplayName(session, jid, c.name),
          isGroup: jid.endsWith('@g.us'),
          unreadCount: typeof c.unreadCount === 'number' ? Math.max(0, c.unreadCount) : prev?.unreadCount || 0,
          lastMessageText: prev?.lastMessageText || '',
          lastMessageFromMe: prev?.lastMessageFromMe ?? false,
          lastMessageStatus: prev?.lastMessageStatus,
          lastMessageTimestamp: toEpochMs(c.conversationTimestamp || prev?.lastMessageTimestamp || Date.now()),
          archived: Boolean(c.archived),
          pinned: Boolean(c.pinned),
        });
      }
      schedulePersistStore(session);
      broadcastToUserClients(session, 'whatsapp:chats_sync', getSortedChats(session));
    });

    sock.ev.on('chats.update', (updates) => {
      for (const upd of updates) {
        if (!upd.id) continue;
        const jid = resolveCanonicalJid(session, upd.id);
        const prev = session.chats.get(jid);
        if (!prev) continue;
        if (typeof upd.unreadCount === 'number') prev.unreadCount = Math.max(0, upd.unreadCount);
        if (upd.name) prev.name = upd.name;
        if (upd.archived !== undefined) prev.archived = Boolean(upd.archived);
        if (upd.pinned !== undefined) prev.pinned = Boolean(upd.pinned);
        if (upd.conversationTimestamp) {
          prev.lastMessageTimestamp = Math.max(prev.lastMessageTimestamp, toEpochMs(upd.conversationTimestamp));
        }
        session.chats.set(jid, prev);
        broadcastToUserClients(session, 'whatsapp:chat_update', prev);
      }
      schedulePersistStore(session);
    });

    sock.ev.on('groups.upsert', (groups) => {
      for (const g of groups) {
        const jid = resolveCanonicalJid(session, g.id);
        if (!jid) continue;
        const existingContact = session.contacts.get(jid) || {};
        session.contacts.set(jid, { ...existingContact, name: g.subject });
        const chat = session.chats.get(jid);
        if (chat) {
          chat.name = g.subject;
          session.chats.set(jid, chat);
          broadcastToUserClients(session, 'whatsapp:chat_update', chat);
        }
      }
      schedulePersistStore(session);
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      const isLiveNotify = type === 'notify';
      for (const m of messages) {
        const result = upsertStoredMessage(session, m, { incrementUnread: isLiveNotify });
        if (result) {
          broadcastToUserClients(session, 'whatsapp:message', result);
        }
      }
    });

    sock.ev.on('messages.update', (updates) => {
      for (const upd of updates) {
        const jid = resolveCanonicalJid(session, upd.key.remoteJid || '');
        const msgId = upd.key.id;
        if (!jid || !msgId) continue;
        if (upd.update.status !== undefined && upd.update.status !== null) {
          const nextStatus = mapWAStatusToUi(upd.update.status, Boolean(upd.key.fromMe));
          const list = session.messages.get(jid);
          if (list) {
            const target = list.find((m) => m.id === msgId);
            if (target) {
              target.status = nextStatus;
              broadcastToUserClients(session, 'whatsapp:message_status', {
                jid,
                messageId: msgId,
                status: nextStatus,
              });
            }
          }
          const chat = session.chats.get(jid);
          if (chat && list && list[list.length - 1]?.id === msgId) {
            chat.lastMessageStatus = nextStatus;
            broadcastToUserClients(session, 'whatsapp:chat_update', chat);
          }
          schedulePersistStore(session);
        }
      }
    });

    sock.ev.on('message-receipt.update', (receipts) => {
      for (const rec of receipts) {
        const jid = resolveCanonicalJid(session, rec.key.remoteJid || '');
        const msgId = rec.key.id;
        if (!jid || !msgId) continue;
        const nextStatus: WAMsgStatus | null = rec.receipt.readTimestamp
          ? 'read'
          : rec.receipt.receiptTimestamp
            ? 'delivered'
            : null;
        if (!nextStatus) continue;
        const list = session.messages.get(jid);
        if (list) {
          const target = list.find((m) => m.id === msgId);
          if (target) {
            target.status = nextStatus;
            broadcastToUserClients(session, 'whatsapp:message_status', {
              jid,
              messageId: msgId,
              status: nextStatus,
            });
          }
        }
        const chat = session.chats.get(jid);
        if (chat && list && list[list.length - 1]?.id === msgId) {
          chat.lastMessageStatus = nextStatus;
          broadcastToUserClients(session, 'whatsapp:chat_update', chat);
        }
        schedulePersistStore(session);
      }
    });

    sock.ev.on('presence.update', ({ id, presences }) => {
      const jid = resolveCanonicalJid(session, id);
      if (!jid) return;
      const firstPresence = Object.values(presences || {})[0];
      const presenceVal = firstPresence?.lastKnownPresence;
      if (
        presenceVal === 'available' ||
        presenceVal === 'composing' ||
        presenceVal === 'recording' ||
        presenceVal === 'unavailable'
      ) {
        const chat = session.chats.get(jid);
        if (chat) {
          chat.presence = presenceVal;
          session.chats.set(jid, chat);
        }
        broadcastToUserClients(session, 'whatsapp:presence', {
          jid,
          presence: presenceVal,
        });
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          session.qrDataUrl = await QRCode.toDataURL(qr, {
            width: 280,
            margin: 2,
            color: {
              dark: '#0F172A',
              light: '#FFFFFF',
            },
          });
          session.status = 'qr';
          session.errorMessage = null;
          broadcastSessionState(session);
        } catch (err) {
          console.error('Error generating QR code:', err);
        }
      }

      if (connection === 'open') {
        const rawJid = sock.user?.id || '';
        const phone = rawJid.split(':')[0]?.split('@')[0] || null;
        session.status = 'connected';
        session.qrDataUrl = null;
        session.phoneNumber = phone ? `+${phone}` : null;
        session.displayName = sock.user?.name || 'WhatsApp vinculado';
        session.errorMessage = null;
        broadcastSessionState(session);
        broadcastToUserClients(session, 'whatsapp:chats_sync', getSortedChats(session));
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
          ?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        if (isLoggedOut) {
          session.sock = null;
          session.status = 'disconnected';
          session.qrDataUrl = null;
          session.phoneNumber = null;
          session.displayName = null;
          session.errorMessage = 'Sesión cerrada en WhatsApp.';
          session.chats.clear();
          session.messages.clear();
          session.contacts.clear();
          session.rawMessages.clear();
          if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          }
          broadcastSessionState(session);
          broadcastToUserClients(session, 'whatsapp:chats_sync', []);
        } else if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
          session.reconnectTimer = setTimeout(() => {
            void startWhatsAppSocket(safeId);
          }, 1200);
        } else if (hasSavedCredentials(safeId)) {
          session.sock = null;
          session.status = 'connecting';
          session.errorMessage = null;
          broadcastSessionState(session);
          session.reconnectTimer = setTimeout(() => {
            void startWhatsAppSocket(safeId);
          }, 3000);
        } else {
          session.sock = null;
          session.status = 'disconnected';
          session.qrDataUrl = null;
          session.errorMessage = 'Conexión cerrada. Pulsa Vincular para generar un nuevo código QR.';
          broadcastSessionState(session);
        }
      }
    });
  } catch (err) {
    session.status = 'error';
    session.errorMessage = err instanceof Error ? err.message : 'No se pudo iniciar la sesión de WhatsApp.';
    broadcastSessionState(session);
  }

  return session;
}

async function disconnectWhatsAppSocket(userId: string): Promise<UserWASession> {
  const safeId = sanitizeUserId(userId);
  const session = getOrCreateSession(safeId);

  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }

  if (session.persistTimer) {
    clearTimeout(session.persistTimer);
    session.persistTimer = null;
  }

  if (session.sock) {
    try {
      await session.sock.logout();
    } catch {
      try {
        session.sock.end(undefined);
      } catch {
        // ignore
      }
    }
    session.sock = null;
  }

  const sessionDir = path.join(SESSIONS_ROOT, safeId);
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }

  session.status = 'disconnected';
  session.qrDataUrl = null;
  session.phoneNumber = null;
  session.displayName = null;
  session.errorMessage = null;
  session.chats.clear();
  session.messages.clear();
  session.contacts.clear();
  session.lidToPn.clear();
  session.rawMessages.clear();
  session.avatarCache.clear();
  broadcastSessionState(session);
  broadcastToUserClients(session, 'whatsapp:chats_sync', []);
  return session;
}

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // --- WhatsApp API Routes ---
  app.get('/api/whatsapp/status', (req, res) => {
    const userId = String(req.query.userId || '');
    if (!userId) {
      res.status(400).json({ error: 'Falta userId.' });
      return;
    }
    ensureAutoResumeSession(userId);
    const session = getOrCreateSession(userId);
    res.json(serializeSessionState(session));
  });

  app.post('/api/whatsapp/connect', async (req, res) => {
    const { userId } = req.body as { userId?: string };
    if (!userId) {
      res.status(400).json({ error: 'Falta userId.' });
      return;
    }
    const session = await startWhatsAppSocket(userId);
    res.json(serializeSessionState(session));
  });

  app.post('/api/whatsapp/disconnect', async (req, res) => {
    const { userId } = req.body as { userId?: string };
    if (!userId) {
      res.status(400).json({ error: 'Falta userId.' });
      return;
    }
    const session = await disconnectWhatsAppSocket(userId);
    res.json(serializeSessionState(session));
  });

  app.get('/api/whatsapp/chats', (req, res) => {
    const userId = String(req.query.userId || '');
    if (!userId) {
      res.status(400).json({ error: 'Falta userId.' });
      return;
    }
    ensureAutoResumeSession(userId);
    const session = getOrCreateSession(userId);
    res.json({ chats: getSortedChats(session) });
  });

  app.get('/api/whatsapp/messages', (req, res) => {
    const userId = String(req.query.userId || '');
    const jid = String(req.query.jid || '');
    if (!userId || !jid) {
      res.status(400).json({ error: 'Faltan userId o jid.' });
      return;
    }
    const session = getOrCreateSession(userId);
    const canonical = resolveCanonicalJid(session, jid) || jid;
    res.json({ messages: session.messages.get(canonical) || [] });
  });

  app.post('/api/whatsapp/read', async (req, res) => {
    const { userId, jid } = req.body as { userId?: string; jid?: string };
    if (!userId || !jid) {
      res.status(400).json({ error: 'Faltan userId o jid.' });
      return;
    }
    const session = getOrCreateSession(userId);
    const canonical = resolveCanonicalJid(session, jid) || jid;
    const chat = session.chats.get(canonical);
    if (chat) {
      chat.unreadCount = 0;
      session.chats.set(canonical, chat);
      schedulePersistStore(session);
      broadcastToUserClients(session, 'whatsapp:chat_update', chat);
    }

    if (session.sock && session.status === 'connected') {
      try {
        const list = session.messages.get(canonical) || [];
        const keysToRead: WAMessageKey[] = list
          .filter((m) => !m.fromMe)
          .slice(-10)
          .map((m) => ({ remoteJid: canonical, id: m.id, fromMe: false }));
        if (keysToRead.length > 0) {
          await session.sock.readMessages(keysToRead);
        }
      } catch {
        // ignore non-fatal read receipt error
      }
    }

    res.json({ ok: true });
  });

  app.post('/api/whatsapp/presence', async (req, res) => {
    const { userId, jid, presence } = req.body as {
      userId?: string;
      jid?: string;
      presence?: 'composing' | 'recording' | 'paused';
    };
    if (!userId || !jid || !presence) {
      res.status(400).json({ error: 'Faltan parámetros.' });
      return;
    }
    const session = getOrCreateSession(userId);
    if (session.sock && session.status === 'connected') {
      try {
        await session.sock.sendPresenceUpdate(presence, jid);
      } catch {
        // ignore presence errors
      }
    }
    res.json({ ok: true });
  });

  app.get('/api/whatsapp/avatar', async (req, res) => {
    const userId = String(req.query.userId || '');
    const jid = String(req.query.jid || '');
    if (!userId || !jid) {
      res.status(400).json({ error: 'Faltan userId o jid.' });
      return;
    }
    const session = getOrCreateSession(userId);
    if (session.avatarCache.has(jid)) {
      res.json({ url: session.avatarCache.get(jid) });
      return;
    }
    if (!session.sock || session.status !== 'connected') {
      res.json({ url: null });
      return;
    }
    try {
      const url = await session.sock.profilePictureUrl(jid, 'preview');
      session.avatarCache.set(jid, url || null);
      res.json({ url: url || null });
    } catch {
      session.avatarCache.set(jid, null);
      res.json({ url: null });
    }
  });

  app.get('/api/whatsapp/media', async (req, res) => {
    const userId = String(req.query.userId || '');
    const jid = String(req.query.jid || '');
    const messageId = String(req.query.messageId || '');
    if (!userId || !jid || !messageId) {
      res.status(400).json({ error: 'Faltan parámetros.' });
      return;
    }
    const session = getOrCreateSession(userId);
    const rawMsg = session.rawMessages.get(`${jid}::${messageId}`);
    if (!rawMsg || !session.sock) {
      res.status(404).json({ error: 'Archivo multimedia no disponible en memoria de sesión.' });
      return;
    }
    try {
      const buffer = await downloadMediaMessage(
        rawMsg,
        'buffer',
        {},
        {
          logger,
          reuploadRequest: session.sock.updateMediaMessage,
        }
      );
      const list = session.messages.get(jid) || [];
      const meta = list.find((m) => m.id === messageId);
      res.setHeader('Content-Type', meta?.mediaMime || 'application/octet-stream');
      if (meta?.fileName) {
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${meta.fileName.replace(/["\r\n]/g, '')}"`
        );
      }
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch (err) {
      console.error('Error downloading WA media:', err);
      res.status(500).json({ error: 'No se pudo descargar el archivo de WhatsApp.' });
    }
  });

  app.post('/api/whatsapp/send', async (req, res) => {
    const {
      userId,
      jid: explicitJid,
      phone,
      message,
      quotedMessageId,
      mediaBase64,
      mediaMime,
      fileName,
      mediaType,
      ptt,
    } = req.body as {
      userId?: string;
      jid?: string;
      phone?: string;
      message?: string;
      quotedMessageId?: string;
      mediaBase64?: string;
      mediaMime?: string;
      fileName?: string;
      mediaType?: 'image' | 'document' | 'audio';
      ptt?: boolean;
    };

    if (!userId || (!explicitJid && !phone) || (!message?.trim() && !mediaBase64)) {
      res.status(400).json({ error: 'Faltan destinatario o contenido del mensaje.' });
      return;
    }

    const session = getOrCreateSession(userId);
    if (session.status !== 'connected' || !session.sock) {
      res.status(409).json({
        error: 'WhatsApp no está vinculado. Escanea el código QR para enviar mensajes.',
      });
      return;
    }

    let targetJid = explicitJid ? resolveCanonicalJid(session, explicitJid) : '';
    if (!targetJid && phone) {
      const digits = phone.replace(/[^\d]/g, '');
      if (digits.length < 7) {
        res.status(400).json({ error: 'Número de teléfono inválido para WhatsApp.' });
        return;
      }
      targetJid = `${digits}@s.whatsapp.net`;
    }

    try {
      const cleanText = (message || '').trim();
      const quotedRaw = quotedMessageId
        ? session.rawMessages.get(`${targetJid}::${quotedMessageId}`)
        : undefined;

      let content: AnyMessageContent;
      if (mediaBase64 && mediaType === 'image') {
        content = {
          image: Buffer.from(mediaBase64, 'base64'),
          caption: cleanText || undefined,
          mimetype: mediaMime || 'image/jpeg',
        };
      } else if (mediaBase64 && mediaType === 'audio') {
        content = {
          audio: Buffer.from(mediaBase64, 'base64'),
          mimetype: mediaMime || 'audio/ogg; codecs=opus',
          ptt: ptt ?? true,
        };
      } else if (mediaBase64 && mediaType === 'document') {
        content = {
          document: Buffer.from(mediaBase64, 'base64'),
          mimetype: mediaMime || 'application/octet-stream',
          fileName: fileName || 'archivo',
          caption: cleanText || undefined,
        };
      } else {
        content = { text: cleanText };
      }

      const sent = await session.sock.sendMessage(
        targetJid,
        content,
        quotedRaw ? { quoted: quotedRaw } : undefined
      );

      if (sent) {
        const stored = upsertStoredMessage(session, sent, { incrementUnread: false });
        if (stored) {
          broadcastToUserClients(session, 'whatsapp:message', stored);
          res.json({ ok: true, jid: targetJid, message: stored.message, chat: stored.chat });
          return;
        }
      }

      res.json({ ok: true, jid: targetJid });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error enviando mensaje por WhatsApp.';
      res.status(500).json({ error: msg });
    }
  });

  // --- Gemini AI Endpoints ---
  app.post('/api/ai/prioritize-tasks', async (req, res) => {
    try {
      const { tasks, events, todayDate } = req.body as {
        tasks?: Array<{
          id: string;
          title: string;
          notes: string;
          dueDate: string;
          estimatedMinutes: number;
          priority: string;
          quadrant: string;
        }>;
        events?: Array<{
          title: string;
          date: string;
          startTime: string;
          endTime: string;
          isImportant: boolean;
        }>;
        todayDate?: string;
      };

      if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        res.status(400).json({ error: 'No hay tareas pendientes para priorizar.' });
        return;
      }

      const ai = getGeminiClient();
      const prompt = `Hoy es ${todayDate || new Date().toISOString().slice(0, 10)}.
Eres Kairo, un asistente personal ejecutivo de productividad.
Analiza las siguientes tareas pendientes y la agenda de citas del usuario para priorizarlas usando la Matriz de Eisenhower y asignar un orden lógico de ejecución (orderIndex comenzando en 0).

Agenda de referencia:
${JSON.stringify(events || [], null, 2)}

Tareas pendientes:
${JSON.stringify(tasks, null, 2)}

Reglas:
- Devuelve exactamente un elemento por cada id de tarea recibida.
- "priority" debe ser uno de: "alta", "media", "baja".
- "quadrant" debe ser uno de: "hacer_ya", "planificar", "delegar", "eliminar".
- "orderIndex" debe ser un entero único secuencial (0, 1, 2...).
- "aiReason" debe ser una explicación ejecutiva breve en español (máximo 180 caracteres) explicando por qué ocupa ese lugar.`;

      const response = await generateContentWithFallback(
        ai,
        'gemini-4-hydrogen',
        'gemini-3.1-flash-lite',
        (model) => ({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  priority: { type: Type.STRING },
                  quadrant: { type: Type.STRING },
                  orderIndex: { type: Type.INTEGER },
                  aiReason: { type: Type.STRING },
                },
                required: ['id', 'priority', 'quadrant', 'orderIndex', 'aiReason'],
              },
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '[]').trim());
      res.json({ prioritized: parsed });
    } catch (err) {
      console.error('Error in /api/ai/prioritize-tasks:', err);
      const msg = extractReadableError(err, 'Error al priorizar tareas con Gemini.');
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/ai/organize-note', async (req, res) => {
    try {
      const { rawText, currentTitle } = req.body as { rawText?: string; currentTitle?: string };
      if (!rawText || !rawText.trim()) {
        res.status(400).json({ error: 'Escribe o dicta algún texto para organizar.' });
        return;
      }

      const ai = getGeminiClient();
      const prompt = `Eres Kairo, asistente ejecutivo.
Transforma la siguiente nota rápida sin editar en una nota estructurada, clara y accionable en español.
Título actual sugerido: "${currentTitle || ''}"

Texto original:
"""
${rawText}
"""

Reglas:
- "title": título claro y conciso (máximo 80 caracteres).
- "content": contenido organizado con puntos clave, decisiones y próximos pasos si aplica (texto limpio legible, sin HTML).
- "folder": clasifica exactamente en uno de: "general", "reuniones", "ideas", "pendientes".
- "tags": lista de 1 a 5 etiquetas cortas en minúsculas (máximo 20 caracteres cada una).`;

      const response = await generateContentWithFallback(
        ai,
        'gemini-4-hydrogen',
        'gemini-3.1-flash-lite',
        (model) => ({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                content: { type: Type.STRING },
                folder: { type: Type.STRING },
                tags: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['title', 'content', 'folder', 'tags'],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      console.error('Error in /api/ai/organize-note:', err);
      const msg = extractReadableError(err, 'Error al organizar la nota con Gemini.');
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/ai/smart-capture', async (req, res) => {
    try {
      const { text, todayDate, contacts } = req.body as {
        text?: string;
        todayDate?: string;
        contacts?: Array<{ name: string }>;
      };

      if (!text || !text.trim()) {
        res.status(400).json({ error: 'Ingresa un texto o comando para procesar.' });
        return;
      }

      const ai = getGeminiClient();
      const prompt = `Hoy es ${todayDate || new Date().toISOString().slice(0, 10)}.
Eres Kairo, asistente personal ejecutivo.
Analiza la entrada del usuario y clasifica la intención principal en exactamente uno de:
1) "event": Si menciona cita, reunión, llamada, hora o fecha agendada.
2) "task": Si menciona una acción o pendiente por hacer.
3) "note": Si es una idea, apunte o resumen para guardar.

Contactos conocidos del usuario: ${(contacts || []).map((c) => c.name).join(', ') || 'Ninguno'}

Entrada del usuario:
"""
${text}
"""

Reglas estrictas:
- Fechas en formato YYYY-MM-DD (si dice "mañana", suma 1 día a ${todayDate}).
- Horas en formato HH:MM 24h (si no hay endTime, suma 60 minutos a startTime; si es event sin hora, usa "09:00" y "10:00").
- Para "task": priority en ["alta","media","baja"], quadrant en ["hacer_ya","planificar","delegar","eliminar"], estimatedMinutes entero (ej. 30).
- Para "note": folder en ["general","reuniones","ideas","pendientes"], tags de 1 a 4 palabras cortas.`;

      const response = await generateContentWithFallback(
        ai,
        'gemini-4-hydrogen',
        'gemini-3.1-flash-lite',
        (model) => ({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                intent: { type: Type.STRING },
                event: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    date: { type: Type.STRING },
                    startTime: { type: Type.STRING },
                    endTime: { type: Type.STRING },
                    location: { type: Type.STRING },
                    isImportant: { type: Type.BOOLEAN },
                    contactName: { type: Type.STRING },
                    whatsappReminderEnabled: { type: Type.BOOLEAN },
                  },
                },
                task: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    notes: { type: Type.STRING },
                    dueDate: { type: Type.STRING },
                    priority: { type: Type.STRING },
                    quadrant: { type: Type.STRING },
                    estimatedMinutes: { type: Type.INTEGER },
                  },
                },
                note: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    content: { type: Type.STRING },
                    folder: { type: Type.STRING },
                    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                },
              },
              required: ['intent'],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      console.error('Error in /api/ai/smart-capture:', err);
      const msg = extractReadableError(err, 'Error procesando la captura inteligente.');
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/ai/assistant', async (req, res) => {
    try {
      const { contents, context, todayDate, currentTime } = req.body as {
        contents?: Content[];
        context?: Record<string, unknown>;
        todayDate?: string;
        currentTime?: string;
      };

      if (!contents || !Array.isArray(contents) || contents.length === 0) {
        res.status(400).json({ error: 'Falta el historial o mensaje de conversación.' });
        return;
      }

      const ai = getGeminiClient();
      const systemInstruction = buildAssistantSystemInstruction(
        context,
        todayDate,
        currentTime,
        false
      );
      const response = await generateContentWithFallback(
        ai,
        'gemini-4-hydrogen',
        'gemini-3.1-flash-lite',
        (model) => ({
          model,
          contents,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: ASSISTANT_TOOLS }],
          },
        })
      );

      const modelContent = response.candidates?.[0]?.content ?? null;
      const functionCalls = response.functionCalls ?? [];

      res.json({
        text: response.text ?? '',
        functionCalls,
        modelContent,
      });
    } catch (err) {
      console.error('Error in /api/ai/assistant:', err);
      res.status(500).json({ error: extractReadableError(err, 'Error en la asistente de IA.') });
    }
  });

  app.post('/api/ai/transcribe', async (req, res) => {
    try {
      const { audioBase64, mimeType } = req.body as {
        audioBase64?: string;
        mimeType?: string;
      };

      if (!audioBase64) {
        res.status(400).json({ error: 'No se recibió audio para transcribir.' });
        return;
      }

      const cleanMime = (mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
      const ai = getGeminiClient('v1beta');
      const audioPart = {
        inlineData: {
          mimeType: cleanMime,
          data: audioBase64,
        },
      };
      const promptPart = {
        text: 'Transcribe exactamente lo que dice la persona en este audio en español. Devuelve solo la transcripción limpia, sin comillas ni comentarios.',
      };

      let transcript = '';
      try {
        const response = await withGeminiRetry(
          () =>
            ai.models.generateContent({
              model: 'gemini-3.5-transcribe',
              contents: { parts: [audioPart, { text: 'Transcribe this audio in Spanish.' }] },
            }),
          3
        );
        transcript = (
          response.text ||
          response.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ||
          ''
        ).trim();
        if (!transcript) {
          console.warn('gemini-3.5-transcribe returned empty text, candidates:', JSON.stringify(response.candidates));
        }
      } catch (primaryErr) {
        console.warn('gemini-3.5-transcribe fallback to gemini-4-hydrogen:', primaryErr);
      }

      if (!transcript) {
        const fallbackResponse = await generateContentWithFallback(
          ai,
          'gemini-4-hydrogen',
          'gemini-3.1-flash-lite',
          (model) => ({
            model,
            contents: { parts: [audioPart, promptPart] },
          })
        );
        transcript = (fallbackResponse.text ?? '').trim();
      }

      res.json({ text: transcript });
    } catch (err) {
      console.error('Error in /api/ai/transcribe:', err);
      res.status(500).json({ error: extractReadableError(err, 'No se pudo transcribir el audio.') });
    }
  });

  app.post('/api/ai/tts', async (req, res) => {
    try {
      const { text, voiceName } = req.body as { text?: string; voiceName?: string };
      if (!text || !text.trim()) {
        res.status(400).json({ error: 'Falta texto para sintetizar voz.' });
        return;
      }

      const allowedVoices = ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir'];
      const chosenVoice = allowedVoices.includes(voiceName || '') ? voiceName! : 'Kore';

      const ai = getGeminiClient();
      const chunks = splitTextForTts(text, 1200);
      if (chunks.length === 0) {
        res.status(400).json({ error: 'Falta texto válido para sintetizar voz.' });
        return;
      }

      const audioChunks: string[] = [];
      for (const chunk of chunks) {
        const response = await withGeminiRetry(
          () =>
            ai.models.generateContent({
              model: 'gemini-3.8-flash-lite-tts',
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: chunk,
                      speechMetadata: {
                        style: 'Warm, clear, natural Spanish executive personal assistant',
                      },
                    },
                  ],
                },
              ],
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: chosenVoice },
                  },
                },
              },
            }),
          3
        );
        const chunkAudio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (chunkAudio) {
          audioChunks.push(chunkAudio);
        }
      }

      if (audioChunks.length === 0) {
        res.status(500).json({ error: 'Gemini no devolvió audio.' });
        return;
      }

      const mergedAudio = mergeWavBase64Chunks(audioChunks);
      res.json({ audioBase64: mergedAudio, mimeType: 'audio/wav' });
    } catch (err) {
      console.error('Error in /api/ai/tts:', err);
      res.status(500).json({ error: extractReadableError(err, 'Error generando voz.') });
    }
  });

  // --- Vite / Static Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const waWss = new WebSocketServer({ noServer: true });
  const liveWss = new WebSocketServer({ noServer: true });

  waWss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
    const userId = sanitizeUserId(url.searchParams.get('userId') || '');
    if (!userId) {
      ws.close(1008, 'Missing userId');
      return;
    }
    ensureAutoResumeSession(userId);
    const session = getOrCreateSession(userId);
    session.clients.add(ws);
    ws.send(
      JSON.stringify({
        type: 'whatsapp:state',
        data: serializeSessionState(session),
      })
    );
    ws.send(
      JSON.stringify({
        type: 'whatsapp:chats_sync',
        data: getSortedChats(session),
      })
    );

    ws.on('close', () => {
      session.clients.delete(ws);
    });
  });

  liveWss.on('connection', (clientWs) => {
    let liveSession: Awaited<ReturnType<ReturnType<typeof getGeminiClient>['live']['connect']>> | null =
      null;
    let closing = false;
    let reconnecting = false;
    let initParams: {
      voiceName?: string;
      context?: Record<string, unknown>;
      todayDate?: string;
      currentTime?: string;
    } | null = null;

    const sendJson = (payload: unknown) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const openLiveSession = async (isResume: boolean) => {
      if (closing || !initParams) return;
      const ai = getGeminiClient();
      const allowedVoices = ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir'];
      const chosenVoice = allowedVoices.includes(initParams.voiceName || '')
        ? initParams.voiceName!
        : 'Kore';

      const session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: chosenVoice },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: ASSISTANT_TOOLS }],
          systemInstruction: buildAssistantSystemInstruction(
            initParams.context,
            initParams.todayDate,
            initParams.currentTime,
            true
          ),
        },
        callbacks: {
          onopen: () => {
            reconnecting = false;
            sendJson({ type: 'ready', resumed: isResume });
          },
          onmessage: (message: LiveServerMessage) => {
            if (closing) return;
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              sendJson({
                type: 'input_transcript',
                text: content.inputTranscription.text,
              });
            }
            if (content?.outputTranscription?.text) {
              sendJson({
                type: 'output_transcript',
                text: content.outputTranscription.text,
              });
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                sendJson({ type: 'audio', data: part.inlineData.data });
              }
            }
            if (content?.interrupted) {
              sendJson({ type: 'interrupted' });
            }
            if (content?.turnComplete) {
              sendJson({ type: 'turn_complete' });
            }
            if (message.toolCall?.functionCalls && message.toolCall.functionCalls.length > 0) {
              sendJson({
                type: 'tool_call',
                calls: message.toolCall.functionCalls,
              });
            }
            if (message.goAway && !closing && !reconnecting) {
              reconnecting = true;
              try {
                liveSession?.close();
              } catch {
                // ignore
              }
              liveSession = null;
              void openLiveSession(true).catch((err) => {
                reconnecting = false;
                sendJson({
                  type: 'error',
                  message: extractReadableError(err, 'No se pudo renovar la sesión de voz en vivo.'),
                });
              });
            }
          },
          onerror: (err) => {
            if (closing || reconnecting) return;
            sendJson({
              type: 'error',
              message: extractReadableError(err, 'Error en la sesión de voz en vivo.'),
            });
          },
          onclose: () => {
            if (closing || reconnecting) return;
            reconnecting = true;
            liveSession = null;
            void openLiveSession(true).catch(() => {
              reconnecting = false;
              if (!closing) {
                sendJson({ type: 'closed' });
              }
            });
          },
        },
      });
      liveSession = session;
    };

    clientWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          voiceName?: string;
          context?: Record<string, unknown>;
          todayDate?: string;
          currentTime?: string;
          data?: string;
          text?: string;
          responses?: Array<{
            id?: string;
            name?: string;
            response: Record<string, unknown>;
          }>;
        };

        if (msg.type === 'init') {
          if (liveSession) return;
          initParams = {
            voiceName: msg.voiceName,
            context: msg.context,
            todayDate: msg.todayDate,
            currentTime: msg.currentTime,
          };
          await openLiveSession(false);
          return;
        }

        if (!liveSession) return;

        if (msg.type === 'audio' && msg.data) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && msg.text) {
          liveSession.sendRealtimeInput({ text: msg.text });
        } else if (msg.type === 'tool_response' && Array.isArray(msg.responses)) {
          liveSession.sendToolResponse({
            functionResponses: msg.responses,
          });
        }
      } catch (err) {
        sendJson({
          type: 'error',
          message: extractReadableError(err, 'Error procesando audio en vivo.'),
        });
      }
    });

    clientWs.on('close', () => {
      closing = true;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
      }
    });
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
    if (pathname === '/ws') {
      waWss.handleUpgrade(request, socket, head, (ws) => {
        waWss.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/live') {
      liveWss.handleUpgrade(request, socket, head, (ws) => {
        liveWss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Kairo server listening on http://0.0.0.0:${PORT}`);
  });
}

void bootstrap();
