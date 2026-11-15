import { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Monitor,
  Share,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, platform, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopyUrl = async () => {
    if (!appUrl || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handlePrimaryInstall = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) return;
      setShowGuide(false);
      return;
    }
    setShowGuide(true);
  };

  if (variant === 'header') {
    if (isInstalled) return null;

    return (
      <>
        <button
          type="button"
          onClick={() => void handlePrimaryInstall()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          title="Instalar Kairo en Android, iOS o Windows"
        >
          <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span className="hidden sm:inline">
            {isInstallable ? 'Instalar app' : 'Instalar'}
          </span>
        </button>

        {showGuide && (
          <InstallGuideModal
            platform={platform}
            isInIframe={isInIframe}
            isInstallable={isInstallable}
            appUrl={appUrl}
            copiedUrl={copiedUrl}
            onCopyUrl={handleCopyUrl}
            onInstall={handlePrimaryInstall}
            onClose={() => setShowGuide(false)}
          />
        )}
      </>
    );
  }

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
              Instalar aplicación en Android, iOS y Windows
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Instala Kairo en tu pantalla de inicio o escritorio para abrirla como app independiente con acceso rápido y caché sin conexión.
          </p>
        </div>

        {isInstalled ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-xs font-medium text-emerald-700 dark:text-emerald-300 shrink-0">
            <CheckCircle2 className="w-4 h-4" />
            Instalada en este dispositivo
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void handlePrimaryInstall()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            {isInstallable ? 'Instalar ahora' : 'Cómo instalar en mi dispositivo'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <Smartphone className="w-4 h-4 text-emerald-600" />
            <span>Android (Chrome / Edge)</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Pulsa <strong>Instalar app</strong> arriba o abre el menú del navegador (⋮) y elige <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <Share className="w-4 h-4 text-blue-600" />
            <span>iOS (iPhone / iPad en Safari)</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Abre esta dirección en <strong>Safari</strong>, toca el botón <strong>Compartir</strong> y selecciona <strong>Añadir a pantalla de inicio</strong>.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
            <Monitor className="w-4 h-4 text-indigo-600" />
            <span>Windows 10 / 11 (Edge / Chrome)</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Pulsa <strong>Instalar app</strong> o el ícono de instalación en la barra de direcciones para crear un acceso directo en el Menú Inicio y barra de tareas.
          </p>
        </div>
      </div>

      {showGuide && (
        <InstallGuideModal
          platform={platform}
          isInIframe={isInIframe}
          isInstallable={isInstallable}
          appUrl={appUrl}
          copiedUrl={copiedUrl}
          onCopyUrl={handleCopyUrl}
          onInstall={handlePrimaryInstall}
          onClose={() => setShowGuide(false)}
        />
      )}
    </section>
  );
}

interface InstallGuideModalProps {
  platform: 'android' | 'ios' | 'windows' | 'other';
  isInIframe: boolean;
  isInstallable: boolean;
  appUrl: string;
  copiedUrl: boolean;
  onCopyUrl: () => void;
  onInstall: () => void;
  onClose: () => void;
}

function InstallGuideModal({
  platform,
  isInIframe,
  isInstallable,
  appUrl,
  copiedUrl,
  onCopyUrl,
  onInstall,
  onClose,
}: InstallGuideModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
              Instalar Kairo en tu dispositivo
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Compatible con Android, iPhone/iPad (iOS) y Windows como aplicación independiente.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isInIframe && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200 space-y-2">
            <p>
              Estás viendo la app dentro de una vista previa integrada. Para activar la descarga directa en tu dispositivo, abre esta dirección en una pestaña directa de Chrome, Edge o Safari:
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={appUrl}
                className="flex-1 h-8 px-2.5 rounded-lg bg-white dark:bg-slate-950 border border-amber-200 dark:border-amber-800 text-[11px] font-mono text-slate-700 dark:text-slate-200"
              />
              <button
                type="button"
                onClick={onCopyUrl}
                className="h-8 px-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer shrink-0"
              >
                {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedUrl ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3 text-xs text-slate-700 dark:text-slate-300">
          {(platform === 'ios' || platform === 'other') && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Share className="w-3.5 h-3.5 text-blue-600" />
                iOS (iPhone / iPad — Safari)
              </p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Abre Kairo en <strong>Safari</strong>.</li>
                <li>Toca el ícono <strong>Compartir</strong> en la barra inferior o superior.</li>
                <li>Desliza y selecciona <strong>Añadir a pantalla de inicio</strong>.</li>
              </ol>
            </div>
          )}

          {(platform === 'android' || platform === 'other') && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                Android (Chrome / Edge)
              </p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Abre Kairo en <strong>Chrome</strong> o <strong>Edge</strong>.</li>
                <li>Toca el menú <strong>⋮</strong> en la esquina superior derecha.</li>
                <li>Elige <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</li>
              </ol>
            </div>
          )}

          {(platform === 'windows' || platform === 'other') && (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <p className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-indigo-600" />
                Windows 10 / 11 (Edge / Chrome)
              </p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Abre Kairo en <strong>Microsoft Edge</strong> o <strong>Google Chrome</strong>.</li>
                <li>Haz clic en el ícono de <strong>Instalar</strong> en la barra de direcciones (o menú → Aplicaciones → Instalar Kairo).</li>
                <li>Quedará instalada en el Menú Inicio y como ventana propia.</li>
              </ol>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {isInstallable && (
            <button
              type="button"
              onClick={onInstall}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Instalar ahora
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
