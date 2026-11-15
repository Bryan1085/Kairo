import { useMemo, useState } from 'react';
import {
  AlarmClock,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  MapPin,
  MessageCircle,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  addMinutesToTime,
  buildConfirmationMessage,
  buildWhatsAppLink,
  formatLongDate,
  getLocalDateStr,
  getTomorrowDateStr,
} from '../lib/utils';
import type { CalendarEvent, Contact, UserProfile, WhatsAppState } from '../types';

interface CalendarViewProps {
  events: CalendarEvent[];
  contacts: Contact[];
  profile: UserProfile | null;
  waState: WhatsAppState;
  preselectedContact?: Contact | null;
  onClearPreselectedContact?: () => void;
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
  onUpdateEvent: (
    eventId: string,
    patch: Partial<{
      title: string;
      description: string;
      date: string;
      startTime: string;
      endTime: string;
      location: string;
      isImportant: boolean;
      reminderMinutes: number;
      alarmDismissed: boolean;
      contactId: string;
      contactName: string;
      whatsappReminderEnabled: boolean;
      whatsappConfirmationSent: boolean;
    }>
  ) => Promise<void>;
  onDeleteEvent: (eventId: string) => Promise<void>;
  onSendWhatsApp: (phone: string, message: string) => Promise<{ ok: boolean; error?: string }>;
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function CalendarView({
  events,
  contacts,
  profile,
  waState,
  preselectedContact,
  onClearPreselectedContact,
  onCreateEvent,
  onUpdateEvent,
  onDeleteEvent,
  onSendWhatsApp,
}: CalendarViewProps) {
  const todayStr = getLocalDateStr();
  const tomorrowStr = getTomorrowDateStr();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [cursorMonth, setCursorMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const [modalOpen, setModalOpen] = useState(Boolean(preselectedContact));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [isImportant, setIsImportant] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState(profile?.defaultReminderMinutes ?? 15);
  const [contactId, setContactId] = useState(preselectedContact?.id || '');
  const [whatsappReminderEnabled, setWhatsappReminderEnabled] = useState(
    Boolean(preselectedContact)
  );

  const monthCells = useMemo(() => {
    const year = cursorMonth.getFullYear();
    const month = cursorMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: Array<{ dateStr: string; day: number; inMonth: boolean }> = [];
    for (let i = startOffset - 1; i >= 0; i -= 1) {
      const d = new Date(year, month, -i);
      cells.push({ dateStr: getLocalDateStr(d), day: d.getDate(), inMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      const dt = new Date(year, month, d);
      cells.push({ dateStr: getLocalDateStr(dt), day: d, inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      const nextIdx = cells.length - (startOffset + daysInMonth) + 1;
      const dt = new Date(year, month + 1, nextIdx);
      cells.push({ dateStr: getLocalDateStr(dt), day: dt.getDate(), inMonth: false });
    }
    return cells;
  }, [cursorMonth]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.date) || [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return map;
  }, [events]);

  const dayEvents = eventsByDate.get(selectedDate) || [];

  const openCreateModal = (targetDate = selectedDate) => {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setDate(targetDate);
    setStartTime('09:00');
    setEndTime('10:00');
    setLocation('');
    setIsImportant(false);
    setReminderMinutes(profile?.defaultReminderMinutes ?? 15);
    setContactId('');
    setWhatsappReminderEnabled(false);
    setModalOpen(true);
  };

  const openEditModal = (ev: CalendarEvent) => {
    setEditingId(ev.id);
    setTitle(ev.title);
    setDescription(ev.description);
    setDate(ev.date);
    setStartTime(ev.startTime);
    setEndTime(ev.endTime);
    setLocation(ev.location);
    setIsImportant(ev.isImportant);
    setReminderMinutes(ev.reminderMinutes);
    setContactId(ev.contactId);
    setWhatsappReminderEnabled(ev.whatsappReminderEnabled);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    onClearPreselectedContact?.();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;

    setSaving(true);
    const chosenContact = contacts.find((c) => c.id === contactId);
    const safeEnd = endTime > startTime ? endTime : addMinutesToTime(startTime, 60);

    try {
      if (editingId) {
        await onUpdateEvent(editingId, {
          title,
          description,
          date,
          startTime,
          endTime: safeEnd,
          location,
          isImportant,
          reminderMinutes,
          contactId: chosenContact?.id || '',
          contactName: chosenContact?.name || '',
          whatsappReminderEnabled,
        });
      } else {
        await onCreateEvent({
          title,
          description,
          date,
          startTime,
          endTime: safeEnd,
          location,
          isImportant,
          reminderMinutes,
          contactId: chosenContact?.id || '',
          contactName: chosenContact?.name || '',
          whatsappReminderEnabled,
        });
      }
      setSelectedDate(date);
      closeModal();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmViaWhatsApp = async (ev: CalendarEvent) => {
    const contact = contacts.find((c) => c.id === ev.contactId);
    if (!contact) {
      setStatusMessage('Asocia un contacto con número de teléfono para enviar por WhatsApp.');
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
      setStatusMessage(null);
      const res = await onSendWhatsApp(contact.phone, msg);
      setSendingId(null);
      if (res.ok) {
        await onUpdateEvent(ev.id, { whatsappConfirmationSent: true });
        setStatusMessage(`Recordatorio enviado a ${contact.name} (${contact.phone}).`);
      } else {
        setStatusMessage(res.error || 'No se pudo enviar el mensaje.');
      }
    } else {
      window.open(buildWhatsAppLink(contact.phone, msg), '_blank', 'noopener,noreferrer');
      await onUpdateEvent(ev.id, { whatsappConfirmationSent: true });
      setStatusMessage(`Se abrió WhatsApp Web para confirmar con ${contact.name}.`);
    }
  };

  const monthLabel = new Intl.DateTimeFormat('es-ES', {
    month: 'long',
    year: 'numeric',
  }).format(cursorMonth);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
            Calendario y alarmas de citas
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Programa recordatorios sonoros y confirmaciones 1 día antes por WhatsApp.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCreateModal(selectedDate)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Nueva cita
        </button>
      </div>

      {statusMessage && (
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-200 flex items-center justify-between">
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-blue-600 dark:text-blue-300 hover:underline"
          >
            Cerrar
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Month Grid */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-base font-semibold capitalize text-slate-900 dark:text-slate-100">
              {monthLabel}
            </h3>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setCursorMonth(
                    (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                  )
                }
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  setCursorMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                  setSelectedDate(todayStr);
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() =>
                  setCursorMonth(
                    (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                  )
                }
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center mb-2">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="text-xs font-medium text-slate-500 dark:text-slate-400 py-1"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {monthCells.map((cell) => {
              const cellEvents = eventsByDate.get(cell.dateStr) || [];
              const isSelected = cell.dateStr === selectedDate;
              const isToday = cell.dateStr === todayStr;
              const hasImportant = cellEvents.some((e) => e.isImportant);

              return (
                <button
                  key={cell.dateStr}
                  type="button"
                  onClick={() => setSelectedDate(cell.dateStr)}
                  className={`h-16 p-1.5 rounded-lg border text-left flex flex-col justify-between transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40'
                      : 'border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  } ${!cell.inMonth ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        isToday
                          ? 'font-bold text-blue-600 dark:text-blue-400'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {cell.day}
                    </span>
                    {hasImportant && (
                      <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">
                        !
                      </span>
                    )}
                  </div>
                  {cellEvents.length > 0 && (
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                      {cellEvents.length} {cellEvents.length === 1 ? 'cita' : 'citas'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Day Agenda */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {selectedDate === todayStr
                  ? 'Hoy'
                  : selectedDate === tomorrowStr
                  ? 'Mañana'
                  : 'Agenda del día'}
              </p>
              <h3 className="font-display text-base font-semibold capitalize text-slate-900 dark:text-slate-100">
                {formatLongDate(selectedDate)}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => openCreateModal(selectedDate)}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
              title="Agregar cita en esta fecha"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {dayEvents.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <CalendarIcon className="w-6 h-6 mx-auto text-slate-400" />
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Sin citas programadas este día.
              </p>
              <button
                type="button"
                onClick={() => openCreateModal(selectedDate)}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Agregar cita
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {dayEvents.map((ev) => (
                <div key={ev.id} className="py-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        <span>
                          {ev.startTime} – {ev.endTime}
                        </span>
                        {ev.isImportant && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-sans font-medium text-red-600 dark:text-red-400">
                              Prioritaria
                            </span>
                          </>
                        )}
                      </div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {ev.title}
                      </h4>
                      {ev.description && (
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {ev.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {ev.location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {ev.location}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                          <AlarmClock className="w-3 h-3" /> {ev.reminderMinutes} min antes
                        </span>
                        {ev.contactName && (
                          <span>· {ev.contactName}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditModal(ev)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        title="Editar"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteEvent(ev.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {ev.whatsappReminderEnabled && ev.contactId && (
                    <div className="flex items-center justify-between pt-1">
                      {ev.whatsappConfirmationSent ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                          <Check className="w-3.5 h-3.5" />
                          Confirmación WhatsApp enviada
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={sendingId === ev.id}
                          onClick={() => void handleConfirmViaWhatsApp(ev)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          {sendingId === ev.id
                            ? 'Enviando...'
                            : 'Enviar confirmación por WhatsApp'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Event Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
                {editingId ? 'Editar cita' : 'Nueva cita'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Título de la cita *
                </label>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej. Revisión de contrato con cliente"
                  className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Fecha
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Inicio
                  </label>
                  <input
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Fin
                  </label>
                  <input
                    type="time"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Lugar o enlace
                  </label>
                  <input
                    type="text"
                    maxLength={200}
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Oficina, Google Meet..."
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Alarma previa
                  </label>
                  <select
                    value={reminderMinutes}
                    onChange={(e) => setReminderMinutes(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                  >
                    <option value={0}>Al iniciar (0 min)</option>
                    <option value={5}>5 minutos antes</option>
                    <option value={15}>15 minutos antes</option>
                    <option value={30}>30 minutos antes</option>
                    <option value={60}>1 hora antes</option>
                    <option value={1440}>1 día antes</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Contacto vinculado (opcional)
                </label>
                <select
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                >
                  <option value="">Sin contacto vinculado</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Detalles
                </label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Notas de preparación o agenda..."
                  className="w-full p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                />
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isImportant}
                    onChange={(e) => setIsImportant(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>Marcar como cita prioritaria (alarma urgente)</span>
                </label>

                <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whatsappReminderEnabled}
                    onChange={(e) => setWhatsappReminderEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>Enviar confirmación por WhatsApp 1 día antes</span>
                </label>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer"
                >
                  {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Agendar cita'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
