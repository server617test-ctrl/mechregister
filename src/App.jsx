import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

/* ============================================================
   MECHANIC SHOP REGISTER — FiveM RP point-of-sale
   Backend: Supabase (tables: shop_config, items, deals, employees)
   Default management login: employee "Boss", PIN 1234
   ============================================================ */

const DEFAULT_THEME = {
  bg: "#070811",
  panel: "#0d1020",
  accent: "#00e5ff",
  accent2: "#ff2d95",
  text: "#e6f6ff",
};

const DEFAULT_CONFIG = {
  shopName: "Benny's Custom Works",
  tagline: "LOS SANTOS · MECHANIC & CUSTOMS",
  logo: null,
  webhook: "",
  info: "Welcome to the shop!",
  theme: DEFAULT_THEME,
};

/* ---------------- debounce (per-row DB writes) ---------------- */
const timers = {};
function debounced(key, fn, ms = 600) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(fn, ms);
}

/* ---------------- sound (Web Audio, no files) ---------------- */
let audioCtx = null;
function beep(freq = 520, dur = 0.06, type = "triangle", vol = 0.12) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}
const sClick = () => beep(520, 0.05);
const sAdd = () => { beep(660, 0.05); setTimeout(() => beep(880, 0.06), 60); };
const sRemove = () => beep(300, 0.07, "sawtooth", 0.08);
const sSuccess = () => { beep(523, 0.08); setTimeout(() => beep(659, 0.08), 90); setTimeout(() => beep(784, 0.14), 180); };
const sError = () => { beep(220, 0.15, "square", 0.08); };
const sSwitch = () => beep(440, 0.04, "sine", 0.09);

/* ---------------- image resize -> dataURL ---------------- */
function fileToDataUrl(file, maxDim = 320) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/* ---------------- DB mapping helpers ---------------- */
const dealFromRow = (r) => ({ id: r.id, name: r.name, desc: r.description || "", price: Number(r.price), img: r.img });
const dealToRow = (d) => ({ id: d.id, name: d.name, description: d.desc || "", price: d.price, img: d.img });

/* ============================================================ */
export default function App() {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [items, setItems] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [deals, setDeals] = useState([]);
  const [user, setUser] = useState(null);
  const [panel, setPanel] = useState("main");
  const [anim, setAnim] = useState(0);
  const [cart, setCart] = useState([]);
  const [toast, setToast] = useState(null);

  const itemsRef = useRef(items); itemsRef.current = items;
  const dealsRef = useRef(deals); dealsRef.current = deals;
  const employeesRef = useRef(employees); employeesRef.current = employees;

  /* -------- initial load from Supabase -------- */
  useEffect(() => {
    (async () => {
      try {
        const [cfg, it, em, dl] = await Promise.all([
          supabase.from("shop_config").select("data").eq("id", 1).single(),
          supabase.from("items").select("*").order("name"),
          supabase.from("employees").select("*").order("name"),
          supabase.from("deals").select("*").order("name"),
        ]);
        if (cfg.error || it.error || em.error || dl.error) {
          throw cfg.error || it.error || em.error || dl.error;
        }
        const data = cfg.data?.data || {};
        setConfig({ ...DEFAULT_CONFIG, ...data, theme: { ...DEFAULT_THEME, ...(data.theme || {}) } });
        setItems((it.data || []).map((r) => ({ ...r, price: Number(r.price) })));
        setEmployees(em.data || []);
        setDeals((dl.data || []).map(dealFromRow));
        setReady(true);
      } catch (e) {
        console.error(e);
        setLoadError(
          "Couldn't reach the database. Check that your .env has the right Supabase URL and anon key, and that you've run supabase-setup.sql."
        );
      }
    })();
  }, []);

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3200);
  };
  const dbError = (e) => { console.error(e); sError(); showToast("Database error — change may not have saved.", false); };

  /* -------- config persistence (explicit Save button) -------- */
  const persistConfig = async (c) => {
    setConfig(c);
    const { error } = await supabase.from("shop_config").upsert({ id: 1, data: c });
    if (error) dbError(error);
  };

  /* -------- generic row CRUD -------- */
  const makeCrud = (table, list, setList, ref, toRow = (x) => x) => ({
    save: async (row) => {
      const exists = ref.current.some((x) => x.id === row.id);
      setList(exists ? ref.current.map((x) => (x.id === row.id ? row : x)) : [...ref.current, row]);
      const { error } = await supabase.from(table).upsert(toRow(row));
      if (error) dbError(error);
    },
    add: async (row) => {
      setList([...ref.current, row]);
      const { error } = await supabase.from(table).insert(toRow(row));
      if (error) dbError(error);
    },
    update: (id, patch) => {
      setList(ref.current.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      debounced(table + ":" + id, async () => {
        const row = ref.current.find((x) => x.id === id);
        if (!row) return;
        const { error } = await supabase.from(table).update(toRow(row)).eq("id", id);
        if (error) dbError(error);
      });
    },
    remove: async (id) => {
      setList(ref.current.filter((x) => x.id !== id));
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) dbError(error);
    },
  });

  const itemsCrud = makeCrud("items", items, setItems, itemsRef);
  const dealsCrud = makeCrud("deals", deals, setDeals, dealsRef, dealToRow);
  const employeesCrud = makeCrud("employees", employees, setEmployees, employeesRef);

  const switchPanel = (p) => {
    if (p === panel) return;
    sSwitch();
    setAnim((a) => a + 1);
    setPanel(p);
  };

  /* -------- cart -------- */
  const addToCart = (entry) => {
    sAdd();
    setCart((c) => {
      const found = c.find((x) => x.refId === entry.refId && x.kind === entry.kind);
      if (found) return c.map((x) => (x === found ? { ...x, qty: x.qty + 1 } : x));
      return [...c, { ...entry, qty: 1 }];
    });
  };
  const changeQty = (line, delta) => {
    delta > 0 ? sAdd() : sRemove();
    setCart((c) =>
      c.map((x) => (x === line ? { ...x, qty: x.qty + delta } : x)).filter((x) => x.qty > 0)
    );
  };
  const clearCart = () => { sRemove(); setCart([]); };

  const theme = config.theme;

  if (loadError) {
    return (
      <div style={{ minHeight: "100vh", background: "#101418", color: "#e06455", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", padding: 30, textAlign: "center" }}>
        {loadError}
      </div>
    );
  }
  if (!ready) {
    return (
      <div style={{ minHeight: "100vh", background: "#101418", color: "#aab", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
        Opening the garage…
      </div>
    );
  }

  return (
    <div className="app-root">
      <style>{buildCss(theme)}</style>

      {!user ? (
        <LoginScreen config={config} employees={employees} onLogin={(u) => { sSuccess(); setUser(u); setPanel("main"); }} />
      ) : (
        <>
          <Header config={config} user={user} panel={panel} onNav={switchPanel} onLogout={() => { sClick(); setUser(null); setCart([]); }} />
          <main key={anim} className="panel-wrap">
            {panel === "main" && <MainPanel config={config} items={items} deals={deals} user={user} onGo={switchPanel} />}
            {panel === "register" && (
              <RegisterPanel items={items} deals={deals} cart={cart} addToCart={addToCart} changeQty={changeQty}
                clearCart={clearCart} config={config} user={user} showToast={showToast} setCart={setCart} />
            )}
            {panel === "deals" && <DealsPanel deals={deals} addToCart={addToCart} />}
            {panel === "info" && <InfoPanel config={config} />}
            {panel === "myinfo" && (
              <MyInfoPanel user={user} crud={employeesCrud} showToast={showToast} onUpdateUser={setUser} />
            )}
            {panel === "board" && user.role === "management" && <BoardPanel employees={employees} />}
            {panel === "management" && user.role === "management" && (
              <ManagementPanel config={config} persistConfig={persistConfig}
                items={items} itemsCrud={itemsCrud}
                employees={employees} employeesCrud={employeesCrud}
                deals={deals} dealsCrud={dealsCrud}
                showToast={showToast} />
            )}
          </main>
        </>
      )}

      {toast && <div className={"toast " + (toast.ok ? "ok" : "bad")}>{toast.msg}</div>}
    </div>
  );
}

/* ============================ LOGIN ============================ */
function LoginScreen({ config, employees, onLogin }) {
  const [selected, setSelected] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const tryLogin = () => {
    const emp = employees.find((e) => e.id === selected);
    if (!emp) { setErr("Pick your name first."); sError(); return; }
    if (emp.pin !== pin) { setErr("Wrong PIN. Try again."); sError(); setPin(""); return; }
    onLogin(emp);
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo">
          {config.logo ? <img src={config.logo} alt="logo" /> : <div className="logo-fallback">🔧</div>}
        </div>
        <h1>{config.shopName}</h1>
        <div className="tagline">{config.tagline}</div>
        <div className="login-emps">
          {employees.map((e) => (
            <button key={e.id} className={"emp-chip" + (selected === e.id ? " sel" : "")}
              onClick={() => { sClick(); setSelected(e.id); setErr(""); }}>
              {e.name}{e.role === "management" && <span className="mgr-tag">MGMT</span>}
            </button>
          ))}
        </div>
        <input className="pin-input" type="password" inputMode="numeric" placeholder="PIN"
          value={pin} onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && tryLogin()} />
        {err && <div className="login-err">{err}</div>}
        <button className="btn-primary big" onClick={tryLogin}>Clock in</button>
      </div>
    </div>
  );
}

/* ============================ HEADER ============================ */
function Header({ config, user, panel, onNav, onLogout }) {
  const tabs = [
    ["main", "Main"], ["register", "Register"], ["deals", "Deals"], ["info", "Info"], ["myinfo", "My Info"],
  ];
  if (user.role === "management") { tabs.push(["board", "Board"]); tabs.push(["management", "Management"]); }
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-logo">
          {config.logo ? <img src={config.logo} alt="logo" /> : <span>🔧</span>}
        </div>
        <div>
          <div className="brand-name">{config.shopName}</div>
          <div className="brand-sub">{config.tagline}</div>
        </div>
      </div>
      <nav className="nav">
        {tabs.map(([id, label]) => (
          <button key={id} className={"nav-btn" + (panel === id ? " active" : "")} onClick={() => onNav(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="userbox">
        <div className="user-name">{user.name}<span className="user-role">{user.role}</span></div>
        <button className="btn-ghost" onClick={onLogout}>Clock out</button>
      </div>
    </header>
  );
}

/* ============================ MAIN ============================ */
function MainPanel({ config, items, deals, user, onGo }) {
  const [q, setQ] = useState("");
  const results = q.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()))
    : [];
  return (
    <div className="panel">
      <div className="hero">
        <h2>On the clock, {user.name}.</h2>
        <p>Quick price check below, or jump straight to the register.</p>
        <input className="search big-search" placeholder="Price check — type an item name…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {q.trim() !== "" && (
          <div className="pc-results">
            {results.length === 0 && <div className="muted">No item matches "{q}".</div>}
            {results.map((i) => (
              <div key={i.id} className="pc-row">
                <span>{i.name}</span><span className="pc-price">{money(i.price)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="stat-row">
        <button className="stat-card" onClick={() => onGo("register")}>
          <div className="stat-num">{items.length}</div><div className="stat-label">Items on the shelf</div>
          <div className="stat-go">Open register →</div>
        </button>
        <button className="stat-card" onClick={() => onGo("deals")}>
          <div className="stat-num">{deals.length}</div><div className="stat-label">Active deals</div>
          <div className="stat-go">View deals →</div>
        </button>
        <button className="stat-card" onClick={() => onGo("info")}>
          <div className="stat-num">ℹ</div><div className="stat-label">Shop info & rules</div>
          <div className="stat-go">Read info →</div>
        </button>
      </div>
    </div>
  );
}

/* ============================ REGISTER ============================ */
function RegisterPanel({ items, deals, cart, addToCart, changeQty, clearCart, config, user, showToast, setCart }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [customer, setCustomer] = useState("");
  const [discount, setDiscount] = useState(0);
  const [sending, setSending] = useState(false);

  const cats = ["All", ...Array.from(new Set(items.map((i) => i.category || "Misc")))];
  const shown = items.filter((i) =>
    (cat === "All" || (i.category || "Misc") === cat) &&
    i.name.toLowerCase().includes(q.toLowerCase())
  );

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const disc = Math.min(100, Math.max(0, Number(discount) || 0));
  const total = subtotal * (1 - disc / 100);

  const checkout = async () => {
    if (cart.length === 0) { sError(); showToast("Cart is empty.", false); return; }
    if (!config.webhook) { sError(); showToast("No Discord webhook set. Add one in Management → Settings.", false); return; }
    setSending(true);
    const lines = cart.map((l) => `• ${l.name} ×${l.qty} — ${money(l.price * l.qty)}`).join("\n");
    const payload = {
      username: `${config.shopName} Register`,
      embeds: [{
        title: "🧾 New Transaction",
        color: parseInt((config.theme.accent || "#f5a623").replace("#", ""), 16),
        fields: [
          { name: "Employee", value: user.name, inline: true },
          { name: "Customer", value: customer || "Walk-in", inline: true },
          { name: "Items", value: lines.slice(0, 1024) || "—" },
          { name: "Subtotal", value: money(subtotal), inline: true },
          { name: "Discount", value: disc + "%", inline: true },
          { name: "Total", value: "**" + money(total) + "**", inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    };
    try {
      const res = await fetch(config.webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      sSuccess();
      showToast(`Sale logged — ${money(total)} sent to Discord.`);
      setCart([]); setCustomer(""); setDiscount(0);
    } catch (e) {
      sError();
      showToast("Webhook failed to send. Check the URL in Management.", false);
    }
    setSending(false);
  };

  return (
    <div className="panel register-grid">
      <div className="reg-left">
        <div className="reg-controls">
          <input className="search" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="cat-row">
            {cats.map((c) => (
              <button key={c} className={"cat-chip" + (cat === c ? " sel" : "")} onClick={() => { sClick(); setCat(c); }}>{c}</button>
            ))}
          </div>
        </div>
        <div className="item-grid">
          {shown.map((i) => (
            <button key={i.id} className="item-card" onClick={() => addToCart({ kind: "item", refId: i.id, name: i.name, price: i.price })}>
              <div className="item-img">{i.img ? <img src={i.img} alt={i.name} /> : <span>🔩</span>}</div>
              <div className="item-name">{i.name}</div>
              <div className="item-price">{money(i.price)}</div>
            </button>
          ))}
          {shown.length === 0 && <div className="muted pad">No items match. Management can add items in the Management panel.</div>}
        </div>
        {deals.length > 0 && (
          <>
            <div className="section-label">Quick-add deals</div>
            <div className="deal-strip">
              {deals.map((d) => (
                <button key={d.id} className="deal-chip" onClick={() => addToCart({ kind: "deal", refId: d.id, name: "★ " + d.name, price: d.price })}>
                  ★ {d.name} · {money(d.price)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <aside className="cart">
        <div className="cart-head">Cart<button className="btn-ghost sm" onClick={clearCart}>Clear</button></div>
        <div className="cart-lines">
          {cart.length === 0 && <div className="muted pad">Tap items to ring them up.</div>}
          {cart.map((l, idx) => (
            <div key={idx} className="cart-line">
              <div className="cl-name">{l.name}</div>
              <div className="cl-controls">
                <button className="qty-btn" onClick={() => changeQty(l, -1)}>−</button>
                <span className="cl-qty">{l.qty}</span>
                <button className="qty-btn" onClick={() => changeQty(l, +1)}>+</button>
              </div>
              <div className="cl-price">{money(l.price * l.qty)}</div>
            </div>
          ))}
        </div>
        <div className="cart-meta">
          <input className="search" placeholder="Customer name (optional)" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          <label className="disc-row">Discount %
            <input type="number" min="0" max="100" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </label>
        </div>
        <div className="totals">
          <div className="t-row"><span>Subtotal</span><span>{money(subtotal)}</span></div>
          {disc > 0 && <div className="t-row"><span>Discount ({disc}%)</span><span>−{money(subtotal - total)}</span></div>}
          <div className="t-row grand"><span>Total</span><span>{money(total)}</span></div>
        </div>
        <button className="btn-primary big" disabled={sending} onClick={checkout}>
          {sending ? "Sending…" : "Checkout · " + money(total)}
        </button>
      </aside>
    </div>
  );
}

/* ============================ DEALS ============================ */
function DealsPanel({ deals, addToCart }) {
  return (
    <div className="panel">
      <h2 className="panel-title">Current Deals</h2>
      {deals.length === 0 && <div className="muted">No active deals right now.</div>}
      <div className="deals-grid">
        {deals.map((d) => (
          <div key={d.id} className="deal-card">
            <div className="deal-img">{d.img ? <img src={d.img} alt={d.name} /> : <span>★</span>}</div>
            <div className="deal-body">
              <div className="deal-name">{d.name}</div>
              <div className="deal-desc">{d.desc}</div>
              <div className="deal-foot">
                <span className="deal-price">{money(d.price)}</span>
                <button className="btn-primary sm" onClick={() => addToCart({ kind: "deal", refId: d.id, name: "★ " + d.name, price: d.price })}>
                  Add to cart
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================ INFO ============================ */
function InfoPanel({ config }) {
  return (
    <div className="panel">
      <h2 className="panel-title">Shop Info</h2>
      <div className="info-card">
        {config.info.split("\n").map((line, i) => (
          <p key={i} className={line.trim() === "" ? "spacer" : ""}>{line}</p>
        ))}
      </div>
    </div>
  );
}

/* ============================ EMPLOYEE BOARD (management only) ============================ */
function BoardPanel({ employees }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const shown = employees.filter((e) =>
    (e.name || "").toLowerCase().includes(q.toLowerCase()) ||
    (e.callsign || "").toLowerCase().includes(q.toLowerCase()) ||
    (e.specialty || "").toLowerCase().includes(q.toLowerCase())
  );
  const mgmt = employees.filter((e) => e.role === "management").length;
  const filled = employees.filter((e) => e.phone || e.email || e.specialty).length;
  return (
    <div className="panel">
      <h2 className="panel-title">Employee Board</h2>
      <div className="board-stats">
        <div className="board-stat"><span className="bs-num">{employees.length}</span><span className="bs-label">On roster</span></div>
        <div className="board-stat"><span className="bs-num">{mgmt}</span><span className="bs-label">Management</span></div>
        <div className="board-stat"><span className="bs-num">{filled}</span><span className="bs-label">Profiles filled</span></div>
      </div>
      <input className="search wide" placeholder="Search by name, callsign, or specialty…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="board-grid">
        {shown.length === 0 && <div className="mg-empty">No one matches that search.</div>}
        {shown.map((e) => (
          <button key={e.id} className="board-card" onClick={() => { sClick(); setOpen(e); }}>
            <div className="board-avatar">
              {e.avatar ? <img src={e.avatar} alt="" /> : (e.name || "?").charAt(0).toUpperCase()}
            </div>
            <div className="board-info">
              <div className="board-name">
                {e.name}
                {e.role === "management" && <span className="role-badge mgmt">MGMT</span>}
              </div>
              {e.callsign && <div className="board-callsign">"{e.callsign}"</div>}
              <div className="board-specialty">{e.specialty || "No specialty listed"}</div>
              <div className="board-contact">
                {e.phone ? <span>☎ {e.phone}</span> : <span className="dim">☎ —</span>}
                {e.email ? <span>✉ {e.email}</span> : <span className="dim">✉ —</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)}
          footer={<button className="btn-primary" onClick={() => setOpen(null)}>Close</button>}>
          <div className="profile-head">
            <div className="board-avatar lg">
              {open.avatar ? <img src={open.avatar} alt="" /> : (open.name || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="mg-name">{open.name} {open.role === "management" && <span className="role-badge mgmt">MGMT</span>}</div>
              {open.callsign && <div className="board-callsign">"{open.callsign}"</div>}
              <div className="mg-sub">{open.role === "management" ? "Management" : "Employee"}</div>
            </div>
          </div>
          <ProfileLine label="Phone" value={open.phone} />
          <ProfileLine label="Email" value={open.email} />
          <ProfileLine label="Specialty" value={open.specialty} />
          <ProfileLine label="Usual hours" value={open.schedule} />
          <ProfileLine label="Started" value={open.hired_on} />
          <ProfileLine label="Notes" value={open.notes} />
        </Modal>
      )}
    </div>
  );
}

function ProfileLine({ label, value }) {
  return (
    <div className="profile-line">
      <span className="pl-label">{label}</span>
      <span className={"pl-value" + (value ? "" : " dim")}>{value || "Not provided"}</span>
    </div>
  );
}

/* ============================ MY INFO (each employee edits their own) ============================ */
function MyInfoPanel({ user, crud, showToast, onUpdateUser }) {
  const [form, setForm] = useState({
    callsign: user.callsign || "",
    phone: user.phone || "",
    email: user.email || "",
    specialty: user.specialty || "",
    schedule: user.schedule || "",
    hired_on: user.hired_on || "",
    notes: user.notes || "",
    avatar: user.avatar || null,
  });
  const [dirty, setDirty] = useState(false);
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const save = () => {
    const merged = { ...user, ...form };
    crud.save(merged);
    onUpdateUser(merged);
    setDirty(false);
    sSuccess();
    showToast("Your info has been saved.");
  };
  return (
    <div className="panel">
      <h2 className="panel-title">My Info</h2>
      <div className="myinfo-wrap">
        <div className="myinfo-card">
          <div className="myinfo-avatar-row">
            <div className="board-avatar lg">
              {form.avatar ? <img src={form.avatar} alt="" /> : (user.name || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="mg-name">{user.name}</div>
              <div className="mg-sub">{user.role === "management" ? "Management" : "Employee"}</div>
              <ImgUpload value={form.avatar} onChange={(avatar) => set({ avatar })} />
            </div>
          </div>

          <div className="privacy-note">
            Heads up: this info is visible to shop management, and it lives in the shop's database — keep it in-character. Use your character's phone and email, not your real-life contact details.
          </div>

          <Field label="Callsign / nickname">
            <input className="search wide" placeholder="e.g. Wrench" value={form.callsign} onChange={(e) => set({ callsign: e.target.value })} />
          </Field>
          <Field label="Phone (in-character)">
            <input className="search wide" placeholder="e.g. 555-0142" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <Field label="Email (in-character)">
            <input className="search wide" placeholder="e.g. wrench@bennys.ls" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Specialty">
            <input className="search wide" placeholder="e.g. Turbo installs, bodywork" value={form.specialty} onChange={(e) => set({ specialty: e.target.value })} />
          </Field>
          <Field label="Usual hours">
            <input className="search wide" placeholder="e.g. Weeknights after 8" value={form.schedule} onChange={(e) => set({ schedule: e.target.value })} />
          </Field>
          <Field label="Started at the shop">
            <input className="search wide" placeholder="e.g. March 2026" value={form.hired_on} onChange={(e) => set({ hired_on: e.target.value })} />
          </Field>
          <Field label="Notes for management">
            <textarea className="search wide" rows={4} placeholder="Anything the bosses should know…" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>

          <button className="btn-primary big" disabled={!dirty} onClick={save}>
            {dirty ? "Save my info" : "Saved"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================ MANAGEMENT ============================ */
function ManagementPanel({ config, persistConfig, items, itemsCrud, employees, employeesCrud, deals, dealsCrud, showToast }) {
  const [tab, setTab] = useState("items");
  const tabs = [["items", "Items"], ["deals", "Deals"], ["employees", "Employees"], ["settings", "Settings"]];
  return (
    <div className="panel">
      <h2 className="panel-title">Management</h2>
      <div className="mg-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={"cat-chip" + (tab === id ? " sel" : "")} onClick={() => { sClick(); setTab(id); }}>{label}</button>
        ))}
      </div>
      {tab === "items" && <ItemsEditor items={items} crud={itemsCrud} showToast={showToast} />}
      {tab === "deals" && <DealsEditor deals={deals} crud={dealsCrud} showToast={showToast} />}
      {tab === "employees" && <EmployeesEditor employees={employees} crud={employeesCrud} showToast={showToast} />}
      {tab === "settings" && <SettingsEditor config={config} persist={persistConfig} showToast={showToast} />}
    </div>
  );
}

function ImgUpload({ value, onChange }) {
  const ref = useRef();
  return (
    <div className="img-up">
      <div className="img-up-preview" onClick={() => ref.current.click()}>
        {value ? <img src={value} alt="" /> : <span>＋ PNG</span>}
      </div>
      <input ref={ref} type="file" accept="image/*" style={{ display: "none" }}
        onChange={async (e) => {
          const f = e.target.files[0];
          if (!f) return;
          try { onChange(await fileToDataUrl(f)); sAdd(); } catch { sError(); }
          e.target.value = "";
        }} />
      {value && <button className="btn-ghost sm" onClick={() => { sRemove(); onChange(null); }}>Remove</button>}
    </div>
  );
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">{title}<button className="btn-ghost sm" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function DeleteBtn({ onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button className={"btn-danger sm" + (armed ? " armed" : "")}
      onClick={() => { if (armed) onConfirm(); else { sClick(); setArmed(true); } }}>
      {armed ? "Confirm?" : "Delete"}
    </button>
  );
}

function ItemsEditor({ items, crud, showToast }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const shown = items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  const openAdd = () => { sClick(); setEditing({ isNew: true, row: { id: uid(), name: "", price: "", category: "", img: null } }); };
  const openEdit = (row) => { sClick(); setEditing({ isNew: false, row: { ...row } }); };
  const set = (patch) => setEditing((e) => ({ ...e, row: { ...e.row, ...patch } }));
  const save = () => {
    const r = editing.row;
    if (!r.name.trim() || r.price === "" || isNaN(Number(r.price))) { sError(); showToast("Item needs a name and a valid price.", false); return; }
    crud.save({ ...r, name: r.name.trim(), price: Number(r.price), category: (r.category || "").trim() || "Misc" });
    setEditing(null); sSuccess(); showToast(editing.isNew ? "Item added." : "Item updated.");
  };
  return (
    <div>
      <div className="mg-toolbar">
        <input className="search" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" onClick={openAdd}>＋ Add item</button>
      </div>
      <div className="mg-list">
        {shown.length === 0 && <div className="mg-empty">{q ? "No items match your search." : "No items yet — add your first one."}</div>}
        {shown.map((i) => (
          <div key={i.id} className="mg-row">
            <div className="mg-thumb">{i.img ? <img src={i.img} alt="" /> : <span>🔩</span>}</div>
            <div className="mg-main">
              <div className="mg-name">{i.name}</div>
              <div className="mg-sub">{i.category || "Misc"}</div>
            </div>
            <div className="mg-price">{money(i.price)}</div>
            <div className="mg-actions">
              <button className="btn-ghost sm" onClick={() => openEdit(i)}>Edit</button>
              <DeleteBtn onConfirm={() => { sRemove(); crud.remove(i.id); showToast("Item removed."); }} />
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <Modal title={editing.isNew ? "Add item" : "Edit item"} onClose={() => setEditing(null)}
          footer={<>
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={save}>{editing.isNew ? "Add item" : "Save changes"}</button>
          </>}>
          <Field label="Picture"><ImgUpload value={editing.row.img} onChange={(img) => set({ img })} /></Field>
          <Field label="Name"><input className="search wide" autoFocus value={editing.row.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Price ($)"><input className="search wide" type="number" min="0" value={editing.row.price} onChange={(e) => set({ price: e.target.value })} /></Field>
          <Field label="Category"><input className="search wide" placeholder="e.g. Parts, Performance" value={editing.row.category || ""} onChange={(e) => set({ category: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

function DealsEditor({ deals, crud, showToast }) {
  const [editing, setEditing] = useState(null);
  const openAdd = () => { sClick(); setEditing({ isNew: true, row: { id: uid(), name: "", desc: "", price: "", img: null } }); };
  const openEdit = (row) => { sClick(); setEditing({ isNew: false, row: { ...row } }); };
  const set = (patch) => setEditing((e) => ({ ...e, row: { ...e.row, ...patch } }));
  const save = () => {
    const r = editing.row;
    if (!r.name.trim() || r.price === "" || isNaN(Number(r.price))) { sError(); showToast("Deal needs a name and a valid price.", false); return; }
    crud.save({ ...r, name: r.name.trim(), price: Number(r.price) });
    setEditing(null); sSuccess(); showToast(editing.isNew ? "Deal added." : "Deal updated.");
  };
  return (
    <div>
      <div className="mg-toolbar">
        <div className="mg-toolbar-spacer" />
        <button className="btn-primary" onClick={openAdd}>＋ Add deal</button>
      </div>
      <div className="mg-list">
        {deals.length === 0 && <div className="mg-empty">No deals yet — add your first one.</div>}
        {deals.map((d) => (
          <div key={d.id} className="mg-row">
            <div className="mg-thumb">{d.img ? <img src={d.img} alt="" /> : <span>★</span>}</div>
            <div className="mg-main">
              <div className="mg-name">{d.name}</div>
              <div className="mg-sub">{d.desc}</div>
            </div>
            <div className="mg-price">{money(d.price)}</div>
            <div className="mg-actions">
              <button className="btn-ghost sm" onClick={() => openEdit(d)}>Edit</button>
              <DeleteBtn onConfirm={() => { sRemove(); crud.remove(d.id); showToast("Deal removed."); }} />
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <Modal title={editing.isNew ? "Add deal" : "Edit deal"} onClose={() => setEditing(null)}
          footer={<>
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={save}>{editing.isNew ? "Add deal" : "Save changes"}</button>
          </>}>
          <Field label="Picture"><ImgUpload value={editing.row.img} onChange={(img) => set({ img })} /></Field>
          <Field label="Name"><input className="search wide" autoFocus value={editing.row.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Description"><input className="search wide" value={editing.row.desc || ""} onChange={(e) => set({ desc: e.target.value })} /></Field>
          <Field label="Price ($)"><input className="search wide" type="number" min="0" value={editing.row.price} onChange={(e) => set({ price: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

function EmployeesEditor({ employees, crud, showToast }) {
  const [editing, setEditing] = useState(null);
  const [showPin, setShowPin] = useState(false);
  const openAdd = () => { sClick(); setShowPin(false); setEditing({ isNew: true, row: { id: uid(), name: "", pin: "", role: "employee" } }); };
  const openEdit = (row) => { sClick(); setShowPin(false); setEditing({ isNew: false, row: { ...row } }); };
  const set = (patch) => setEditing((e) => ({ ...e, row: { ...e.row, ...patch } }));
  const save = () => {
    const r = editing.row;
    if (!r.name.trim() || !r.pin.trim()) { sError(); showToast("Employee needs a name and a PIN.", false); return; }
    if (!editing.isNew && r.role === "employee") {
      const was = employees.find((e) => e.id === r.id);
      const otherMgrs = employees.filter((e) => e.role === "management" && e.id !== r.id);
      if (was && was.role === "management" && otherMgrs.length === 0) { sError(); showToast("You need at least one management account.", false); return; }
    }
    crud.save({ ...r, name: r.name.trim(), pin: r.pin.trim() });
    setEditing(null); sSuccess(); showToast(editing.isNew ? "Employee added." : "Employee updated.");
  };
  const remove = (row) => {
    if (row.role === "management" && employees.filter((e) => e.role === "management").length === 1) {
      sError(); showToast("You need at least one management account.", false); return;
    }
    sRemove(); crud.remove(row.id); showToast("Employee removed.");
  };
  return (
    <div>
      <div className="mg-toolbar">
        <div className="mg-toolbar-spacer" />
        <button className="btn-primary" onClick={openAdd}>＋ Add employee</button>
      </div>
      <div className="mg-list">
        {employees.map((e) => (
          <div key={e.id} className="mg-row">
            <div className="mg-avatar">{(e.name || "?").charAt(0).toUpperCase()}</div>
            <div className="mg-main">
              <div className="mg-name">{e.name} {e.role === "management" && <span className="role-badge mgmt">MGMT</span>}</div>
              <div className="mg-sub">PIN ••••</div>
            </div>
            <div className="mg-actions">
              <button className="btn-ghost sm" onClick={() => openEdit(e)}>Edit</button>
              <DeleteBtn onConfirm={() => remove(e)} />
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <Modal title={editing.isNew ? "Add employee" : "Edit employee"} onClose={() => setEditing(null)}
          footer={<>
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" onClick={save}>{editing.isNew ? "Add employee" : "Save changes"}</button>
          </>}>
          <Field label="Name"><input className="search wide" autoFocus value={editing.row.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="PIN">
            <div className="pin-row">
              <input className="search" type={showPin ? "text" : "password"} inputMode="numeric" value={editing.row.pin} onChange={(e) => set({ pin: e.target.value })} />
              <button className="btn-ghost sm" onClick={() => { sClick(); setShowPin(!showPin); }}>{showPin ? "Hide" : "Show"}</button>
            </div>
          </Field>
          <Field label="Role">
            <select className="search wide" value={editing.row.role} onChange={(e) => set({ role: e.target.value })}>
              <option value="employee">Employee</option>
              <option value="management">Management</option>
            </select>
          </Field>
        </Modal>
      )}
    </div>
  );
}

function SettingsEditor({ config, persist, showToast }) {
  const [local, setLocal] = useState(config);
  useEffect(() => setLocal(config), [config]);
  const set = (patch) => setLocal({ ...local, ...patch });
  const setTheme = (k, v) => setLocal({ ...local, theme: { ...local.theme, [k]: v } });
  const save = () => { persist(local); sSuccess(); showToast("Settings saved for everyone."); };
  const colors = [
    ["bg", "Background"], ["panel", "Panels"], ["accent", "Accent"], ["accent2", "Accent 2"], ["text", "Text"],
  ];
  return (
    <div className="settings">
      <div className="set-group">
        <div className="section-label">Branding</div>
        <div className="set-row"><label>Shop name</label>
          <input className="search" value={local.shopName} onChange={(e) => set({ shopName: e.target.value })} /></div>
        <div className="set-row"><label>Tagline</label>
          <input className="search" value={local.tagline} onChange={(e) => set({ tagline: e.target.value })} /></div>
        <div className="set-row"><label>Logo (PNG)</label>
          <ImgUpload value={local.logo} onChange={(logo) => set({ logo })} /></div>
      </div>
      <div className="set-group">
        <div className="section-label">Theme colors</div>
        {colors.map(([k, label]) => (
          <div key={k} className="set-row">
            <label>{label}</label>
            <div className="color-row">
              <input type="color" value={local.theme[k]} onChange={(e) => setTheme(k, e.target.value)} />
              <input className="search num" value={local.theme[k]} onChange={(e) => setTheme(k, e.target.value)} />
            </div>
          </div>
        ))}
        <button className="btn-ghost sm" onClick={() => { sClick(); setLocal({ ...local, theme: { ...DEFAULT_THEME } }); }}>Reset colors to default</button>
      </div>
      <div className="set-group">
        <div className="section-label">Discord webhook</div>
        <div className="set-row"><label>Webhook URL</label>
          <input className="search wide" placeholder="https://discord.com/api/webhooks/…" value={local.webhook} onChange={(e) => set({ webhook: e.target.value })} /></div>
        <div className="muted sm-text">Every checkout posts an embed with employee, customer, items, and totals.</div>
      </div>
      <div className="set-group">
        <div className="section-label">Info panel text</div>
        <textarea className="search wide" rows={8} value={local.info} onChange={(e) => set({ info: e.target.value })} />
      </div>
      <button className="btn-primary big" onClick={save}>Save settings</button>
    </div>
  );
}

/* ============================ CSS ============================ */
function buildCss(t) {
  return `
  @import url('https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&family=Rajdhani:wght@500;600;700&display=swap');
  :root {
    --bg: ${t.bg}; --panel: ${t.panel}; --accent: ${t.accent};
    --accent2: ${t.accent2}; --text: ${t.text};
  }
  * { box-sizing: border-box; margin: 0; }
  body { margin: 0; }
  .app-root {
    min-height: 100vh; background: var(--bg); color: var(--text);
    font-family: "Rajdhani", "Segoe UI", system-ui, sans-serif; font-size: 16px;
    background-image:
      radial-gradient(ellipse at 50% -20%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 55%),
      radial-gradient(ellipse at 90% 110%, color-mix(in srgb, var(--accent2) 7%, transparent), transparent 45%),
      linear-gradient(color-mix(in srgb, var(--accent) 4%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--accent) 4%, transparent) 1px, transparent 1px);
    background-size: 100% 100%, 100% 100%, 44px 44px, 44px 44px;
    position: relative;
  }
  .app-root::after {
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 200;
    background: repeating-linear-gradient(0deg, rgba(0,0,0,.09) 0 1px, transparent 1px 3px);
    mix-blend-mode: multiply;
  }
  h1, h2, h3, .brand-name, .panel-title, .cart-head, .btn-primary, .nav-btn, .stat-num, .deal-name {
    font-family: "Chakra Petch", "Rajdhani", sans-serif;
  }
  button { font-family: inherit; cursor: pointer; }
  input, select, textarea { font-family: inherit; }

  .topbar {
    position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 20px;
    padding: 12px 22px; background: color-mix(in srgb, var(--panel) 92%, black);
    border-bottom: 2px solid var(--accent);
    box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 45%, transparent), 0 4px 24px rgba(0,0,0,.5);
  }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 220px; }
  .brand-logo {
    width: 48px; height: 48px; border-radius: 10px; background: color-mix(in srgb, var(--accent) 15%, var(--panel));
    display: flex; align-items: center; justify-content: center; font-size: 24px; overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .brand-logo img { width: 100%; height: 100%; object-fit: contain; }
  .brand-name { font-weight: 700; letter-spacing: 1.5px; font-size: 17px; text-transform: uppercase;
    text-shadow: 0 0 10px color-mix(in srgb, var(--accent) 70%, transparent); }
  .brand-sub { font-size: 10px; letter-spacing: 3px; opacity: .55; text-transform: uppercase; color: var(--accent2); }
  .nav { display: flex; gap: 6px; flex: 1; justify-content: center; flex-wrap: wrap; }
  .nav-btn {
    background: transparent; border: none; color: var(--text); opacity: .6;
    padding: 9px 18px; border-radius: 4px; font-size: 13px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase;
    transition: all .18s ease; border-bottom: 2px solid transparent;
  }
  .nav-btn:hover { opacity: 1; background: color-mix(in srgb, var(--accent) 8%, transparent); transform: translateY(-1px);
    text-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent); }
  .nav-btn.active { opacity: 1; color: var(--accent); border-bottom-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    text-shadow: 0 0 10px color-mix(in srgb, var(--accent) 80%, transparent);
    box-shadow: 0 6px 14px -6px color-mix(in srgb, var(--accent) 70%, transparent); }
  .userbox { display: flex; align-items: center; gap: 12px; }
  .user-name { font-weight: 700; font-size: 14px; }
  .user-role { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--accent); }

  .panel-wrap { animation: panelIn .28s cubic-bezier(.22,.9,.3,1); }
  @keyframes panelIn { from { opacity: 0; transform: translateY(14px) scale(.995); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .panel-wrap { animation: none; } }
  .panel { max-width: 1200px; margin: 0 auto; padding: 28px 22px 60px; }
  .panel-title { font-size: 24px; margin-bottom: 18px; letter-spacing: 3px; text-transform: uppercase;
    text-shadow: 0 0 12px color-mix(in srgb, var(--accent) 45%, transparent);
    border-left: 4px solid var(--accent2); padding-left: 12px; }
  .section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: .55; margin: 22px 0 10px; }
  .muted { opacity: .55; } .pad { padding: 18px; } .sm-text { font-size: 12px; margin-top: 6px; }

  .hero { background: linear-gradient(140deg, var(--panel), color-mix(in srgb, var(--panel) 75%, black));
    border-radius: 8px; padding: 30px; border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
    border-left: 3px solid var(--accent);
    box-shadow: inset 0 0 40px color-mix(in srgb, var(--accent) 4%, transparent), 0 0 20px color-mix(in srgb, var(--accent) 10%, transparent); }
  .hero h2 { font-size: 28px; letter-spacing: 1px; text-transform: uppercase;
    text-shadow: 0 0 14px color-mix(in srgb, var(--accent) 50%, transparent); }
  .hero p { opacity: .6; margin: 6px 0 16px; }
  .big-search { width: 100%; font-size: 17px; padding: 14px 18px; }
  .pc-results { margin-top: 12px; }
  .pc-row { display: flex; justify-content: space-between; padding: 10px 14px; border-radius: 8px; background: color-mix(in srgb, var(--bg) 60%, transparent); margin-bottom: 6px; }
  .pc-price { color: var(--accent); font-weight: 800; }
  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 18px; }
  .stat-card { background: var(--panel); border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent); border-radius: 6px; padding: 20px; text-align: left; color: var(--text); transition: all .18s ease; }
  .stat-card:hover { transform: translateY(-3px); border-color: var(--accent2);
    box-shadow: 0 0 18px color-mix(in srgb, var(--accent2) 35%, transparent); }
  .stat-num { font-size: 34px; font-weight: 700; color: var(--accent);
    text-shadow: 0 0 14px color-mix(in srgb, var(--accent) 65%, transparent); }
  .stat-label { opacity: .65; margin-top: 2px; }
  .stat-go { margin-top: 12px; font-size: 13px; color: var(--accent2); font-weight: 600; }

  .register-grid { display: grid; grid-template-columns: 1fr 340px; gap: 20px; align-items: start; }
  @media (max-width: 900px) { .register-grid { grid-template-columns: 1fr; } }
  .reg-controls { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
  .search {
    background: color-mix(in srgb, var(--bg) 70%, black); color: var(--text);
    border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); border-radius: 10px;
    padding: 10px 14px; font-size: 14px; outline: none; transition: border .15s;
  }
  .search:focus { border-color: var(--accent); }
  .search.num { width: 110px; } .search.wide { width: 100%; }
  .cat-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .cat-chip, .deal-chip, .emp-chip {
    background: var(--panel); color: var(--text); border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    padding: 7px 14px; border-radius: 999px; font-size: 13px; transition: all .15s;
  }
  .cat-chip:hover, .deal-chip:hover, .emp-chip:hover { border-color: var(--accent); transform: translateY(-1px); }
  .cat-chip.sel, .emp-chip.sel { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 700; }
  .item-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .item-card {
    background: linear-gradient(160deg, var(--panel), color-mix(in srgb, var(--panel) 80%, black));
    border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent); border-radius: 6px;
    padding: 12px; color: var(--text); text-align: center; transition: all .15s ease;
  }
  .item-card:hover { transform: translateY(-3px); border-color: var(--accent);
    box-shadow: 0 0 16px color-mix(in srgb, var(--accent) 40%, transparent), inset 0 0 20px color-mix(in srgb, var(--accent) 6%, transparent); }
  .item-card:active { transform: scale(.96); }
  .item-img { height: 80px; display: flex; align-items: center; justify-content: center; font-size: 32px; margin-bottom: 8px; }
  .item-img img { max-height: 80px; max-width: 100%; object-fit: contain; border-radius: 8px; }
  .item-name { font-size: 13px; font-weight: 600; min-height: 32px; }
  .item-price { color: var(--accent); font-weight: 800; margin-top: 4px; font-family: "Chakra Petch", sans-serif;
    text-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent); }
  .deal-strip { display: flex; gap: 8px; flex-wrap: wrap; }

  .cart { background: var(--panel); border-radius: 8px; border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-top: 2px solid var(--accent);
    padding: 16px; position: sticky; top: 86px; display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 12%, transparent); }
  .cart-head { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 15px;
    letter-spacing: 2.5px; text-transform: uppercase; color: var(--accent);
    text-shadow: 0 0 8px color-mix(in srgb, var(--accent) 55%, transparent); }
  .cart-lines { max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .cart-line { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center;
    background: color-mix(in srgb, var(--bg) 55%, transparent); padding: 8px 10px; border-radius: 10px; animation: lineIn .18s ease; }
  @keyframes lineIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
  .cl-name { font-size: 13px; font-weight: 600; }
  .cl-controls { display: flex; align-items: center; gap: 6px; }
  .qty-btn { width: 24px; height: 24px; border-radius: 6px; border: none; background: color-mix(in srgb, var(--text) 12%, transparent); color: var(--text); font-weight: 800; }
  .qty-btn:hover { background: var(--accent); color: var(--bg); }
  .cl-qty { min-width: 18px; text-align: center; font-weight: 700; font-size: 13px; }
  .cl-price { font-weight: 700; font-size: 13px; color: var(--accent); }
  .cart-meta { display: flex; flex-direction: column; gap: 8px; }
  .disc-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; opacity: .85; }
  .disc-row input { width: 80px; background: color-mix(in srgb, var(--bg) 70%, black); color: var(--text);
    border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); border-radius: 8px; padding: 6px 10px; }
  .totals { border-top: 1px dashed color-mix(in srgb, var(--text) 20%, transparent); padding-top: 10px; }
  .t-row { display: flex; justify-content: space-between; font-size: 14px; padding: 3px 0; opacity: .8; }
  .t-row.grand { font-size: 22px; font-weight: 800; opacity: 1; color: var(--accent); font-family: "Chakra Petch", sans-serif;
    text-shadow: 0 0 12px color-mix(in srgb, var(--accent) 70%, transparent); }

  .deals-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .deal-card { background: var(--panel); border-radius: 8px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--accent2) 25%, transparent); display: flex; flex-direction: column; transition: all .18s; }
  .deal-card:hover { transform: translateY(-3px); border-color: var(--accent2);
    box-shadow: 0 0 18px color-mix(in srgb, var(--accent2) 40%, transparent); }
  .deal-img { height: 120px; display: flex; align-items: center; justify-content: center; font-size: 42px; color: var(--accent2);
    background: linear-gradient(135deg, color-mix(in srgb, var(--accent2) 14%, transparent), color-mix(in srgb, var(--accent) 8%, transparent));
    text-shadow: 0 0 18px color-mix(in srgb, var(--accent2) 70%, transparent); }
  .deal-img img { height: 100%; width: 100%; object-fit: cover; }
  .deal-body { padding: 14px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .deal-name { font-weight: 800; font-size: 16px; }
  .deal-desc { opacity: .6; font-size: 13px; flex: 1; }
  .deal-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
  .deal-price { color: var(--accent); font-weight: 800; font-size: 18px; font-family: "Chakra Petch", sans-serif;
    text-shadow: 0 0 10px color-mix(in srgb, var(--accent) 60%, transparent); }

  .info-card { background: var(--panel); border-radius: 14px; padding: 24px; border-left: 4px solid var(--accent); line-height: 1.7; }
  .info-card .spacer { height: 10px; }

  .mg-tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .board-stats { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .board-stat { background: var(--panel); border: 1px solid color-mix(in srgb, var(--text) 10%, transparent); border-radius: 5px; padding: 12px 20px; display: flex; flex-direction: column; }
  .bs-num { font-size: 24px; font-weight: 700; color: var(--accent); }
  .bs-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; opacity: .55; }
  .board-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin-top: 14px; }
  .board-card { display: flex; gap: 14px; align-items: flex-start; text-align: left; background: var(--panel); color: var(--text);
    border: 1px solid color-mix(in srgb, var(--text) 10%, transparent); border-radius: 6px; padding: 14px; transition: all .15s; }
  .board-card:hover { border-color: var(--accent); transform: translateY(-2px); }
  .board-avatar { width: 46px; height: 46px; border-radius: 50%; flex: none; overflow: hidden;
    background: color-mix(in srgb, var(--accent) 18%, var(--panel)); color: var(--accent);
    display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; }
  .board-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .board-avatar.lg { width: 68px; height: 68px; font-size: 26px; }
  .board-info { flex: 1; min-width: 0; }
  .board-name { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; }
  .board-callsign { font-size: 12px; color: var(--accent2); opacity: .9; margin-top: 1px; }
  .board-specialty { font-size: 13px; opacity: .65; margin-top: 4px; }
  .board-contact { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; font-size: 12px; opacity: .8; }
  .board-contact .dim, .pl-value.dim { opacity: .4; }
  .profile-head { display: flex; gap: 14px; align-items: center; padding-bottom: 12px; border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent); }
  .profile-line { display: flex; gap: 12px; padding: 7px 0; border-bottom: 1px dashed color-mix(in srgb, var(--text) 8%, transparent); font-size: 13px; }
  .pl-label { flex: 0 0 110px; text-transform: uppercase; font-size: 11px; letter-spacing: 1.5px; opacity: .55; padding-top: 2px; }
  .pl-value { flex: 1; white-space: pre-wrap; }
  .myinfo-wrap { display: flex; justify-content: center; }
  .myinfo-card { background: var(--panel); border: 1px solid color-mix(in srgb, var(--text) 10%, transparent); border-radius: 6px; padding: 22px; width: 100%; max-width: 560px; display: flex; flex-direction: column; gap: 14px; }
  .myinfo-avatar-row { display: flex; gap: 16px; align-items: center; padding-bottom: 14px; border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent); }
  .privacy-note { font-size: 12px; line-height: 1.5; padding: 10px 12px; border-radius: 4px; border-left: 3px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent); opacity: .85; }
  .myinfo-card textarea { resize: vertical; }
  .btn-primary:disabled { opacity: .45; cursor: default; }
  @media (max-width: 640px) { .board-grid { grid-template-columns: 1fr; } }
  .mg-toolbar { display: flex; gap: 10px; margin-bottom: 14px; }
  .mg-toolbar .search { flex: 1; }
  .mg-toolbar-spacer { flex: 1; }
  .mg-list { display: flex; flex-direction: column; gap: 8px; }
  .mg-row { display: flex; align-items: center; gap: 14px; background: var(--panel); border: 1px solid color-mix(in srgb, var(--text) 10%, transparent); border-radius: 5px; padding: 10px 14px; }
  .mg-thumb { width: 40px; height: 40px; border-radius: 4px; overflow: hidden; background: color-mix(in srgb, var(--bg) 60%, transparent); display: flex; align-items: center; justify-content: center; font-size: 18px; flex: none; }
  .mg-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .mg-avatar { width: 40px; height: 40px; border-radius: 50%; background: color-mix(in srgb, var(--accent) 18%, var(--panel)); color: var(--accent); display: flex; align-items: center; justify-content: center; font-weight: 700; flex: none; }
  .mg-main { flex: 1; min-width: 0; }
  .mg-name { font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .mg-sub { font-size: 12px; opacity: .55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mg-price { font-weight: 700; color: var(--accent); white-space: nowrap; }
  .mg-actions { display: flex; gap: 8px; flex: none; }
  .mg-empty { opacity: .5; padding: 24px; text-align: center; }
  .role-badge { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; padding: 2px 8px; border-radius: 3px; background: color-mix(in srgb, var(--accent2) 25%, transparent); }
  .role-badge.mgmt { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); }
  .btn-danger.sm { padding: 5px 12px; font-size: 12px; }
  .btn-danger.armed { background: #b04130; color: #fff; border-color: #b04130; }
  .modal-overlay { position: fixed; inset: 0; z-index: 90; background: rgba(0,0,0,.62); display: flex; align-items: center; justify-content: center; padding: 20px; animation: toastIn .18s ease; }
  .modal-card { background: var(--panel); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); border-radius: 6px; width: 100%; max-width: 440px; box-shadow: 0 30px 80px rgba(0,0,0,.6); animation: panelIn .22s ease; }
  .modal-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; font-weight: 700; font-size: 16px; border-bottom: 1px solid color-mix(in srgb, var(--text) 10%, transparent); }
  .modal-body { padding: 18px; display: flex; flex-direction: column; gap: 14px; max-height: 60vh; overflow-y: auto; }
  .modal-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 18px; border-top: 1px solid color-mix(in srgb, var(--text) 10%, transparent); }
  .field label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; opacity: .6; margin-bottom: 6px; }
  .pin-row { display: flex; gap: 8px; }
  .pin-row .search { flex: 1; }
  @media (max-width: 640px) { .mg-row { flex-wrap: wrap; } .mg-actions { width: 100%; justify-content: flex-end; } }
  .editor-add, .editor-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    background: var(--panel); padding: 12px; border-radius: 12px; margin-bottom: 10px;
    border: 1px solid color-mix(in srgb, var(--text) 8%, transparent); }
  .editor-add { border-style: dashed; border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .editor-add .search, .editor-row .search { flex: 1; min-width: 120px; }
  .editor-add .search.num, .editor-row .search.num { flex: 0 0 110px; }
  .img-up { display: flex; align-items: center; gap: 6px; }
  .img-up-preview { width: 52px; height: 52px; border-radius: 10px; border: 1px dashed color-mix(in srgb, var(--text) 30%, transparent);
    display: flex; align-items: center; justify-content: center; font-size: 11px; opacity: .8; cursor: pointer; overflow: hidden; background: color-mix(in srgb, var(--bg) 60%, transparent); }
  .img-up-preview img { width: 100%; height: 100%; object-fit: cover; }
  .img-up-preview:hover { border-color: var(--accent); }

  .settings { display: flex; flex-direction: column; gap: 8px; max-width: 720px; }
  .set-group { background: var(--panel); border-radius: 14px; padding: 18px; border: 1px solid color-mix(in srgb, var(--text) 8%, transparent); }
  .set-group .section-label { margin-top: 0; }
  .set-row { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
  .set-row label { flex: 0 0 130px; font-size: 13px; opacity: .75; }
  .set-row .search { flex: 1; }
  .color-row { display: flex; gap: 8px; align-items: center; }
  .color-row input[type=color] { width: 44px; height: 36px; border: none; background: none; cursor: pointer; padding: 0; }

  .btn-primary {
    background: linear-gradient(120deg, var(--accent), color-mix(in srgb, var(--accent) 60%, var(--accent2)));
    color: var(--bg); border: none; border-radius: 4px;
    padding: 10px 20px; font-weight: 700; font-size: 14px; letter-spacing: 1.5px; text-transform: uppercase; transition: all .15s;
    box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .btn-primary:hover { filter: brightness(1.15); transform: translateY(-1px);
    box-shadow: 0 0 22px color-mix(in srgb, var(--accent) 70%, transparent); }
  .btn-primary:active { transform: scale(.97); }
  .btn-primary:disabled { opacity: .5; cursor: wait; }
  .btn-primary.big { padding: 14px; font-size: 16px; width: 100%; }
  .btn-primary.sm { padding: 7px 14px; font-size: 13px; }
  .btn-ghost { background: transparent; border: 1px solid color-mix(in srgb, var(--text) 20%, transparent); color: var(--text); border-radius: 8px; padding: 7px 14px; font-size: 13px; transition: all .15s; }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
  .btn-ghost.sm { padding: 4px 10px; font-size: 12px; }
  .btn-danger { background: transparent; border: 1px solid #b0413066; color: #e06455; border-radius: 8px; padding: 8px 14px; font-size: 13px; }
  .btn-danger:hover { background: #b0413022; }

  .login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;
    background-image:
      radial-gradient(ellipse at 50% 120%, color-mix(in srgb, var(--accent2) 12%, transparent), transparent 60%),
      linear-gradient(color-mix(in srgb, var(--accent) 5%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, var(--accent) 5%, transparent) 1px, transparent 1px);
    background-size: 100% 100%, 44px 44px, 44px 44px; }
  .login-card { background: color-mix(in srgb, var(--panel) 92%, black); border-radius: 10px; padding: 36px; width: 100%; max-width: 420px; text-align: center;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); border-top: 3px solid var(--accent);
    box-shadow: 0 0 40px color-mix(in srgb, var(--accent) 22%, transparent), 0 30px 80px rgba(0,0,0,.6);
    animation: panelIn .35s ease; }
  .login-logo { width: 84px; height: 84px; margin: 0 auto 14px; border-radius: 18px; overflow: hidden;
    background: color-mix(in srgb, var(--accent) 14%, var(--bg)); display: flex; align-items: center; justify-content: center; font-size: 40px; }
  .login-logo img { width: 100%; height: 100%; object-fit: contain; }
  .login-card h1 { font-size: 24px; letter-spacing: 2px; text-transform: uppercase;
    text-shadow: 0 0 16px color-mix(in srgb, var(--accent) 60%, transparent); }
  .tagline { font-size: 10px; letter-spacing: 3px; opacity: .5; text-transform: uppercase; margin: 4px 0 22px; }
  .login-emps { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 16px; }
  .mgr-tag { font-size: 9px; margin-left: 6px; padding: 1px 6px; border-radius: 99px; background: color-mix(in srgb, var(--accent2) 30%, transparent); letter-spacing: 1px; }
  .pin-input { width: 100%; text-align: center; letter-spacing: 8px; font-size: 20px; padding: 12px;
    background: color-mix(in srgb, var(--bg) 70%, black); color: var(--text);
    border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); border-radius: 12px; margin-bottom: 14px; outline: none; }
  .pin-input:focus { border-color: var(--accent); box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 45%, transparent); }
  .search:focus { box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 30%, transparent); }
  .login-err { color: #e06455; font-size: 13px; margin-bottom: 10px; }

  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 100;
    background: var(--panel); color: var(--text); padding: 12px 22px; border-radius: 12px; font-size: 14px; font-weight: 600;
    box-shadow: 0 0 20px color-mix(in srgb, var(--accent) 35%, transparent), 0 12px 40px rgba(0,0,0,.5);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); border-left: 4px solid var(--accent); animation: toastIn .25s ease; }
  .toast.bad { border-left-color: #e06455; }
  @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 14px); } to { opacity: 1; transform: translate(-50%, 0); } }
  `;
}
