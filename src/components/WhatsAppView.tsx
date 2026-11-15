import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  CheckCheck,
  Clock,
  Download,
  FileText,
  Loader2,
  LogOut,
  MessageCircle,
  MessageSquarePlus,
  Mic,
  Paperclip,
  QrCode,
  RefreshCw,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { SendWhatsAppOptions } from '../hooks/useWhatsApp';
import { isValidPhone } from '../lib/utils';
import type {
  Contact,
  ContactCategory,
  WhatsAppChatMessage,
  WhatsAppChatThread,
  WhatsAppMessageStatus,
  WhatsAppState,
} from '../types';

interface WhatsAppViewProps {
  userId: string;
  waState: WhatsAppState;
  waBusy: boolean;
  chats: WhatsAppChatThread[];
  messagesByJid: Record<string, WhatsAppChatMessage[]>;
  activeJid: string | null;
  loadingMessages: boolean;
  contacts: Contact[];
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onRefreshStatus: () => Promise<void>;
  onRefreshChats: () => Promise<void>;
  onSelectChat: (jid: string | null) => Promise<void>;
  onStartChatByPhone: (phone: string, displayName?: string) => Promise<string | null>;
  onSendMessage: (
    phoneOrJid: string,
    message: string,
    options?: SendWhatsAppOptions
  ) => Promise<{ ok: boolean; error?: string; jid?: string }>;
  onSendTyping: (jid: string, presence: 'composing' | 'recording' | 'paused') => Promise<void>;
  onSaveToContacts: (input: {
    name: string;
    phone: string;
    email: string;
    role: string;
    category: ContactCategory;
    notes: string;
  }) => Promise<void>;
  onScheduleWithPhone: (name: string, phone: string) => void;
}

const QUICK_EMOJIS = [
  '😀', '😊', '😂', '🙏', '👍', '❤️', '🔥', '✅',
  '📅', '⏰', '📌', '🎉', '💼', '👋', '🤝', '💡',
];

function normalizeDigits(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

function getInitials(name: string): string {
  const clean = name.replace(/^\+/, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return clean.slice(0, 2).toUpperCase() || 'WA';
}

function formatChatTime(epochMs: number): string {
  if (!epochMs) return '';
  const date = new Date(epochMs);
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === todayStr) {
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Ayer';
  }
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}

function formatMessageTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateDivider(epochMs: number): string {
  const date = new Date(epochMs);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) return 'Hoy';
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
  return date.toLocaleDateString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const str = String(reader.result || '');
      resolve(str.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const str = String(reader.result || '');
      resolve(str.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function MessageStatusTicks({ status }: { status?: WhatsAppMessageStatus }) {
  if (!status) return null;
  if (status === 'pending') {
    return <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400 shrink-0" />;
  }
  if (status === 'sent') {
    return <Check className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />;
  }
  if (status === 'delivered') {
    return <CheckCheck className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />;
  }
  if (status === 'read') {
    return <CheckCheck className="w-3.5 h-3.5 text-[#53BDEB] shrink-0" />;
  }
  return <span className="text-[10px] text-red-500 font-semibold">!</span>;
}

function WAAvatar({
  userId,
  jid,
  name,
  isGroup,
  connected,
  size = 'md',
}: {
  userId: string;
  jid: string;
  name: string;
  isGroup: boolean;
  connected: boolean;
  size?: 'sm' | 'md';
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setBroken(false);
    if (!connected || !jid) return;
    fetch(`/api/whatsapp/avatar?userId=${encodeURIComponent(userId)}&jid=${encodeURIComponent(jid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { url?: string | null } | null) => {
        if (active && data?.url) setUrl(data.url);
      })
      .catch(() => {
        // fallback cleanly
      });
    return () => {
      active = false;
    };
  }, [userId, jid, connected]);

  const dims = size === 'sm' ? 'w-10 h-10 text-xs' : 'w-11 h-11 text-sm';

  if (url && !broken) {
    return (
      <img
        src={url}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`${dims} rounded-full object-cover shrink-0 bg-slate-200 dark:bg-slate-800`}
      />
    );
  }

  return (
    <div
      className={`${dims} rounded-full shrink-0 flex items-center justify-center font-semibold ${
        isGroup
          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
          : 'bg-slate-200 dark:bg-[#2A3942] text-slate-700 dark:text-slate-200'
      }`}
    >
      {isGroup ? <Users className="w-4 h-4" /> : getInitials(name)}
    </div>
  );
}

function WAMediaPreview({
  userId,
  msg,
}: {
  userId: string;
  msg: WhatsAppChatMessage;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const mediaUrl = `/api/whatsapp/media?userId=${encodeURIComponent(userId)}&jid=${encodeURIComponent(msg.jid)}&messageId=${encodeURIComponent(msg.id)}`;

  if (msg.type === 'image' || msg.type === 'sticker') {
    return (
      <div className="mb-1.5">
        {!imgFailed ? (
          <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="block">
            <img
              src={mediaUrl}
              alt={msg.caption || 'Imagen de WhatsApp'}
              onError={() => setImgFailed(true)}
              className={`rounded-lg object-cover ${
                msg.type === 'sticker' ? 'max-w-[140px] max-h-[140px]' : 'max-w-[260px] max-h-[260px]'
              }`}
            />
          </a>
        ) : (
          <div className="px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 text-xs text-slate-500 dark:text-slate-300">
            Imagen adjunta (disponible al reconectar sesión)
          </div>
        )}
      </div>
    );
  }

  if (msg.type === 'audio') {
    return (
      <div className="mb-1">
        <audio controls preload="none" src={mediaUrl} className="max-w-[240px] h-9" />
      </div>
    );
  }

  if (msg.type === 'document') {
    return (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mb-1.5 flex items-center gap-2.5 px-3 py-2 rounded-lg bg-black/5 dark:bg-black/20 hover:bg-black/10 transition-colors"
      >
        <FileText className="w-5 h-5 text-[#00A884] shrink-0" />
        <span className="text-xs font-medium truncate max-w-[180px]">
          {msg.fileName || 'Documento'}
        </span>
        <Download className="w-4 h-4 text-slate-500 shrink-0 ml-auto" />
      </a>
    );
  }

  return null;
}

export function WhatsAppView({
  userId,
  waState,
  waBusy,
  chats,
  messagesByJid,
  activeJid,
  loadingMessages,
  contacts,
  onConnect,
  onDisconnect,
  onRefreshStatus,
  onRefreshChats,
  onSelectChat,
  onStartChatByPhone,
  onSendMessage,
  onSendTyping,
  onSaveToContacts,
  onScheduleWithPhone,
}: WhatsAppViewProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'groups'>('all');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<WhatsAppChatMessage | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('+');
  const [newChatSearch, setNewChatSearch] = useState('');
  const [newChatError, setNewChatError] = useState<string | null>(null);

  const [recordingPtt, setRecordingPtt] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [savedContactSuccess, setSavedContactSuccess] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const typingTimerRef = useRef<number | null>(null);

  const contactByPhoneDigits = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const c of contacts) {
      const d = normalizeDigits(c.phone);
      if (d) map.set(d, c);
    }
    return map;
  }, [contacts]);

  const enrichedChats = useMemo(() => {
    return chats.map((chat) => {
      const digits = normalizeDigits(chat.phone || chat.jid.split('@')[0] || '');
      const kairoContact = !chat.isGroup && digits ? contactByPhoneDigits.get(digits) : undefined;
      return {
        ...chat,
        kairoContact,
        displayName: kairoContact?.name || chat.name || chat.phone || chat.jid,
      };
    });
  }, [chats, contactByPhoneDigits]);

  const filteredChats = useMemo(() => {
    return enrichedChats.filter((c) => {
      if (filter === 'unread' && c.unreadCount === 0) return false;
      if (filter === 'groups' && !c.isGroup) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        c.displayName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.lastMessageText.toLowerCase().includes(q)
      );
    });
  }, [enrichedChats, filter, search]);

  const activeChat = useMemo(
    () => enrichedChats.find((c) => c.jid === activeJid) || null,
    [enrichedChats, activeJid]
  );

  const activeMessages = useMemo(() => {
    if (!activeJid) return [];
    const list = messagesByJid[activeJid] || [];
    if (!chatSearchQuery.trim()) return list;
    const q = chatSearchQuery.toLowerCase();
    return list.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        (m.caption && m.caption.toLowerCase().includes(q)) ||
        (m.fileName && m.fileName.toLowerCase().includes(q))
    );
  }, [activeJid, messagesByJid, chatSearchQuery]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeJid, activeMessages.length]);

  useEffect(() => {
    setReplyingTo(null);
    setSendError(null);
    setSavedContactSuccess(false);
    setChatSearchOpen(false);
    setChatSearchQuery('');
  }, [activeJid]);

  const handleDraftChange = (val: string) => {
    setDraft(val);
    if (!activeJid || waState.status !== 'connected') return;
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    void onSendTyping(activeJid, val.trim() ? 'composing' : 'paused');
    if (val.trim()) {
      typingTimerRef.current = window.setTimeout(() => {
        if (activeJid) void onSendTyping(activeJid, 'paused');
      }, 2500);
    }
  };

  const handleSendText = async () => {
    if (!activeJid || !draft.trim() || sending) return;
    const text = draft.trim();
    setSending(true);
    setSendError(null);
    setDraft('');
    setShowEmojiPicker(false);
    const replyId = replyingTo?.id;
    setReplyingTo(null);

    try {
      const res = await onSendMessage(activeJid, text, {
        jid: activeJid,
        quotedMessageId: replyId,
      });
      if (!res.ok) {
        setSendError(res.error || 'No se pudo enviar el mensaje.');
        setDraft(text);
      }
      void onSendTyping(activeJid, 'paused');
    } finally {
      setSending(false);
    }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeJid) return;

    if (file.size > 15 * 1024 * 1024) {
      setSendError('El archivo supera el límite de 15 MB.');
      return;
    }

    setSending(true);
    setSendError(null);
    try {
      const mediaBase64 = await fileToBase64(file);
      const mime = file.type || 'application/octet-stream';
      const mediaType: 'image' | 'audio' | 'document' = mime.startsWith('image/')
        ? 'image'
        : mime.startsWith('audio/')
          ? 'audio'
          : 'document';

      const res = await onSendMessage(activeJid, draft.trim(), {
        jid: activeJid,
        mediaBase64,
        mediaMime: mime,
        fileName: file.name,
        mediaType,
        ptt: false,
      });
      if (res.ok) {
        setDraft('');
      } else {
        setSendError(res.error || 'No se pudo enviar el archivo.');
      }
    } finally {
      setSending(false);
    }
  };

  const toggleVoiceNote = async () => {
    if (!activeJid) return;
    if (recordingPtt) {
      mediaRecorderRef.current?.stop();
      setRecordingPtt(false);
      void onSendTyping(activeJid, 'paused');
      return;
    }

    setSendError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const chosenMime = candidates.find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);
      const effectiveMime = recorder.mimeType || chosenMime || 'audio/webm';
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: effectiveMime });
        if (blob.size < 400) return;

        setSending(true);
        try {
          const mediaBase64 = await blobToBase64(blob);
          const res = await onSendMessage(activeJid, '', {
            jid: activeJid,
            mediaBase64,
            mediaMime: effectiveMime,
            mediaType: 'audio',
            ptt: true,
          });
          if (!res.ok) {
            setSendError(res.error || 'No se pudo enviar la nota de voz.');
          }
        } finally {
          setSending(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingPtt(true);
      void onSendTyping(activeJid, 'recording');
    } catch {
      setSendError('Permite el acceso al micrófono para enviar notas de voz por WhatsApp.');
    }
  };

  const handleOpenNewChatByPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidPhone(newChatPhone)) {
      setNewChatError('Ingresa un teléfono válido con código de país (ej. +502 5555 1234).');
      return;
    }
    setNewChatError(null);
    const jid = await onStartChatByPhone(newChatPhone);
    if (jid) {
      setNewChatOpen(false);
      setNewChatPhone('+');
      setNewChatSearch('');
    }
  };

  const handleSaveCurrentContact = async () => {
    if (!activeChat || activeChat.isGroup || !activeChat.phone || savingContact) return;
    setSavingContact(true);
    try {
      await onSaveToContacts({
        name: activeChat.displayName || activeChat.phone,
        phone: activeChat.phone,
        email: '',
        role: '',
        category: 'personal',
        notes: 'Guardado desde WhatsApp en Kairo',
      });
      setSavedContactSuccess(true);
    } finally {
      setSavingContact(false);
    }
  };

  const filteredDirectoryContacts = useMemo(() => {
    if (!newChatSearch.trim()) return contacts;
    const q = newChatSearch.toLowerCase();
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q)
    );
  }, [contacts, newChatSearch]);

  const showConversationOnMobile = Boolean(activeJid) || waState.status !== 'connected';

  return (
    <div className="h-[calc(100vh-8.5rem)] min-h-[560px] bg-white dark:bg-[#111B21] border border-slate-200 dark:border-[#222D34] rounded-xl overflow-hidden flex shadow-sm">
      {/* Left Pane: Chats List */}
      <aside
        className={`${
          showConversationOnMobile ? 'hidden md:flex' : 'flex'
        } w-full md:w-[350px] lg:w-[380px] shrink-0 flex-col border-r border-slate-200 dark:border-[#222D34] bg-white dark:bg-[#111B21]`}
      >
        {/* Top WhatsApp Header */}
        <div className="h-14 px-4 bg-[#F0F2F5] dark:bg-[#202C33] border-b border-slate-200 dark:border-[#222D34] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#00A884] text-white flex items-center justify-center text-xs font-semibold shrink-0">
              {waState.displayName ? getInitials(waState.displayName) : 'WA'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                {waState.status === 'connected' ? waState.displayName || 'WhatsApp' : 'WhatsApp'}
              </p>
              <p className="text-[11px] text-[#667781] dark:text-[#8696A0] truncate font-mono tabular-nums">
                {waState.status === 'connected'
                  ? waState.phoneNumber || 'Conectado'
                  : waState.status === 'qr'
                    ? 'Esperando escaneo QR'
                    : waState.status === 'connecting'
                      ? 'Conectando...'
                      : 'Sin vincular'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {waState.status === 'connected' && (
              <button
                type="button"
                onClick={() => {
                  setNewChatOpen(true);
                  setNewChatError(null);
                }}
                title="Nuevo chat"
                className="p-2 rounded-full text-[#54656F] dark:text-[#AEBAC1] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void onRefreshStatus();
                void onRefreshChats();
              }}
              title="Actualizar chats"
              className="p-2 rounded-full text-[#54656F] dark:text-[#AEBAC1] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {waState.status === 'connected' ? (
              <button
                type="button"
                disabled={waBusy}
                onClick={() => void onDisconnect()}
                title="Desvincular sesión"
                className="p-2 rounded-full text-[#54656F] dark:text-[#AEBAC1] hover:text-red-600 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={waBusy}
                onClick={() => void onConnect()}
                title="Generar código QR"
                className="p-2 rounded-full text-[#008069] dark:text-[#00A884] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                <QrCode className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Search & Filter Tabs */}
        <div className="px-3 py-2.5 border-b border-slate-100 dark:border-[#222D34] space-y-2 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-[#667781] dark:text-[#8696A0] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar un chat o número..."
              className="w-full h-9 pl-9 pr-8 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33] text-xs text-[#111B21] dark:text-[#E9EDEF] placeholder-[#667781] dark:placeholder-[#8696A0] focus:outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#667781]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {(
              [
                ['all', 'Todos'],
                ['unread', 'No leídos'],
                ['groups', 'Grupos'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                  filter === key
                    ? 'bg-[#E7FCE3] dark:bg-[#0A332C] text-[#008069] dark:text-[#00A884]'
                    : 'bg-[#F0F2F5] dark:bg-[#202C33] text-[#54656F] dark:text-[#8696A0] hover:bg-slate-200 dark:hover:bg-[#2A3942]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Thread List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-[#222D34]">
          {filteredChats.length === 0 ? (
            <div className="px-6 py-12 text-center space-y-2">
              <MessageCircle className="w-7 h-7 mx-auto text-[#8696A0]" />
              <p className="text-xs text-[#667781] dark:text-[#8696A0]">
                {waState.status !== 'connected'
                  ? 'Vincula tu WhatsApp con el código QR para ver y responder tus chats.'
                  : chats.length === 0
                    ? 'Los chats aparecerán aquí automáticamente conforme sincronice WhatsApp o envíes un mensaje.'
                    : 'No hay chats que coincidan con el filtro.'}
              </p>
              {waState.status === 'connected' && (
                <button
                  type="button"
                  onClick={() => setNewChatOpen(true)}
                  className="text-xs font-medium text-[#008069] dark:text-[#00A884] hover:underline cursor-pointer"
                >
                  Iniciar nuevo chat
                </button>
              )}
            </div>
          ) : (
            filteredChats.map((chat) => {
              const isActive = activeJid === chat.jid;
              const presenceLabel =
                chat.presence === 'composing'
                  ? 'escribiendo...'
                  : chat.presence === 'recording'
                    ? 'grabando audio...'
                    : null;

              return (
                <button
                  key={chat.jid}
                  type="button"
                  onClick={() => void onSelectChat(chat.jid)}
                  className={`w-full px-3.5 py-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#F0F2F5] dark:bg-[#2A3942]'
                      : 'hover:bg-[#F5F6F6] dark:hover:bg-[#202C33]'
                  }`}
                >
                  <WAAvatar
                    userId={userId}
                    jid={chat.jid}
                    name={chat.displayName}
                    isGroup={chat.isGroup}
                    connected={waState.status === 'connected'}
                  />

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] truncate">
                        {chat.displayName}
                      </span>
                      <span
                        className={`text-[11px] font-mono tabular-nums shrink-0 ${
                          chat.unreadCount > 0
                            ? 'text-[#00A884] font-semibold'
                            : 'text-[#667781] dark:text-[#8696A0]'
                        }`}
                      >
                        {formatChatTime(chat.lastMessageTimestamp)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0">
                        {!presenceLabel && chat.lastMessageFromMe && (
                          <MessageStatusTicks status={chat.lastMessageStatus} />
                        )}
                        <span
                          className={`text-xs truncate ${
                            presenceLabel
                              ? 'text-[#00A884] font-medium'
                              : 'text-[#667781] dark:text-[#8696A0]'
                          }`}
                        >
                          {presenceLabel || chat.lastMessageText || chat.phone || 'Conversación'}
                        </span>
                      </div>

                      {chat.unreadCount > 0 && (
                        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#25D366] text-white text-[11px] font-semibold inline-flex items-center justify-center font-mono tabular-nums shrink-0">
                          {chat.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Pane: Conversation / QR Linking */}
      <section
        className={`${
          showConversationOnMobile ? 'flex' : 'hidden md:flex'
        } flex-1 min-w-0 flex-col bg-[#EFEAE2] dark:bg-[#0B141A] relative`}
      >
        {!activeChat ? (
          waState.status !== 'connected' ? (
            /* Authentic WhatsApp Web QR Linking Panel */
            <div className="flex-1 overflow-y-auto bg-[#F0F2F5] dark:bg-[#111B21] flex items-center justify-center p-6">
              <div className="w-full max-w-2xl bg-white dark:bg-[#202C33] border border-slate-200 dark:border-[#2A3942] rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-8">
                <div className="flex-1 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-[#00A884] text-white flex items-center justify-center shrink-0">
                      <MessageCircle className="w-5 h-5" />
                    </div>
                    <h2 className="font-display text-lg font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                      Usa WhatsApp en Kairo
                    </h2>
                  </div>

                  <ol className="space-y-2.5 text-sm text-[#3B4A54] dark:text-[#D1D7DB] list-decimal list-inside">
                    <li>Abre WhatsApp en tu teléfono.</li>
                    <li>
                      Toca <strong>Menú</strong> o <strong>Ajustes</strong> y selecciona{' '}
                      <strong>Dispositivos vinculados</strong>.
                    </li>
                    <li>
                      Toca <strong>Vincular un dispositivo</strong> y escanea este código QR.
                    </li>
                  </ol>

                  {waState.errorMessage && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {waState.errorMessage}
                    </p>
                  )}

                  <div className="pt-1 flex items-center gap-2.5">
                    <button
                      type="button"
                      disabled={waBusy}
                      onClick={() => void onConnect()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#008069] hover:bg-[#006D59] disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap cursor-pointer"
                    >
                      {waBusy || waState.status === 'connecting' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <QrCode className="w-4 h-4" />
                      )}
                      {waState.status === 'qr' ? 'Generar nuevo QR' : 'Vincular WhatsApp'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRefreshStatus()}
                      className="px-3 py-2 rounded-lg border border-slate-200 dark:border-[#2A3942] text-xs font-medium text-[#3B4A54] dark:text-[#D1D7DB] hover:bg-slate-50 dark:hover:bg-[#2A3942] cursor-pointer"
                    >
                      Actualizar
                    </button>
                  </div>
                </div>

                <div className="shrink-0">
                  {waState.status === 'qr' && waState.qrDataUrl ? (
                    <img
                      src={waState.qrDataUrl}
                      alt="Código QR de WhatsApp"
                      className="w-52 h-52 rounded-xl bg-white p-2.5 border border-slate-200"
                    />
                  ) : (
                    <div className="w-52 h-52 rounded-xl bg-[#F0F2F5] dark:bg-[#111B21] border border-dashed border-slate-300 dark:border-[#2A3942] flex flex-col items-center justify-center p-4 text-center gap-2">
                      {waState.status === 'connecting' ? (
                        <>
                          <Loader2 className="w-7 h-7 animate-spin text-[#00A884]" />
                          <span className="text-xs text-[#667781] dark:text-[#8696A0]">
                            Generando código QR...
                          </span>
                        </>
                      ) : (
                        <>
                          <QrCode className="w-8 h-8 text-[#8696A0]" />
                          <span className="text-xs text-[#667781] dark:text-[#8696A0]">
                            Pulsa Vincular WhatsApp para mostrar el QR
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Connected Empty State */
            <div className="flex-1 bg-[#F0F2F5] dark:bg-[#222E35] flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-[#00A884]/15 text-[#008069] dark:text-[#00A884] flex items-center justify-center">
                <MessageCircle className="w-8 h-8" />
              </div>
              <div className="space-y-1.5 max-w-md">
                <h2 className="font-display text-xl font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                  WhatsApp en Kairo
                </h2>
                <p className="text-sm text-[#54656F] dark:text-[#8696A0]">
                  Selecciona una conversación a la izquierda o inicia un nuevo chat para enviar y recibir mensajes en tiempo real.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewChatOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#008069] hover:bg-[#006D59] text-white text-sm font-medium cursor-pointer"
              >
                <MessageSquarePlus className="w-4 h-4" />
                Nuevo chat
              </button>
            </div>
          )
        ) : (
          /* Active Chat Conversation */
          <>
            {/* Conversation Header */}
            <header className="h-14 px-4 bg-[#F0F2F5] dark:bg-[#202C33] border-b border-slate-200 dark:border-[#222D34] flex items-center justify-between gap-3 shrink-0 z-10">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => void onSelectChat(null)}
                  className="md:hidden p-1.5 -ml-1.5 rounded-full text-[#54656F] dark:text-[#AEBAC1] hover:bg-black/5 cursor-pointer"
                  aria-label="Volver a chats"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <WAAvatar
                  userId={userId}
                  jid={activeChat.jid}
                  name={activeChat.displayName}
                  isGroup={activeChat.isGroup}
                  connected={waState.status === 'connected'}
                  size="sm"
                />

                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                    {activeChat.displayName}
                  </h3>
                  <p className="text-[11px] truncate">
                    {activeChat.presence === 'composing' ? (
                      <span className="text-[#00A884] font-medium">escribiendo...</span>
                    ) : activeChat.presence === 'recording' ? (
                      <span className="text-[#00A884] font-medium">grabando audio...</span>
                    ) : activeChat.presence === 'available' ? (
                      <span className="text-[#008069] dark:text-[#00A884]">en línea</span>
                    ) : (
                      <span className="text-[#667781] dark:text-[#8696A0] font-mono tabular-nums">
                        {activeChat.isGroup ? 'Grupo de WhatsApp' : activeChat.phone || activeChat.jid}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setChatSearchOpen((v) => !v);
                    setChatSearchQuery('');
                  }}
                  title="Buscar en este chat"
                  className="p-2 rounded-full text-[#54656F] dark:text-[#AEBAC1] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                >
                  <Search className="w-4 h-4" />
                </button>

                {!activeChat.isGroup && !activeChat.kairoContact && activeChat.phone && (
                  <button
                    type="button"
                    disabled={savingContact || savedContactSuccess}
                    onClick={() => void handleSaveCurrentContact()}
                    title="Guardar en Contactos de Kairo"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2A3942] border border-slate-200 dark:border-[#374248] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-[#008069] dark:text-[#00A884]" />
                    <span className="hidden sm:inline">
                      {savedContactSuccess ? 'Guardado' : 'Guardar contacto'}
                    </span>
                  </button>
                )}

                {!activeChat.isGroup && activeChat.phone && (
                  <button
                    type="button"
                    onClick={() =>
                      onScheduleWithPhone(activeChat.displayName, activeChat.phone)
                    }
                    title="Agendar cita en calendario"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#2A3942] border border-slate-200 dark:border-[#374248] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                  >
                    <CalendarPlus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span className="hidden lg:inline">Agendar</span>
                  </button>
                )}
              </div>
            </header>

            {chatSearchOpen && (
              <div className="px-4 py-2 bg-white dark:bg-[#111B21] border-b border-slate-200 dark:border-[#222D34] flex items-center gap-2 shrink-0">
                <Search className="w-4 h-4 text-[#667781]" />
                <input
                  type="text"
                  autoFocus
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder="Buscar mensajes en esta conversación..."
                  className="flex-1 text-xs bg-transparent text-[#111B21] dark:text-[#E9EDEF] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setChatSearchOpen(false);
                    setChatSearchQuery('');
                  }}
                  className="text-xs text-[#667781] hover:text-[#111B21]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Messages Canvas with subtle WhatsApp wallpaper */}
            <div
              className="flex-1 overflow-y-auto px-4 sm:px-8 py-4 space-y-1.5"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 25px 25px, rgba(120, 130, 140, 0.08) 1.5px, transparent 0)',
                backgroundSize: '36px 36px',
              }}
            >
              {loadingMessages ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#00A884]" />
                </div>
              ) : activeMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="px-4 py-2 rounded-lg bg-white/90 dark:bg-[#182229] text-xs text-[#54656F] dark:text-[#8696A0] shadow-sm">
                    {chatSearchQuery
                      ? 'No se encontraron mensajes con esa búsqueda.'
                      : 'Envía el primer mensaje para iniciar esta conversación.'}
                  </div>
                </div>
              ) : (
                activeMessages.map((msg, idx) => {
                  const prevMsg = idx > 0 ? activeMessages[idx - 1] : null;
                  const showDateDivider =
                    !prevMsg ||
                    new Date(prevMsg.timestamp).toDateString() !==
                      new Date(msg.timestamp).toDateString();

                  return (
                    <div key={msg.id} className="space-y-1.5">
                      {showDateDivider && (
                        <div className="flex justify-center py-2">
                          <span className="px-3 py-1 rounded-lg bg-white/90 dark:bg-[#182229] text-[11px] font-medium text-[#54656F] dark:text-[#8696A0] shadow-xs">
                            {formatDateDivider(msg.timestamp)}
                          </span>
                        </div>
                      )}

                      <div
                        className={`group flex ${
                          msg.fromMe ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <div
                          className={`relative max-w-[85%] sm:max-w-[68%] rounded-lg px-3 py-1.5 shadow-xs ${
                            msg.fromMe
                              ? 'bg-[#D9FDD3] dark:bg-[#005C4B] text-[#111B21] dark:text-[#E9EDEF] rounded-tr-none'
                              : 'bg-white dark:bg-[#202C33] text-[#111B21] dark:text-[#E9EDEF] rounded-tl-none'
                          }`}
                        >
                          {/* Reply action button on hover */}
                          <button
                            type="button"
                            onClick={() => setReplyingTo(msg)}
                            title="Responder"
                            className={`opacity-0 group-hover:opacity-100 transition-opacity absolute top-1 ${
                              msg.fromMe ? '-left-8' : '-right-8'
                            } p-1.5 rounded-full bg-white/90 dark:bg-[#202C33] text-[#54656F] dark:text-[#AEBAC1] shadow-xs cursor-pointer`}
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>

                          {!msg.fromMe && activeChat.isGroup && (
                            <p className="text-[11px] font-semibold text-[#008069] dark:text-[#00A884] mb-0.5">
                              {msg.senderName}
                            </p>
                          )}

                          {msg.quoted && (
                            <div className="mb-1.5 rounded-md bg-black/5 dark:bg-black/25 px-2.5 py-1.5 flex gap-2">
                              <span className="w-[3px] rounded-full bg-[#00A884] shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold text-[#008069] dark:text-[#00A884] truncate">
                                  {msg.quoted.senderName}
                                </p>
                                <p className="text-xs text-[#54656F] dark:text-[#AEBAC1] truncate">
                                  {msg.quoted.text}
                                </p>
                              </div>
                            </div>
                          )}

                          {msg.hasMedia && <WAMediaPreview userId={userId} msg={msg} />}

                          <div className="flex items-end gap-2 flex-wrap">
                            {(msg.text && msg.type !== 'audio') || msg.caption ? (
                              <p className="text-[14px] leading-[1.35] whitespace-pre-wrap break-words">
                                {msg.caption || msg.text}
                              </p>
                            ) : null}

                            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#667781] dark:text-[#8696A0] font-mono tabular-nums shrink-0 pt-0.5">
                              {formatMessageTime(msg.timestamp)}
                              {msg.fromMe && <MessageStatusTicks status={msg.status} />}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {sendError && (
              <div className="px-4 py-2 bg-red-50 dark:bg-red-950/60 border-t border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
                <span>{sendError}</span>
                <button type="button" onClick={() => setSendError(null)}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {replyingTo && (
              <div className="px-4 py-2 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-slate-200 dark:border-[#222D34] flex items-center justify-between gap-3">
                <div className="flex items-stretch gap-2.5 min-w-0 flex-1 bg-white dark:bg-[#111B21] rounded-lg px-3 py-1.5">
                  <span className="w-[3px] rounded-full bg-[#00A884] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#008069] dark:text-[#00A884] truncate">
                      {replyingTo.fromMe ? 'Tú' : replyingTo.senderName}
                    </p>
                    <p className="text-xs text-[#54656F] dark:text-[#8696A0] truncate">
                      {replyingTo.caption || replyingTo.text || replyingTo.fileName || 'Mensaje'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  className="p-1.5 rounded-full text-[#54656F] hover:bg-black/5 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Emoji Quick Popover */}
            {showEmojiPicker && (
              <div className="px-4 py-2.5 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-slate-200 dark:border-[#222D34] flex flex-wrap gap-1.5">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setDraft((prev) => prev + emoji)}
                    className="w-8 h-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-lg flex items-center justify-center cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {/* WhatsApp Composer Bar */}
            <div className="px-3 py-2.5 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-slate-200 dark:border-[#222D34] flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowEmojiPicker((v) => !v)}
                title="Emojis"
                className="p-2 rounded-full text-[#54656F] dark:text-[#AEBAC1] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer shrink-0"
              >
                <Smile className="w-5 h-5" />
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                onChange={(e) => void handleFilePick(e)}
                className="hidden"
              />
              <button
                type="button"
                disabled={sending || waState.status !== 'connected'}
                onClick={() => fileInputRef.current?.click()}
                title="Adjuntar imagen, audio o documento"
                className="p-2 rounded-full text-[#54656F] dark:text-[#AEBAC1] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 cursor-pointer shrink-0"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              <textarea
                rows={1}
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendText();
                  }
                }}
                placeholder={
                  waState.status === 'connected'
                    ? 'Escribe un mensaje'
                    : 'Vincula WhatsApp para enviar mensajes...'
                }
                disabled={waState.status !== 'connected' || recordingPtt}
                className="flex-1 max-h-28 px-3.5 py-2.5 rounded-lg bg-white dark:bg-[#2A3942] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder-[#667781] dark:placeholder-[#8696A0] resize-none focus:outline-none"
              />

              {draft.trim() ? (
                <button
                  type="button"
                  disabled={sending || waState.status !== 'connected'}
                  onClick={() => void handleSendText()}
                  title="Enviar mensaje"
                  className="w-10 h-10 rounded-full bg-[#00A884] hover:bg-[#008F6F] disabled:opacity-50 text-white flex items-center justify-center shrink-0 cursor-pointer"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={sending || waState.status !== 'connected'}
                  onClick={() => void toggleVoiceNote()}
                  title={recordingPtt ? 'Detener y enviar nota de voz' : 'Grabar nota de voz'}
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer ${
                    recordingPtt
                      ? 'bg-red-600 text-white'
                      : 'text-[#54656F] dark:text-[#AEBAC1] hover:bg-black/5 dark:hover:bg-white/10'
                  }`}
                >
                  {recordingPtt ? <Square className="w-4 h-4" /> : <Mic className="w-5 h-5" />}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {/* New Chat Modal */}
      {newChatOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#202C33] border border-slate-200 dark:border-[#2A3942] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                Nuevo chat de WhatsApp
              </h3>
              <button
                type="button"
                onClick={() => setNewChatOpen(false)}
                className="p-1.5 rounded-full text-[#667781] hover:bg-black/5 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleOpenNewChatByPhone} className="space-y-2.5 pb-3 border-b border-slate-200 dark:border-[#2A3942]">
              <label className="block text-xs font-medium text-[#54656F] dark:text-[#AEBAC1]">
                Escribir a un número con código de país
              </label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={newChatPhone}
                  onChange={(e) => setNewChatPhone(e.target.value)}
                  placeholder="+502 5555 1234"
                  className="flex-1 h-10 px-3 rounded-lg bg-[#F0F2F5] dark:bg-[#111B21] text-sm font-mono text-[#111B21] dark:text-[#E9EDEF]"
                />
                <button
                  type="submit"
                  className="px-4 h-10 rounded-lg bg-[#008069] hover:bg-[#006D59] text-white text-xs font-medium whitespace-nowrap cursor-pointer"
                >
                  Abrir chat
                </button>
              </div>
              {newChatError && (
                <p className="text-xs text-red-600 dark:text-red-400">{newChatError}</p>
              )}
            </form>

            <div className="space-y-2.5">
              <input
                type="text"
                value={newChatSearch}
                onChange={(e) => setNewChatSearch(e.target.value)}
                placeholder="Buscar en tus contactos de Kairo..."
                className="w-full h-9 px-3 rounded-lg bg-[#F0F2F5] dark:bg-[#111B21] text-xs text-[#111B21] dark:text-[#E9EDEF]"
              />
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-[#2A3942]">
                {filteredDirectoryContacts.length === 0 ? (
                  <p className="py-6 text-center text-xs text-[#667781] dark:text-[#8696A0]">
                    No hay contactos guardados que coincidan.
                  </p>
                ) : (
                  filteredDirectoryContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={async () => {
                        await onStartChatByPhone(c.phone, c.name);
                        setNewChatOpen(false);
                      }}
                      className="w-full py-2.5 px-2 flex items-center justify-between gap-3 hover:bg-[#F5F6F6] dark:hover:bg-[#2A3942] rounded-lg text-left cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] truncate">
                          {c.name}
                        </p>
                        <p className="text-xs font-mono text-[#667781] dark:text-[#8696A0]">
                          {c.phone}
                        </p>
                      </div>
                      <MessageCircle className="w-4 h-4 text-[#00A884] shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
