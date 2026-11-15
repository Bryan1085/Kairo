import { AlarmClock, BellOff, Clock, MapPin, Volume2 } from 'lucide-react';
import { playAlarmChime } from '../lib/alarmAudio';
import type { CalendarEvent } from '../types';

interface AlarmOverlayProps {
  alarms: CalendarEvent[];
  onSnooze: (eventId: string) => void;
  onDismiss: (eventId: string) => Promise<void>;
}

export function AlarmOverlay({ alarms, onSnooze, onDismiss }: AlarmOverlayProps) {
  if (alarms.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-full max-w-md space-y-3 px-4 sm:px-0">
      {alarms.map((ev) => (
        <div
          key={ev.id}
          role="alert"
          className={`rounded-xl border p-4 bg-white dark:bg-slate-900 shadow-lg ${
            ev.isImportant
              ? 'border-red-300 dark:border-red-800'
              : 'border-amber-300 dark:border-amber-800'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-lg shrink-0 ${
                  ev.isImportant
                    ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400'
                    : 'bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400'
                }`}
              >
                <AlarmClock className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span>{ev.isImportant ? 'Cita prioritaria' : 'Alarma de cita'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {ev.startTime} – {ev.endTime}
                  </span>
                </div>
                <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {ev.title}
                </h4>
                {ev.location && (
                  <p className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{ev.location}</span>
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => playAlarmChime(ev.isImportant)}
              title="Repetir sonido"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Volume2 className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onSnooze(ev.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Clock className="w-3.5 h-3.5" />
              Posponer 5 min
            </button>
            <button
              type="button"
              onClick={() => void onDismiss(ev.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <BellOff className="w-3.5 h-3.5" />
              Descartar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
