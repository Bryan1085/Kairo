import { useEffect, useRef, useState } from 'react';
import { playAlarmChime } from '../lib/alarmAudio';
import {
  buildConfirmationMessage,
  getTomorrowDateStr,
  parseEventDateTime,
} from '../lib/utils';
import type { CalendarEvent, Contact, UserProfile, WhatsAppState } from '../types';

interface UseAlarmEngineProps {
  events: CalendarEvent[];
  contacts: Contact[];
  profile: UserProfile | null;
  waState: WhatsAppState;
  onDismissAlarm: (eventId: string) => Promise<void>;
  onMarkWhatsappSent: (eventId: string) => Promise<void>;
  onSendWhatsApp: (phone: string, message: string) => Promise<{ ok: boolean; error?: string }>;
}

export function useAlarmEngine({
  events,
  contacts,
  profile,
  waState,
  onDismissAlarm,
  onMarkWhatsappSent,
  onSendWhatsApp,
}: UseAlarmEngineProps) {
  const [activeAlarms, setActiveAlarms] = useState<CalendarEvent[]>([]);
  const snoozedUntilRef = useRef<Map<string, number>>(new Map());
  const chimedIdsRef = useRef<Set<string>>(new Set());
  const autoSendingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const evaluateAlarms = () => {
      const now = Date.now();
      const due: CalendarEvent[] = [];

      for (const ev of events) {
        if (ev.alarmDismissed) {
          chimedIdsRef.current.delete(ev.id);
          continue;
        }
        const snoozeUntil = snoozedUntilRef.current.get(ev.id) || 0;
        if (now < snoozeUntil) continue;

        const startMs = parseEventDateTime(ev.date, ev.startTime).getTime();
        const triggerMs = startMs - ev.reminderMinutes * 60_000;
        const expireMs = startMs + 60 * 60_000; // active up to 60 min after start

        if (now >= triggerMs && now <= expireMs) {
          due.push(ev);
          if (!chimedIdsRef.current.has(ev.id)) {
            chimedIdsRef.current.add(ev.id);
            if (profile?.alarmSoundEnabled ?? true) {
              playAlarmChime(ev.isImportant);
            }
          }
        }
      }

      setActiveAlarms(due);
    };

    evaluateAlarms();
    const interval = window.setInterval(evaluateAlarms, 10_000);
    return () => window.clearInterval(interval);
  }, [events, profile?.alarmSoundEnabled]);

  // Automatic 1-day-before WhatsApp confirmation if enabled and WhatsApp connected
  useEffect(() => {
    if (!profile?.whatsappAutoSendEnabled || waState.status !== 'connected') return;

    const tomorrow = getTomorrowDateStr();
    const pendingConfirmations = events.filter(
      (ev) =>
        ev.date === tomorrow &&
        ev.whatsappReminderEnabled &&
        !ev.whatsappConfirmationSent &&
        ev.contactId
    );

    for (const ev of pendingConfirmations) {
      if (autoSendingIdsRef.current.has(ev.id)) continue;
      const contact = contacts.find((c) => c.id === ev.contactId);
      if (!contact?.phone) continue;

      autoSendingIdsRef.current.add(ev.id);
      const msg = buildConfirmationMessage({
        contactName: contact.name,
        title: ev.title,
        date: ev.date,
        startTime: ev.startTime,
        location: ev.location,
      });

      void onSendWhatsApp(contact.phone, msg)
        .then(async (res) => {
          if (res.ok) {
            await onMarkWhatsappSent(ev.id);
          }
        })
        .finally(() => {
          autoSendingIdsRef.current.delete(ev.id);
        });
    }
  }, [
    events,
    contacts,
    profile?.whatsappAutoSendEnabled,
    waState.status,
    onSendWhatsApp,
    onMarkWhatsappSent,
  ]);

  const snoozeAlarm = (eventId: string, minutes = 5) => {
    snoozedUntilRef.current.set(eventId, Date.now() + minutes * 60_000);
    chimedIdsRef.current.delete(eventId);
    setActiveAlarms((prev) => prev.filter((e) => e.id !== eventId));
  };

  const dismissAlarm = async (eventId: string) => {
    setActiveAlarms((prev) => prev.filter((e) => e.id !== eventId));
    await onDismissAlarm(eventId);
  };

  return {
    activeAlarms,
    snoozeAlarm,
    dismissAlarm,
  };
}
