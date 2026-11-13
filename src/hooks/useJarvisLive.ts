import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActiveMedia,
  AgentConnectionStatus,
  AppDeploymentMode,
  AudioMetrics,
  JarvisActionStatus,
  JarvisErrorCode,
  JarvisSystemState,
  JarvisVoiceName,
  SystemTelemetry,
  TranscriptEntry,
} from "../types/jarvis";

const TARGET_INPUT_SAMPLE_RATE = 16000;
const TARGET_OUTPUT_SAMPLE_RATE = 24000;
const FFT_SIZE = 256;

function float32To16kHzBase64Pcm(
  inputBuffer: Float32Array,
  inputSampleRate: number
): { base64: string; rms: number } {
  let sumSquares = 0;
  for (let i = 0; i < inputBuffer.length; i++) {
    const sample = inputBuffer[i];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, inputBuffer.length));

  let resampled: Float32Array;
  if (inputSampleRate === TARGET_INPUT_SAMPLE_RATE) {
    resampled = inputBuffer;
  } else {
    const ratio = inputSampleRate / TARGET_INPUT_SAMPLE_RATE;
    const newLength = Math.round(inputBuffer.length / ratio);
    resampled = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < resampled.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (
        let i = offsetBuffer;
        i < nextOffsetBuffer && i < inputBuffer.length;
        i++
      ) {
        accum += inputBuffer[i];
        count++;
      }
      resampled[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
  }

  const pcm16 = new Int16Array(resampled.length);
  for (let i = 0; i < resampled.length; i++) {
    const clamped = Math.max(-1, Math.min(1, resampled[i]));
    pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize))
    );
  }

  return {
    base64: btoa(binary),
    rms,
  };
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const byteLength = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

export function useJarvisLive() {
  const [deploymentMode, setDeploymentMode] = useState<AppDeploymentMode>(
    typeof window !== "undefined" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
      ? "cloud"
      : "local"
  );

  const [systemState, setSystemState] = useState<JarvisSystemState>("CONNECTING");
  const [errorCode, setErrorCode] = useState<JarvisErrorCode>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const [needsUserGesture, setNeedsUserGesture] = useState<boolean>(false);
  const [voiceName, setVoiceName] = useState<JarvisVoiceName>("Charon");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  // Telemetry & Autonomous Actions
  const [activeAction, setActiveAction] = useState<JarvisActionStatus | null>(null);
  const [actionHistory, setActionHistory] = useState<JarvisActionStatus[]>([]);
  const [systemTelemetry, setSystemTelemetry] = useState<SystemTelemetry | null>(null);

  // YouTube / Media Player State
  const [activeMedia, setActiveMedia] = useState<ActiveMedia | null>(null);
  const [mediaCommand, setMediaCommand] = useState<{ action: string; value?: number; id: number } | null>(null);

  // Windows Local Agent State
  const [agentUrl, setAgentUrl] = useState<string>(
    typeof window !== "undefined" ? localStorage.getItem("jarvis_agent_url") || "http://127.0.0.1:3001" : "http://127.0.0.1:3001"
  );
  const [agentToken, setAgentToken] = useState<string>(
    typeof window !== "undefined" ? localStorage.getItem("jarvis_agent_token") || "" : ""
  );
  const [agentStatus, setAgentStatus] = useState<AgentConnectionStatus>("connecting");

  // Voice & Listening Configuration
  const [isContinuousListening, setIsContinuousListening] = useState<boolean>(true);
  const [wakeWordEnabled, setWakeWordEnabled] = useState<boolean>(false);
  const [isPushToTalkActive, setIsPushToTalkActive] = useState<boolean>(false);
  const [speechLanguage, setSpeechLanguage] = useState<"en-US" | "ur-PK">("en-US");
  const [availableMics, setAvailableMics] = useState<{ deviceId: string; label: string }[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");

  // Refs
  const systemStateRef = useRef<JarvisSystemState>("CONNECTING");
  const isMicMutedRef = useRef<boolean>(false);
  const isContinuousListeningRef = useRef<boolean>(true);
  const isPushToTalkActiveRef = useRef<boolean>(false);
  const voiceNameRef = useRef<JarvisVoiceName>("Charon");
  const speechLanguageRef = useRef<"en-US" | "ur-PK">("en-US");
  const agentUrlRef = useRef<string>(agentUrl);
  const agentTokenRef = useRef<string>(agentToken);
  const wsRef = useRef<WebSocket | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const isSpeakingSpeechSynthesisRef = useRef<boolean>(false);
  const simulatedSpeechIntervalRef = useRef<number | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const lastProcessedTextRef = useRef<string>("");
  const lastProcessedTimeRef = useRef<number>(0);
  const silenceTimerRef = useRef<any>(null);

  // Web Audio API refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);

  // VAD
  const lastSpeechTimestampRef = useRef<number>(0);
  const consecutiveSpeechFramesRef = useRef<number>(0);
  const isUserSpeakingRef = useRef<boolean>(false);
  const isJarvisPlayingRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);
  const wakeWordEnabledRef = useRef<boolean>(false);
  const transcriptsRef = useRef<TranscriptEntry[]>([]);
  const sendCloudChatMessageRef = useRef<(text: string) => Promise<void>>(async () => {});

  // Pre-allocated buffers for 60fps audio visualization
  const inputFreqDataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(64) as unknown as Uint8Array<ArrayBuffer>);
  const outputFreqDataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(64) as unknown as Uint8Array<ArrayBuffer>);
  const inputWaveDataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(128) as unknown as Uint8Array<ArrayBuffer>);
  const outputWaveDataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(128) as unknown as Uint8Array<ArrayBuffer>);

  const audioMetricsRef = useRef<AudioMetrics>({
    inputLevel: 0,
    outputLevel: 0,
    activeLevel: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    frequencyBins: new Uint8Array(64),
    timeDomainData: new Uint8Array(128).fill(128),
  });

  const updateState = useCallback((next: JarvisSystemState) => {
    systemStateRef.current = next;
    setSystemState(next);
  }, []);

  // Update pairing refs
  useEffect(() => {
    agentUrlRef.current = agentUrl;
    if (typeof window !== "undefined") localStorage.setItem("jarvis_agent_url", agentUrl);
  }, [agentUrl]);

  useEffect(() => {
    agentTokenRef.current = agentToken;
    if (typeof window !== "undefined") localStorage.setItem("jarvis_agent_token", agentToken);
  }, [agentToken]);

  useEffect(() => {
    isContinuousListeningRef.current = isContinuousListening;
  }, [isContinuousListening]);

  useEffect(() => {
    isPushToTalkActiveRef.current = isPushToTalkActive;
  }, [isPushToTalkActive]);

  useEffect(() => {
    speechLanguageRef.current = speechLanguage;
    const recognizer = speechRecognitionRef.current;
    if (recognizer) {
      recognizer.lang = speechLanguage;
      try { recognizer.stop(); } catch {}
    }
  }, [speechLanguage]);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  useEffect(() => {
    wakeWordEnabledRef.current = wakeWordEnabled;
    // When wake word mode is toggled, restart recognizer in cloud mode so it
    // picks up the new setting immediately (continuous vs gated).
    const recognizer = speechRecognitionRef.current;
    if (recognizer && systemStateRef.current !== "ERROR" && systemStateRef.current !== "CONNECTING") {
      try { recognizer.stop(); } catch {}
      // onend auto-restarts if isContinuousListening is true
    }
  }, [wakeWordEnabled]);

  /**
   * Immediately halts all audio playback (Web Audio + SpeechSynthesis).
   */
  const stopAllPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((source) => {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch {}
    });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    isJarvisPlayingRef.current = false;

    if (activeUtteranceRef.current) {
      activeUtteranceRef.current.onstart = null;
      activeUtteranceRef.current.onend = null;
      activeUtteranceRef.current.onerror = null;
      activeUtteranceRef.current = null;
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
      isSpeakingSpeechSynthesisRef.current = false;
    }

    // Halt native Windows SAPI speech if agent or local server is active
    try {
      fetch(`${agentUrlRef.current}/api/tts/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => {
        fetch("/api/tts/stop", { method: "POST" }).catch(() => {});
      });
    } catch {}

    if (simulatedSpeechIntervalRef.current) {
      window.clearInterval(simulatedSpeechIntervalRef.current);
      simulatedSpeechIntervalRef.current = null;
    }
  }, []);

  /**
   * Append or update transcripts.
   */
  const appendTranscript = useCallback(
    (role: "user" | "jarvis", deltaText: string, finished: boolean) => {
      const cleaned = deltaText;
      if (!cleaned && !finished) return;

      setTranscripts((prev) => {
        const next = [...prev];
        const lastIdx = next.length - 1;
        if (lastIdx >= 0 && next[lastIdx].role === role && !next[lastIdx].isComplete) {
          const updated = {
            ...next[lastIdx],
            text: next[lastIdx].text + cleaned,
            isComplete: finished,
          };
          next[lastIdx] = updated;
          return next;
        }

        if (lastIdx >= 0 && !next[lastIdx].isComplete) {
          next[lastIdx] = { ...next[lastIdx], isComplete: true };
        }

        if (!cleaned.trim()) return next;

        next.push({
          id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role,
          text: cleaned,
          timestamp: Date.now(),
          isComplete: finished,
        });

        return next.slice(-40);
      });
    },
    []
  );

  const finalizeCurrentTranscripts = useCallback(() => {
    setTranscripts((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.isComplete) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...last, isComplete: true };
      return next;
    });
  }, []);

  /**
   * Natural voice speech synthesizer for conversational responses:
   * 1. Direct hardware speaker output via Windows SAPI Local Agent (/api/tts/speak)
   * 2. Synchronized browser Web Speech API with V8 GC retention fix and Chromium stall protection
   */
  const speakTextCloud = useCallback(
    (text: string, reqId?: string) => {
      const cleanText = text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/#+\s*/g, "")
        .replace(/\[(.*?)\]\(.*?\)/g, "$1")
        .trim();

      if (!cleanText) return;

      const speechId = reqId || `tts-${Date.now()}`;
      console.log(`[TTS] Speech started [${speechId}]: "${cleanText.slice(0, 60)}..."`);

      // 1. Direct Windows Speaker Output via Local Agent (Bypasses all browser sandbox/autoplay limits)
      try {
        const ttsTarget =
          agentStatus === "connected"
            ? `${agentUrlRef.current.replace(/\/$/, "")}/api/tts/speak`
            : "/api/tts/speak";
        fetch(ttsTarget, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(agentTokenRef.current ? { Authorization: `Bearer ${agentTokenRef.current}` } : {}),
          },
          body: JSON.stringify({ text: cleanText, voice: voiceNameRef.current }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.success) {
              console.log(
                `[TTS] Direct Windows speaker playback confirmed [${speechId}] (${data.voice})`
              );
            }
          })
          .catch(() => {});
      } catch {}

      // 2. Browser Web Speech API Synthesis
      if (typeof window === "undefined" || !window.speechSynthesis) return;

      const doSpeak = () => {
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          try {
            window.speechSynthesis.cancel();
          } catch {}
        }

        if (window.speechSynthesis.paused) {
          try {
            window.speechSynthesis.resume();
          } catch {}
        }

        const utterance = new SpeechSynthesisUtterance(cleanText);
        // Retain utterance in ref and window to prevent V8 Garbage Collection mid-speech
        activeUtteranceRef.current = utterance;
        (window as any).__jarvisCurrentUtterance = utterance;

        // Pitch & rate tuning per requested voice
        if (voiceNameRef.current === "Charon") {
          utterance.pitch = 0.9;
          utterance.rate = 1.0;
        } else if (voiceNameRef.current === "Fenrir") {
          utterance.pitch = 0.78;
          utterance.rate = 0.95;
        } else if (voiceNameRef.current === "Zephyr") {
          utterance.pitch = 1.05;
          utterance.rate = 1.0;
        } else if (voiceNameRef.current === "Puck") {
          utterance.pitch = 1.15;
          utterance.rate = 1.08;
        } else {
          utterance.pitch = 1.0;
          utterance.rate = 1.0;
        }

        // Voice selection: prioritize multilingual / natural voices
        const voices = window.speechSynthesis.getVoices();
        const hasUrduScript = /[\u0600-\u06FF]/.test(cleanText);
        if (hasUrduScript) {
          const urduVoice = voices.find((v) => v.lang.includes("ur") || v.lang.includes("ar"));
          if (urduVoice) utterance.voice = urduVoice;
        } else {
          const preferred = voices.find(
            (v) =>
              v.lang.includes("en") &&
              (v.name.includes("Google") ||
                v.name.includes("Natural") ||
                v.name.includes("Neural") ||
                v.name.includes("David") ||
                v.name.includes("Mark"))
          );
          if (preferred) utterance.voice = preferred;
        }

        let keepAliveTimer: any = null;
        let startedRef = false;

        // Guard: if onstart hasn't fired within 1.5s, the browser silently dropped it — retry once
        const startGuardTimer = setTimeout(() => {
          if (!startedRef) {
            console.warn(`[TTS] No onstart within 1500ms [${speechId}] — retrying once`);
            try {
              window.speechSynthesis.cancel();
            } catch {}
            const retryUtterance = new SpeechSynthesisUtterance(cleanText);
            activeUtteranceRef.current = retryUtterance;
            (window as any).__jarvisCurrentUtterance = retryUtterance;
            retryUtterance.pitch = utterance.pitch;
            retryUtterance.rate = utterance.rate;
            retryUtterance.voice = utterance.voice;
            retryUtterance.onstart = utterance.onstart;
            retryUtterance.onend = utterance.onend;
            retryUtterance.onerror = utterance.onerror;
            window.speechSynthesis.speak(retryUtterance);
          }
        }, 1500);

        utterance.onstart = () => {
          startedRef = true;
          clearTimeout(startGuardTimer);
          isSpeakingSpeechSynthesisRef.current = true;
          isJarvisPlayingRef.current = true;
          updateState("JARVIS SPEAKING");

          // Simulate waveform modulation for 3D core
          if (simulatedSpeechIntervalRef.current) clearInterval(simulatedSpeechIntervalRef.current);
          simulatedSpeechIntervalRef.current = window.setInterval(() => {
            if (!isSpeakingSpeechSynthesisRef.current) return;
            const energy = 0.4 + Math.random() * 0.55;
            audioMetricsRef.current.outputLevel = energy;
            audioMetricsRef.current.activeLevel = energy;
            audioMetricsRef.current.bass = 0.5 + Math.random() * 0.4;
            audioMetricsRef.current.mid = 0.4 + Math.random() * 0.5;
          }, 80);

          // Keep-alive for Chromium bug where SpeechSynthesis pauses after 15s
          keepAliveTimer = setInterval(() => {
            if (!isSpeakingSpeechSynthesisRef.current) {
              clearInterval(keepAliveTimer);
            } else if (window.speechSynthesis.paused) {
              window.speechSynthesis.resume();
            }
          }, 4000);
        };

        const handleSpeechDone = () => {
          startedRef = true;
          clearTimeout(startGuardTimer);
          console.log(`[TTS] Speech completed [${speechId}]`);
          if (keepAliveTimer) clearInterval(keepAliveTimer);
          isSpeakingSpeechSynthesisRef.current = false;
          isJarvisPlayingRef.current = false;
          activeUtteranceRef.current = null;
          (window as any).__jarvisCurrentUtterance = null;
          if (simulatedSpeechIntervalRef.current) {
            clearInterval(simulatedSpeechIntervalRef.current);
            simulatedSpeechIntervalRef.current = null;
          }
          audioMetricsRef.current.outputLevel = 0;
          audioMetricsRef.current.activeLevel = 0;
          finalizeCurrentTranscripts();
          updateState("LISTENING");

          // Ensure speech recognition resumes listening after JARVIS finishes speaking
          const recognizer = speechRecognitionRef.current;
          if (
            recognizer &&
            (isContinuousListeningRef.current || isPushToTalkActiveRef.current) &&
            !isMicMutedRef.current &&
            systemStateRef.current !== "ERROR"
          ) {
            try {
              recognizer.start();
            } catch {
              // Already started or restarting, safe to ignore
            }
          }
        };

        utterance.onend = handleSpeechDone;
        utterance.onerror = (e) => {
          console.warn(`[TTS] Speech error [${speechId}]:`, e.error);
          handleSpeechDone();
        };

        window.speechSynthesis.speak(utterance);
      };

      // If voices haven't loaded yet, wait for voiceschanged event before speaking
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) {
        const onVoicesChanged = () => {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
          doSpeak();
        };
        window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
        setTimeout(() => {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
          if (!isSpeakingSpeechSynthesisRef.current) doSpeak();
        }, 600);
      } else {
        doSpeak();
      }
    },
    [agentStatus, finalizeCurrentTranscripts, updateState]
  );

  /**
   * Schedules a 24kHz PCM audio chunk from Gemini Live for gapless playback (Local Mode).
   */
  const scheduleAudioChunk = useCallback(
    (base64Pcm: string) => {
      const outCtx = outputAudioCtxRef.current;
      const outAnalyser = outputAnalyserRef.current;
      if (!outCtx || !outAnalyser) return;

      if (outCtx.state === "suspended") {
        outCtx.resume().catch(() => {});
      }

      const float32Samples = base64PcmToFloat32(base64Pcm);
      if (float32Samples.length === 0) return;

      const audioBuffer = outCtx.createBuffer(
        1,
        float32Samples.length,
        TARGET_OUTPUT_SAMPLE_RATE
      );
      audioBuffer.getChannelData(0).set(float32Samples);

      const source = outCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(outAnalyser);

      const now = outCtx.currentTime;
      if (nextStartTimeRef.current < now) {
        nextStartTimeRef.current = now + 0.015;
      }

      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;
      activeSourcesRef.current.add(source);
      isJarvisPlayingRef.current = true;

      if (systemStateRef.current !== "JARVIS SPEAKING") {
        updateState("JARVIS SPEAKING");
      }

      source.onended = () => {
        activeSourcesRef.current.delete(source);
        if (activeSourcesRef.current.size === 0) {
          isJarvisPlayingRef.current = false;
          if (systemStateRef.current === "JARVIS SPEAKING") {
            updateState("LISTENING");
          }
        }
      };
    },
    [updateState]
  );

  /**
   * Sends user message to /api/chat HTTP pipeline with response handling, actions and speech output.
   */
  const sendCloudChatMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // Prevent overlapping concurrent chat executions
      if (isProcessingRef.current) {
        console.log(`[FRONTEND] Ignored overlapping request while already processing: "${text.trim()}"`);
        return;
      }
      isProcessingRef.current = true;

      const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      console.log(`[INPUT] User message received: "${text.trim()}" [${reqId}]`);
      console.log(`[FRONTEND] Request submitted [${reqId}] at ${new Date().toISOString()}`);

      stopAllPlayback();
      appendTranscript("user", text.trim(), true);
      updateState("THINKING");

      const startTime = Date.now();

      // Thinking timeout: if AI takes >8s, show a "Still processing..." hint in transcript
      const thinkingTimer = setTimeout(() => {
        if (systemStateRef.current === "THINKING") {
          appendTranscript("jarvis", "Still processing your request, Sir...", false);
        }
      }, 8000);

      try {
        const historyForApi = transcriptsRef.current.slice(-8).map((t) => ({
          role: t.role === "user" ? "user" : "model",
          text: t.text,
        }));

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text.trim(),
            history: historyForApi,
            voice: voiceNameRef.current,
            agentUrl: agentUrlRef.current,
            agentToken: agentTokenRef.current,
            reqId,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}: Unable to reach JARVIS intelligence.`);
        }

        const data = await res.json();
        const duration = Date.now() - startTime;
        console.log(`[FRONTEND] Response displayed [${reqId}] duration: ${duration}ms`);
        clearTimeout(thinkingTimer);

        // 1. Handle Action Telemetry
        if (data.action) {
          const act: JarvisActionStatus = {
            callId: `cloud-${Date.now()}`,
            tool: data.action.tool,
            args: data.action.args || {},
            status: data.action.status || "completed",
            requiresLocalAgent: data.action.requiresLocalAgent,
            result: data.action.result,
            timestamp: Date.now(),
          };
          setActiveAction(act);
          setActionHistory((prev) => [act, ...prev.slice(0, 49)]);

          if (data.action.tool === "media_control") {
            setMediaCommand({
              action: data.action.args?.action,
              value: data.action.args?.value,
              id: Date.now(),
            });
          }
        }

        // 2. Handle YouTube Media Playback
        if (data.media && data.media.type === "youtube" && data.media.videoId) {
          setActiveMedia({
            videoId: data.media.videoId,
            title: data.media.query || text,
            query: data.media.query,
          });
        }

        // 3. Spoken Audio Response & UI Transcript display
        const replyText = data.response || "Task processed, Sir.";
        appendTranscript("jarvis", replyText, true);
        speakTextCloud(replyText, reqId);
      } catch (err: any) {
        clearTimeout(thinkingTimer);
        const errMsg = err?.message || "Connection failure";
        console.error(`[FRONTEND] Error processing request [${reqId}]:`, errMsg);
        // If all AI models are busy (503), speak a helpful fallback
        const isBusy = errMsg.includes("503") || errMsg.includes("busy") || errMsg.includes("demand");
        const spokenErr = isBusy
          ? "Sorry Sir, all AI systems are currently busy. Please try again in a moment."
          : "Sorry Sir, I encountered an issue. Please try again.";
        // Show error in transcript but recover to LISTENING so user can try again
        appendTranscript("jarvis", `Sorry Sir, I encountered an issue: ${errMsg}. Please try again.`, true);
        speakTextCloud(spokenErr, reqId);
        updateState("LISTENING");
      } finally {
        isProcessingRef.current = false;
      }
    },
    [appendTranscript, speakTextCloud, stopAllPlayback, updateState]
  );

  useEffect(() => {
    sendCloudChatMessageRef.current = sendCloudChatMessage;
  }, [sendCloudChatMessage]);

  /**
   * Initializes Web Speech API SpeechRecognition supporting English, Roman Urdu, and Urdu.
   */
  const initCloudSpeechRecognition = useCallback(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn("SpeechRecognition API not available in this browser. Fallback to typing.");
      return;
    }

    try {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.abort();
      }

      const recognizer = new SpeechRecognition();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.lang = speechLanguageRef.current || "en-US";
      recognizer.maxAlternatives = 3;

      recognizer.onstart = () => {
        if (systemStateRef.current === "CONNECTING" || systemStateRef.current === "READY") {
          updateState("LISTENING");
        }
      };

      recognizer.onresult = (event: any) => {
        if (isMicMutedRef.current) return;
        if (!isContinuousListeningRef.current && !isPushToTalkActiveRef.current) return;

        let interimText = "";
        let finalPhrase = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalPhrase += event.results[i][0].transcript;
          } else {
            interimText += event.results[i][0].transcript;
          }
        }

        if (interimText) {
          if (isJarvisPlayingRef.current) {
            stopAllPlayback();
          }
          if (systemStateRef.current !== "USER SPEAKING") {
            updateState("USER SPEAKING");
          }
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            if (systemStateRef.current === "USER SPEAKING") {
              updateState("LISTENING");
            }
          }, 1200);
        }

        if (finalPhrase.trim()) {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          let command = finalPhrase.trim();
          console.log(`[INPUT] User message received (voice): "${command}"`);

          // Deduplication: prevent processing identical voice command twice within 1500ms
          const now = Date.now();
          if (
            command.toLowerCase() === lastProcessedTextRef.current.toLowerCase() &&
            now - lastProcessedTimeRef.current < 1500
          ) {
            console.log(`[VOICE] Ignored duplicate voice command: "${command}"`);
            return;
          }
          lastProcessedTextRef.current = command;
          lastProcessedTimeRef.current = now;

          // --- Auto language detection: if Urdu/Arabic script detected, switch TTS to Urdu ---
          if (/[\u0600-\u06FF]/.test(command) && speechLanguageRef.current !== "ur-PK") {
            console.log("[LANG] Urdu script detected in voice input — switching TTS to ur-PK");
            speechLanguageRef.current = "ur-PK";
            setSpeechLanguage("ur-PK");
          }

          // --- Wake word filtering ---
          // When wake word mode is on, utterance must contain "Jarvis" or phonetic variants to proceed.
          if (wakeWordEnabledRef.current) {
            const leadingWake = /^(?:hey|ok|okay|suno|sun|hello|hi|ya|o)?\s*(?:jarvis|jarwis|jervis|javis|travis|service|darvis)[,.]?\s*/i;
            if (leadingWake.test(command)) {
              command = command.replace(leadingWake, "").trim();
            } else {
              const anywhereWake = /\b(?:jarvis|jarwis|jervis|javis)\b/i;
              if (anywhereWake.test(command)) {
                command = command.replace(anywhereWake, "").trim();
              } else {
                console.log("[JARVIS WAKE GATED] Discarding utterance (no wake word):", command);
                return;
              }
            }
          }

          // If user only said the wake word ("Jarvis" / "Hey Jarvis"), acknowledge politely
          if (!command) {
            appendTranscript("user", finalPhrase.trim(), true);
            const ack = "Yes Sir, I am listening. How may I assist you?";
            appendTranscript("jarvis", ack, true);
            speakTextCloud(ack);
            return;
          }

          // Always use the stable ref to invoke chat pipeline to avoid stale closure
          if (sendCloudChatMessageRef.current) {
            sendCloudChatMessageRef.current(command);
          }
        }
      };

      recognizer.onerror = (event: any) => {
        if (event.error === "not-allowed") {
          setErrorCode("MIC_PERMISSION_DENIED");
          setErrorMessage("Microphone permission denied. Enable microphone in browser settings.");
          updateState("ERROR");
        } else if (
          event.error === "no-speech" ||
          event.error === "audio-capture"
        ) {
          // Transient: browser lost mic or detected silence — restart after short delay
          console.warn(`[VOICE] Recognizer error "${event.error}" — restarting in 500ms`);
          setTimeout(() => {
            if (
              (isContinuousListeningRef.current || isPushToTalkActiveRef.current) &&
              !isMicMutedRef.current &&
              systemStateRef.current !== "ERROR"
            ) {
              try { recognizer.start(); } catch {}
            }
          }, 500);
        } else if (event.error === "network") {
          // Network drop — restart recognizer after 2s
          console.warn("[VOICE] Recognizer network error — restarting in 2s");
          setTimeout(() => {
            if (
              (isContinuousListeningRef.current || isPushToTalkActiveRef.current) &&
              !isMicMutedRef.current &&
              systemStateRef.current !== "ERROR"
            ) {
              try { recognizer.start(); } catch {}
            }
          }, 2000);
        }
      };

      recognizer.onend = () => {
        if (systemStateRef.current === "USER SPEAKING") {
          updateState("LISTENING");
        }
        // Auto-restart when continuous listening is on OR when push-to-talk is held
        if (
          (isContinuousListeningRef.current || isPushToTalkActiveRef.current) &&
          !isMicMutedRef.current &&
          systemStateRef.current !== "ERROR"
        ) {
          try {
            recognizer.start();
          } catch {}
        }
      };

      speechRecognitionRef.current = recognizer;
      recognizer.start();
    } catch {}
  }, [stopAllPlayback, updateState]);

  /**
   * Initializes microphone capture and Web Audio contexts.
   */
  const initAudioPipeline = useCallback(async (): Promise<boolean> => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorCode("MIC_PERMISSION_DENIED");
        setErrorMessage("Microphone permission is required for voice conversation.");
        updateState("ERROR");
        return false;
      }

      // Enumerate available microphones
      if (navigator.mediaDevices.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const mics = devices
            .filter((d) => d.kind === "audioinput")
            .map((d, idx) => ({
              deviceId: d.deviceId,
              label: d.label || `Microphone ${idx + 1}`,
            }));
          setAvailableMics(mics);
          if (mics.length > 0 && !selectedMicId) {
            setSelectedMicId(mics[0].deviceId);
          }
        } catch {}
      }

      if (!mediaStreamRef.current) {
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: TARGET_INPUT_SAMPLE_RATE,
        };
        if (selectedMicId) {
          audioConstraints.deviceId = { exact: selectedMicId };
        }

        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });

        const activeTrack = mediaStreamRef.current.getAudioTracks()[0];
        if (activeTrack) {
          console.log(`[MIC] Active microphone device: "${activeTrack.label || 'Default'}"`);
        }
      }

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      if (!inputAudioCtxRef.current) {
        const inCtx = new AudioCtx({ sampleRate: TARGET_INPUT_SAMPLE_RATE });
        const inAnalyser = inCtx.createAnalyser();
        inAnalyser.fftSize = FFT_SIZE;
        inAnalyser.smoothingTimeConstant = 0.75;

        const micSource = inCtx.createMediaStreamSource(mediaStreamRef.current);
        const processor = inCtx.createScriptProcessor(2048, 1, 1);

        micSource.connect(inAnalyser);
        inAnalyser.connect(processor);
        processor.connect(inCtx.destination);

        processor.onaudioprocess = (event: AudioProcessingEvent) => {
          if (isMicMutedRef.current) return;
          if (!isContinuousListeningRef.current && !isPushToTalkActiveRef.current) return;

          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            const inputChannel = event.inputBuffer.getChannelData(0);
            const { base64 } = float32To16kHzBase64Pcm(inputChannel, inCtx.sampleRate);
            ws.send(JSON.stringify({ type: "audio", audio: base64 }));
          }
        };

        inputAudioCtxRef.current = inCtx;
        inputAnalyserRef.current = inAnalyser;
        scriptProcessorRef.current = processor;
      }

      if (!outputAudioCtxRef.current) {
        const outCtx = new AudioCtx({ sampleRate: TARGET_OUTPUT_SAMPLE_RATE });
        const outAnalyser = outCtx.createAnalyser();
        outAnalyser.fftSize = FFT_SIZE;
        outAnalyser.smoothingTimeConstant = 0.72;
        outAnalyser.connect(outCtx.destination);

        outputAudioCtxRef.current = outCtx;
        outputAnalyserRef.current = outAnalyser;
      }

      if (inputAudioCtxRef.current.state === "suspended") {
        await inputAudioCtxRef.current.resume().catch(() => {});
      }
      if (outputAudioCtxRef.current.state === "suspended") {
        await outputAudioCtxRef.current.resume().catch(() => {});
      }

      setNeedsUserGesture(
        inputAudioCtxRef.current.state === "suspended" ||
          outputAudioCtxRef.current.state === "suspended"
      );

      return true;
    } catch {
      setErrorCode("MIC_PERMISSION_DENIED");
      setErrorMessage("Microphone permission is required for voice conversation.");
      updateState("ERROR");
      return false;
    }
  }, [updateState]);

  /**
   * Primary connection coordinator: handles Local WebSocket or Cloud Fallback.
   * Cloud pipeline (HTTP /api/chat + Web Speech API) is the default when:
   *   - Deployed on Vercel, OR
   *   - Running on any non-localhost hostname, OR
   *   - The /live WebSocket is unavailable / returns ECONNRESET
   */
  const connectSession = useCallback(async () => {
    updateState("CONNECTING");
    setErrorCode(null);
    setErrorMessage(null);

    // 1. Check /api/status to detect Vercel environment
    let isCloudDeployment = false;
    try {
      const statusRes = await fetch("/api/status");
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.environment === "vercel-serverless") {
          isCloudDeployment = true;
          setDeploymentMode("cloud");
        }
        // If the Express server explicitly says live WS is not supported, switch to cloud
        if (statusData.liveWebSocketAvailable === false) {
          isCloudDeployment = true;
        }
      }
    } catch {}

    const audioReady = await initAudioPipeline();
    if (!audioReady) return;

    // 2. Always initialize speech recognition so user voice is captured in English & Urdu
    initCloudSpeechRecognition();

    // If confirmed cloud deployment or non-localhost, stay in cloud mode
    if (isCloudDeployment || window.location.hostname !== "localhost") {
      setDeploymentMode("cloud");
      updateState("READY");
      setTimeout(() => {
        if (systemStateRef.current === "READY") updateState("LISTENING");
      }, 700);
      return;
    }

    // 3. Localhost: attempt Live WebSocket with a quick 5-second connection test
    //    If it fails (ECONNRESET / 1006 / timeout), fall back to cloud pipeline immediately.
    let wsConnected = false;
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => { if (!settled) { settled = true; resolve(); } };

      // 5-second timeout — if WS doesn't open, switch to cloud
      const connectionTimer = setTimeout(() => {
        if (!wsConnected) {
          console.warn("JARVIS Live WS timeout — switching to cloud pipeline");
          settle();
        }
      }, 5000);

      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/live?voice=${encodeURIComponent(
          voiceNameRef.current
        )}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          wsConnected = true;
          clearTimeout(connectionTimer);
          updateState("READY");
          setTimeout(() => {
            if (systemStateRef.current === "READY") updateState("LISTENING");
          }, 700);
          settle();
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "audio" && typeof msg.audio === "string") {
              scheduleAudioChunk(msg.audio);
            } else if (msg.type === "model_text" && typeof msg.text === "string") {
              appendTranscript("jarvis", msg.text, false);
            } else if (msg.type === "input_transcription") {
              appendTranscript("user", msg.text, Boolean(msg.finished));
            } else if (msg.type === "output_transcription") {
              appendTranscript("jarvis", msg.text, Boolean(msg.finished));
            } else if (msg.type === "action_started") {
              const act: JarvisActionStatus = {
                callId: msg.callId,
                tool: msg.tool,
                args: msg.args || {},
                status: "running",
                timestamp: Date.now(),
              };
              setActiveAction(act);
              setActionHistory((prev) => [act, ...prev.slice(0, 49)]);
              updateState("EXECUTING ACTION");
            } else if (msg.type === "action_completed") {
              const status = msg.result?.success !== false ? "completed" : "failed";
              setActiveAction((prev) =>
                prev ? { ...prev, status, result: msg.result } : null
              );
              setActionHistory((prev) =>
                prev.map((item) =>
                  item.callId === msg.callId ? { ...item, status, result: msg.result } : item
                )
              );
            } else if (msg.type === "interrupted") {
              stopAllPlayback();
              finalizeCurrentTranscripts();
              updateState("LISTENING");
            } else if (msg.type === "turn_complete") {
              finalizeCurrentTranscripts();
              if (!isJarvisPlayingRef.current) updateState("LISTENING");
            } else if (msg.type === "error") {
              // Server sent an error (e.g. Live API rejected) — fall back to cloud
              console.warn("JARVIS Live WS server error:", msg.code, msg.message);
              clearTimeout(connectionTimer);
              ws.close();
              setDeploymentMode("cloud");
              initCloudSpeechRecognition();
              updateState("LISTENING");
              settle();
            } else if (msg.type === "connected") {
              wsConnected = true;
              clearTimeout(connectionTimer);
              settle();
            }
          } catch {}
        };

        ws.onerror = () => {
          clearTimeout(connectionTimer);
          console.warn("JARVIS Live WS failed — switching to cloud pipeline");
          setDeploymentMode("cloud");
          initCloudSpeechRecognition();
          updateState("LISTENING");
          settle();
        };

        ws.onclose = (evt) => {
          if (!wsConnected) {
            // Closed before we ever opened (e.g. ECONNRESET / code 1006)
            clearTimeout(connectionTimer);
            console.warn(`JARVIS Live WS closed early (code ${evt.code}) — switching to cloud pipeline`);
            setDeploymentMode("cloud");
            initCloudSpeechRecognition();
            updateState("LISTENING");
            settle();
          }
        };
      } catch {
        clearTimeout(connectionTimer);
        setDeploymentMode("cloud");
        initCloudSpeechRecognition();
        updateState("LISTENING");
        settle();
      }
    });
  }, [
    appendTranscript,
    finalizeCurrentTranscripts,
    initAudioPipeline,
    initCloudSpeechRecognition,
    scheduleAudioChunk,
    stopAllPlayback,
    updateState,
  ]);

  /**
   * Pings Windows Local Agent (http://127.0.0.1:3001) for telemetry & pairing status.
   */
  const pingLocalAgent = useCallback(async () => {
    try {
      const url = agentUrlRef.current.replace(/\/$/, "");
      const res = await fetch(`${url}/api/agent/status`, {
        headers: agentTokenRef.current
          ? { "Authorization": `Bearer ${agentTokenRef.current}` }
          : {},
      });
      if (res.ok) {
        setAgentStatus("connected");
        // Fetch hardware telemetry
        const telemRes = await fetch(`${url}/api/system_status`, {
          headers: agentTokenRef.current
            ? { "Authorization": `Bearer ${agentTokenRef.current}` }
            : {},
        });
        if (telemRes.ok) {
          const telem = await telemRes.json();
          setSystemTelemetry(telem);
        }
      } else {
        setAgentStatus("disconnected");
      }
    } catch {
      setAgentStatus("disconnected");
    }
  }, []);

  // Poll Local Agent
  useEffect(() => {
    pingLocalAgent();
    const interval = setInterval(pingLocalAgent, 4500);
    return () => clearInterval(interval);
  }, [pingLocalAgent]);

  const unlockAndResumeAudio = useCallback(async () => {
    if (inputAudioCtxRef.current?.state === "suspended") {
      await inputAudioCtxRef.current.resume().catch(() => {});
    }
    if (outputAudioCtxRef.current?.state === "suspended") {
      await outputAudioCtxRef.current.resume().catch(() => {});
    }
    setNeedsUserGesture(false);

    if (systemStateRef.current === "ERROR") {
      connectSession();
    }
  }, [connectSession]);

  const toggleMicMute = useCallback(() => {
    setIsMicMuted((prev) => {
      const next = !prev;
      isMicMutedRef.current = next;
      if (next && systemStateRef.current === "USER SPEAKING") {
        updateState("LISTENING");
      }
      return next;
    });
  }, [updateState]);

  const changeVoice = useCallback(
    (newVoice: JarvisVoiceName) => {
      voiceNameRef.current = newVoice;
      setVoiceName(newVoice);
      stopAllPlayback();
      if (deploymentMode === "local") {
        connectSession();
      }
    },
    [connectSession, deploymentMode, stopAllPlayback]
  );

  const triggerEmergencyStop = useCallback(() => {
    stopAllPlayback();
    if (activeMedia) {
      setActiveMedia(null);
    }
    // Notify Local Agent if connected
    if (agentStatus === "connected") {
      fetch(`${agentUrlRef.current}/api/emergency_stop`, {
        method: "POST",
        headers: agentTokenRef.current
          ? { "Authorization": `Bearer ${agentTokenRef.current}` }
          : {},
      }).catch(() => {});
    }
    fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "emergency_stop", args: {} }),
    }).catch(() => {});

    setActiveAction({
      callId: `stop-${Date.now()}`,
      tool: "emergency_stop",
      args: {},
      status: "completed",
      result: { message: "ALL OPERATIONS HALTED" },
      timestamp: Date.now(),
    });
  }, [activeMedia, agentStatus, stopAllPlayback]);

  const sendTextMessage = useCallback(
    (text: string) => {
      // Direct text submission through verified chat pipeline:
      // Guarantees reliable AI response generation, transcript rendering, and TTS voice output
      sendCloudChatMessage(text);
    },
    [sendCloudChatMessage]
  );

  const sampleAudioMetrics = useCallback((): AudioMetrics => {
    const inAnalyser = inputAnalyserRef.current;
    const outAnalyser = outputAnalyserRef.current;
    const metrics = audioMetricsRef.current;

    let inSum = 0;
    let outSum = 0;

    if (inAnalyser && !isMicMutedRef.current) {
      inAnalyser.getByteFrequencyData(inputFreqDataRef.current);
      inAnalyser.getByteTimeDomainData(inputWaveDataRef.current);
      for (let i = 0; i < inputFreqDataRef.current.length; i++) {
        inSum += inputFreqDataRef.current[i];
      }
    }

    if (outAnalyser && isJarvisPlayingRef.current) {
      outAnalyser.getByteFrequencyData(outputFreqDataRef.current);
      outAnalyser.getByteTimeDomainData(outputWaveDataRef.current);
      for (let i = 0; i < outputFreqDataRef.current.length; i++) {
        outSum += outputFreqDataRef.current[i];
      }
    }

    const rawInputLevel = Math.min(1, inSum / (64 * 140));
    const rawOutputLevel = Math.min(1, outSum / (64 * 130));

    metrics.inputLevel = metrics.inputLevel * 0.72 + rawInputLevel * 0.28;
    metrics.outputLevel = metrics.outputLevel * 0.72 + rawOutputLevel * 0.28;

    const isSpeakingOut =
      systemStateRef.current === "JARVIS SPEAKING" || isJarvisPlayingRef.current;

    metrics.activeLevel = isSpeakingOut
      ? Math.max(metrics.outputLevel, metrics.inputLevel * 0.4)
      : metrics.inputLevel;

    return metrics;
  }, []);

  // Initialize session on mount
  useEffect(() => {
    connectSession();

    const handleGlobalInteraction = () => {
      if (
        inputAudioCtxRef.current?.state === "suspended" ||
        outputAudioCtxRef.current?.state === "suspended"
      ) {
        inputAudioCtxRef.current?.resume().catch(() => {});
        outputAudioCtxRef.current?.resume().catch(() => {});
        setNeedsUserGesture(false);
      }
      if (typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.paused) {
        try { window.speechSynthesis.resume(); } catch {}
      }
    };

    window.addEventListener("pointerdown", handleGlobalInteraction, { passive: true });
    window.addEventListener("keydown", handleGlobalInteraction, { passive: true });
    window.addEventListener("click", handleGlobalInteraction, { passive: true });
    window.addEventListener("touchstart", handleGlobalInteraction, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", handleGlobalInteraction);
      window.removeEventListener("keydown", handleGlobalInteraction);
      window.removeEventListener("click", handleGlobalInteraction);
      window.removeEventListener("touchstart", handleGlobalInteraction);
      stopAllPlayback();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
      }
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.abort();
        } catch {}
      }
    };
  }, [connectSession, stopAllPlayback]);

  return {
    deploymentMode,
    systemState,
    errorCode,
    errorMessage,
    isMicMuted,
    needsUserGesture,
    voiceName,
    transcripts,
    activeAction,
    actionHistory,
    systemTelemetry,
    activeMedia,
    setActiveMedia,
    mediaCommand,
    agentUrl,
    setAgentUrl,
    agentToken,
    setAgentToken,
    agentStatus,
    isContinuousListening,
    setIsContinuousListening,
    wakeWordEnabled,
    setWakeWordEnabled,
    isPushToTalkActive,
    setIsPushToTalkActive,
    speechLanguage,
    setSpeechLanguage,
    availableMics,
    selectedMicId,
    setSelectedMicId,
    sampleAudioMetrics,
    unlockAndResumeAudio,
    reconnect: connectSession,
    toggleMicMute,
    changeVoice,
    clearTranscripts: () => setTranscripts([]),
    interruptJarvis: stopAllPlayback,
    triggerEmergencyStop,
    sendTextMessage,
  };
}
