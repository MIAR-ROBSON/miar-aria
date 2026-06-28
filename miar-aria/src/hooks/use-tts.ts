import { useState, useEffect, useRef, useCallback } from 'react';

export function useTTS(initialSpeed = 1) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [rate, setRate] = useState(initialSpeed);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const rateRef = useRef(initialSpeed);
  const speakingRef = useRef(false);

  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { setRate(initialSpeed); rateRef.current = initialSpeed; }, [initialSpeed]);

  useEffect(() => {
    const loadVoices = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.cancel(); };
  }, []);

  // Chrome bug workaround: speechSynthesis pauses silently after ~15s
  // Calling pause()+resume() every 10s keeps it alive
  useEffect(() => {
    const interval = setInterval(() => {
      if (speakingRef.current && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const getFemaleVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = voicesRef.current;
    if (!voices.length) return null;
    const ptVoices = voices.filter(v => v.lang.startsWith('pt'));
    const femaleKw = ['female', 'feminino', 'francisca', 'vitoria', 'luciana', 'maria', 'ana', 'samantha', 'zira'];
    const maleKw = ['male', 'masculino', 'daniel', 'jorge', 'joao', 'joão', 'paulo', 'carlos', 'richard', 'mark', 'george', 'david'];
    const isFemale = (v: SpeechSynthesisVoice) => {
      const n = v.name.toLowerCase();
      return femaleKw.some(k => n.includes(k)) && !maleKw.some(k => n.includes(k));
    };
    return ptVoices.find(isFemale)
      || voices.find(isFemale)
      || ptVoices[0]
      || voices.find(v => !maleKw.some(k => v.name.toLowerCase().includes(k)))
      || voices[0] || null;
  }, []);

  const speak = useCallback((text: string, overrideRate?: number) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    speakingRef.current = false;

    const cleanText = text.replace(/__IMG__data:[^\s]*/g, '').trim();
    if (!cleanText) return;

    // Chrome requires voices to be loaded — retry once if empty
    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voice = getFemaleVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'pt-BR';
      utterance.rate = overrideRate ?? rateRef.current;
      utterance.pitch = 1.1;
      utterance.volume = 1;

      utterance.onstart = () => {
        speakingRef.current = true;
        setIsPlaying(true);
        setIsPaused(false);
      };
      utterance.onend = () => {
        speakingRef.current = false;
        setIsPlaying(false);
        setIsPaused(false);
      };
      utterance.onerror = (e) => {
        // 'interrupted' is expected when cancel() is called — not a real error
        if (e.error !== 'interrupted') {
          speakingRef.current = false;
          setIsPlaying(false);
          setIsPaused(false);
        }
      };

      synth.speak(utterance);

      // Chrome bug: sometimes speak() fires but never starts
      // Check after 500ms and retry if still not speaking
      setTimeout(() => {
        if (!synth.speaking && speakingRef.current === false && cleanText) {
          synth.cancel();
          synth.speak(utterance);
        }
      }, 500);
    };

    if (voicesRef.current.length > 0) {
      doSpeak();
    } else {
      // Wait for voices to load then speak
      window.speechSynthesis.onvoiceschanged = () => {
        voicesRef.current = window.speechSynthesis.getVoices();
        doSpeak();
      };
    }
  }, [getFemaleVoice]);

  const pause = useCallback(() => {
    window.speechSynthesis.pause();
    speakingRef.current = false;
    setIsPaused(true);
    setIsPlaying(false);
  }, []);

  const resume = useCallback(() => {
    window.speechSynthesis.resume();
    speakingRef.current = true;
    setIsPaused(false);
    setIsPlaying(true);
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setIsPlaying(false);
    setIsPaused(false);
  }, []);

  const speakSelection = useCallback(() => {
    const sel = window.getSelection()?.toString().trim();
    if (sel) speak(sel);
  }, [speak]);

  return { speak, pause, resume, stop, speakSelection, isPlaying, isPaused, rate, setRate };
}
