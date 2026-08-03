import type { VoiceSettings } from '../shared/types';
import { bridge } from './bridge';

/**
 * Free voice input and output.
 *
 * Output prefers the browser/OS Web Speech API and falls back to an OS speech
 * command run by the main process. Input uses the Web Speech API when the
 * runtime provides it. Nothing here depends on a paid or cloud service, and
 * every path degrades to plain typing.
 */

// Minimal structural types: `SpeechRecognition` is not in the standard DOM lib.
interface RecognitionResultLike {
  0: { transcript: string };
  isFinal: boolean;
}
interface RecognitionEventLike {
  results: ArrayLike<RecognitionResultLike>;
  resultIndex: number;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionConstructor = new () => RecognitionLike;

function recognitionConstructor(): RecognitionConstructor | null {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export class SpeechOutput {
  private useNative = false;
  private webVoicesAvailable = false;

  /**
   * Decide once which engine to use. Chromium reports voices asynchronously,
   * and on several Linux Electron builds it never reports any at all, which is
   * exactly when the OS command fallback matters.
   */
  async init(): Promise<void> {
    this.webVoicesAvailable = await this.waitForWebVoices();
    if (!this.webVoicesAvailable) {
      this.useNative = await bridge.nativeSpeechAvailable();
    }
  }

  /** True when replies can actually be spoken by some engine. */
  get available(): boolean {
    return this.webVoicesAvailable || this.useNative;
  }

  get engine(): 'web' | 'native' | 'none' {
    if (this.webVoicesAvailable) return 'web';
    return this.useNative ? 'native' : 'none';
  }

  listVoices(): string[] {
    if (!this.webVoicesAvailable) return [];
    return window.speechSynthesis.getVoices().map((voice) => voice.name);
  }

  private waitForWebVoices(): Promise<boolean> {
    if (typeof window.speechSynthesis === 'undefined') return Promise.resolve(false);
    if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => finish(), 1200);
      const finish = (): void => {
        window.clearTimeout(timer);
        window.speechSynthesis.onvoiceschanged = null;
        resolve(window.speechSynthesis.getVoices().length > 0);
      };
      window.speechSynthesis.onvoiceschanged = finish;
    });
  }

  /** Speak `text`. Resolves when the utterance finishes or is superseded. */
  async speak(text: string, settings: VoiceSettings): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.cancel();

    if (this.webVoicesAvailable) {
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(trimmed);
        utterance.rate = settings.rate;
        utterance.volume = settings.volume;
        const match = window.speechSynthesis
          .getVoices()
          .find((voice) => voice.name === settings.voiceName);
        if (match) utterance.voice = match;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
      return;
    }

    if (this.useNative) {
      await bridge.speakNative(trimmed, settings);
    }
  }

  cancel(): void {
    if (this.webVoicesAvailable && typeof window.speechSynthesis !== 'undefined') {
      window.speechSynthesis.cancel();
    }
    if (this.useNative) void bridge.stopNativeSpeech();
  }
}

export interface SpeechInputHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onEnd(): void;
  onError(message: string): void;
}

export class SpeechInput {
  private recognition: RecognitionLike | null = null;
  private listening = false;

  /**
   * Whether this runtime can do speech recognition at all.
   *
   * Note: plain Electron builds usually do NOT ship Chromium's speech
   * recognition backend, so this is commonly false and the UI falls back to
   * typing. It is true in browsers and in Chromium builds that include it.
   */
  static get supported(): boolean {
    return recognitionConstructor() !== null;
  }

  get active(): boolean {
    return this.listening;
  }

  start(handlers: SpeechInputHandlers): boolean {
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      handlers.onError('Talking out loud is not available here. Type to me instead.');
      return false;
    }
    if (this.listening) return true;

    const recognition = new Constructor();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          handlers.onFinal(result[0].transcript.trim());
        } else {
          interim += result[0].transcript;
        }
      }
      if (interim) handlers.onPartial(interim.trim());
    };
    recognition.onerror = (event) => {
      const code = event.error ?? 'unknown';
      handlers.onError(
        code === 'not-allowed'
          ? 'Microphone permission was denied.'
          : `I could not hear you (${code}). You can type instead.`,
      );
    };
    recognition.onend = () => {
      this.listening = false;
      this.recognition = null;
      handlers.onEnd();
    };

    this.recognition = recognition;
    this.listening = true;
    try {
      recognition.start();
      return true;
    } catch {
      this.listening = false;
      this.recognition = null;
      handlers.onError('Could not start the microphone. You can type instead.');
      return false;
    }
  }

  stop(): void {
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch {
      this.recognition.abort();
    }
  }
}
