import { useState } from 'react';
import {
  AlarmClock,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Circle,
  MapPin,
  MessageCircle,
  Pin,
} from 'lucide-react';
import {
  buildConfirmationMessage,
  buildWhatsAppLink,
  formatDisplayDate,
  getLocalDateStr,
  getTomorrowDateStr,
  PRIORITY_LABELS,
} from '../lib/utils';
import type {
  ActiveTab,
  CalendarEvent,
  Contact,
  DailyTask,
  NoteFolder,
  QuickNote,
  TaskPriority,
  TaskQuadrant,
  UserProfile,
  WhatsAppState,
} from '../types';
import { SmartCaptureBar } from './SmartCaptureBar';

interface OverviewViewProps {
  events: CalendarEvent[];
  tasks: DailyTask[];
  contacts: Contact[];
  notes: QuickNote[];
  profile: UserProfile | null;
  waState: WhatsAppState;
  onNavigate: (tab: ActiveTab) => void;
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
  onCreateNote: (input: {
    title: string;
    content: string;
    rawText: string;
    folder: NoteFolder;
    tags: string[];
    pinned: boolean;
    isOrganized: boolean;
  }) => Promise<void>;
  onToggleTask: (task: DailyTask) => Promise<void>;
  onMarkWhatsappSent: (eventId: string) => Promise<void>;
  onSendWhatsApp: (phone: string, message: string) => Promise<{ ok: boolean; error?: string }>;
}

export function OverviewView({
  events,
  tasks,
  contacts,
  notes,
  profile,
  waState,
  onNavigate,
  onCreateEvent,
  onCreateTask,
  onCreateNote,
  onToggleTask,
  onMarkWhatsappSent,
  onSendWhatsApp,
}: OverviewViewProps) {
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [waFeedback, setWaFeedback] = useState<string | null>(null);

  const today = getLocalDateStr();
  const tomorrow = getTomorrowDateStr();

  const todayEvents = events.filter((ev) => ev.date === today);
  const pendingTasks = tasks.filter((t) => !t.completed);
  const topTasks = pendingTasks.slice(0, 5);
  const tomorrowConfirmations = events.filter(
    (ev) => ev.date === tomorrow && ev.whatsappReminderEnabled && !ev.whatsappConfirmationSent
  );
  const pinnedNotes = notes.filter((n) => n.pinned).slice(0, 3);

  const handleSendConfirmation = async (ev: CalendarEvent) => {
    const contact = contacts.find((c) => c.id === ev.contactId);
    if (!contact) {
      setWaFeedback('Esta cita no tiene un contacto con teléfono vinculado.');
      return;
    }
    const msg = buildConfirmationMessage({
      contactName: contact.name,
      title: ev.title,
      date: ev.date,
      startTime: ev.startTime,
      location: ev.location,
    });

    if (waState.status === 'connected') {
      setSendingId(ev.id);
      setWaFeedback(null);
      const res = await onSendWhatsApp(contact.phone, msg);
      setSendingId(null);
      if (res.ok) {
        await onMarkWhatsappSent(ev.id);
        setWaFeedback(`Confirmación enviada a ${contact.name} por WhatsApp.`);
      } else {
        setWaFeedback(res.error || 'No se pudo enviar automáticamente.');
      }
    } else {
      window.open(buildWhatsAppLink(contact.phone, msg), '_blank', 'noopener,noreferrer');
      await onMarkWhatsappSent(ev.id);
      setWaFeedback(`Se abrió WhatsApp Web para confirmar con ${contact.name}.`);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('calendar')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors cursor-pointer"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Citas para hoy</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {todayEvents.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {todayEvents.filter((e) => e.isImportant).length} prioritarias
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('tasks')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors cursor-pointer"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Tareas pendientes</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {pendingTasks.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {pendingTasks.filter((t) => t.priority === 'alta').length} de prioridad alta
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('calendar')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors cursor-pointer"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Confirmar mañana</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {tomorrowConfirmations.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Recordatorios WhatsApp
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('contacts')}
          className="text-left p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors cursor-pointer"
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Contactos y notas</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
            {contacts.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {notes.length} notas guardadas
          </p>
        </button>
      </div>

      {/* Smart Capture */}
      <SmartCaptureBar
        contacts={contacts}
        defaultReminderMinutes={profile?.defaultReminderMinutes ?? 15}
        onCreateEvent={onCreateEvent}
        onCreateTask={onCreateTask}
        onCreateNote={onCreateNote}
      />

      {/* Two-Column Executive Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Today's Schedule */}
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
                Agenda de hoy
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                {formatDisplayDate(today)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Ver calendario <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {todayEvents.length === 0 ? (
            <div className="py-8 text-center space-y-2 border-t border-slate-100 dark:border-slate-800">
              <Calendar className="w-6 h-6 mx-auto text-slate-400" />
              <p className="text-sm text-slate-600 dark:text-slate-300">No tienes citas programadas para hoy.</p>
              <button
                type="button"
                onClick={() => onNavigate('calendar')}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Agendar primera cita
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {todayEvents.map((ev) => (
                <div key={ev.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300 pt-0.5 shrink-0">
                      {ev.startTime} – {ev.endTime}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {ev.title}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {ev.isImportant && (
                          <span className="text-red-600 dark:text-red-400 font-medium">Prioritaria</span>
                        )}
                        {ev.location && (
                          <>
                            {ev.isImportant && <span aria-hidden="true">·</span>}
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {ev.location}
                            </span>
                          </>
                        )}
                        {ev.contactName && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{ev.contactName}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 shrink-0 font-mono tabular-nums">
                    <AlarmClock className="w-3.5 h-3.5" />
                    <span>{ev.reminderMinutes}m</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tomorrow WhatsApp Confirmations */}
          {tomorrowConfirmations.length > 0 && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Confirmar citas de mañana por WhatsApp
                </h3>
              </div>
              {waFeedback && (
                <p className="text-xs text-blue-600 dark:text-blue-400">{waFeedback}</p>
              )}
              <div className="space-y-2">
                {tomorrowConfirmations.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {ev.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono tabular-nums">{ev.startTime}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{ev.contactName || 'Sin contacto vinculado'}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={sendingId === ev.id}
                      onClick={() => void handleSendConfirmation(ev)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      {sendingId === ev.id ? 'Enviando...' : 'Enviar confirmación'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Right Column: Top Tasks & Pinned Notes */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
                Prioridades del día
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('tasks')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Gestionar <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {topTasks.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center border-t border-slate-100 dark:border-slate-800">
                Sin tareas pendientes.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {topTasks.map((task) => (
                  <div key={task.id} className="py-2.5 flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => void onToggleTask(task)}
                      className="mt-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                      aria-label={`Completar ${task.title}`}
                    >
                      {task.completed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Circle className="w-4 h-4" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {task.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span
                          className={
                            task.priority === 'alta'
                              ? 'text-red-600 dark:text-red-400 font-medium'
                              : task.priority === 'media'
                              ? 'text-amber-600 dark:text-amber-400 font-medium'
                              : ''
                          }
                        >
                          Prioridad {PRIORITY_LABELS[task.priority]}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono tabular-nums">{task.estimatedMinutes} min</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
                Notas fijadas
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('notes')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Todas las notas <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {pinnedNotes.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center border-t border-slate-100 dark:border-slate-800">
                Fija notas clave para tenerlas a la mano aquí.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {pinnedNotes.map((note) => (
                  <div key={note.id} className="py-3 space-y-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                      <Pin className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span className="truncate">{note.title}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                      {note.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
