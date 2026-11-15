import {
  addMinutesToTime,
  buildWhatsAppLink,
  getLocalDateStr,
  isValidPhone,
} from './utils';
import type {
  ActiveTab,
  AssistantActionLog,
  CalendarEvent,
  Contact,
  ContactCategory,
  DailyTask,
  NoteFolder,
  QuickNote,
  TaskPriority,
  TaskQuadrant,
  UserProfile,
  WhatsAppChatMessage,
  WhatsAppChatThread,
  WhatsAppState,
} from '../types';

export interface AssistantToolDeps {
  userId?: string;
  events: CalendarEvent[];
  tasks: DailyTask[];
  contacts: Contact[];
  notes: QuickNote[];
  profile: UserProfile | null;
  waState: WhatsAppState;
  waChats: WhatsAppChatThread[];
  waMessagesByJid?: Record<string, WhatsAppChatMessage[]>;
  onNavigate: (tab: ActiveTab) => void;
  onOpenWhatsAppChat?: (jid: string) => void;
  onCreateEvent: (input: {
    title: string;
    description: string;
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    isImportant: boolean;
    reminderMinutes: number;
    contactId: string;
    contactName: string;
    whatsappReminderEnabled: boolean;
  }) => Promise<void>;
  onCreateTask: (input: {
    title: string;
    notes: string;
    dueDate: string;
    priority: TaskPriority;
    quadrant: TaskQuadrant;
    estimatedMinutes: number;
  }) => Promise<void>;
  onCompleteTask: (taskId: string) => Promise<void>;
  onCreateNote: (input: {
    title: string;
    content: string;
    rawText: string;
    folder: NoteFolder;
    tags: string[];
    pinned: boolean;
    isOrganized: boolean;
  }) => Promise<void>;
  onCreateContact: (input: {
    name: string;
    phone: string;
    email: string;
    role: string;
    category: ContactCategory;
    notes: string;
  }) => Promise<void>;
  onSendWhatsApp: (
    phoneOrJid: string,
    message: string,
    options?: { jid?: string }
  ) => Promise<{ ok: boolean; error?: string; jid?: string }>;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function extractPhoneDigits(value: string): string {
  return value.replace(/[^\d]/g, '');
}

function phonesMatch(a: string, b: string): boolean {
  const da = extractPhoneDigits(a);
  const db = extractPhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 8 && db.length >= 8) {
    return da.endsWith(db.slice(-8)) || db.endsWith(da.slice(-8));
  }
  return false;
}

function resolveChatDisplayName(chat: WhatsAppChatThread, contacts: Contact[]): string {
  if (!chat.isGroup && chat.phone) {
    const matched = contacts.find((c) => phonesMatch(c.phone, chat.phone));
    if (matched) return matched.name;
  }
  return chat.name || chat.phone || chat.jid;
}

function formatChatTime(ts: number): string | null {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

function serializeChatForContext(chat: WhatsAppChatThread, contacts: Contact[]) {
  return {
    jid: chat.jid,
    name: resolveChatDisplayName(chat, contacts),
    phone: chat.phone || null,
    isGroup: chat.isGroup,
    unreadCount: chat.unreadCount || 0,
    lastMessageText: (chat.lastMessageText || '').slice(0, 180),
    lastMessageFromMe: Boolean(chat.lastMessageFromMe),
    lastMessageTime: formatChatTime(chat.lastMessageTimestamp),
  };
}

async function fetchLatestWhatsAppChats(deps: AssistantToolDeps): Promise<WhatsAppChatThread[]> {
  if (!deps.userId) return deps.waChats;
  try {
    const res = await fetch(`/api/whatsapp/chats?userId=${encodeURIComponent(deps.userId)}`);
    if (res.ok) {
      const data = (await res.json()) as { chats?: WhatsAppChatThread[] };
      if (Array.isArray(data.chats)) {
        return data.chats;
      }
    }
  } catch {
    // fallback to locally synced chats
  }
  return deps.waChats;
}

interface ResolvedWhatsAppTarget {
  jid: string;
  name: string;
  phone: string;
  isGroup: boolean;
}

function resolveWhatsAppTargetFromPool(
  chatsPool: WhatsAppChatThread[],
  contacts: Contact[],
  params: { jid?: string; chatName?: string; contactName?: string; phone?: string }
): ResolvedWhatsAppTarget | null {
  const rawJid = (params.jid || '').trim();
  const rawPhone = (params.phone || '').trim();
  const rawName = (params.chatName || params.contactName || '').trim();

  if (rawJid) {
    const byJid = chatsPool.find((c) => c.jid === rawJid);
    if (byJid) {
      return {
        jid: byJid.jid,
        name: resolveChatDisplayName(byJid, contacts),
        phone: byJid.phone || '',
        isGroup: byJid.isGroup,
      };
    }
    if (rawJid.includes('@')) {
      return {
        jid: rawJid,
        name: rawName || rawPhone || rawJid,
        phone: rawPhone,
        isGroup: rawJid.endsWith('@g.us'),
      };
    }
  }

  if (rawPhone) {
    const byPhone = chatsPool.find((c) => phonesMatch(c.phone || c.jid, rawPhone));
    if (byPhone) {
      return {
        jid: byPhone.jid,
        name: resolveChatDisplayName(byPhone, contacts),
        phone: byPhone.phone || rawPhone,
        isGroup: byPhone.isGroup,
      };
    }
    const contactByPhone = contacts.find((c) => phonesMatch(c.phone, rawPhone));
    const digits = extractPhoneDigits(rawPhone);
    if (digits.length >= 7) {
      return {
        jid: `${digits}@s.whatsapp.net`,
        name: contactByPhone?.name || rawPhone,
        phone: rawPhone,
        isGroup: false,
      };
    }
  }

  if (rawName) {
    const needle = normalizeSearchText(rawName);
    const exactChat = chatsPool.find((c) => {
      const display = normalizeSearchText(resolveChatDisplayName(c, contacts));
      const rawChatName = normalizeSearchText(c.name || '');
      return display === needle || rawChatName === needle;
    });
    if (exactChat) {
      return {
        jid: exactChat.jid,
        name: resolveChatDisplayName(exactChat, contacts),
        phone: exactChat.phone || '',
        isGroup: exactChat.isGroup,
      };
    }

    const partialChat = chatsPool.find((c) => {
      const display = normalizeSearchText(resolveChatDisplayName(c, contacts));
      const rawChatName = normalizeSearchText(c.name || '');
      return display.includes(needle) || rawChatName.includes(needle);
    });
    if (partialChat) {
      return {
        jid: partialChat.jid,
        name: resolveChatDisplayName(partialChat, contacts),
        phone: partialChat.phone || '',
        isGroup: partialChat.isGroup,
      };
    }

    const exactContact = contacts.find((c) => normalizeSearchText(c.name) === needle);
    const matchedContact =
      exactContact || contacts.find((c) => normalizeSearchText(c.name).includes(needle));
    if (matchedContact) {
      const existingByContactPhone = chatsPool.find((c) =>
        phonesMatch(c.phone || c.jid, matchedContact.phone)
      );
      if (existingByContactPhone) {
        return {
          jid: existingByContactPhone.jid,
          name: matchedContact.name,
          phone: matchedContact.phone,
          isGroup: existingByContactPhone.isGroup,
        };
      }
      const digits = extractPhoneDigits(matchedContact.phone);
      if (digits.length >= 7) {
        return {
          jid: `${digits}@s.whatsapp.net`,
          name: matchedContact.name,
          phone: matchedContact.phone,
          isGroup: false,
        };
      }
    }
  }

  return null;
}

export function buildWorkspaceContext(deps: AssistantToolDeps) {
  const today = getLocalDateStr();
  const whatsappUnreadTotal = deps.waChats.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  return {
    today,
    profile: {
      displayName: deps.profile?.displayName || 'Usuario',
      defaultReminderMinutes: deps.profile?.defaultReminderMinutes ?? 15,
      whatsappConnected: deps.waState.status === 'connected',
      whatsappStatus: deps.waState.status,
      whatsappPhone: deps.waState.phoneNumber || null,
      whatsappUnreadTotal,
    },
    events: deps.events.slice(0, 200).map((e) => ({
      id: e.id,
      title: e.title,
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      location: e.location,
      isImportant: e.isImportant,
      contactName: e.contactName,
      whatsappReminderEnabled: e.whatsappReminderEnabled,
    })),
    tasks: deps.tasks.slice(0, 200).map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate,
      priority: t.priority,
      quadrant: t.quadrant,
      estimatedMinutes: t.estimatedMinutes,
      completed: t.completed,
    })),
    contacts: deps.contacts.slice(0, 200).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      role: c.role,
      category: c.category,
    })),
    notes: deps.notes.slice(0, 50).map((n) => ({
      id: n.id,
      title: n.title,
      folder: n.folder,
      pinned: n.pinned,
      content: n.content.slice(0, 1500),
    })),
    whatsappChats: deps.waChats.slice(0, 150).map((c) => serializeChatForContext(c, deps.contacts)),
  };
}

export async function executeAssistantToolCall(
  call: { id?: string; name?: string; args?: Record<string, unknown> },
  deps: AssistantToolDeps
): Promise<{
  functionResponse: { id?: string; name: string; response: Record<string, unknown> };
  log: AssistantActionLog;
}> {
  const name = call.name || 'unknown';
  const args = call.args || {};
  const logId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  try {
    if (name === 'create_event') {
      const title = String(args.title || 'Cita').slice(0, 160);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date || ''))
        ? String(args.date)
        : getLocalDateStr();
      const startTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(args.startTime || ''))
        ? String(args.startTime)
        : '09:00';
      const rawEnd = String(args.endTime || '');
      const endTime =
        /^([01]\d|2[0-3]):[0-5]\d$/.test(rawEnd) && rawEnd > startTime
          ? rawEnd
          : addMinutesToTime(startTime, 60);

      const contactNameInput = String(args.contactName || '').trim();
      const matched = contactNameInput
        ? deps.contacts.find((c) =>
            normalizeSearchText(c.name).includes(normalizeSearchText(contactNameInput))
          )
        : undefined;

      await deps.onCreateEvent({
        title,
        description: String(args.description || '').slice(0, 1000),
        date,
        startTime,
        endTime,
        location: String(args.location || '').slice(0, 200),
        isImportant: Boolean(args.isImportant),
        reminderMinutes:
          typeof args.reminderMinutes === 'number'
            ? Math.min(1440, Math.max(0, Math.round(args.reminderMinutes)))
            : deps.profile?.defaultReminderMinutes ?? 15,
        contactId: matched?.id || '',
        contactName: matched?.name || contactNameInput.slice(0, 120),
        whatsappReminderEnabled: Boolean(args.whatsappReminderEnabled),
      });

      const summary = `Cita agendada: "${title}" (${date} ${startTime})`;
      return {
        functionResponse: {
          id: call.id,
          name,
          response: { ok: true, summary, date, startTime, endTime },
        },
        log: { id: logId, toolName: name, summary, ok: true },
      };
    }

    if (name === 'create_task') {
      const title = String(args.title || 'Tarea').slice(0, 200);
      const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(args.dueDate || ''))
        ? String(args.dueDate)
        : getLocalDateStr();
      const priority: TaskPriority = ['alta', 'media', 'baja'].includes(String(args.priority))
        ? (String(args.priority) as TaskPriority)
        : 'media';
      const quadrant: TaskQuadrant = [
        'hacer_ya',
        'planificar',
        'delegar',
        'eliminar',
      ].includes(String(args.quadrant))
        ? (String(args.quadrant) as TaskQuadrant)
        : 'planificar';
      const estimatedMinutes =
        typeof args.estimatedMinutes === 'number'
          ? Math.min(1440, Math.max(1, Math.round(args.estimatedMinutes)))
          : 30;

      await deps.onCreateTask({
        title,
        notes: String(args.notes || '').slice(0, 1000),
        dueDate,
        priority,
        quadrant,
        estimatedMinutes,
      });

      const summary = `Tarea creada: "${title}" (${priority})`;
      return {
        functionResponse: { id: call.id, name, response: { ok: true, summary } },
        log: { id: logId, toolName: name, summary, ok: true },
      };
    }

    if (name === 'complete_task') {
      const taskId = String(args.taskId || '');
      const found = deps.tasks.find((t) => t.id === taskId);
      if (!found) {
        return {
          functionResponse: {
            id: call.id,
            name,
            response: { ok: false, error: 'No se encontró esa tarea por ID.' },
          },
          log: { id: logId, toolName: name, summary: 'Tarea no encontrada', ok: false },
        };
      }
      await deps.onCompleteTask(found.id);
      const summary = `Tarea completada: "${found.title}"`;
      return {
        functionResponse: { id: call.id, name, response: { ok: true, summary } },
        log: { id: logId, toolName: name, summary, ok: true },
      };
    }

    if (name === 'create_note') {
      const title = String(args.title || 'Nota').slice(0, 160);
      const content = String(args.content || '').slice(0, 8000);
      const folder: NoteFolder = ['general', 'reuniones', 'ideas', 'pendientes'].includes(
        String(args.folder)
      )
        ? (String(args.folder) as NoteFolder)
        : 'general';
      const tags = Array.isArray(args.tags)
        ? args.tags.map((t) => String(t).slice(0, 40)).slice(0, 8)
        : [];

      await deps.onCreateNote({
        title,
        content,
        rawText: content.slice(0, 4000),
        folder,
        tags,
        pinned: Boolean(args.pinned),
        isOrganized: true,
      });

      const summary = `Nota guardada en ${folder}: "${title}"`;
      return {
        functionResponse: { id: call.id, name, response: { ok: true, summary } },
        log: { id: logId, toolName: name, summary, ok: true },
      };
    }

    if (name === 'create_contact') {
      const contactName = String(args.name || '').slice(0, 120);
      const phone = String(args.phone || '').slice(0, 24);
      if (!contactName || !isValidPhone(phone)) {
        return {
          functionResponse: {
            id: call.id,
            name,
            response: {
              ok: false,
              error: 'El contacto requiere nombre y teléfono válido con código de país.',
            },
          },
          log: {
            id: logId,
            toolName: name,
            summary: 'Datos de contacto incompletos o teléfono inválido',
            ok: false,
          },
        };
      }

      const category: ContactCategory = ['trabajo', 'cliente', 'personal', 'familia'].includes(
        String(args.category)
      )
        ? (String(args.category) as ContactCategory)
        : 'trabajo';

      await deps.onCreateContact({
        name: contactName,
        phone,
        email: String(args.email || '').slice(0, 254),
        role: String(args.role || '').slice(0, 120),
        category,
        notes: String(args.notes || '').slice(0, 1000),
      });

      const summary = `Contacto guardado: ${contactName} (${phone})`;
      return {
        functionResponse: { id: call.id, name, response: { ok: true, summary } },
        log: { id: logId, toolName: name, summary, ok: true },
      };
    }

    if (name === 'list_whatsapp_chats') {
      const onlyUnread = Boolean(args.onlyUnread);
      const search = normalizeSearchText(String(args.search || ''));
      const latestChats = await fetchLatestWhatsAppChats(deps);

      const filtered = latestChats.filter((c) => {
        if (onlyUnread && (c.unreadCount || 0) <= 0) return false;
        if (!search) return true;
        const display = normalizeSearchText(resolveChatDisplayName(c, deps.contacts));
        const raw = normalizeSearchText(c.name || '');
        const phone = normalizeSearchText(c.phone || '');
        const lastMsg = normalizeSearchText(c.lastMessageText || '');
        return (
          display.includes(search) ||
          raw.includes(search) ||
          phone.includes(search) ||
          lastMsg.includes(search)
        );
      });

      const chats = filtered.map((c) => serializeChatForContext(c, deps.contacts));
      const summary = `Chats de WhatsApp consultados (${chats.length})`;
      return {
        functionResponse: {
          id: call.id,
          name,
          response: {
            ok: true,
            whatsappStatus: deps.waState.status,
            totalMatches: filtered.length,
            chats,
          },
        },
        log: { id: logId, toolName: name, summary, ok: true },
      };
    }

    if (name === 'read_whatsapp_chat') {
      const jidArg = String(args.jid || '').trim();
      const chatNameArg = String(args.chatName || '').trim();
      const phoneArg = String(args.phone || '').trim();
      const limit =
        typeof args.limit === 'number' ? Math.min(250, Math.max(1, Math.round(args.limit))) : 25;

      let target = resolveWhatsAppTargetFromPool(deps.waChats, deps.contacts, {
        jid: jidArg,
        chatName: chatNameArg,
        phone: phoneArg,
      });

      if (!target || !deps.waChats.some((c) => c.jid === target?.jid)) {
        const latestChats = await fetchLatestWhatsAppChats(deps);
        const freshTarget = resolveWhatsAppTargetFromPool(latestChats, deps.contacts, {
          jid: jidArg,
          chatName: chatNameArg,
          phone: phoneArg,
        });
        if (freshTarget) target = freshTarget;
      }

      if (!target) {
        return {
          functionResponse: {
            id: call.id,
            name,
            response: {
              ok: false,
              error: 'No se encontró ese chat o grupo en WhatsApp.',
            },
          },
          log: {
            id: logId,
            toolName: name,
            summary: 'Chat de WhatsApp no encontrado',
            ok: false,
          },
        };
      }

      let messages: WhatsAppChatMessage[] = deps.waMessagesByJid?.[target.jid] || [];
      if (deps.userId) {
        try {
          const res = await fetch(
            `/api/whatsapp/messages?userId=${encodeURIComponent(deps.userId)}&jid=${encodeURIComponent(
              target.jid
            )}`
          );
          if (res.ok) {
            const data = (await res.json()) as { messages?: WhatsAppChatMessage[] };
            if (Array.isArray(data.messages)) {
              messages = data.messages;
            }
          }
        } catch {
          // fallback to cached messages
        }
      }

      const recent = messages.slice(-limit).map((m) => ({
        id: m.id,
        fromMe: m.fromMe,
        senderName: m.fromMe ? 'Tú' : m.senderName || target.name,
        text: m.text || m.caption || (m.hasMedia ? `[Archivo ${m.type}]` : ''),
        type: m.type,
        time: formatChatTime(m.timestamp),
      }));

      const summary = `Leídos ${recent.length} mensajes de ${target.name}`;
      return {
        functionResponse: {
          id: call.id,
          name,
          response: {
            ok: true,
            jid: target.jid,
            chatName: target.name,
            isGroup: target.isGroup,
            messagesCount: recent.length,
            messages: recent,
          },
        },
        log: { id: logId, toolName: name, summary, ok: true },
      };
    }

    if (name === 'send_whatsapp_message') {
      const jidArg = String(args.jid || '').trim();
      const chatNameArg = String(args.chatName || '').trim();
      const contactNameArg = String(args.contactName || '').trim();
      const phoneArg = String(args.phone || '').trim();
      const message = String(args.message || '').trim();

      if (!message) {
        return {
          functionResponse: {
            id: call.id,
            name,
            response: { ok: false, error: 'Falta el texto del mensaje a enviar.' },
          },
          log: {
            id: logId,
            toolName: name,
            summary: 'No se pudo enviar: mensaje vacío',
            ok: false,
          },
        };
      }

      let target = resolveWhatsAppTargetFromPool(deps.waChats, deps.contacts, {
        jid: jidArg,
        chatName: chatNameArg,
        contactName: contactNameArg,
        phone: phoneArg,
      });

      if (!target) {
        const latestChats = await fetchLatestWhatsAppChats(deps);
        target = resolveWhatsAppTargetFromPool(latestChats, deps.contacts, {
          jid: jidArg,
          chatName: chatNameArg,
          contactName: contactNameArg,
          phone: phoneArg,
        });
      }

      if (!target) {
        return {
          functionResponse: {
            id: call.id,
            name,
            response: {
              ok: false,
              error:
                'No encontré ese chat, grupo o contacto. Indica el nombre exacto del chat o un número con código de país.',
            },
          },
          log: {
            id: logId,
            toolName: name,
            summary: 'Destinatario de WhatsApp no encontrado',
            ok: false,
          },
        };
      }

      if (deps.waState.status === 'connected') {
        const res = await deps.onSendWhatsApp(target.jid, message, { jid: target.jid });
        if (res.ok) {
          const summary = `WhatsApp enviado a ${target.name}`;
          return {
            functionResponse: {
              id: call.id,
              name,
              response: { ok: true, jid: res.jid || target.jid, recipient: target.name, summary },
            },
            log: { id: logId, toolName: name, summary, ok: true },
          };
        }
        return {
          functionResponse: {
            id: call.id,
            name,
            response: { ok: false, error: res.error || 'Fallo al enviar WhatsApp.' },
          },
          log: { id: logId, toolName: name, summary: res.error || 'Error enviando WhatsApp', ok: false },
        };
      }

      if (target.isGroup || !isValidPhone(target.phone)) {
        return {
          functionResponse: {
            id: call.id,
            name,
            response: {
              ok: false,
              error:
                'WhatsApp no está vinculado. Escanea el código QR en la pestaña WhatsApp para enviar mensajes a tus chats o grupos.',
            },
          },
          log: {
            id: logId,
            toolName: name,
            summary: 'WhatsApp desconectado para enviar al chat',
            ok: false,
          },
        };
      }

      const url = buildWhatsAppLink(target.phone, message);
      window.open(url, '_blank', 'noopener,noreferrer');
      const summary = `Enlace de WhatsApp abierto para ${target.name}`;
      return {
        functionResponse: {
          id: call.id,
          name,
          response: { ok: true, mode: 'wa_me_fallback', recipient: target.name, summary },
        },
        log: { id: logId, toolName: name, summary, ok: true },
      };
    }

    if (name === 'open_whatsapp_chat') {
      const jidArg = String(args.jid || '').trim();
      const chatNameArg = String(args.chatName || '').trim();
      const phoneArg = String(args.phone || '').trim();

      let target = resolveWhatsAppTargetFromPool(deps.waChats, deps.contacts, {
        jid: jidArg,
        chatName: chatNameArg,
        phone: phoneArg,
      });

      if (!target) {
        const latestChats = await fetchLatestWhatsAppChats(deps);
        target = resolveWhatsAppTargetFromPool(latestChats, deps.contacts, {
          jid: jidArg,
          chatName: chatNameArg,
          phone: phoneArg,
        });
      }

      if (!target) {
        return {
          functionResponse: {
            id: call.id,
            name,
            response: { ok: false, error: 'No se encontró ese chat en WhatsApp.' },
          },
          log: { id: logId, toolName: name, summary: 'Chat de WhatsApp no encontrado', ok: false },
        };
      }

      if (deps.onOpenWhatsAppChat) {
        deps.onOpenWhatsAppChat(target.jid);
      } else {
        deps.onNavigate('whatsapp');
      }

      const summary = `Chat de WhatsApp abierto: ${target.name}`;
      return {
        functionResponse: {
          id: call.id,
          name,
          response: { ok: true, jid: target.jid, chatName: target.name, summary },
        },
        log: { id: logId, toolName: name, summary, ok: true },
      };
    }

    if (name === 'navigate_to') {
      const tab = String(args.tab || 'overview') as ActiveTab;
      const allowed: ActiveTab[] = [
        'overview',
        'assistant',
        'whatsapp',
        'calendar',
        'tasks',
        'contacts',
        'notes',
        'settings',
      ];
      if (allowed.includes(tab)) {
        deps.onNavigate(tab);
        const summary = `Vista cambiada a ${tab}`;
        return {
          functionResponse: { id: call.id, name, response: { ok: true, summary } },
          log: { id: logId, toolName: name, summary, ok: true },
        };
      }
    }

    return {
      functionResponse: { id: call.id, name, response: { ok: false, error: 'Herramienta desconocida' } },
      log: { id: logId, toolName: name, summary: `Acción no reconocida (${name})`, ok: false },
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Error ejecutando acción';
    return {
      functionResponse: { id: call.id, name, response: { ok: false, error: errMsg } },
      log: { id: logId, toolName: name, summary: errMsg, ok: false },
    };
  }
}
