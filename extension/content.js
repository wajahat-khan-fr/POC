(() => {
  "use strict";

  const TOOLTIP_TEXT = "Payload Evaluated";
  const TOOLTIP_LIFETIME_MS = 2200;

  function getAnchorPosition(event) {
    if (
      typeof event.clientX === "number" &&
      typeof event.clientY === "number" &&
      (event.clientX !== 0 || event.clientY !== 0)
    ) {
      return { x: event.clientX, y: event.clientY };
    }

    const active = document.activeElement;
    if (active && typeof active.getBoundingClientRect === "function") {
      const rect = active.getBoundingClientRect();
      return { x: rect.left + 8, y: rect.top + 8 };
    }

    return { x: 16, y: 16 };
  }

  function showShadowTooltip(text, x, y) {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.position = "fixed";
    host.style.left = `${Math.max(8, x + 12)}px`;
    host.style.top = `${Math.max(8, y + 12)}px`;
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
    host.style.all = "initial";

    const root = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent =
      ":host{all:initial} .tip{font:600 12px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#0f172a;color:#f8fafc;padding:8px 10px;border-radius:8px;box-shadow:0 8px 24px rgba(2,6,23,.32);border:1px solid rgba(148,163,184,.45);white-space:nowrap}";

    const bubble = document.createElement("div");
    bubble.className = "tip";
    bubble.textContent = text;

    root.appendChild(style);
    root.appendChild(bubble);
    document.documentElement.appendChild(host);

    window.setTimeout(() => {
      if (host.isConnected) {
        host.remove();
      }
    }, TOOLTIP_LIFETIME_MS);
  }

  function isSupportedPageUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function sendTriageMessage(pastedText, destinationUrl) {
    if (!isSupportedPageUrl(destinationUrl)) {
      return;
    }

    const payload = {
      type: "DLP_PASTE_EVENT",
      pastedText,
      destinationUrl
    };

    try {
      void chrome.runtime.sendMessage(payload);
    } catch {
      // Intentionally silent: fire-and-forget telemetry path.
    }
  }

  document.addEventListener(
    "paste",
    (event) => {
      const position = getAnchorPosition(event);
      const pastedText = event.clipboardData
        ? event.clipboardData.getData("text/plain")
        : "";
      const destinationUrl = window.location.href;

      // Schedule after the browser applies paste; never block default behavior.
      window.setTimeout(() => {
        showShadowTooltip(TOOLTIP_TEXT, position.x, position.y);
      }, 0);
      sendTriageMessage(pastedText, destinationUrl);
    },
    { capture: true, passive: true }
  );
})();
