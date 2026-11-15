import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type {
  WhatsAppChatMessage,
  WhatsAppChatThread,
  WhatsAppMessageStatus,
  WhatsAppState,
} from '../types';

const INITIAL_STATE: WhatsAppState = {
  status: 'disconnected',
  qrDataUrl: null,
  phoneNumber: null,
  displayName: null,
  errorMessage: null,
};

export interface SendWhatsAppOptions {
  jid?: string;
  quotedMessageId?: string;
  mediaBase64?: string;
  mediaMime?: string;
  fileName?: string;
  mediaType?: 'image' | 'document' | 'audio';
  ptt?: boolean;
}

export function useWhatsApp() {
  const { user } = useAuth();
  const [waState, setWaState] = useState<WhatsAppState>(INITIAL_STATE);
  const [busy, setBusy] = useState(false);
  const [chats, setChats] = useState<WhatsAppChatThread[]>([]);
  const [messagesByJid, setMessagesByJid] = useState<Record<string, WhatsAppChatMessage[]>>({});
  const [activeJid, setActiveJid] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const activeJidRef = useRef<string | null>(null);
  activeJidRef.current = activeJid;

  const refreshStatus = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/whatsapp/status?userId=${encodeURIComponent(user.uid)}`);
      if (res.ok) {
        const data = (await res.json()) as WhatsAppState;
        setWaState(data);
      }
    } catch {
      // ignore transient poll errors
    }
  }, [user]);

  const refreshChats = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/whatsapp/chats?userId=${encodeURIComponent(user.uid)}`);
      if (res.ok) {
        const data = (await res.json()) as { chats?: WhatsAppChatThread[] };
        if (Array.isArray(data.chats)) {
          setChats(data.chats);
        }
      }
    } catch {
      // ignore transient poll errors
    }
  }, [user]);

  const markAsRead = useCallback(
    async (jid: string) => {
      if (!user || !jid) return;
      setChats((prev) =>
        prev.map((c) => (c.jid === jid ? { ...c, unreadCount: 0 } : c))
      );
      try {
        await fetch('/api/whatsapp/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.uid, jid }),
        });
      } catch {
        // ignore read receipt failure
      }
    },
    [user]
  );

  const selectChat = useCallback(
    async (jid: string | null) => {
      setActiveJid(jid);
      if (!user || !jid) return;

      setLoadingMessages(true);
      try {
        const res = await fetch(
          `/api/whatsapp/messages?userId=${encodeURIComponent(user.uid)}&jid=${encodeURIComponent(jid)}`
        );
        if (res.ok) {
          const data = (await res.json()) as { messages?: WhatsAppChatMessage[] };
          setMessagesByJid((prev) => ({
            ...prev,
            [jid]: Array.isArray(data.messages) ? data.messages : [],
          }));
        }
        void markAsRead(jid);
      } finally {
        setLoadingMessages(false);
      }
    },
    [user, markAsRead]
  );

  useEffect(() => {
    if (!user) {
      setWaState(INITIAL_STATE);
      setChats([]);
      setMessagesByJid({});
      setActiveJid(null);
      return;
    }

    void refreshStatus();
    void refreshChats();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?userId=${encodeURIComponent(user.uid)}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closed = false;

    const connectWs = () => {
      if (closed) return;
      ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as { type: string; data: unknown };

          if (msg.type === 'whatsapp:state' && msg.data) {
            setWaState(msg.data as WhatsAppState);
          } else if (msg.type === 'whatsapp:chats_sync' && Array.isArray(msg.data)) {
            setChats(msg.data as WhatsAppChatThread[]);
          } else if (msg.type === 'whatsapp:chat_update' && msg.data) {
            const updated = msg.data as WhatsAppChatThread;
            setChats((prev) => {
              const exists = prev.some((c) => c.jid === updated.jid);
              const next = exists
                ? prev.map((c) => (c.jid === updated.jid ? { ...c, ...updated } : c))
                : [updated, ...prev];
              return next.sort(
                (a, b) =>
                  (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
                  b.lastMessageTimestamp - a.lastMessageTimestamp
              );
            });
          } else if (msg.type === 'whatsapp:message' && msg.data) {
            const { chat, message } = msg.data as {
              chat: WhatsAppChatThread;
              message: WhatsAppChatMessage;
            };
            const isViewingChat = activeJidRef.current === chat.jid;
            const adjustedChat =
              isViewingChat && !message.fromMe ? { ...chat, unreadCount: 0 } : chat;

            setChats((prev) => {
              const exists = prev.some((c) => c.jid === adjustedChat.jid);
              const next = exists
                ? prev.map((c) => (c.jid === adjustedChat.jid ? adjustedChat : c))
                : [adjustedChat, ...prev];
              return next.sort(
                (a, b) =>
                  (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
                  b.lastMessageTimestamp - a.lastMessageTimestamp
              );
            });

            setMessagesByJid((prev) => {
              const list = prev[message.jid] || [];
              const existingIdx = list.findIndex((m) => m.id === message.id);
              const nextList =
                existingIdx >= 0
                  ? list.map((m, i) => (i === existingIdx ? message : m))
                  : [...list, message].sort((a, b) => a.timestamp - b.timestamp);
              return { ...prev, [message.jid]: nextList };
            });

            if (isViewingChat && !message.fromMe) {
              void markAsRead(chat.jid);
            }
          } else if (msg.type === 'whatsapp:message_status' && msg.data) {
            const { jid, messageId, status } = msg.data as {
              jid: string;
              messageId: string;
              status: WhatsAppMessageStatus;
            };
            setMessagesByJid((prev) => {
              const list = prev[jid];
              if (!list) return prev;
              return {
                ...prev,
                [jid]: list.map((m) => (m.id === messageId ? { ...m, status } : m)),
              };
            });
          } else if (msg.type === 'whatsapp:presence' && msg.data) {
            const { jid, presence } = msg.data as {
              jid: string;
              presence: WhatsAppChatThread['presence'];
            };
            setChats((prev) =>
              prev.map((c) => (c.jid === jid ? { ...c, presence } : c))
            );
          }
        } catch {
          // ignore malformed payloads
        }
      };
      ws.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(connectWs, 3000);
        }
      };
    };

    connectWs();

    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [user, refreshStatus, refreshChats, markAsRead]);

  const connect = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid }),
      });
      if (res.ok) {
        const data = (await res.json()) as WhatsAppState;
        setWaState(data);
      }
    } finally {
      setBusy(false);
    }
  }, [user]);

  const disconnect = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      const res = await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid }),
      });
      if (res.ok) {
        const data = (await res.json()) as WhatsAppState;
        setWaState(data);
        setChats([]);
        setMessagesByJid({});
        setActiveJid(null);
      }
    } finally {
      setBusy(false);
    }
  }, [user]);

  const startChatByPhone = useCallback(
    async (phone: string, displayName?: string) => {
      const digits = phone.replace(/[^\d]/g, '');
      if (digits.length < 7) return null;
      const jid = `${digits}@s.whatsapp.net`;
      setChats((prev) => {
        if (prev.some((c) => c.jid === jid)) return prev;
        const placeholder: WhatsAppChatThread = {
          jid,
          phone: `+${digits}`,
          name: displayName?.trim() || `+${digits}`,
          isGroup: false,
          unreadCount: 0,
          lastMessageText: '',
          lastMessageFromMe: false,
          lastMessageTimestamp: Date.now(),
        };
        return [placeholder, ...prev];
      });
      await selectChat(jid);
      return jid;
    },
    [selectChat]
  );

  const sendMessage = useCallback(
    async (
      phoneOrJid: string,
      message: string,
      options?: SendWhatsAppOptions
    ): Promise<{ ok: boolean; error?: string; jid?: string }> => {
      if (!user) return { ok: false, error: 'Usuario no autenticado.' };
      try {
        const isJid = phoneOrJid.includes('@');
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.uid,
            jid: options?.jid || (isJid ? phoneOrJid : undefined),
            phone: !isJid ? phoneOrJid : undefined,
            message,
            quotedMessageId: options?.quotedMessageId,
            mediaBase64: options?.mediaBase64,
            mediaMime: options?.mediaMime,
            fileName: options?.fileName,
            mediaType: options?.mediaType,
            ptt: options?.ptt,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          jid?: string;
          message?: WhatsAppChatMessage;
          chat?: WhatsAppChatThread;
        };
        if (!res.ok) {
          return { ok: false, error: data.error || 'No se pudo enviar el mensaje.' };
        }
        return { ok: true, jid: data.jid };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Error de red enviando mensaje.',
        };
      }
    },
    [user]
  );

  const sendTyping = useCallback(
    async (jid: string, presence: 'composing' | 'recording' | 'paused') => {
      if (!user || !jid || waState.status !== 'connected') return;
      try {
        await fetch('/api/whatsapp/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.uid, jid, presence }),
        });
      } catch {
        // ignore
      }
    },
    [user, waState.status]
  );

  const totalUnread = useMemo(
    () => chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0),
    [chats]
  );

  return {
    waState,
    busy,
    chats,
    messagesByJid,
    activeJid,
    loadingMessages,
    totalUnread,
    connect,
    disconnect,
    selectChat,
    startChatByPhone,
    sendMessage,
    sendTyping,
    markAsRead,
    refreshStatus,
    refreshChats,
  };
}
