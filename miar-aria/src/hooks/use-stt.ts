import { useState, useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const AUTO_SEND_SECONDS = 4;

export function useSTT(onAutoSend: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [supported, setSupported] = useState(true);

  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalTranscriptRef = useRef('');
  const onAutoSendRef = useRef(onAutoSend);
  const isRecordingRef = useRef(false);

  useEffect(() => { onAutoSendRef.current = onAutoSend; }, [onAutoSend]);

  // All timer logic in stable refs — avoids circular useCallback deps
  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setCountdown(null);
  }, []);

  const resetCountdown = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

    let remaining = AUTO_SEND_SECONDS;
    setCountdown(remaining);

    intervalRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining > 0 ? remaining : null);
      if (remaining <= 0 && intervalRef.current) clearInterval(intervalRef.current);
    }, 1000);

    timerRef.current = setTimeout(() => {
      // auto-send when timer fires
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setCountdown(null);
      isRecordingRef.current = false;
      setIsRecording(false);
      recognitionRef.current?.stop();
      const text = finalTranscriptRef.current.trim();
      finalTranscriptRef.current = '';
      setTranscript('');
      if (text) onAutoSendRef.current(text);
    }, AUTO_SEND_SECONDS * 1000);
  }, []);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setSupported(false); return; }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'pt-BR';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let newFinal = '';
      let currentInterim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) newFinal += event.results[i][0].transcript;
        else currentInterim += event.results[i][0].transcript;
      }
      if (newFinal) finalTranscriptRef.current += newFinal + ' ';
      setTranscript(finalTranscriptRef.current + currentInterim);
      if (newFinal || currentInterim) resetCountdown();
    };

    recognition.onend = () => {
      if (isRecordingRef.current) { try { recognition.start(); } catch (_) {} }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (isRecordingRef.current) { try { recognition.start(); } catch (_) {} }
    };

    recognitionRef.current = recognition;
    return () => { recognition.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once — resetCountdown is stable

  const start = useCallback(() => {
    if (!recognitionRef.current) return;
    finalTranscriptRef.current = '';
    setTranscript('');
    isRecordingRef.current = true;
    setIsRecording(true);
    try { recognitionRef.current.start(); } catch (_) {}
    resetCountdown();
  }, [resetCountdown]);

  const stop = useCallback((): string => {
    clearTimers();
    isRecordingRef.current = false;
    setIsRecording(false);
    recognitionRef.current?.stop();
    const text = finalTranscriptRef.current.trim();
    finalTranscriptRef.current = '';
    setTranscript('');
    return text;
  }, [clearTimers]);

  return { isRecording, transcript, start, stop, countdown, supported };
}
