import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildWorkspaceContext,
  executeAssistantToolCall,
  type AssistantToolDeps,
} from '../lib/assistantExecutor';
import { getLocalDateStr } from '../lib/utils';
import type { AssistantActionLog, VoiceName } from '../types';

export type LiveStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error';

export interface LiveTranscriptItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

function floatTo16BitPcmBase64(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const outBuffer = new ArrayBuffer(sampleCount * 4);
  const float32 = new Float32Array(outBuffer);
  for (let i = 0; i < float32.length; i += 1) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export function useLiveVoiceSession(deps: AssistantToolDeps, voiceName: VoiceName) {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<LiveTranscriptItem[]>([]);
  const [actionLogs, setActionLogs] = useState<AssistantActionLog[]>([]);

  const depsRef = useRef(deps);
  depsRef.current = deps;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const stopPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore
      }
    }
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  }, []);

  const stopSession = useCallback(() => {
    stopPlayback();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (inputCtxRef.current) {
      void inputCtxRef.current.close();
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      void outputCtxRef.current.close();
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setStatus('idle');
    setMuted(false);
  }, [stopPlayback]);

  useEffect(() => stopSession, [stopSession]);

  const appendTranscript = useCallback((role: 'user' | 'assistant', chunk: string) => {
    const clean = chunk.trim();
    if (!clean) return;
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role) {
        const merged = `${last.text} ${clean}`.trim();
        return [...prev.slice(0, -1), { ...last, text: merged }];
      }
      return [...prev, { id: `${Date.now()}-${Math.random()}`, role, text: clean }];
    });
  }, []);

  const startSession = useCallback(async () => {
    if (status !== 'idle' && status !== 'error') return;
    setError(null);
    setStatus('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'init',
            voiceName,
            todayDate: getLocalDateStr(),
            currentTime: new Date().toTimeString().slice(0, 5),
            context: buildWorkspaceContext(depsRef.current),
          })
        );
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data) as {
          type: string;
          data?: string;
          text?: string;
          message?: string;
          calls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>;
        };

        if (msg.type === 'ready') {
          setStatus('listening');
          if (processorRef.current) return;
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          processor.onaudioprocess = (audioEvent) => {
            if (mutedRef.current || ws.readyState !== WebSocket.OPEN) return;
            const channel = audioEvent.inputBuffer.getChannelData(0);
            const base64 = floatTo16BitPcmBase64(channel);
            ws.send(JSON.stringify({ type: 'audio', data: base64 }));
          };

          source.connect(processor);
          processor.connect(inputCtx.destination);
        } else if (msg.type === 'audio' && msg.data) {
          setStatus('speaking');
          const float32 = base64PcmToFloat32(msg.data);
          const audioBuffer = outputCtx.createBuffer(1, float32.length, 24000);
          audioBuffer.copyToChannel(float32, 0);

          const src = outputCtx.createBufferSource();
          src.buffer = audioBuffer;
          src.connect(outputCtx.destination);

          const startAt = Math.max(outputCtx.currentTime, nextStartTimeRef.current);
          src.start(startAt);
          nextStartTimeRef.current = startAt + audioBuffer.duration;
          activeSourcesRef.current.add(src);

          src.onended = () => {
            activeSourcesRef.current.delete(src);
            if (activeSourcesRef.current.size === 0) {
              setStatus((curr) => (curr === 'speaking' ? 'listening' : curr));
            }
          };
        } else if (msg.type === 'interrupted') {
          stopPlayback();
          setStatus('listening');
        } else if (msg.type === 'turn_complete') {
          if (activeSourcesRef.current.size === 0) {
            setStatus('listening');
          }
        } else if (msg.type === 'input_transcript' && msg.text) {
          appendTranscript('user', msg.text);
        } else if (msg.type === 'output_transcript' && msg.text) {
          appendTranscript('assistant', msg.text);
        } else if (msg.type === 'tool_call' && Array.isArray(msg.calls)) {
          const responses = [];
          for (const call of msg.calls) {
            const result = await executeAssistantToolCall(call, depsRef.current);
            setActionLogs((prev) => [result.log, ...prev]);
            responses.push(result.functionResponse);
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'tool_response', responses }));
          }
        } else if (msg.type === 'error') {
          setError(msg.message || 'Error en la llamada en vivo.');
          setStatus('error');
        } else if (msg.type === 'closed') {
          stopSession();
        }
      };

      ws.onerror = () => {
        setError('No se pudo conectar el canal de audio en vivo.');
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus((curr) => (curr === 'error' ? 'error' : 'idle'));
      };
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Permite el acceso al micrófono para iniciar la conversación por voz.'
      );
      setStatus('error');
      stopSession();
    }
  }, [status, voiceName, appendTranscript, stopPlayback, stopSession]);

  const sendTextToLive = useCallback((text: string) => {
    if (!text.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return;
    appendTranscript('user', text.trim());
    wsRef.current.send(JSON.stringify({ type: 'text', text: text.trim() }));
  }, [appendTranscript]);

  return {
    status,
    muted,
    setMuted,
    error,
    transcripts,
    actionLogs,
    startSession,
    stopSession,
    sendTextToLive,
  };
}
