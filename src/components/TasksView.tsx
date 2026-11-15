import { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Edit3,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { getLocalDateStr, PRIORITY_LABELS, QUADRANT_LABELS } from '../lib/utils';
import type { CalendarEvent, DailyTask, TaskPriority, TaskQuadrant } from '../types';

interface TasksViewProps {
  tasks: DailyTask[];
  events: CalendarEvent[];
  onCreateTask: (input: {
    title: string;
    notes: string;
    dueDate: string;
    priority: TaskPriority;
    quadrant: TaskQuadrant;
    estimatedMinutes: number;
  }) => Promise<void>;
  onUpdateTask: (
    taskId: string,
    patch: Partial<{
      title: string;
      notes: string;
      dueDate: string;
      priority: TaskPriority;
      quadrant: TaskQuadrant;
      estimatedMinutes: number;
      orderIndex: number;
      completed: boolean;
      aiReason: string;
    }>
  ) => Promise<void>;
  onBatchPrioritize: (
    updates: Array<{
      id: string;
      priority: TaskPriority;
      quadrant: TaskQuadrant;
      orderIndex: number;
      aiReason: string;
    }>
  ) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
}

const QUADRANTS: TaskQuadrant[] = ['hacer_ya', 'planificar', 'delegar', 'eliminar'];

export function TasksView({
  tasks,
  events,
  onCreateTask,
  onUpdateTask,
  onBatchPrioritize,
  onDeleteTask,
}: TasksViewProps) {
  const [viewMode, setViewMode] = useState<'list' | 'matrix'>('list');
  const [filterStatus, setFilterStatus] = useState<'pending' | 'all' | 'completed'>('pending');
  const [prioritizing, setPrioritizing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState(getLocalDateStr());
  const [priority, setPriority] = useState<TaskPriority>('media');
  const [quadrant, setQuadrant] = useState<TaskQuadrant>('planificar');
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);

  const filteredTasks = tasks.filter((t) => {
    if (filterStatus === 'pending') return !t.completed;
    if (filterStatus === 'completed') return t.completed;
    return true;
  });

  const openCreateModal = (defaultQuadrant: TaskQuadrant = 'planificar') => {
    setEditingId(null);
    setTitle('');
    setNotes('');
    setDueDate(getLocalDateStr());
    setPriority(defaultQuadrant === 'hacer_ya' ? 'alta' : 'media');
    setQuadrant(defaultQuadrant);
    setEstimatedMinutes(30);
    setModalOpen(true);
  };

  const openEditModal = (t: DailyTask) => {
    setEditingId(t.id);
    setTitle(t.title);
    setNotes(t.notes);
    setDueDate(t.dueDate);
    setPriority(t.priority);
    setQuadrant(t.quadrant);
    setEstimatedMinutes(t.estimatedMinutes);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        await onUpdateTask(editingId, {
          title,
          notes,
          dueDate,
          priority,
          quadrant,
          estimatedMinutes,
        });
      } else {
        await onCreateTask({
          title,
          notes,
          dueDate,
          priority,
          quadrant,
          estimatedMinutes,
        });
      }
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handlePrioritizeWithAI = async () => {
    const pending = tasks.filter((t) => !t.completed);
    if (pending.length === 0 || prioritizing) return;

    setPrioritizing(true);
    setAiError(null);
    setAiMessage(null);

    try {
      const todayDate = getLocalDateStr();
      const res = await fetch('/api/ai/prioritize-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          todayDate,
          tasks: pending.map((t) => ({
            id: t.id,
            title: t.title,
            notes: t.notes,
            dueDate: t.dueDate,
            estimatedMinutes: t.estimatedMinutes,
            priority: t.priority,
            quadrant: t.quadrant,
          })),
          events: events
            .filter((e) => e.date >= todayDate)
            .slice(0, 12)
            .map((e) => ({
              title: e.title,
              date: e.date,
              startTime: e.startTime,
              endTime: e.endTime,
              isImportant: e.isImportant,
            })),
        }),
      });

      const data = (await res.json()) as {
        prioritized?: Array<{
          id: string;
          priority: string;
          quadrant: string;
          orderIndex: number;
          aiReason: string;
        }>;
        error?: string;
      };

      if (!res.ok || !Array.isArray(data.prioritized)) {
        throw new Error(data.error || 'No se pudo completar la priorización.');
      }

      const validIds = new Set(pending.map((p) => p.id));
      const updates = data.prioritized
        .filter((item) => validIds.has(item.id))
        .map((item, idx) => ({
          id: item.id,
          priority: (['alta', 'media', 'baja'].includes(item.priority)
            ? item.priority
            : 'media') as TaskPriority,
          quadrant: (['hacer_ya', 'planificar', 'delegar', 'eliminar'].includes(item.quadrant)
            ? item.quadrant
            : 'planificar') as TaskQuadrant,
          orderIndex: Number.isInteger(item.orderIndex) ? item.orderIndex : idx,
          aiReason: item.aiReason || '',
        }));

      await onBatchPrioritize(updates);
      setAiMessage(`Se reordenaron ${updates.length} tareas según tu agenda y urgencia.`);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Error al priorizar tareas.');
    } finally {
      setPrioritizing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
            Tareas diarias y prioridades
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Organiza tus pendientes manualmente o deja que Kairo los ordene según tu calendario.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={prioritizing || tasks.filter((t) => !t.completed).length === 0}
            onClick={() => void handlePrioritizeWithAI()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-sm font-medium text-slate-800 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {prioritizing ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            ) : (
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            )}
            <span>{prioritizing ? 'Analizando día...' : 'Priorizar con IA'}</span>
          </button>

          <button
            type="button"
            onClick={() => openCreateModal()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nueva tarea
          </button>
        </div>
      </div>

      {/* Toolbar: Filter + View Mode */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 self-start">
          {(
            [
              { id: 'pending', label: 'Pendientes' },
              { id: 'completed', label: 'Completadas' },
              { id: 'all', label: 'Todas' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterStatus(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                filterStatus === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 self-start">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              viewMode === 'list'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            Lista ordenada
          </button>
          <button
            type="button"
            onClick={() => setViewMode('matrix')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              viewMode === 'matrix'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Matriz Eisenhower
          </button>
        </div>
      </div>

      {(aiMessage || aiError) && (
        <div
          className={`p-3 rounded-lg border text-xs ${
            aiError
              ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
              : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-200'
          }`}
        >
          {aiError || aiMessage}
        </div>
      )}

      {viewMode === 'list' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
          {filteredTasks.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                No hay tareas en esta vista.
              </p>
              <button
                type="button"
                onClick={() => openCreateModal()}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Agregar primera tarea
              </button>
            </div>
          ) : (
            filteredTasks.map((task) => (
              <div
                key={task.id}
                className="p-4 flex items-start justify-between gap-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => void onUpdateTask(task.id, { completed: !task.completed })}
                    className="mt-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                    aria-label={task.completed ? 'Marcar pendiente' : 'Completar tarea'}
                  >
                    {task.completed ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <Circle className="w-5 h-5" />
                    )}
                  </button>
                  <div className="min-w-0 space-y-1">
                    <p
                      className={`text-sm font-medium ${
                        task.completed
                          ? 'line-through text-slate-400 dark:text-slate-500'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {task.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
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
                      <span aria-hidden="true">·</span>
                      <span>{QUADRANT_LABELS[task.quadrant].title}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{task.dueDate}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{task.estimatedMinutes} min</span>
                    </div>
                    {task.notes && (
                      <p className="text-xs text-slate-600 dark:text-slate-400">{task.notes}</p>
                    )}
                    {task.aiReason && (
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        Criterio IA: {task.aiReason}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(task)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    title="Editar"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteTask(task.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    title="Eliminar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {QUADRANTS.map((q) => {
            const qTasks = filteredTasks.filter((t) => t.quadrant === q);
            return (
              <div
                key={q}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {QUADRANT_LABELS[q].title}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {QUADRANT_LABELS[q].subtitle}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCreateModal(q)}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                    title={`Agregar en ${QUADRANT_LABELS[q].title}`}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {qTasks.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">Sin tareas aquí</p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {qTasks.map((task) => (
                      <div key={task.id} className="py-2.5 flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <button
                            type="button"
                            onClick={() =>
                              void onUpdateTask(task.id, { completed: !task.completed })
                            }
                            className="mt-0.5 text-slate-400 hover:text-blue-600 cursor-pointer"
                          >
                            {task.completed ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Circle className="w-4 h-4" />
                            )}
                          </button>
                          <div className="min-w-0">
                            <p
                              className={`text-sm font-medium truncate ${
                                task.completed
                                  ? 'line-through text-slate-400'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {task.title}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {task.dueDate} · {task.estimatedMinutes}m
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openEditModal(task)}
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
                {editingId ? 'Editar tarea' : 'Nueva tarea'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Título *
                </label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej. Enviar informe trimestral"
                  className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Fecha objetivo
                  </label>
                  <input
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Duración (min)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    required
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Prioridad
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                  >
                    <option value="alta">Alta</option>
                    <option value="media">Media</option>
                    <option value="baja">Baja</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Cuadrante
                  </label>
                  <select
                    value={quadrant}
                    onChange={(e) => setQuadrant(e.target.value as TaskQuadrant)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                  >
                    {QUADRANTS.map((q) => (
                      <option key={q} value={q}>
                        {QUADRANT_LABELS[q].title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Notas
                </label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer"
                >
                  {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear tarea'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
