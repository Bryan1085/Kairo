import { useState } from 'react';
import {
  Edit3,
  FileText,
  Loader2,
  Mic,
  MicOff,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useVoiceDictation } from '../hooks/useVoiceDictation';
import { NOTE_FOLDER_LABELS } from '../lib/utils';
import type { NoteFolder, QuickNote } from '../types';

interface NotesViewProps {
  notes: QuickNote[];
  onCreateNote: (input: {
    title: string;
    content: string;
    rawText: string;
    folder: NoteFolder;
    tags: string[];
    pinned: boolean;
    isOrganized: boolean;
  }) => Promise<void>;
  onUpdateNote: (
    noteId: string,
    patch: Partial<{
      title: string;
      content: string;
      rawText: string;
      folder: NoteFolder;
      tags: string[];
      pinned: boolean;
      isOrganized: boolean;
    }>
  ) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
}

const FOLDERS: NoteFolder[] = ['general', 'reuniones', 'ideas', 'pendientes'];

export function NotesView({
  notes,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
}: NotesViewProps) {
  const [folderFilter, setFolderFilter] = useState<'all' | NoteFolder>('all');
  const [search, setSearch] = useState('');

  const [quickText, setQuickText] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [organizingId, setOrganizingId] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const [editingNote, setEditingNote] = useState<QuickNote | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editFolder, setEditFolder] = useState<NoteFolder>('general');
  const [editTags, setEditTags] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const { listening, supported, toggle } = useVoiceDictation((transcript) => {
    setQuickText((prev) => (prev ? `${prev} ${transcript}` : transcript));
  });

  const filteredNotes = notes.filter((n) => {
    if (folderFilter !== 'all' && n.folder !== folderFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const handleQuickCapture = async (organizeWithAi: boolean) => {
    const raw = quickText.trim();
    if (!raw || quickSaving) return;

    setQuickSaving(true);
    setAiError(null);
    try {
      if (organizeWithAi) {
        const res = await fetch('/api/ai/organize-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText: raw }),
        });
        const data = (await res.json()) as {
          title?: string;
          content?: string;
          folder?: string;
          tags?: string[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'No se pudo organizar la nota.');
        }
        const folder: NoteFolder = FOLDERS.includes(data.folder as NoteFolder)
          ? (data.folder as NoteFolder)
          : 'general';
        await onCreateNote({
          title: data.title || raw.slice(0, 60),
          content: data.content || raw,
          rawText: raw,
          folder,
          tags: Array.isArray(data.tags) ? data.tags.slice(0, 8) : [],
          pinned: false,
          isOrganized: true,
        });
      } else {
        const firstLine = raw.split('\n')[0].trim().slice(0, 80) || 'Nota rápida';
        await onCreateNote({
          title: firstLine,
          content: raw,
          rawText: raw,
          folder: folderFilter === 'all' ? 'general' : folderFilter,
          tags: [],
          pinned: false,
          isOrganized: false,
        });
      }
      setQuickText('');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Error guardando la nota.');
    } finally {
      setQuickSaving(false);
    }
  };

  const handleOrganizeExisting = async (note: QuickNote) => {
    setOrganizingId(note.id);
    setAiError(null);
    try {
      const res = await fetch('/api/ai/organize-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: note.rawText || note.content,
          currentTitle: note.title,
        }),
      });
      const data = (await res.json()) as {
        title?: string;
        content?: string;
        folder?: string;
        tags?: string[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo organizar la nota.');
      }
      const folder: NoteFolder = FOLDERS.includes(data.folder as NoteFolder)
        ? (data.folder as NoteFolder)
        : note.folder;
      await onUpdateNote(note.id, {
        title: data.title || note.title,
        content: data.content || note.content,
        folder,
        tags: Array.isArray(data.tags) ? data.tags.slice(0, 8) : note.tags,
        isOrganized: true,
      });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Error organizando la nota.');
    } finally {
      setOrganizingId(null);
    }
  };

  const openEdit = (note: QuickNote) => {
    setEditingNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditFolder(note.folder);
    setEditTags(note.tags.join(', '));
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNote || !editTitle.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      const tags = editTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8);
      await onUpdateNote(editingNote.id, {
        title: editTitle,
        content: editContent,
        folder: editFolder,
        tags,
      });
      setEditingNote(null);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
          Notas rápidas
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Captura ideas al vuelo por texto o micrófono y estructúralas automáticamente con IA.
        </p>
      </div>

      {/* Quick Capture Composer */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <textarea
          rows={3}
          maxLength={4000}
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          placeholder="Escribe o dicta notas de una reunión, ideas de proyecto o pendientes..."
          className="w-full p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm resize-y"
        />

        {aiError && <p className="text-xs text-red-600 dark:text-red-400">{aiError}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {supported && (
              <button
                type="button"
                onClick={toggle}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer ${
                  listening
                    ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                {listening ? 'Detener dictado' : 'Dictar por voz'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!quickText.trim() || quickSaving}
              onClick={() => void handleQuickCapture(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-xs font-medium cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Guardar rápida
            </button>
            <button
              type="button"
              disabled={!quickText.trim() || quickSaving}
              onClick={() => void handleQuickCapture(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
            >
              {quickSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Organizar con IA
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar en notas o etiquetas..."
            className="w-full h-10 pl-9 pr-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
          />
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <button
            type="button"
            onClick={() => setFolderFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              folderFilter === 'all'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Todas
          </button>
          {FOLDERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFolderFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                folderFilter === f
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {NOTE_FOLDER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      {/* Notes Grid */}
      {filteredNotes.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl py-12 text-center space-y-2">
          <FileText className="w-6 h-6 mx-auto text-slate-400" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            No hay notas en esta carpeta.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredNotes.map((note) => (
            <article
              key={note.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{NOTE_FOLDER_LABELS[note.folder]}</span>
                      {note.isOrganized && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-blue-600 dark:text-blue-400">Estructurada</span>
                        </>
                      )}
                      {note.tags.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{note.tags.join(' · ')}</span>
                        </>
                      )}
                    </div>
                    <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
                      {note.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => void onUpdateNote(note.id, { pinned: !note.pinned })}
                      className={`p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${
                        note.pinned ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'
                      }`}
                      title={note.pinned ? 'Desfijar' : 'Fijar arriba'}
                    >
                      {note.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(note)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title="Editar"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteNote(note.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      title="Eliminar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {note.content}
                </p>
              </div>

              {!note.isOrganized && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    type="button"
                    disabled={organizingId === note.id}
                    onClick={() => void handleOrganizeExisting(note)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    {organizingId === note.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {organizingId === note.id ? 'Organizando...' : 'Estructurar con IA'}
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingNote && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">Editar nota</h3>
              <button
                type="button"
                onClick={() => setEditingNote(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Título
                </label>
                <input
                  type="text"
                  required
                  maxLength={160}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Carpeta
                  </label>
                  <select
                    value={editFolder}
                    onChange={(e) => setEditFolder(e.target.value as NoteFolder)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                  >
                    {FOLDERS.map((f) => (
                      <option key={f} value={f}>
                        {NOTE_FOLDER_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Etiquetas (separadas por coma)
                  </label>
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Contenido
                </label>
                <textarea
                  rows={6}
                  maxLength={8000}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingNote(null)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                >
                  {savingEdit ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
