"use strict";

import { DLP_CONFIG } from "./config/current.js";

const EVENT_TYPE = "DLP_PASTE_EVENT";
const MAX_TEXT_LENGTH = 8192;
const MAX_URL_LENGTH = 2048;
const MIN_POST_INTERVAL_MS = 120;

let lastSentAt = 0;

function isValidWorkerEndpoint(url) {
  try {
    const parsed = new URL(url);
    const allowedHost = DLP_CONFIG.workerHost;
    return parsed.protocol === "https:" && parsed.hostname === allowedHost;
  } catch {
    return false;
  }
}

function sanitizePayload(message) {
  if (!message || typeof message !== "object") {
    return null;
  }

  if (message.type !== EVENT_TYPE) {
    return null;
  }

  if (
    typeof message.pastedText !== "string" ||
    typeof message.destinationUrl !== "string"
  ) {
    return null;
  }

  return {
    pastedText: message.pastedText.slice(0, MAX_TEXT_LENGTH),
    destinationUrl: message.destinationUrl.slice(0, MAX_URL_LENGTH)
  };
}

function shouldSendNow() {
  const now = Date.now();
  if (now - lastSentAt < MIN_POST_INTERVAL_MS) {
    return false;
  }

  lastSentAt = now;
  return true;
}

chrome.runtime.onMessage.addListener((message, _sender) => {
  const payload = sanitizePayload(message);
  if (!payload || !shouldSendNow()) {
    return;
  }

  if (!isValidWorkerEndpoint(DLP_CONFIG.workerEndpoint)) {
    return;
  }

  void fetch(DLP_CONFIG.workerEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {
    // Intentionally silent: fire-and-forget telemetry path.
  });
});
