import { BellRing, Calendar, CheckSquare, FileText, LogIn, MessageCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Moon, Sun } from 'lucide-react';

export function LoginScreen() {
  const { signInWithGoogle, signingIn, authError } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between">
      <header className="w-full max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-8">
        <span className="font-display text-xl font-bold tracking-tight whitespace-nowrap shrink-0">
          Kairo
        </span>
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
        >
          {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {resolvedTheme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        </button>
      </header>

      <main className="w-full max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7 space-y-6">
          <p className="text-xs font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400">
            Asistente Personal Ejecutivo
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-50 leading-tight text-balance">
            Tu agenda, prioridades diarias y confirmaciones por WhatsApp en un solo lugar.
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-300 max-w-xl leading-relaxed">
            Organiza tus citas con alarmas puntuales, prioriza tu día con inteligencia artificial, envía recordatorios por WhatsApp un día antes y estructura notas rápidas al instante.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Calendario y alarmas</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Alertas sonoras anticipadas para citas importantes y seguimiento visual en tiempo real.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Priorización inteligente</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Ordena tus tareas del día según tu agenda real y la matriz de Eisenhower.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <MessageCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Confirmación WhatsApp</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Vincula tu cuenta por QR y confirma asistencia a tus contactos 1 día antes de cada cita.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Notas rápidas por voz</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Dicta o escribe ideas sueltas y organízalas automáticamente en carpetas y etiquetas.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 space-y-6">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center">
                <BellRing className="w-5 h-5" />
              </div>
              <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-50">
                Inicia sesión en Kairo
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Accede con tu cuenta de Google para sincronizar tus citas, tareas, contactos y notas de forma privada.
              </p>
            </div>

            {authError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                {authError}
              </div>
            )}

            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={signingIn}
              className="w-full inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium text-sm transition-colors cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>{signingIn ? 'Conectando con Google...' : 'Continuar con Google'}</span>
            </button>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
              <ShieldCheck className="w-4 h-4 shrink-0 text-slate-400" />
              <span>Tus datos se almacenan aislados por usuario en Firestore con reglas de seguridad estrictas.</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full max-w-6xl mx-auto px-6 py-5 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
        <span>Kairo — Asistente Personal</span>
        <span>Calendario · Tareas · Contactos · Notas</span>
      </footer>
    </div>
  );
}
