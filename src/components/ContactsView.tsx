import { useState } from 'react';
import {
  CalendarPlus,
  Edit3,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Send,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { buildWhatsAppLink, CONTACT_CATEGORY_LABELS, isValidPhone } from '../lib/utils';
import type { Contact, ContactCategory, WhatsAppState } from '../types';

interface ContactsViewProps {
  contacts: Contact[];
  waState: WhatsAppState;
  onCreateContact: (input: {
    name: string;
    phone: string;
    email: string;
    role: string;
    category: ContactCategory;
    notes: string;
  }) => Promise<void>;
  onUpdateContact: (
    contactId: string,
    patch: Partial<{
      name: string;
      phone: string;
      email: string;
      role: string;
      category: ContactCategory;
      notes: string;
    }>
  ) => Promise<void>;
  onDeleteContact: (contactId: string) => Promise<void>;
  onSendWhatsApp: (phone: string, message: string) => Promise<{ ok: boolean; error?: string }>;
  onOpenWhatsAppChat: (contact: Contact) => void;
  onScheduleWithContact: (contact: Contact) => void;
}

const CATEGORIES: ContactCategory[] = ['trabajo', 'cliente', 'personal', 'familia'];

export function ContactsView({
  contacts,
  waState,
  onCreateContact,
  onUpdateContact,
  onDeleteContact,
  onSendWhatsApp,
  onOpenWhatsAppChat,
  onScheduleWithContact,
}: ContactsViewProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ContactCategory>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [category, setCategory] = useState<ContactCategory>('trabajo');
  const [notes, setNotes] = useState('');

  const [waModalContact, setWaModalContact] = useState<Contact | null>(null);
  const [waMessage, setWaMessage] = useState('');
  const [waSending, setWaSending] = useState(false);
  const [waFeedback, setWaFeedback] = useState<string | null>(null);

  const filteredContacts = contacts.filter((c) => {
    if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      c.role.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q)
    );
  });

  const openCreateModal = () => {
    setEditingId(null);
    setName('');
    setPhone('+');
    setEmail('');
    setRole('');
    setCategory('trabajo');
    setNotes('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (c: Contact) => {
    setEditingId(c.id);
    setName(c.name);
    setPhone(c.phone);
    setEmail(c.email);
    setRole(c.role);
    setCategory(c.category);
    setNotes(c.notes);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;

    if (!isValidPhone(phone)) {
      setFormError('Ingresa un teléfono válido con código de país (ej. +502 5555 1234).');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await onUpdateContact(editingId, { name, phone, email, role, category, notes });
      } else {
        await onCreateContact({ name, phone, email, role, category, notes });
      }
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSendQuickWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waModalContact || !waMessage.trim() || waSending) return;

    if (waState.status === 'connected') {
      setWaSending(true);
      setWaFeedback(null);
      const res = await onSendWhatsApp(waModalContact.phone, waMessage.trim());
      setWaSending(false);
      if (res.ok) {
        setWaModalContact(null);
        setWaMessage('');
      } else {
        setWaFeedback(res.error || 'No se pudo enviar.');
      }
    } else {
      window.open(
        buildWhatsAppLink(waModalContact.phone, waMessage.trim()),
        '_blank',
        'noopener,noreferrer'
      );
      setWaModalContact(null);
      setWaMessage('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
            Directorio de contactos
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Guarda teléfonos con código de país para enviar mensajes y confirmaciones por WhatsApp.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Nuevo contacto
        </button>
      </div>

      {/* Search & Category Filter */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono, empresa..."
            className="w-full h-10 pl-9 pr-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
          />
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-x-auto">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
              categoryFilter === 'all'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Todos
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {CONTACT_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      {/* Contacts List */}
      {filteredContacts.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl py-12 text-center space-y-2">
          <User className="w-6 h-6 mx-auto text-slate-400" />
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {contacts.length === 0
              ? 'Aún no tienes contactos guardados.'
              : 'Ningún contacto coincide con tu búsqueda.'}
          </p>
          {contacts.length === 0 && (
            <button
              type="button"
              onClick={openCreateModal}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Agregar primer contacto
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredContacts.map((contact) => (
            <div
              key={contact.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{CONTACT_CATEGORY_LABELS[contact.category]}</span>
                    {contact.role && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{contact.role}</span>
                      </>
                    )}
                  </div>
                  <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50 truncate">
                    {contact.name}
                  </h3>
                  <div className="space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                    <p className="flex items-center gap-1.5 font-mono tabular-nums">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      {contact.phone}
                    </p>
                    {contact.email && (
                      <p className="flex items-center gap-1.5 truncate">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        {contact.email}
                      </p>
                    )}
                  </div>
                  {contact.notes && (
                    <p className="pt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                      {contact.notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(contact)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    title="Editar"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteContact(contact.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    title="Eliminar"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenWhatsAppChat(contact)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Abrir chat
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWaModalContact(contact);
                      setWaMessage(`Hola ${contact.name}, `);
                      setWaFeedback(null);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-medium cursor-pointer whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Mensaje rápido
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onScheduleWithContact(contact)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap"
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  Agendar cita
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Contact Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">
                {editingId ? 'Editar contacto' : 'Nuevo contacto'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              {formError && (
                <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Nombre completo *
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Teléfono WhatsApp *
                  </label>
                  <input
                    type="tel"
                    required
                    maxLength={24}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+502 5555 1234"
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Categoría
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ContactCategory)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CONTACT_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Cargo / Empresa
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                  />
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
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer"
                >
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick WhatsApp Modal */}
      {waModalContact && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold">
                  Mensaje a {waModalContact.name}
                </h3>
                <p className="text-xs font-mono text-slate-500">{waModalContact.phone}</p>
              </div>
              <button
                type="button"
                onClick={() => setWaModalContact(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendQuickWhatsApp} className="space-y-3">
              {waFeedback && (
                <p className="text-xs text-red-600 dark:text-red-400">{waFeedback}</p>
              )}
              <textarea
                rows={4}
                required
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
                placeholder="Escribe tu mensaje..."
                className="w-full p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {waState.status === 'connected'
                  ? 'Se enviará directamente desde tu WhatsApp vinculado.'
                  : 'WhatsApp no está vinculado por QR: se abrirá WhatsApp Web con el mensaje listo.'}
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWaModalContact(null)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={waSending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  {waSending ? 'Enviando...' : 'Enviar WhatsApp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
