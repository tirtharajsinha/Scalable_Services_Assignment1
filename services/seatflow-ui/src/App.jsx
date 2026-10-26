import { useEffect, useRef, useState } from "react";
import { call, newId, money, asList, errText } from "./api.js";

const SERVICES = ["booking", "inventory", "payment", "notification"];

// State names aren't fully listed in the spec, so match by keyword.
const isDone = (st) => st === "CONFIRMED" || st === "REJECTED";
const kind = (st) =>
  st === "CONFIRMED" ? "booked" : st === "REJECTED" ? "declined" : "pending";

// Booking service returns `state` (older guess was `status`).
const stateOf = (b) => b?.state ?? b?.status;
const reasonOf = (b, c) =>
  b?.last_error ||
  b?.reason ||
  b?.failureReason ||
  (c?.state ? `Payment ${c.state}` : "-");

/* ---------- health strip ---------- */
function Health() {
  const [h, setH] = useState({});
  const [checking, setChecking] = useState(true);

  const check = async () => {
    setChecking(true);
    try {
      const out = {};
      await Promise.all(
        SERVICES.map(async (s) => (out[s] = (await call(s, "/health")).ok)),
      );
      setH(out);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="health">
      {SERVICES.map((s) => (
        <span
          key={s}
          className={"dot " + (h[s] === undefined ? "" : h[s] ? "up" : "down")}
        >
          {s}
        </span>
      ))}
      {checking && <span className="loader" aria-label="Checking health" />}
    </div>
  );
}

/* ---------- workshops (inventory) ---------- */
function Workshops({ workshops, reload, onPick }) {
  const [f, setF] = useState({
    id: "",
    title: "",
    capacity: 20,
    priceCents: 5000,
  });
  const [msg, setMsg] = useState("");
  const create = async (e) => {
    e.preventDefault();
    const r = await call("inventory", "/api/v1/workshops", {
      method: "POST",
      idempotent: true,
      body: { ...f, capacity: +f.capacity, priceCents: +f.priceCents },
    });
    setMsg(r.ok ? "Workshop created" : errText(r));
    if (r.ok) {
      setF({ ...f, id: "", title: "" });
      reload();
    }
  };
  return (
    <section>
      <h2>Workshops</h2>
      <table>
        <thead>
          <tr>
            <th>Id</th>
            <th>Title</th>
            <th>Seats</th>
            <th>Price</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {workshops.map((w) => (
            <tr key={w.id}>
              <td>
                <code>{w.id}</code>
              </td>
              <td>{w.title}</td>
              <td>
                {w.available ??
                  w.remaining ??
                  w.seatsLeft ??
                  w.seats_left ??
                  "?"}{" "}
                / {w.capacity}
              </td>
              <td>{money(w.priceCents ?? w.price_cents)}</td>
              <td>
                <button className="link" onClick={() => onPick(w.id)}>
                  Book
                </button>
              </td>
            </tr>
          ))}
          {!workshops.length && (
            <tr>
              <td colSpan="5" className="muted">
                No workshops yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form onSubmit={create} className="row">
        <input
          aria-label="Workshop ID"
          placeholder="Workshop Id (a-z, 0-9, -)"
          pattern="[a-z0-9-]{1,60}"
          required
          value={f.id}
          onChange={(e) => setF({ ...f, id: e.target.value })}
        />
        <input
          aria-label="Workshop Title"
          placeholder="Workshop Title"
          required
          maxLength={100}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
        <input
          aria-label="Workshop Capacity"
          placeholder="Capacity"
          required
          type="number"
          min="1"
          max="1000"
          title="Capacity"
          value={f.capacity}
          onChange={(e) => setF({ ...f, capacity: e.target.value })}
        />
        <input
          aria-label="Workshop Price"
          placeholder="Price (Rupees)"
          required
          type="number"
          min="1"
          title="Price in cents"
          value={f.priceCents}
          onChange={(e) => setF({ ...f, priceCents: e.target.value })}
        />
        <button>Add workshop</button>
      </form>
      {msg && <p className="note">{msg}</p>}
    </section>
  );
}

/* ---------- booking flow ---------- */
function Booking({ workshops, selected, setSelected, onSettled, onCreated }) {
  const [customer, setCustomer] = useState("");
  const [key, setKey] = useState(newId());
  const [booking, setBooking] = useState(null);
  const [extra, setExtra] = useState({});
  const [err, setErr] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const timer = useRef();

  const load = async (id, tries = 0) => {
    const r = await call("booking", `/api/v1/bookings/${id}`);
    if (!r.ok) {
      setErr(errText(r));
      return;
    }
    setBooking(r.data);
    const done = isDone(stateOf(r.data));
    // Fetch payment + notification on every poll so they show as soon as they exist.
    const [charge, note] = await Promise.all([
      call("payment", `/api/v1/charges/${id}`),
      call("notification", `/api/v1/notifications/${id}`),
    ]);
    setExtra({
      charge: charge.ok ? charge.data : null,
      note: note.ok ? note.data : null,
      noteDown: !note.ok && note.status !== 404, // 404 = not created yet; anything else = service problem
    });
    if (done || tries >= 60) {
      setTimedOut(!done);
      onSettled();
    } else {
      timer.current = setTimeout(() => load(id, tries + 1), 1000);
    }
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = async (e) => {
    e.preventDefault();
    clearTimeout(timer.current);
    setErr("");
    setExtra({});
    setBooking(null);
    setTimedOut(false);
    const r = await call("booking", "/api/v1/bookings", {
      method: "POST",
      idempotent: key,
      body: { workshopId: selected, customer },
    });
    if (!r.ok) return setErr(errText(r));
    setCustomer("");
    setBooking(r.data);
    onCreated();
    setKey(newId()); // fresh key for the next intentional booking
    load(r.data.id);
  };

  return (
    <section>
      <h2>Book a seat</h2>
      <form onSubmit={submit} className="row">
        <select
          required
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose workshop…</option>
          {workshops.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </select>
        <input
          placeholder="Customer name"
          required
          maxLength={80}
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
        />
        <button>Book</button>
      </form>
      <p className="muted small">
        Idempotency key: <code>{key}</code> (resubmitting the same key replays
        the original result)
      </p>
      {err && <p className="note bad">{err}</p>}
      {booking && (
        <div className="card">
          <div className="between">
            <code>{booking.id}</code>
            <span className={"badge " + String(stateOf(booking)).toLowerCase()}>
              {stateOf(booking)}
            </span>
          </div>
          {!isDone(stateOf(booking)) && !timedOut && (
            <p className="muted small">Workflow running, polling…</p>
          )}
          {timedOut && (
            <p className="muted small">
              Stopped polling; state never reached a final value.
            </p>
          )}
          {kind(stateOf(booking)) === "declined" && (
            <p className="small bad">
              Reason: {reasonOf(booking, extra.charge)}
            </p>
          )}
          {extra.charge && (
            <p className="small">
              Payment: <code>{JSON.stringify(extra.charge)}</code>
            </p>
          )}
          {extra.note && (
            <p className="small">
              Notification: <code>{JSON.stringify(extra.note)}</code>
            </p>
          )}
          {!extra.note && extra.noteDown && (
            <p className="small muted">
              Notification service is unavailable. It will be sent when the
              service is back.
            </p>
          )}
          {!isDone(stateOf(booking)) && booking.last_error && (
            <p className="small muted">
              Retrying after a temporary problem ({booking.last_error}).
            </p>
          )}
          <details>
            <summary className="small muted">Raw booking response</summary>
            <pre>{JSON.stringify(booking, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}

/* ---------- all bookings ---------- */

function Bookings({ tick }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("all");
  const [err, setErr] = useState("");
  const [page, setPage] = useState(1);

  const pageSize = 10;

  const load = async () => {
    const r = await call("booking", "/api/v1/bookings/all");
    console.log("loading bookings…");

    if (r.ok) {
      setRows(Array.isArray(r.data) ? r.data : []);
      setErr("");
      setPage(1);
    } else {
      setErr(errText(r));
    }
  };

  useEffect(() => {
    load();
  }, [tick]);

  const shown = rows.filter(
    (b) => filter === "all" || kind(stateOf(b)) === filter,
  );

  const totalPages = Math.ceil(shown.length / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedBookings = shown.slice(startIndex, startIndex + pageSize);

  return (
    <section>
      <h2>All bookings</h2>

      <div className="row">
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All</option>
          <option value="booked">Booked</option>
          <option value="declined">Declined</option>
        </select>

        <button onClick={load}>Refresh</button>
      </div>

      {err && <p className="note bad">{err}</p>}

      <table>
        <thead>
          <tr>
            <th>Booking</th>
            <th>Workshop</th>
            <th>Customer</th>
            <th>State</th>
            <th>Decline reason</th>
          </tr>
        </thead>

        <tbody>
          {paginatedBookings.map((b) => (
            <tr key={b.id}>
              <td>
                <code>{b.id.slice(0, 8)}</code>
              </td>
              <td>{b.workshop_id}</td>
              <td>{b.customer}</td>
              <td>
                <span className={"badge " + String(stateOf(b)).toLowerCase()}>
                  {stateOf(b)}
                </span>
              </td>
              <td>{kind(stateOf(b)) === "declined" ? reasonOf(b) : ""}</td>
            </tr>
          ))}

          {!shown.length && (
            <tr>
              <td colSpan="5" className="muted">
                No bookings to show.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {totalPages > 0 && (
        <div className="pagination">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </button>

          <span>
            Page {page} of {totalPages}
            {" · "}
            Showing {startIndex + 1}–
            {Math.min(startIndex + pageSize, shown.length)} of {shown.length}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

/* ---------- payment simulation ---------- */
function Simulation() {
  const [mode, setMode] = useState("normal");
  const [current, setCurrent] = useState(null);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const r = await call("payment", "/api/v1/simulation");
    if (r.ok && r.data?.mode) {
      setCurrent(r.data.mode);
      setMode(r.data.mode);
      setMsg("");
    } else {
      setCurrent(null);
      setMsg(errText(r));
    }
  };
  useEffect(() => {
    load();
  }, []);

  const apply = async () => {
    const r = await call("payment", "/api/v1/simulation", {
      method: "POST",
      body: { mode },
    });
    if (r.ok)
      load(); // re-read from the server so the badge shows the real state
    else setMsg(errText(r));
  };

  return (
    <section>
      <h2>Payment simulation</h2>
      <p>
        Current mode:{" "}
        <span
          className={
            "badge " +
            (current === "normal" ? "confirmed" : current ? "failed" : "")
          }
        >
          {current ?? "unknown"}
        </span>
      </p>
      <div className="row">
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          {["normal", "unavailable", "slow_after_commit", "decline"].map(
            (m) => (
              <option key={m}>{m}</option>
            ),
          )}
        </select>
        <button onClick={apply}>Apply</button>
      </div>
      <p className="muted small">
        Needs ENABLE_SIMULATION=true on the payment service.
      </p>
      {msg && <p className="note bad">{msg}</p>}
    </section>
  );
}

/* ---------- app ---------- */
export default function App() {
  const [workshops, setWorkshops] = useState([]);
  const [selected, setSelected] = useState("");
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  const reload = async () => {
    const r = await call("inventory", "/api/v1/workshops");
    if (r.ok) {
      setWorkshops(asList(r.data));
      setErr("");
    } else setErr(errText(r));
  };
  useEffect(() => {
    reload();
  }, []);

  return (
    <main>
      <header>
        <h1>SeatFlow</h1>
        <Health />
      </header>
      {err && <p className="note bad">Inventory: {err}</p>}
      <Workshops workshops={workshops} reload={reload} onPick={setSelected} />
      <Booking
        workshops={workshops}
        selected={selected}
        setSelected={setSelected}
        onSettled={() => {
          reload();
          setTick((t) => t + 1);
        }}
        onCreated={() => setTick((t) => t + 1)}
      />
      <Bookings tick={tick} />
      <Simulation />
    </main>
  );
}
