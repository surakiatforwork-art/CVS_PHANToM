const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const READ_CACHE_TTL = 15;

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          service: "cvs-phantom-api-dev",
          environment: env.ENVIRONMENT || "development",
          backend: env.BRIDGE_URL ? "apps-script-bridge" : "unconfigured",
        });
      }

      if (request.method === "OPTIONS") {
        return preflight(request, env);
      }

      const auth = authorize(request, env);
      if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

      const route = matchRoute(request.method, url.pathname);
      if (!route) return json({ ok: false, error: "Not found" }, 404);
      if ((route.name === "resetVisits" || route.name === "saveReportConfig")
          && env.ENABLE_ADMIN_MUTATIONS !== "1") {
        return json({ ok: false, error: "Admin mutations disabled" }, 403);
      }

      if (route.read && env.ENABLE_EDGE_CACHE === "1") {
        const cached = await readCache(request);
        if (cached) return withCors(cached, request, env);
      }

      const body = route.read ? {} : await parseJsonBody(request);
      const action = buildAction(route, url, body, request);
      const result = await bridgeCall(env, action.name, action.params, action.requestId);

      const response = normalizeBridgeResponse(result, route);
      const corsResponse = withCors(response, request, env);

      if (route.read && response.ok && env.ENABLE_EDGE_CACHE === "1") {
        ctx.waitUntil(writeCache(request, corsResponse.clone()));
      }

      return corsResponse;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      const clientError = /^(Missing |Invalid |Content-Type |items must )/i.test(message);
      return json({
        ok: false,
        error: clientError ? "BAD_REQUEST" : "BACKEND_ERROR",
        message,
      }, clientError ? 400 : 500);
    }
  },
};

function matchRoute(method, pathname) {
  if (method === "GET" && pathname === "/v1/teams") {
    return { name: "teams", read: true };
  }

  let m = pathname.match(/^\/v1\/teams\/([^/]+)\/stores$/);
  if (method === "GET" && m) {
    return { name: "stores", read: true, teamId: decode(m[1]) };
  }

  m = pathname.match(/^\/v1\/teams\/([^/]+)\/stores\/([^/]+)\/visits$/);
  if (method === "POST" && m) {
    return { name: "visit", teamId: decode(m[1]), storeId: decode(m[2]) };
  }

  m = pathname.match(/^\/v1\/teams\/([^/]+)\/visits\/reset$/);
  if (method === "POST" && m) {
    return { name: "resetVisits", teamId: decode(m[1]) };
  }

  m = pathname.match(/^\/v1\/teams\/([^/]+)\/stores\/([^/]+)\/noted$/);
  if (method === "PUT" && m) {
    return { name: "noted", teamId: decode(m[1]), storeId: decode(m[2]) };
  }

  m = pathname.match(/^\/v1\/teams\/([^/]+)\/stores\/([^/]+)\/route$/);
  if (method === "PATCH" && m) {
    return { name: "route", teamId: decode(m[1]), storeId: decode(m[2]) };
  }

  m = pathname.match(/^\/v1\/teams\/([^/]+)\/stores\/([^/]+)\/location$/);
  if (method === "PATCH" && m) {
    return { name: "location", teamId: decode(m[1]), storeId: decode(m[2]) };
  }

  m = pathname.match(/^\/v1\/report-config\/([^/]+)$/);
  if (method === "GET" && m) {
    return { name: "reportConfig", read: true, account: decode(m[1]) };
  }
  if (method === "PUT" && m) {
    return { name: "saveReportConfig", account: decode(m[1]) };
  }

  return null;
}

function requireBaseVersion(body) {
  if (body.baseVersion === null || body.baseVersion === undefined || body.baseVersion === "") {
    throw new Error("Missing baseVersion");
  }
  return body.baseVersion;
}

function buildAction(route, url, body, request) {
  const requestId = request.headers.get("Idempotency-Key") || "";
  if (!route.read && (!requestId || requestId.length > 128)) {
    throw new Error("Missing or invalid Idempotency-Key");
  }

  switch (route.name) {
    case "teams":
      return { name: "getSheets", params: {}, requestId };
    case "stores":
      return { name: "getPlaces", params: { sheet: route.teamId }, requestId };
    case "visit":
      return { name: "markVisited", params: { sheet: route.teamId, id: route.storeId }, requestId };
    case "resetVisits":
      return { name: "resetVisitedAll", params: { sheet: route.teamId }, requestId };
    case "noted":
      return { name: "saveNoted", params: { sheet: route.teamId, id: route.storeId,
        noted: body.noted ?? "", baseVersion: requireBaseVersion(body) }, requestId };
    case "route":
      if (!Object.prototype.hasOwnProperty.call(body, "value")) throw new Error("Missing route value");
      return { name: "updateRoute", params: { sheet: route.teamId, id: route.storeId,
        route: body.value, baseVersion: requireBaseVersion(body) }, requestId };
    case "location": {
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (body.lat == null || body.lng == null ||
          !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new Error("Invalid coordinates");
      }
      return { name: "updateLocation", params: { sheet: route.teamId, id: route.storeId,
        lat, lng, baseVersion: requireBaseVersion(body) }, requestId };
    }
    case "reportConfig":
      return { name: "getReportConfig", params: { account: route.account }, requestId };
    case "saveReportConfig": {
      if (!Array.isArray(body.items)) throw new Error("items must be an array");
      const items = body.items.map(item => ({ ...item, account: route.account }));
      return { name: "saveReportConfigBulk", params: { items, baseVersion: requireBaseVersion(body) }, requestId };
    }
    default:
      throw new Error("Unsupported route");
  }
}

async function bridgeCall(env, action, params, requestId) {
  if (!env.BRIDGE_URL || !env.BRIDGE_SECRET) {
    throw new Error("Bridge is not configured");
  }

  const ts = Date.now();
  const nonce = crypto.randomUUID();
  const unsigned = {
    action,
    params: params || {},
    requestId: requestId || "",
    ts,
    nonce,
  };
  const canonical = JSON.stringify(unsigned);
  const signature = await hmacBase64Url(env.BRIDGE_SECRET, canonical);
  const payload = JSON.stringify({ ...unsigned, signature });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(env.BRIDGE_TIMEOUT_MS || 20000));

  try {
    const res = await fetch(env.BRIDGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      signal: controller.signal,
      redirect: "follow",
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Bridge returned invalid JSON");
    }

    if (!res.ok) {
      throw new Error("Bridge HTTP " + res.status);
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function hmacBase64Url(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  let binary = "";
  for (const byte of sig) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeBridgeResponse(result, route) {
  if (!result || result.ok !== true) {
    const error = result && (result.error || result.message) ? String(result.error || result.message) : "Bridge request failed";
    let status = 502;
    if (error === "LOCK_TIMEOUT") status = 503;
    if (error === "VERSION_CONFLICT") status = 409;
    if (error === "IDEMPOTENCY_CONFLICT") status = 409;
    if (error === "INDETERMINATE_REQUIRES_RECONCILIATION") status = 409;
    if (/not found/i.test(error)) status = 404;
    if (/invalid|missing|unknown/i.test(error)) status = 400;
    return json({
      ok: false, error,
      ...(result && result.currentVersion !== undefined ? {currentVersion: result.currentVersion} : {}),
      ...(result && result.currentValue !== undefined ? {currentValue: result.currentValue} : {}),
    }, status);
  }

  if (route.name === "teams") {
    const teams = (result.sheets || []).map(id => ({ id, name: id }));
    return json({ ok: true, defaultTeamId: result.defaultSheet || "", teams });
  }

  if (route.name === "stores") {
    return json({
      ok: true,
      teamId: route.teamId,
      revision: result.rev || 1,
      schemaVersion: result.schemaVersion || 3,
      total: result.total || 0,
      visited: result.visited || 0,
      remaining: result.remaining || 0,
      stores: result.places || [],
    }, 200, { etag: quoteEtag(result.rev || 1) });
  }

  return json(result);
}

function authorize(request, env) {
  if (!env.DEV_API_TOKEN) {
    return { ok: false, status: 503, error: "API authentication is not configured" };
  }
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return { ok: false, status: 401, error: "Unauthorized" };
  const token = header.slice(7);
  if (!safeEqual(token, env.DEV_API_TOKEN)) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true };
}

function safeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length, 1);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0);
  }
  return diff === 0;
}

async function parseJsonBody(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) throw new Error("Content-Type must be application/json");
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function quoteEtag(value) {
  return '"' + String(value).replace(/"/g, "") + '"';
}

function decode(v) {
  try { return decodeURIComponent(v); } catch { return v; }
}

function preflight(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigin(origin, env)) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

function withCors(response, request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigin(origin, env)) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

function allowedOrigin(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,idempotency-key",
    "access-control-max-age": "600",
    "vary": "Origin",
  };
}

async function readCache(request) {
  const cache = caches.default;
  const key = new Request(request.url, { method: "GET" });
  return cache.match(key);
}

async function writeCache(request, response) {
  const cache = caches.default;
  const key = new Request(request.url, { method: "GET" });
  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=" + READ_CACHE_TTL);
  await cache.put(key, new Response(response.body, { status: response.status, headers }));
}
