// Talking to Kompaly: dictation with the browser's speech recognition (optional, depends on the browser).

import { locale, t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { startCapture, canUseMic, CaptureError, type Capture } from '../lib/recorder/capture';
import { RATE, concat, encodeWav, isSilent } from '../lib/recorder/audio';
import { transcribe, CoursError, isFinal } from '../lib/recorder/api';

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
 * Through the site's transcription (the one « Enregistrer » uses: the same on every browser) when the microphone
 * can be read; the browser's own recognition otherwise, or when the site has no transcription.
 */
export function useDictation(onInterim: (text: string) => void, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const capture = useRef<Capture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverOff = useRef(false);
  const cb = useRef({ onInterim, onFinal });
  useEffect(() => {
    cb.current = { onInterim, onFinal };
  });

  useEffect(
    () => () => {
      rec.current?.abort();
      capture.current?.stop(false);
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const startBrowser = () => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = locale();
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
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError(t('Micro refusé : autorise-le dans les réglages du navigateur.'));
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setError(t('Je n’ai pas réussi à t’entendre.'));
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

  const startServer = async () => {
    const pieces: Float32Array[] = [];
    setError(null);
    setListening(true);
    try {
      capture.current = await startCapture('micro', { offset: 0, target: () => 55, onPiece: p => pieces.push(p.samples), onEnded: () => void finish() });
    } catch (e) {
      setListening(false);
      setError(e instanceof CaptureError ? e.message : t('Micro refusé : autorise-le dans les réglages du navigateur.'));
      return;
    }
    // shortcut: one minute at most, a message to Kompaly is short; past that it is sent as it is.
    timer.current = setTimeout(() => void finish(), 60_000);

    async function finish() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const c = capture.current;
      if (!c) return;
      capture.current = null;
      c.stop(true);
      setListening(false);
      const samples = pieces.reduce((a, b) => concat(a, b), new Float32Array(0));
      if (samples.length < RATE * 0.5 || isSilent(samples)) return setError(t('Je n’ai pas réussi à t’entendre.'));
      setBusy(true);
      try {
        const said = (await transcribe(encodeWav(samples), '')).map(h => h.text).join(' ').replace(/\s+/g, ' ').trim();
        if (said) cb.current.onFinal(said);
        else setError(t('Je n’ai pas réussi à t’entendre.'));
      } catch (e) {
        // No transcription on this site (or not today): the browser's own recognition next time, if it has one.
        if (e instanceof CoursError && isFinal(e) && recognitionCtor()) serverOff.current = true;
        setError(t('Je n’ai pas réussi à t’entendre.'));
      } finally {
        setBusy(false);
      }
    }
    stopServer.current = () => void finish();
  };
  const stopServer = useRef<() => void>(() => undefined);

  const viaServer = () => canUseMic() && !serverOff.current;
  const start = () => {
    if (listening || busy) return;
    if (viaServer()) void startServer();
    else startBrowser();
  };
  const stop = () => (rec.current ? rec.current.stop() : stopServer.current());

  return { listening, busy, error, start, stop, supported: canUseMic() || canDictate() };
}
