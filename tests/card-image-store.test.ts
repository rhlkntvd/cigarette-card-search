import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

import {
  getCardImage,
  reportCardImageError,
  retryCardImage,
  subscribeCardImage,
} from "../src/app/card-image-store.js";

class FakeImage {
  src = "";
  decoding = "auto";
  naturalWidth = 320;
  naturalHeight = 512;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

let nextId = 0;

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const requests: FakeImage[] = [];
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class extends FakeImage {
      constructor() {
        super();
        requests.push(this);
      }
    },
  });
  const imageId = `test-${++nextId}`;
  const subscriptions: (() => void)[] = [];
  const subscribe = (size = 512) => {
    const unsubscribe = subscribeCardImage(imageId, size, () => {});
    subscriptions.push(unsubscribe);
    return unsubscribe;
  };
  t.after(async () => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    await Promise.resolve();
    if (originalImage)
      Object.defineProperty(globalThis, "Image", originalImage);
    else Reflect.deleteProperty(globalThis, "Image");
  });
  return {
    imageId,
    requests,
    subscribe,
    state: (size = 512) => getCardImage(imageId, size),
  };
}

test("subscribers share one request and reuse its successful URL and dimensions", async (t) => {
  const { requests, subscribe, state } = setup(t);
  const leaveGrid = subscribe();
  const leaveViewer = subscribe();
  assert.equal(requests.length, 1);
  const request = requests[0]!;
  const src = request.src;
  request.onload!();
  assert.deepEqual(state(), {
    status: "loaded",
    image: { src, width: 320, height: 512 },
  });
  assert.equal(request.src, src);
  leaveGrid();
  leaveViewer();
  await Promise.resolve();
  subscribe();
  assert.equal(requests.length, 1);
  assert.equal(state().image?.src, src);
});

test("slow thumbnails expose recovery at four seconds, retry once at six, and stop at twelve", (t) => {
  const { requests, subscribe, state } = setup(t);
  subscribe();
  t.mock.timers.tick(3_999);
  assert.equal(state().status, "loading");
  t.mock.timers.tick(1);
  assert.equal(state().status, "slow");
  t.mock.timers.tick(2_000);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.src, "");
  assert.match(requests[1]!.src, /\?retry=/);
  assert.equal(state().status, "slow");
  t.mock.timers.tick(6_000);
  assert.equal(state().status, "error");
  t.mock.timers.tick(60_000);
  assert.equal(requests.length, 2);
});

test("a network error retries once after a short delay and preserves the retry URL on success", (t) => {
  const { requests, subscribe, state } = setup(t);
  subscribe();
  requests[0]!.onerror!();
  t.mock.timers.tick(499);
  assert.equal(requests.length, 1);
  t.mock.timers.tick(1);
  assert.equal(requests.length, 2);
  const src = requests[1]!.src;
  requests[1]!.onload!();
  t.mock.timers.tick(20_000);
  assert.equal(state().status, "loaded");
  assert.equal(state().image?.src, src);
});

test("a second error stops automatic retries; a manual retry starts a fresh budget", (t) => {
  const { imageId, requests, subscribe, state } = setup(t);
  subscribe();
  requests[0]!.onerror!();
  t.mock.timers.tick(500);
  requests[1]!.onerror!();
  assert.equal(state().status, "error");
  t.mock.timers.tick(20_000);
  assert.equal(requests.length, 2);
  retryCardImage(imageId, 512);
  assert.equal(state().status, "loading");
  assert.equal(requests.length, 3);
  t.mock.timers.tick(6_000);
  assert.equal(requests.length, 4);
  t.mock.timers.tick(6_000);
  assert.equal(state().status, "error");
});

test("late load and error callbacks cannot replace the current request", (t) => {
  const { requests, subscribe, state } = setup(t);
  subscribe();
  const lateLoad = requests[0]!.onload!;
  const lateError = requests[0]!.onerror!;
  t.mock.timers.tick(6_000);
  lateLoad();
  lateError();
  assert.equal(state().status, "slow");
  requests[1]!.onload!();
  lateError();
  assert.equal(state().status, "loaded");
});

test("leaving the final subscriber cancels work and ignores later callbacks", async (t) => {
  const { requests, subscribe, state } = setup(t);
  const leaveGrid = subscribe();
  const leaveViewer = subscribe();
  const lateLoad = requests[0]!.onload!;
  leaveViewer();
  await Promise.resolve();
  assert.notEqual(requests[0]!.src, "");
  leaveGrid();
  await Promise.resolve();
  assert.equal(requests[0]!.src, "");
  lateLoad();
  t.mock.timers.tick(20_000);
  assert.equal(state().status, "idle");
  assert.equal(requests.length, 1);
});

test("an immediate unsubscribe and resubscribe keeps the request alive", async (t) => {
  const { requests, subscribe, state } = setup(t);
  subscribe()();
  subscribe();
  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.equal(state().status, "loading");
});

test("failed upgrades are remembered briefly without losing the loaded preview", async (t) => {
  const { requests, subscribe, state } = setup(t);
  subscribe();
  requests[0]!.onload!();
  const leaveViewer = subscribe(1024);
  requests[1]!.onerror!();
  assert.equal(state(1024).status, "error");
  assert.equal(state().status, "loaded");
  leaveViewer();
  await Promise.resolve();
  subscribe(1024);
  assert.equal(requests.length, 2);
  t.mock.timers.tick(5 * 60_000);
  subscribe(1024);
  assert.equal(requests.length, 3);
});

test("a stalled upgrade offers early recovery and stops without discarding the preview", (t) => {
  const { requests, subscribe, state } = setup(t);
  subscribe();
  requests[0]!.onload!();
  const preview = state().image;
  subscribe(1024);
  t.mock.timers.tick(4_000);
  assert.equal(state(1024).status, "slow");
  assert.equal(state().image, preview);
  t.mock.timers.tick(8_000);
  assert.equal(state(1024).status, "error");
  assert.equal(state().image, preview);
  assert.equal(requests.length, 2);
});

test("manual upgrade retries bypass the failure cooldown and ignore stale display errors", (t) => {
  const { imageId, requests, subscribe, state } = setup(t);
  subscribe(1024);
  requests[0]!.onerror!();
  retryCardImage(imageId, 1024);
  assert.equal(requests.length, 2);
  requests[1]!.onload!();
  reportCardImageError(imageId, 1024, "stale-url");
  assert.equal(state(1024).status, "loaded");
  reportCardImageError(imageId, 1024, state(1024).image!.src);
  assert.equal(state(1024).status, "error");
});

test("returning to an unavailable thumbnail permits a fresh attempt", async (t) => {
  const { requests, subscribe, state } = setup(t);
  const leave = subscribe();
  t.mock.timers.tick(6_000);
  t.mock.timers.tick(6_000);
  assert.equal(state().status, "error");
  leave();
  await Promise.resolve();
  subscribe();
  assert.equal(state().status, "loading");
  assert.equal(requests.length, 3);
});
