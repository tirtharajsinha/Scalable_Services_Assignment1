// Thin client for the four SeatFlow services (proxied via vite.config.js).
const uid = () => crypto.randomUUID();

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
export const money = (cents) => (typeof cents === "number" ? `$${(cents / 100).toFixed(2)}` : "-");
export const asList = (d) => (Array.isArray(d) ? d : d?.workshops || d?.items || d?.data || []);
export const errText = (r) => r.data?.error ? `${r.data.error.code}: ${r.data.error.message}` : `HTTP ${r.status}`;
