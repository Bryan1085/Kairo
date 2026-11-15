import { useState } from 'react';
import { Loader2, Mic, MicOff, Send } from 'lucide-react';
import { useVoiceDictation } from '../hooks/useVoiceDictation';
import { getLocalDateStr } from '../lib/utils';
import type {
  Contact,
  NoteFolder,
  SmartCaptureResult,
  TaskPriority,
  TaskQuadrant,
} from '../types';

interface SmartCaptureBarProps {
  contacts: Contact[];
  defaultReminderMinutes: number;
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
}

export function SmartCaptureBar({
  contacts,
  defaultReminderMinutes,
  onCreateEvent,
  onCreateTask,
  onCreateNote,
}: SmartCaptureBarProps) {
  const [input, setInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { listening, supported, error: micError, toggle } = useVoiceDictation((transcript) => {
    setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || processing) return;

    setProcessing(true);
    setError(null);
    setFeedback(null);

    try {
      const res = await fetch('/api/ai/smart-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: input.trim(),
          todayDate: getLocalDateStr(),
          contacts: contacts.map((c) => ({ name: c.name })),
        }),
      });
      const data = (await res.json()) as SmartCaptureResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo procesar la captura.');
      }

      if (data.intent === 'event' && data.event) {
        const matchedContact = contacts.find(
          (c) =>
            data.event?.contactName &&
            c.name.toLowerCase().includes(data.event.contactName.toLowerCase())
        );
        await onCreateEvent({
          title: data.event.title || input.trim().slice(0, 120),
          description: data.event.description || '',
          date: /^\d{4}-\d{2}-\d{2}$/.test(data.event.date) ? data.event.date : getLocalDateStr(),
          startTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(data.event.startTime)
            ? data.event.startTime
            : '09:00',
          endTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(data.event.endTime)
            ? data.event.endTime
            : '10:00',
          location: data.event.location || '',
          isImportant: Boolean(data.event.isImportant),
          reminderMinutes: defaultReminderMinutes,
          contactId: matchedContact?.id || '',
          contactName: matchedContact?.name || data.event.contactName || '',
          whatsappReminderEnabled: Boolean(data.event.whatsappReminderEnabled),
        });
        setFeedback(`Cita agendada: "${data.event.title}" para el ${data.event.date} a las ${data.event.startTime}.`);
      } else if (data.intent === 'task' && data.task) {
        const validPriority: TaskPriority = ['alta', 'media', 'baja'].includes(data.task.priority)
          ? data.task.priority
          : 'media';
        const validQuadrant: TaskQuadrant = [
          'hacer_ya',
          'planificar',
          'delegar',
          'eliminar',
        ].includes(data.task.quadrant)
          ? data.task.quadrant
          : 'planificar';
        await onCreateTask({
          title: data.task.title || input.trim().slice(0, 160),
          notes: data.task.notes || '',
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(data.task.dueDate)
            ? data.task.dueDate
            : getLocalDateStr(),
          priority: validPriority,
          quadrant: validQuadrant,
          estimatedMinutes: Number(data.task.estimatedMinutes) || 30,
        });
        setFeedback(`Tarea creada: "${data.task.title}".`);
      } else if (data.note) {
        const validFolder: NoteFolder = ['general', 'reuniones', 'ideas', 'pendientes'].includes(
          data.note.folder
        )
          ? data.note.folder
          : 'general';
        await onCreateNote({
          title: data.note.title || 'Nota rápida',
          content: data.note.content || input.trim(),
          rawText: input.trim(),
          folder: validFolder,
          tags: Array.isArray(data.note.tags) ? data.note.tags.slice(0, 8) : [],
          pinned: false,
          isOrganized: true,
        });
        setFeedback(`Nota guardada en ${validFolder}: "${data.note.title}".`);
      }

      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo procesar tu solicitud.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Captura inteligente: "Reunión con Ana mañana a las 10:00" o "Preparar propuesta urgente"'
            className="w-full h-11 px-3.5 pr-11 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          {supported && (
            <button
              type="button"
              onClick={toggle}
              title={listening ? 'Detener dictado' : 'Dictar por micrófono'}
              className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md transition-colors ${
                listening
                  ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={!input.trim() || processing}
          className="h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span>{processing ? 'Procesando...' : 'Clasificar y guardar'}</span>
        </button>
      </form>
      {(feedback || error || micError) && (
        <p
          className={`text-xs ${
            error || micError ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {error || micError || feedback}
        </p>
      )}
    </div>
  );
}
