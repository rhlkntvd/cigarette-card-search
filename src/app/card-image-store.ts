import { getIiifUrl } from "../iiif";

export const THUMBNAIL_SIZE = 512;
const SLOW_AFTER_MS = 4_000;
const RETRY_AFTER_MS = 6_000;
const LOAD_TIMEOUT_MS = 12_000;
// Some larger NYPL derivatives fail even when the thumbnail works.
const UPGRADE_RETRY_AFTER_MS = 5 * 60_000;
const MAX_CACHED_IMAGES = 200;

interface LoadedImage {
  src: string;
  width: number;
  height: number;
}

export type CardImageState =
  | { status: "idle" | "loading" | "slow" | "error"; image: null }
  | { status: "loaded"; image: LoadedImage };

export const EMPTY_IMAGE: CardImageState = { status: "idle", image: null };

interface ImageEntry {
  imageId: string;
  size: number;
  state: CardImageState;
  listeners: Set<() => void>;
  request: HTMLImageElement | null;
  timers: ReturnType<typeof setTimeout>[];
  startedAt: number;
  retried: boolean;
  failedAt: number;
}

// Store URLs and dimensions; the browser owns the image bytes and decoded cache.
const entries = new Map<string, ImageEntry>();
let retrySequence = 0;

function pruneCache() {
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_CACHED_IMAGES) {
      break;
    }
    if (entry.listeners.size === 0 && entry.request === null) {
      entries.delete(key);
    }
  }
}

function getEntry(imageId: string, size: number): ImageEntry {
  const key = getIiifUrl(imageId, size);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      imageId,
      size,
      state: EMPTY_IMAGE,
      listeners: new Set(),
      request: null,
      timers: [],
      startedAt: 0,
      retried: false,
      failedAt: 0,
    };
    entries.set(key, entry);
  }
  return entry;
}

function publish(entry: ImageEntry, state: CardImageState) {
  entry.state = state;
  for (const listener of [...entry.listeners]) {
    listener();
  }
}

function stopRequest(entry: ImageEntry, abort = true) {
  for (const timer of entry.timers) {
    clearTimeout(timer);
  }
  entry.timers = [];
  if (entry.request) {
    entry.request.onload = null;
    entry.request.onerror = null;
    if (abort) {
      entry.request.removeAttribute("src");
    }
    entry.request = null;
  }
}

function failRequest(entry: ImageEntry) {
  stopRequest(entry);
  entry.failedAt = Date.now();
  publish(entry, { status: "error", image: null });
}

function startRequest(entry: ImageEntry, fresh: boolean) {
  stopRequest(entry);
  const elapsed = Date.now() - entry.startedAt;
  if (elapsed >= LOAD_TIMEOUT_MS) {
    failRequest(entry);
    return;
  }

  const request = new Image();
  entry.request = request;
  request.decoding = "async";
  const url = getIiifUrl(entry.imageId, entry.size);
  const src = fresh ? `${url}?retry=${Date.now()}-${++retrySequence}` : url;
  publish(entry, {
    status: elapsed >= SLOW_AFTER_MS ? "slow" : "loading",
    image: null,
  });

  request.onload = () => {
    if (entry.request !== request) {
      return;
    }
    const image = {
      src,
      width: request.naturalWidth,
      height: request.naturalHeight,
    };
    stopRequest(entry, false);
    publish(entry, { status: "loaded", image });
  };
  request.onerror = () => {
    if (entry.request !== request) {
      return;
    }
    if (entry.size === THUMBNAIL_SIZE && !entry.retried) {
      stopRequest(entry);
      entry.retried = true;
      entry.timers.push(setTimeout(() => startRequest(entry, true), 500));
    } else {
      failRequest(entry);
    }
  };

  if (elapsed < SLOW_AFTER_MS) {
    entry.timers.push(
      setTimeout(() => {
        if (entry.request === request) {
          publish(entry, { status: "slow", image: null });
        }
      }, SLOW_AFTER_MS - elapsed),
    );
  }
  if (entry.size === THUMBNAIL_SIZE && !entry.retried) {
    entry.timers.push(
      setTimeout(() => {
        if (entry.request === request) {
          entry.retried = true;
          startRequest(entry, true);
        }
      }, RETRY_AFTER_MS - elapsed),
    );
  }
  entry.timers.push(
    setTimeout(() => {
      if (entry.request === request) {
        failRequest(entry);
      }
    }, LOAD_TIMEOUT_MS - elapsed),
  );
  request.src = src;
}

function startCycle(entry: ImageEntry, fresh: boolean) {
  entry.startedAt = Date.now();
  entry.retried = false;
  startRequest(entry, fresh);
}

export function getCardImage(imageId: string, size: number): CardImageState {
  return getEntry(imageId, size).state;
}

export function subscribeCardImage(
  imageId: string,
  size: number,
  listener: () => void,
) {
  const entry = getEntry(imageId, size);
  entry.listeners.add(listener);
  if (entry.state.status === "idle") {
    startCycle(entry, false);
  } else if (
    entry.state.status === "error" &&
    Date.now() - entry.failedAt >= UPGRADE_RETRY_AFTER_MS
  ) {
    startCycle(entry, true);
  }
  pruneCache();

  return () => {
    entry.listeners.delete(listener);
    // React may immediately subscribe again during a Strict Mode mount.
    queueMicrotask(() => {
      if (entry.listeners.size === 0) {
        stopRequest(entry);
        if (
          entry.state.status === "loading" ||
          entry.state.status === "slow" ||
          (entry.size === THUMBNAIL_SIZE && entry.state.status === "error")
        ) {
          entry.state = EMPTY_IMAGE;
        }
        pruneCache();
      }
    });
  };
}

export function retryCardImage(imageId: string, size: number) {
  const entry = getEntry(imageId, size);
  if (entry.listeners.size > 0 && entry.state.status !== "loaded") {
    startCycle(entry, true);
  }
}

export function reportCardImageError(
  imageId: string,
  size: number,
  src: string,
) {
  const entry = getEntry(imageId, size);
  if (entry.state.image?.src === src) {
    failRequest(entry);
  }
}
