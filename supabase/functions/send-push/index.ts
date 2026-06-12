// supabase/functions/send-push/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";
import { importJWK, SignJWT } from "npm:jose@5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = "mailto:admin@agriauto-app.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const TIPOS_TITULO: Record<string, string> = {
  asignado: "Nuevo pedido asignado",
  comentario: "Nuevo comentario",
  movimiento: "Pedido movido",
};

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let vapidPrivateKeyPromise: Promise<CryptoKey> | null = null;
function getVapidPrivateKey(): Promise<CryptoKey> {
  if (!vapidPrivateKeyPromise) {
    const pub = b64urlToBytes(VAPID_PUBLIC_KEY);
    const priv = b64urlToBytes(VAPID_PRIVATE_KEY);
    const jwk = {
      kty: "EC",
      crv: "P-256",
      x: bytesToB64url(pub.slice(1, 33)),
      y: bytesToB64url(pub.slice(33, 65)),
      d: bytesToB64url(priv),
      ext: true,
    };
    vapidPrivateKeyPromise = importJWK(jwk, "ES256") as Promise<CryptoKey>;
  }
  return vapidPrivateKeyPromise;
}

async function buildVapidAuthHeader(endpoint: string): Promise<string> {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const key = await getVapidPrivateKey();
  const jwt = await new SignJWT({ aud, sub: VAPID_SUBJECT })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + 12 * 60 * 60)
    .sign(key);
  return `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`;
}

async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: string) {
  const details = webpush.generateRequestDetails(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload
  );
  details.headers.Authorization = await buildVapidAuthHeader(sub.endpoint);
  const res = await fetch(details.endpoint, {
    method: details.method,
    headers: details.headers,
    body: details.body,
  });
  return res;
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    console.log("PAYLOAD RECEIVED:", JSON.stringify(payload));
    const record = payload.record;
    if (!record) {
      return new Response(JSON.stringify({ ok: false, error: "No record in payload" }), { status: 400 });
    }

    const { usuario_id, tipo, texto, pedido_id } = record;
    console.log("usuario_id:", usuario_id, "tipo:", tipo, "pedido_id:", pedido_id);

    const { data: subs, error: subsErr } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("usuario_id", usuario_id);

    console.log("subs found:", subs?.length, "err:", JSON.stringify(subsErr));

    if (subsErr) throw subsErr;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, msg: "No subscriptions" }), { status: 200 });
    }

    const title = TIPOS_TITULO[tipo] || "AGRIAUTO";
    const body = texto || "Tienes una notificación nueva";
    const notifPayload = JSON.stringify({ title, body, url: pedido_id ? `/?pedido=${pedido_id}` : "/" });

    let sent = 0;
    for (const sub of subs) {
      try {
        const res = await sendPush(sub, notifPayload);
        if (res.ok) {
          sent++;
          console.log("push sent ok", res.status, sub.endpoint.slice(0, 50));
        } else {
          const text = await res.text();
          console.error("push error", res.status, text, sub.endpoint.slice(0, 50));
          if (res.status === 410 || res.status === 404) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      } catch (err: any) {
        console.error("push exception", err?.message, sub.endpoint.slice(0, 50));
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});