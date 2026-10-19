// Talking to Kompaly: dictation with the browser's speech recognition (optional, depends on the browser).

import { useEffect, useRef, useState } from 'react';

// Minimal typing of the Web Speech API (not in TypeScript's DOM library yet).
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
export type RecognitionCtor = new () => Recognition;

export function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canDictate = () => typeof window !== 'undefined' && recognitionCtor() !== null;

/**
 * Dictation: `start()` listens, `onInterim` receives the text as it is recognised,
 * `onFinal` the whole sentence once the student stops talking.
 */
export function useDictation(onInterim: (text: string) => void, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef({ onInterim, onFinal });
  useEffect(() => {
    cb.current = { onInterim, onFinal };
  });

  useEffect(() => () => rec.current?.abort(), []);

  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor || listening) return;
    const r = new Ctor();
    r.lang = 'fr-FR';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      cb.current.onInterim((finalText + interim).trim());
    };
    r.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError("Micro refusé : autorise-le dans les réglages du navigateur.");
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError('Je n’ai pas réussi à t’entendre.');
    };
    r.onend = () => {
      setListening(false);
      rec.current = null;
      if (finalText.trim()) cb.current.onFinal(finalText.trim());
    };
    rec.current = r;
    setError(null);
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  };

  const stop = () => rec.current?.stop();

  return { listening, error, start, stop, supported: canDictate() };
}
