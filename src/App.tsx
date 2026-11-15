import { useState } from 'react';
import {
  Calendar,
  CheckSquare,
  FileText,
  LayoutDashboard,
  Loader2,
  Menu,
  MessageCircle,
  Mic,
  Moon,
  Settings,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { useAlarmEngine } from './hooks/useAlarmEngine';
import { useFirestoreData } from './hooks/useFirestoreData';
import { useWhatsApp } from './hooks/useWhatsApp';
import { AlarmOverlay } from './components/AlarmOverlay';
import { AssistantView } from './components/AssistantView';
import { CalendarView } from './components/CalendarView';
import { ContactsView } from './components/ContactsView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginScreen } from './components/LoginScreen';
import { NotesView } from './components/NotesView';
import { OverviewView } from './components/OverviewView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SettingsView } from './components/SettingsView';
import { TasksView } from './components/TasksView';
import { WhatsAppView } from './components/WhatsAppView';
import type { ActiveTab, Contact } from './types';

const VALID_TABS: ActiveTab[] = [
  'overview',
  'assistant',
  'whatsapp',
  'calendar',
  'tasks',
  'contacts',
  'notes',
  'settings',
];

function getInitialTabFromUrl(): ActiveTab {
  if (typeof window === 'undefined') return 'overview';
  const param = new URLSearchParams(window.location.search).get('tab') as ActiveTab | null;
  return param && VALID_TABS.includes(param) ? param : 'overview';
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Resumen', icon: LayoutDashboard },
  { id: 'assistant', label: 'Asistente IA', icon: Mic },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'calendar', label: 'Calendario', icon: Calendar },
  { id: 'tasks', label: 'Tareas', icon: CheckSquare },
  { id: 'contacts', label: 'Contactos', icon: Users },
  { id: 'notes', label: 'Notas rápidas', icon: FileText },
  { id: 'settings', label: 'Ajustes', icon: Settings },
];

function KairoWorkspace() {
  const { user, profile, authReady, profileReady } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => getInitialTabFromUrl());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [preselectedContact, setPreselectedContact] = useState<Contact | null>(null);

  const {
    events,
    tasks,
    contacts,
    notes,
    loading: dataLoading,
    createEvent,
    updateEvent,
    deleteEvent,
    createTask,
    updateTask,
    applyBatchTaskPrioritization,
    deleteTask,
    createContact,
    updateContact,
    deleteContact,
    createNote,
    updateNote,
    deleteNote,
  } = useFirestoreData();

  const {
    waState,
    busy: waBusy,
    chats: waChats,
    messagesByJid: waMessagesByJid,
    activeJid: waActiveJid,
    loadingMessages: waLoadingMessages,
    totalUnread: waTotalUnread,
    connect: connectWhatsApp,
    disconnect: disconnectWhatsApp,
    selectChat: selectWhatsAppChat,
    startChatByPhone: startWhatsAppChatByPhone,
    sendMessage: sendWhatsApp,
    sendTyping: sendWhatsAppTyping,
    refreshStatus: refreshWhatsApp,
    refreshChats: refreshWhatsAppChats,
  } = useWhatsApp();

  const { activeAlarms, snoozeAlarm, dismissAlarm } = useAlarmEngine({
    events,
    contacts,
    profile,
    waState,
    onDismissAlarm: (eventId) => updateEvent(eventId, { alarmDismissed: true }),
    onMarkWhatsappSent: (eventId) => updateEvent(eventId, { whatsappConfirmationSent: true }),
    onSendWhatsApp: sendWhatsApp,
  });

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  const activeNav = NAV_ITEMS.find((item) => item.id === activeTab) || NAV_ITEMS[0];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col justify-between bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-5">
        <div className="space-y-8">
          <div className="px-2">
            <span className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Kairo
            </span>
          </div>

          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate flex-1 text-left">{item.label}</span>
                  {item.id === 'whatsapp' && waTotalUnread > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#25D366] text-white text-[11px] font-semibold inline-flex items-center justify-center font-mono tabular-nums">
                      {waTotalUnread}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <button
            type="button"
            onClick={() => setActiveTab('whatsapp')}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer"
          >
            <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300 truncate">
              <MessageCircle
                className={`w-3.5 h-3.5 shrink-0 ${
                  waState.status === 'connected' ? 'text-emerald-600' : 'text-slate-400'
                }`}
              />
              <span className="truncate">
                {waState.status === 'connected' ? 'WhatsApp activo' : 'WhatsApp sin vincular'}
              </span>
            </span>
          </button>

          <div className="px-2">
            <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
              {profile?.displayName || user.displayName || 'Usuario'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
          </div>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-5 flex flex-col justify-between z-10">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <span className="font-display text-xl font-bold">Kairo</span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg text-slate-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                      {item.id === 'whatsapp' && waTotalUnread > 0 && (
                        <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#25D366] text-white text-[11px] font-semibold inline-flex items-center justify-center font-mono tabular-nums">
                          {waTotalUnread}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 px-4 sm:px-8 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Abrir menú"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">Kairo</span>
              <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-slate-900 dark:text-slate-50 truncate">
                {activeNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton variant="header" />
            {activeTab !== 'assistant' && (
              <button
                type="button"
                onClick={() => setActiveTab('assistant')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" />
                Hablar con Kairo
              </button>
            )}
            <button
              type="button"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={resolvedTheme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
          </div>
        </header>

        <main
          className={`flex-1 w-full mx-auto ${
            activeTab === 'whatsapp'
              ? 'p-2 sm:p-4 max-w-7xl'
              : 'p-4 sm:p-8 max-w-6xl'
          }`}
        >
          {!profileReady || dataLoading ? (
            <div className="space-y-4">
              <div className="h-24 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
              <div className="h-64 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  events={events}
                  tasks={tasks}
                  contacts={contacts}
                  notes={notes}
                  profile={profile}
                  waState={waState}
                  onNavigate={setActiveTab}
                  onCreateEvent={createEvent}
                  onCreateTask={createTask}
                  onCreateNote={createNote}
                  onToggleTask={(task) => updateTask(task.id, { completed: !task.completed })}
                  onMarkWhatsappSent={(eventId) =>
                    updateEvent(eventId, { whatsappConfirmationSent: true })
                  }
                  onSendWhatsApp={sendWhatsApp}
                />
              )}

              {activeTab === 'assistant' && (
                <AssistantView
                  userId={user.uid}
                  events={events}
                  tasks={tasks}
                  contacts={contacts}
                  notes={notes}
                  profile={profile}
                  waState={waState}
                  waChats={waChats}
                  waMessagesByJid={waMessagesByJid}
                  onNavigate={setActiveTab}
                  onOpenWhatsAppChat={(jid) => {
                    void selectWhatsAppChat(jid);
                    setActiveTab('whatsapp');
                  }}
                  onCreateEvent={createEvent}
                  onCreateTask={createTask}
                  onCompleteTask={(taskId) => updateTask(taskId, { completed: true })}
                  onCreateNote={createNote}
                  onCreateContact={createContact}
                  onSendWhatsApp={sendWhatsApp}
                />
              )}

              {activeTab === 'whatsapp' && (
                <WhatsAppView
                  userId={user.uid}
                  waState={waState}
                  waBusy={waBusy}
                  chats={waChats}
                  messagesByJid={waMessagesByJid}
                  activeJid={waActiveJid}
                  loadingMessages={waLoadingMessages}
                  contacts={contacts}
                  onConnect={connectWhatsApp}
                  onDisconnect={disconnectWhatsApp}
                  onRefreshStatus={refreshWhatsApp}
                  onRefreshChats={refreshWhatsAppChats}
                  onSelectChat={selectWhatsAppChat}
                  onStartChatByPhone={startWhatsAppChatByPhone}
                  onSendMessage={sendWhatsApp}
                  onSendTyping={sendWhatsAppTyping}
                  onSaveToContacts={createContact}
                  onScheduleWithPhone={(name, phone) => {
                    const digits = phone.replace(/[^\d]/g, '');
                    const matched = contacts.find(
                      (c) => c.phone.replace(/[^\d]/g, '') === digits
                    );
                    if (matched) {
                      setPreselectedContact(matched);
                    } else {
                      setPreselectedContact({
                        id: '',
                        userId: user.uid,
                        name,
                        phone,
                        email: '',
                        role: '',
                        category: 'personal',
                        notes: '',
                      });
                    }
                    setActiveTab('calendar');
                  }}
                />
              )}

              {activeTab === 'calendar' && (
                <CalendarView
                  events={events}
                  contacts={contacts}
                  profile={profile}
                  waState={waState}
                  preselectedContact={preselectedContact}
                  onClearPreselectedContact={() => setPreselectedContact(null)}
                  onCreateEvent={createEvent}
                  onUpdateEvent={updateEvent}
                  onDeleteEvent={deleteEvent}
                  onSendWhatsApp={sendWhatsApp}
                />
              )}

              {activeTab === 'tasks' && (
                <TasksView
                  tasks={tasks}
                  events={events}
                  onCreateTask={createTask}
                  onUpdateTask={updateTask}
                  onBatchPrioritize={applyBatchTaskPrioritization}
                  onDeleteTask={deleteTask}
                />
              )}

              {activeTab === 'contacts' && (
                <ContactsView
                  contacts={contacts}
                  waState={waState}
                  onCreateContact={createContact}
                  onUpdateContact={updateContact}
                  onDeleteContact={deleteContact}
                  onSendWhatsApp={sendWhatsApp}
                  onOpenWhatsAppChat={(contact) => {
                    void startWhatsAppChatByPhone(contact.phone, contact.name);
                    setActiveTab('whatsapp');
                  }}
                  onScheduleWithContact={(contact) => {
                    setPreselectedContact(contact);
                    setActiveTab('calendar');
                  }}
                />
              )}

              {activeTab === 'notes' && (
                <NotesView
                  notes={notes}
                  onCreateNote={createNote}
                  onUpdateNote={updateNote}
                  onDeleteNote={deleteNote}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  waState={waState}
                  waBusy={waBusy}
                  onConnectWhatsApp={connectWhatsApp}
                  onDisconnectWhatsApp={disconnectWhatsApp}
                  onRefreshWhatsApp={refreshWhatsApp}
                />
              )}
            </>
          )}
        </main>
      </div>

      <AlarmOverlay
        alarms={activeAlarms}
        onSnooze={(id) => snoozeAlarm(id, 5)}
        onDismiss={dismissAlarm}
      />
      <OfflineIndicator />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <KairoWorkspace />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
