/// <reference types="chrome" />

// Augment chrome.offscreen with types not yet in @types/chrome
declare namespace chrome.offscreen {
  const enum Reason {
    AUDIO_PLAYBACK = 'AUDIO_PLAYBACK',
    IFRAME_SCRIPTING = 'IFRAME_SCRIPTING',
    DOM_SCRAPING = 'DOM_SCRAPING',
    BLOBS = 'BLOBS',
    DOM_PARSER = 'DOM_PARSER',
    USER_MEDIA = 'USER_MEDIA',
    DISPLAY_MEDIA = 'DISPLAY_MEDIA',
    WEB_RTC = 'WEB_RTC',
    CLIPBOARD = 'CLIPBOARD',
    LOCAL_STORAGE = 'LOCAL_STORAGE',
    WORKERS = 'WORKERS',
    BATTERY_STATUS = 'BATTERY_STATUS',
    MATCH_MEDIA = 'MATCH_MEDIA',
    GEOLOCATION = 'GEOLOCATION',
  }

  interface CreateParameters {
    url: string;
    reasons: Reason[];
    justification: string;
  }

  function createDocument(params: CreateParameters): Promise<void>;
  function closeDocument(): Promise<void>;
  function hasDocument(): Promise<boolean>;
}

// Declare Stockfish WASM module shape
declare function Stockfish(): Promise<{
  addMessageListener: (cb: (line: string) => void) => void;
  postMessage: (cmd: string) => void;
  terminate?: () => void;
}>;
