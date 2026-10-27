// Thin client for the four SeatFlow services (proxied via vite.config.js).
// const uid = () => crypto.randomUUID();
// crypto.randomUUID only exists on https/localhost; getRandomValues also works on plain http.
const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16),
  );

export async function call(service, path, { method = "GET", body, idempotent } = {}) {
  const headers = { "X-Correlation-ID": uid() };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotent) headers["Idempotency-Key"] = idempotent === true ? uid() : idempotent;
  try {
    const res = await fetch(`/svc/${service}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, replayed: res.headers.get("Idempotency-Replayed") === "true" };
  } catch (e) {
    return { ok: false, status: 0, data: { error: { code: "NETWORK", message: e.message } } };
  }
}

export const newId = uid;
export const money = (cents) => (typeof cents === "number" ? `₹${(cents).toFixed(2)}` : "-");
export const asList = (d) => (Array.isArray(d) ? d : d?.workshops || d?.items || d?.data || []);
export const errText = (r) => r.data?.error ? `${r.data.error.code}: ${r.data.error.message}` : `HTTP ${r.status}`;
