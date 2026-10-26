import { useEffect, useRef, useState } from "react";
import { call, newId, money, asList, errText } from "./api.js";

const SERVICES = ["booking", "inventory", "payment", "notification"];
const DONE = ["CONFIRMED", "FAILED", "CANCELLED", "REJECTED", "COMPENSATED", "DECLINED"];

/* ---------- health strip ---------- */
function Health() {
  const [h, setH] = useState({});
  const check = async () => {
    const out = {};
    await Promise.all(SERVICES.map(async (s) => (out[s] = (await call(s, "/health")).ok)));
    setH(out);
  };
  useEffect(() => { check(); const t = setInterval(check, 8000); return () => clearInterval(t); }, []);
  return (
    <div className="health">
      {SERVICES.map((s) => (
        <span key={s} className={"dot " + (h[s] === undefined ? "" : h[s] ? "up" : "down")}>{s}</span>
      ))}
    </div>
  );
}

/* ---------- workshops (inventory) ---------- */
function Workshops({ workshops, reload, onPick }) {
  const [f, setF] = useState({ id: "", title: "", capacity: 20, priceCents: 5000 });
  const [msg, setMsg] = useState("");
  const create = async (e) => {
    e.preventDefault();
    const r = await call("inventory", "/api/v1/workshops", {
      method: "POST", idempotent: true,
      body: { ...f, capacity: +f.capacity, priceCents: +f.priceCents },
    });
    setMsg(r.ok ? "Workshop created" : errText(r));
    if (r.ok) { setF({ ...f, id: "", title: "" }); reload(); }
  };
  return (
    <section>
      <h2>Workshops</h2>
      <table>
        <thead><tr><th>Id</th><th>Title</th><th>Seats</th><th>Price</th><th /></tr></thead>
        <tbody>
          {workshops.map((w) => (
            <tr key={w.id}>
              <td><code>{w.id}</code></td>
              <td>{w.title}</td>
              <td>{w.available ?? w.remaining ?? w.seatsLeft ?? "?"} / {w.capacity}</td>
              <td>{money(w.priceCents)}</td>
              <td><button className="link" onClick={() => onPick(w.id)}>Book</button></td>
            </tr>
          ))}
          {!workshops.length && <tr><td colSpan="5" className="muted">No workshops yet.</td></tr>}
        </tbody>
      </table>
      <form onSubmit={create} className="row">
        <input placeholder="id (a-z, 0-9, -)" pattern="[a-z0-9-]{1,60}" required value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} />
        <input placeholder="Title" required maxLength={100} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <input type="number" min="1" max="1000" title="Capacity" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        <input type="number" min="1" title="Price in cents" value={f.priceCents} onChange={(e) => setF({ ...f, priceCents: e.target.value })} />
        <button>Add workshop</button>
      </form>
      {msg && <p className="note">{msg}</p>}
    </section>
  );
}

/* ---------- booking flow ---------- */
function Booking({ workshops, selected, setSelected, onSettled }) {
  const [customer, setCustomer] = useState("");
  const [key, setKey] = useState(newId());
  const [booking, setBooking] = useState(null);
  const [extra, setExtra] = useState({});
  const [err, setErr] = useState("");
  const timer = useRef();

  const load = async (id) => {
    const r = await call("booking", `/api/v1/bookings/${id}`);
    if (!r.ok) { setErr(errText(r)); return; }
    setBooking(r.data);
    if (DONE.includes(String(r.data?.status).toUpperCase())) {
      const [charge, note] = await Promise.all([
        call("payment", `/api/v1/charges/${id}`),
        call("notification", `/api/v1/notifications/${id}`),
      ]);
      setExtra({ charge: charge.ok ? charge.data : null, note: note.ok ? note.data : null });
      onSettled();
    } else {
      timer.current = setTimeout(() => load(id), 1000);
    }
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = async (e) => {
    e.preventDefault();
    clearTimeout(timer.current);
    setErr(""); setExtra({}); setBooking(null);
    const r = await call("booking", "/api/v1/bookings", {
      method: "POST", idempotent: key, body: { workshopId: selected, customer },
    });
    if (!r.ok) return setErr(errText(r));
    setBooking(r.data);
    setKey(newId()); // fresh key for the next intentional booking
    load(r.data.id);
  };

  return (
    <section>
      <h2>Book a seat</h2>
      <form onSubmit={submit} className="row">
        <select required value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Choose workshop…</option>
          {workshops.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
        </select>
        <input placeholder="Customer name" required maxLength={80} value={customer} onChange={(e) => setCustomer(e.target.value)} />
        <button>Book</button>
      </form>
      <p className="muted small">Idempotency key: <code>{key}</code> (resubmitting the same key replays the original result)</p>
      {err && <p className="note bad">{err}</p>}
      {booking && (
        <div className="card">
          <div className="between">
            <code>{booking.id}</code>
            <span className={"badge " + String(booking.status).toLowerCase()}>{booking.status}</span>
          </div>
          {!DONE.includes(String(booking.status).toUpperCase()) && <p className="muted small">Workflow running, polling…</p>}
          {extra.charge && <p className="small">Payment: <code>{JSON.stringify(extra.charge)}</code></p>}
          {extra.note && <p className="small">Notification: <code>{JSON.stringify(extra.note)}</code></p>}
        </div>
      )}
    </section>
  );
}

/* ---------- payment simulation ---------- */
function Simulation() {
  const [mode, setMode] = useState("normal");
  const [msg, setMsg] = useState("");
  const apply = async () => {
    const r = await call("payment", "/api/v1/simulation", { method: "POST", body: { mode } });
    setMsg(r.ok ? `Payment mock set to "${mode}"` : errText(r));
  };
  return (
    <section>
      <h2>Payment simulation</h2>
      <div className="row">
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          {["normal", "unavailable", "slow_after_commit", "decline"].map((m) => <option key={m}>{m}</option>)}
        </select>
        <button onClick={apply}>Apply</button>
      </div>
      <p className="muted small">Needs ENABLE_SIMULATION=true on the payment service. Try “decline” to watch the seat get released.</p>
      {msg && <p className="note">{msg}</p>}
    </section>
  );
}

/* ---------- app ---------- */
export default function App() {
  const [workshops, setWorkshops] = useState([]);
  const [selected, setSelected] = useState("");
  const [err, setErr] = useState("");
  const reload = async () => {
    const r = await call("inventory", "/api/v1/workshops");
    if (r.ok) { setWorkshops(asList(r.data)); setErr(""); } else setErr(errText(r));
  };
  useEffect(() => { reload(); }, []);

  return (
    <main>
      <header>
        <h1>SeatFlow</h1>
        <Health />
      </header>
      {err && <p className="note bad">Inventory: {err}</p>}
      <Workshops workshops={workshops} reload={reload} onPick={setSelected} />
      <Booking workshops={workshops} selected={selected} setSelected={setSelected} onSettled={reload} />
      <Simulation />
    </main>
  );
}
