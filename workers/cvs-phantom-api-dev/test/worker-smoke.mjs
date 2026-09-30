import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";

const env = {
  ENVIRONMENT: "test",
  BRIDGE_URL: "https://bridge.test/exec",
  BRIDGE_SECRET: "bridge-secret",
  DEV_API_TOKEN: "client-token",
  ENABLE_EDGE_CACHE: "0",
  ALLOWED_ORIGINS: "https://example.test",
};

const ctx = { waitUntil() {} };
let lastEnvelope = null;

globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  lastEnvelope = body;

  const unsigned = {
    action: body.action,
    params: body.params,
    requestId: body.requestId,
    ts: body.ts,
    nonce: body.nonce,
  };
  const expected = createHmac("sha256", env.BRIDGE_SECRET)
    .update(JSON.stringify(unsigned))
    .digest("base64url");
  assert.equal(body.signature, expected, "bridge signature mismatch");

  if (body.action === "getSheets") {
    return new Response(JSON.stringify({ ok: true, defaultSheet: "DB_GBKK4", sheets: ["DB_GBKK4"] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (body.action === "getPlaces") {
    return new Response(JSON.stringify({
      ok: true,
      schemaVersion: 3,
      rev: 7,
      total: 1,
      visited: 0,
      remaining: 1,
      places: [{ id: "1", name: "Store", visited: false }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (body.action === "updateRoute" && body.params.route === "conflict") {
    return new Response(JSON.stringify({ok:false,error:"VERSION_CONFLICT",
      currentVersion:"latest",currentValue:"new-route"}), {
      status:200,headers:{"content-type":"application/json"}
    });
  }
  return new Response(JSON.stringify({ ok: true, action: body.action, requestId: body.requestId }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

async function call(path, init = {}) {
  const request = new Request("https://api.test" + path, init);
  return worker.fetch(request, env, ctx);
}

{
  const res = await call("/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.backend, "apps-script-bridge");
}

{
  const res = await call("/v1/teams");
  assert.equal(res.status, 401);
}

{
  const res = await call("/v1/teams", {
    headers: { authorization: "Bearer client-token" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.teams, [{ id: "DB_GBKK4", name: "DB_GBKK4" }]);
  assert.equal(lastEnvelope.action, "getSheets");
}

{
  const res = await call("/v1/teams/DB_GBKK4/stores", {
    headers: { authorization: "Bearer client-token" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("etag"), '"7"');
  const body = await res.json();
  assert.equal(body.stores[0].id, "1");
}

{
  const res = await call("/v1/teams/DB_GBKK4/stores/1/location", {
    method: "PATCH",
    headers: {
      authorization: "Bearer client-token",
      "content-type": "application/json",
      "idempotency-key": "loc-1",
    },
    body: JSON.stringify({ lat: 13.9, lng: 100.4, baseVersion: 'prior-field-hash' }),
  });
  assert.equal(res.status, 200);
  assert.equal(lastEnvelope.action, "updateLocation");
  assert.equal(lastEnvelope.requestId, "loc-1");
}

{
  const res = await call("/v1/teams/DB_GBKK4/stores/1/location", {
    method: "PATCH",
    headers: {
      authorization: "Bearer client-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ lat: 999, lng: 100.4 }),
  });
  assert.equal(res.status, 400);
}

{
  const res = await call("/v1/teams", {
    method: "OPTIONS",
    headers: { origin: "https://example.test" },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://example.test");
}

{
  const res = await call("/v1/teams/DB_GBKK4/stores/1/route", {
    method:"PATCH",
    headers:{authorization:"Bearer client-token","content-type":"application/json"},
    body:JSON.stringify({value:"2",baseVersion:"old"}),
  });
  assert.equal(res.status,400,"mutation must require Idempotency-Key");
}
{
  const res = await call("/v1/teams/DB_GBKK4/stores/1/route", {
    method:"PATCH",
    headers:{authorization:"Bearer client-token","content-type":"application/json",
      "Idempotency-Key":"route-no-version"},
    body:JSON.stringify({value:"2"}),
  });
  assert.equal(res.status,400,"field edit must require baseVersion");
}
{
  const res = await call("/v1/teams/DB_GBKK4/stores/1/route", {
    method:"PATCH",
    headers:{authorization:"Bearer client-token","content-type":"application/json",
      "Idempotency-Key":"route-conflict"},
    body:JSON.stringify({value:"conflict",baseVersion:"old"}),
  });
  assert.equal(res.status,409,"stale field edit must conflict");
  const data=await res.json();
  assert.equal(data.currentVersion,"latest");
}
{
  const res = await call("/v1/teams/DB_GBKK4/visits/reset", {
    method:"POST",
    headers:{authorization:"Bearer client-token","content-type":"application/json",
      "Idempotency-Key":"disabled-admin"},
    body:"{}",
  });
  assert.equal(res.status,403,"admin mutations must be disabled by default");
}

console.log("worker-smoke: ok");
