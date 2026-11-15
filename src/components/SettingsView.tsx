import { useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  Loader2,
  LogOut,
  MessageCircle,
  Moon,
  QrCode,
  RefreshCw,
  Sun,
  Monitor,
  Volume2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { playAlarmChime } from '../lib/alarmAudio';
import { PWAInstallButton } from './PWAInstallButton';
import type { WhatsAppState } from '../types';

interface SettingsViewProps {
  waState: WhatsAppState;
  waBusy: boolean;
  onConnectWhatsApp: () => Promise<void>;
  onDisconnectWhatsApp: () => Promise<void>;
  onRefreshWhatsApp: () => Promise<void>;
}

export function SettingsView({
  waState,
  waBusy,
  onConnectWhatsApp,
  onDisconnectWhatsApp,
  onRefreshWhatsApp,
}: SettingsViewProps) {
  const { profile, updatePreferences, signOut } = useAuth();
  const { theme, setTheme } = useTheme();

  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [defaultReminderMinutes, setDefaultReminderMinutes] = useState(
    profile?.defaultReminderMinutes ?? 15
  );
  const [alarmSoundEnabled, setAlarmSoundEnabled] = useState(
    profile?.alarmSoundEnabled ?? true
  );
  const [whatsappAutoSendEnabled, setWhatsappAutoSendEnabled] = useState(
    profile?.whatsappAutoSendEnabled ?? false
  );
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedNotice(false);
    try {
      await updatePreferences({
        displayName,
        defaultReminderMinutes,
        alarmSoundEnabled,
        whatsappAutoSendEnabled,
      });
      setSavedNotice(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
          WhatsApp y preferencias
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Vincula tu cuenta de WhatsApp mediante código QR y configura tus alarmas predeterminadas.
        </p>
      </div>

      {/* App Install Card (Android, iOS, Windows) */}
      <PWAInstallButton variant="card" />

      {/* WhatsApp Linking Card */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
                Vinculación real con WhatsApp
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Permite enviar confirmaciones automáticas de asistencia 1 día antes de tus citas.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void onRefreshWhatsApp()}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              title="Actualizar estado"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {waState.status === 'connected' ? (
              <button
                type="button"
                disabled={waBusy}
                onClick={() => void onDisconnectWhatsApp()}
                className="px-4 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-medium cursor-pointer"
              >
                Desvincular sesión
              </button>
            ) : (
              <button
                type="button"
                disabled={waBusy}
                onClick={() => void onConnectWhatsApp()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
              >
                {waBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <QrCode className="w-4 h-4" />
                )}
                {waState.status === 'qr' ? 'Generar nuevo QR' : 'Vincular WhatsApp'}
              </button>
            )}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
          {waState.status === 'connected' && (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  WhatsApp conectado ({waState.displayName || 'Cuenta activa'})
                </p>
                {waState.phoneNumber && (
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    {waState.phoneNumber}
                  </p>
                )}
              </div>
            </div>
          )}

          {waState.status === 'connecting' && (
            <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              <span>Iniciando sesión con WhatsApp Web y generando código QR...</span>
            </div>
          )}

          {waState.status === 'qr' && waState.qrDataUrl && (
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <img
                src={waState.qrDataUrl}
                alt="Código QR para vincular WhatsApp"
                className="w-52 h-52 rounded-xl border border-slate-200 bg-white p-2 shrink-0"
              />
              <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Escanea este código desde tu teléfono
                </p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Abre WhatsApp en tu teléfono.</li>
                  <li>Ve a Dispositivos vinculados y toca Vincular un dispositivo.</li>
                  <li>Apunta la cámara hacia este código QR.</li>
                </ol>
              </div>
            </div>
          )}

          {(waState.status === 'disconnected' || waState.status === 'error') && (
            <div className="space-y-1">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Estado: Desconectado
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {waState.errorMessage ||
                  'Sin sesión vinculada. Aunque no la vincules, puedes seguir enviando confirmaciones abriendo WhatsApp Web en un clic.'}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Profile & Alarm Preferences */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
              Preferencias del asistente y alarmas
            </h3>
          </div>
          <button
            type="button"
            onClick={() => playAlarmChime(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Volume2 className="w-3.5 h-3.5" />
            Probar sonido de alarma
          </button>
        </div>

        <form onSubmit={handleSavePrefs} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Nombre en Kairo
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Alarma predeterminada para nuevas citas
              </label>
              <select
                value={defaultReminderMinutes}
                onChange={(e) => setDefaultReminderMinutes(Number(e.target.value))}
                className="w-full h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
              >
                <option value={5}>5 minutos antes</option>
                <option value={15}>15 minutos antes</option>
                <option value={30}>30 minutos antes</option>
                <option value={60}>1 hora antes</option>
              </select>
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={alarmSoundEnabled}
                onChange={(e) => setAlarmSoundEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
              />
              <span>Reproducir tono de alarma al acercarse una cita</span>
            </label>

            <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={whatsappAutoSendEnabled}
                onChange={(e) => setWhatsappAutoSendEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
              />
              <span>
                Enviar automáticamente confirmaciones de mañana cuando WhatsApp esté conectado
              </span>
            </label>
          </div>

          <div className="pt-2 flex items-center justify-between gap-4">
            <div className="text-xs text-emerald-700 dark:text-emerald-400">
              {savedNotice && 'Preferencias guardadas correctamente.'}
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium cursor-pointer"
            >
              {saving ? 'Guardando...' : 'Guardar preferencias'}
            </button>
          </div>
        </form>
      </section>

      {/* Appearance & Account */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-50">
            Apariencia de la interfaz
          </h3>
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                theme === 'light'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              Claro
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                theme === 'dark'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              Oscuro
            </button>
            <button
              type="button"
              onClick={() => setTheme('system')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                theme === 'system'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              Sistema
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 self-start sm:self-auto cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </section>
    </div>
  );
}
