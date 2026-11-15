import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  RotateCcw,
  Send,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  buildWorkspaceContext,
  executeAssistantToolCall,
  type AssistantToolDeps,
} from '../lib/assistantExecutor';
import { getLocalDateStr } from '../lib/utils';
import { useLiveVoiceSession } from '../hooks/useLiveVoiceSession';
import type { AssistantActionLog, AssistantMessage, VoiceName } from '../types';

interface AssistantViewProps extends AssistantToolDeps {}

const VOICES: Array<{ id: VoiceName; label: string }> = [
  { id: 'Kore', label: 'Kore (Clara y ejecutiva)' },
  { id: 'Zephyr', label: 'Zephyr (Cálida y serena)' },
  { id: 'Puck', label: 'Puck (Dinámica)' },
  { id: 'Charon', label: 'Charon (Profunda)' },
  { id: 'Fenrir', label: 'Fenrir (Firme)' },
];

const STARTER_PROMPTS = [
  '¿Qué chats de WhatsApp tengo sin leer?',
  '¿Qué citas y tareas urgentes tengo para hoy?',
  'Agéndame una reunión mañana a las 10:00 para revisar presupuesto',
  'Resume mis notas pendientes más recientes',
];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function AssistantView(props: AssistantViewProps) {
  const [mode, setMode] = useState<'chat' | 'live'>('chat');
  const [voiceName, setVoiceName] = useState<VoiceName>('Kore');
  const [autoSpeak, setAutoSpeak] = useState(true);

  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Hola, soy Kairo. Puedes escribirme o hablarme con naturalidad para consultar tu agenda, agendar citas, organizar tareas, guardar notas o enviar confirmaciones por WhatsApp.',
      timestamp: new Date().toTimeString().slice(0, 5),
    },
  ]);
  const [geminiHistory, setGeminiHistory] = useState<Array<Record<string, unknown>>>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [liveTextInput, setLiveTextInput] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const live = useLiveVoiceSession(props, voiceName);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, live.transcripts]);

  useEffect(() => {
    return () => {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
    };
  }, []);

  const stopTtsPlayback = () => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    setSpeakingMessageId(null);
  };

  const speakText = async (messageId: string, text: string) => {
    if (speakingMessageId === messageId) {
      stopTtsPlayback();
      return;
    }
    stopTtsPlayback();
    setSpeakingMessageId(messageId);
    try {
      const res = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceName }),
      });
      const data = (await res.json()) as { audioBase64?: string; error?: string };
      if (!res.ok || !data.audioBase64) {
        throw new Error(data.error || 'No se pudo sintetizar la voz.');
      }
      const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
      ttsAudioRef.current = audio;
      audio.onended = () => setSpeakingMessageId(null);
      audio.onerror = () => setSpeakingMessageId(null);
      await audio.play();
    } catch (err) {
      setSpeakingMessageId(null);
      setError(err instanceof Error ? err.message : 'Error reproduciendo voz.');
    }
  };

  const sendMessageToAssistant = async (rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);
    stopTtsPlayback();

    const userMsgId = `u-${Date.now()}`;
    const timeStr = new Date().toTimeString().slice(0, 5);
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', text: trimmed, timestamp: timeStr },
    ]);
    setInput('');

    const userTurn = { role: 'user', parts: [{ text: trimmed }] };
    let workingContents = [...geminiHistory, userTurn];
    const context = buildWorkspaceContext(props);
    const todayDate = getLocalDateStr();
    const collectedActions: AssistantActionLog[] = [];

    try {
      let finalReply = '';
      let iterations = 0;

      while (iterations < 25) {
        iterations += 1;
        const res = await fetch('/api/ai/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: workingContents,
            context,
            todayDate,
            currentTime: timeStr,
          }),
        });
        const data = (await res.json()) as {
          text?: string;
          functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
          modelContent?: Record<string, unknown>;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'No se pudo obtener respuesta de Kairo.');
        }

        if (data.modelContent) {
          workingContents = [...workingContents, data.modelContent];
        }

        if (data.functionCalls && data.functionCalls.length > 0) {
          const responseParts = [];
          for (const call of data.functionCalls) {
            const executed = await executeAssistantToolCall(call, props);
            collectedActions.push(executed.log);
            responseParts.push({ functionResponse: executed.functionResponse });
          }
          workingContents = [
            ...workingContents,
            { role: 'user', parts: responseParts },
          ];
          continue;
        }

        finalReply = data.text?.trim() || 'Listo, he actualizado tu espacio de trabajo.';
        break;
      }

      if (!finalReply) {
        finalReply =
          collectedActions.length > 0
            ? collectedActions.map((a) => a.summary).join('. ')
            : 'Listo, he actualizado tu espacio de trabajo.';
      }

      const assistantMsgId = `a-${Date.now()}`;
      setGeminiHistory(workingContents);
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: 'assistant',
          text: finalReply,
          timestamp: new Date().toTimeString().slice(0, 5),
          actions: collectedActions.length > 0 ? collectedActions : undefined,
        },
      ]);

      if (autoSpeak && finalReply) {
        void speakText(assistantMsgId, finalReply);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error comunicándose con Kairo.');
    } finally {
      setSending(false);
    }
  };

  const formatUiError = (err: unknown, fallback: string) => {
    const raw = err instanceof Error ? err.message : fallback;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      if (parsed?.error?.message) return parsed.error.message;
    } catch {
      // plain string
    }
    return raw || fallback;
  };

  const toggleVoiceRecording = async () => {
    if (recordingVoice) {
      mediaRecorderRef.current?.stop();
      setRecordingVoice(false);
      return;
    }

    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ];
      const chosenMime = candidates.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);
      const effectiveMime = recorder.mimeType || chosenMime || 'audio/webm';
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: effectiveMime });
        if (blob.size < 400) {
          setError('El audio fue demasiado corto. Mantén unos segundos mientras hablas.');
          return;
        }

        setTranscribing(true);
        try {
          const audioBase64 = await blobToBase64(blob);
          const res = await fetch('/api/ai/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64,
              mimeType: effectiveMime.split(';')[0].trim() || 'audio/webm',
            }),
          });
          const data = (await res.json()) as { text?: string; error?: string };
          if (!res.ok) {
            throw new Error(data.error || 'No se pudo transcribir la nota de voz.');
          }
          if (data.text && data.text.trim()) {
            await sendMessageToAssistant(data.text.trim());
          } else {
            setError('No se detectó voz en el audio. Intenta hablar más claro o cerca del micrófono.');
          }
        } catch (err) {
          setError(formatUiError(err, 'Error transcribiendo audio.'));
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingVoice(true);
    } catch {
      setError('Permite el acceso al micrófono para enviar mensajes de voz.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-50">
            Asistente de IA y voz
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Conversa en lenguaje natural por texto, notas de voz o llamada de voz en vivo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Voz de Kairo"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value as VoiceName)}
            className="h-9 px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                Voz: {v.label}
              </option>
            ))}
          </select>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                if (live.status !== 'idle') live.stopSession();
                setMode('chat');
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                mode === 'chat'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Chat con voz
            </button>
            <button
              type="button"
              onClick={() => {
                stopTtsPlayback();
                setMode('live');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                mode === 'live'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <PhoneCall className="w-3.5 h-3.5" />
              Voz en vivo
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {mode === 'chat' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col h-[calc(100vh-16rem)] min-h-[480px]">
          {/* Chat Header Controls */}
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Conectada sin límite de mensajes a tu agenda, tareas, contactos, notas y WhatsApp
            </span>
            <div className="flex items-center gap-2">
              {messages.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    stopTtsPlayback();
                    setGeminiHistory([]);
                    setError(null);
                    setMessages([
                      {
                        id: `welcome-${Date.now()}`,
                        role: 'assistant',
                        text: 'Nueva conversación iniciada. ¿En qué te ayudo ahora?',
                        timestamp: new Date().toTimeString().slice(0, 5),
                      },
                    ]);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Nueva conversación</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (autoSpeak) stopTtsPlayback();
                  setAutoSpeak((v) => !v);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {autoSpeak ? (
                  <Volume2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span>{autoSpeak ? 'Lectura automática activa' : 'Solo texto'}</span>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                } space-y-1.5`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.text}</p>

                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-2.5 pt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-1">
                      {msg.actions.map((act) => (
                        <div
                          key={act.id}
                          className={`flex items-center gap-1.5 text-xs ${
                            act.ok
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>{act.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-400 px-1 font-mono tabular-nums">
                  <span>{msg.timestamp}</span>
                  {msg.role === 'assistant' && (
                    <button
                      type="button"
                      onClick={() => void speakText(msg.id, msg.text)}
                      className="inline-flex items-center gap-1 font-sans text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                    >
                      {speakingMessageId === msg.id ? (
                        <>
                          <Square className="w-3 h-3" /> Detener
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3 h-3" /> Escuchar
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {(sending || transcribing) && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>{transcribing ? 'Transcribiendo audio...' : 'Kairo está pensando...'}</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Starter Prompts */}
          {messages.length <= 2 && (
            <div className="px-5 pb-3 flex flex-wrap gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void sendMessageToAssistant(prompt)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 text-left cursor-pointer"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessageToAssistant(input);
            }}
            className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2.5"
          >
            <button
              type="button"
              onClick={() => void toggleVoiceRecording()}
              disabled={sending || transcribing}
              title={recordingVoice ? 'Detener y enviar nota de voz' : 'Grabar mensaje de voz'}
              className={`h-11 px-3.5 rounded-lg border inline-flex items-center gap-2 text-xs font-medium shrink-0 cursor-pointer transition-colors ${
                recordingVoice
                  ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {recordingVoice ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span className="hidden sm:inline">
                {recordingVoice ? 'Detener' : 'Hablar'}
              </span>
            </button>

            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe una orden o pregunta para Kairo..."
              className="flex-1 h-11 px-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            />

            <button
              type="submit"
              disabled={!input.trim() || sending || transcribing}
              className="h-11 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium inline-flex items-center gap-2 shrink-0 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Enviar</span>
            </button>
          </form>
        </div>
      ) : (
        /* Live Voice Mode */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="space-y-1">
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-50">
                  Conversación de voz en tiempo real
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {live.status === 'idle' && 'Pulsa Iniciar llamada para hablar directamente con Kairo.'}
                  {live.status === 'connecting' && 'Conectando canal de voz en vivo...'}
                  {live.status === 'listening' && 'Escuchando tu micrófono en tiempo real.'}
                  {live.status === 'speaking' && 'Kairo está respondiendo por voz.'}
                  {live.status === 'error' && 'La sesión de voz tuvo un problema.'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {live.status !== 'idle' && live.status !== 'error' && (
                  <button
                    type="button"
                    onClick={() => live.setMuted((m) => !m)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer ${
                      live.muted
                        ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {live.muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    {live.muted ? 'Silenciado' : 'Silenciar'}
                  </button>
                )}

                {live.status === 'idle' || live.status === 'error' ? (
                  <button
                    type="button"
                    onClick={() => void live.startSession()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer"
                  >
                    <PhoneCall className="w-4 h-4" />
                    Iniciar llamada
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={live.stopSession}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium cursor-pointer"
                  >
                    <PhoneOff className="w-4 h-4" />
                    Finalizar
                  </button>
                )}
              </div>
            </div>

            {live.error && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                {live.error}
              </div>
            )}

            {/* Live Transcript Feed */}
            <div className="h-72 overflow-y-auto space-y-3 pr-1">
              {live.transcripts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-2 text-slate-500 dark:text-slate-400">
                  <Mic className="w-7 h-7 text-slate-400" />
                  <p className="text-sm">
                    La transcripción en vivo aparecerá aquí mientras conversas.
                  </p>
                  <p className="text-xs max-w-sm">
                    Puedes interrumpir en cualquier momento o pedirle a Kairo que agende citas, cree tareas o envíe mensajes.
                  </p>
                </div>
              ) : (
                live.transcripts.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3 rounded-lg text-sm ${
                      item.role === 'user'
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-slate-900 dark:text-slate-100 ml-8'
                        : 'bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 mr-8'
                    }`}
                  >
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-0.5">
                      {item.role === 'user' ? 'Tú' : 'Kairo'}
                    </p>
                    <p>{item.text}</p>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Optional text nudge during live call */}
            {live.status !== 'idle' && live.status !== 'error' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!liveTextInput.trim()) return;
                  live.sendTextToLive(liveTextInput);
                  setLiveTextInput('');
                }}
                className="pt-3 border-t border-slate-100 dark:border-slate-800 flex gap-2"
              >
                <input
                  type="text"
                  value={liveTextInput}
                  onChange={(e) => setLiveTextInput(e.target.value)}
                  placeholder="Enviar texto puntual durante la llamada..."
                  className="flex-1 h-10 px-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                />
                <button
                  type="submit"
                  className="h-10 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Enviar
                </button>
              </form>
            )}
          </div>

          {/* Live Actions Executed */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Acciones ejecutadas por voz
            </h3>
            {live.actionLogs.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center border-t border-slate-100 dark:border-slate-800">
                Cuando pidas agendar una cita, crear una tarea o guardar una nota durante la llamada, verás el registro aquí.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {live.actionLogs.map((log) => (
                  <div key={log.id} className="py-2.5 flex items-start gap-2 text-xs">
                    <CheckCircle2
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        log.ok ? 'text-emerald-600' : 'text-red-500'
                      }`}
                    />
                    <span className="text-slate-700 dark:text-slate-200">{log.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
