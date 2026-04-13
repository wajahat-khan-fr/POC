export interface Env {
  ALLOWED_EXTENSION_IDS?: string;
  /** Comma-separated host suffixes treated as approved paste destinations (e.g. corp.example.com,internal.local). */
  INTERNAL_HOST_SUFFIXES?: string;
}

type TriageInput = {
  pastedText: string;
  destinationUrl: string;
};

const CC_16_DIGITS = /\b\d{16}\b/;
const SSN_FORMATTED = /\b\d{3}-\d{2}-\d{4}\b/;
const HIGH_RISK_DOMAINS = ["pastebin.com", "reddit.com"];
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 240;
const rateState = new Map<string, { count: number; windowStart: number }>();
const JSON_CONTENT_TYPE = "application/json";

let cachedAllowedIdsRaw = "";
let cachedAllowedIds: Set<string> = new Set();

let cachedInternalSuffixesRaw = "";
let cachedInternalSuffixes: string[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getHostnameFromUrl(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isRiskyHostname(hostname: string): boolean {
  return HIGH_RISK_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

function getInternalHostSuffixes(env: Env): string[] {
  const raw = env.INTERNAL_HOST_SUFFIXES || "";
  if (raw === cachedInternalSuffixesRaw) {
    return cachedInternalSuffixes;
  }

  cachedInternalSuffixesRaw = raw;
  cachedInternalSuffixes = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  return cachedInternalSuffixes;
}

function isInternalHost(hostname: string, suffixes: string[]): boolean {
  if (!hostname || suffixes.length === 0) {
    return false;
  }

  return suffixes.some((suffix) => {
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  });
}

function getAllowedExtensionIds(env: Env): Set<string> {
  const raw = env.ALLOWED_EXTENSION_IDS || "";
  if (raw === cachedAllowedIdsRaw) {
    return cachedAllowedIds;
  }

  cachedAllowedIdsRaw = raw;
  cachedAllowedIds = new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );

  return cachedAllowedIds;
}

function requestIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown"
  );
}

function isRateLimited(request: Request): boolean {
  const ip = requestIp(request);
  const now = Date.now();
  const current = rateState.get(ip);
  if (!current || now - current.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateState.set(ip, { count: 1, windowStart: now });
    return false;
  }

  current.count += 1;
  return current.count > RATE_LIMIT_MAX_REQUESTS;
}

function isAllowedExtensionOrigin(request: Request, env: Env): boolean {
  const configured = getAllowedExtensionIds(env);
  if (configured.size === 0) {
    return true;
  }

  const origin = request.headers.get("origin") || "";
  if (!origin.startsWith("chrome-extension://")) {
    return false;
  }

  const extensionId = origin.replace("chrome-extension://", "").replace("/", "");
  return configured.has(extensionId);
}

function evaluateRisk(input: TriageInput, env: Env) {
  const containsCreditCard = CC_16_DIGITS.test(input.pastedText);
  const containsSSN = SSN_FORMATTED.test(input.pastedText);
  const sensitiveDetected = containsCreditCard || containsSSN;

  const destinationHostname = getHostnameFromUrl(input.destinationUrl);
  const internalSuffixes = getInternalHostSuffixes(env);
  const internalDestination = isInternalHost(
    destinationHostname,
    internalSuffixes
  );
  const riskyDomain = destinationHostname
    ? isRiskyHostname(destinationHostname)
    : false;

  // Enterprise DLP: sensitive paste is HIGH on any non-internal host, or on known exfil domains.
  const risk =
    sensitiveDetected && (riskyDomain || !internalDestination)
      ? "HIGH"
      : "SAFE";

  return {
    risk,
    containsCreditCard,
    containsSSN,
    sensitiveDetected,
    internalDestination,
    riskyDomain
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "Method Not Allowed" });
    }
    if (isRateLimited(request)) {
      return jsonResponse(429, { error: "Too Many Requests" });
    }
    if (!isAllowedExtensionOrigin(request, env)) {
      return jsonResponse(403, { error: "Forbidden origin" });
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes(JSON_CONTENT_TYPE)) {
      return jsonResponse(415, { error: "Unsupported Media Type" });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    if (!isObject(body)) {
      return jsonResponse(400, { error: "Request body must be an object" });
    }

    const pastedText = body.pastedText;
    const destinationUrl = body.destinationUrl;

    if (typeof pastedText !== "string" || typeof destinationUrl !== "string") {
      return jsonResponse(400, {
        error: "Expected string fields: pastedText and destinationUrl"
      });
    }

    const evaluation = evaluateRisk(
      {
        pastedText: pastedText.slice(0, 8192),
        destinationUrl: destinationUrl.slice(0, 2048)
      },
      env
    );

    return jsonResponse(200, evaluation);
  }
};
