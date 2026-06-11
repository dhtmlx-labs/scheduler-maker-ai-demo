export type BrowserSpeechRecognitionEvent = Event & {
  results: {
    length: number;
    [index: number]: {
      length: number;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

export type BrowserSpeechRecognitionErrorEvent = Event & {
  error?: string;
};

export type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  abort: () => void;
  start: () => void;
  stop: () => void;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onstart: (() => void) | null;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

export function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | undefined {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}
