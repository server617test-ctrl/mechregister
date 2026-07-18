import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

/* ============================================================
   MECHANIC SHOP REGISTER — FiveM RP point-of-sale
   Backend: Supabase (tables: shop_config, items, deals, employees)
   Default management login: employee "Boss", PIN 1234
   ============================================================ */

const DEFAULT_THEME = {
  bg: "#16181c",
  panel: "#20242a",
  accent: "#ffb400",
  accent2: "#9aa4b0",
  text: "#e7eaee",
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
    ["main", "Main"], ["register", "Register"], ["deals", "Deals"], ["info", "Info"],
  ];
  if (user.role === "management") tabs.push(["management", "Management"]);
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

function ItemsEditor({ items, crud, showToast }) {
  const [draft, setDraft] = useState({ name: "", price: "", category: "", img: null });
  const add = () => {
    if (!draft.name || draft.price === "") { sError(); showToast("Item needs a name and price.", false); return; }
    crud.add({ id: uid(), name: draft.name, price: Number(draft.price), category: draft.category || "Misc", img: draft.img });
    setDraft({ name: "", price: "", category: "", img: null });
    sSuccess(); showToast("Item added.");
  };
  return (
    <div>
      <div className="editor-add">
        <ImgUpload value={draft.img} onChange={(img) => setDraft({ ...draft, img })} />
        <input className="search" placeholder="Item name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="search num" type="number" placeholder="Price" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
        <input className="search" placeholder="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
        <button className="btn-primary" onClick={add}>Add item</button>
      </div>
      <div className="editor-list">
        {items.map((i) => (
          <div key={i.id} className="editor-row">
            <ImgUpload value={i.img} onChange={(img) => crud.update(i.id, { img })} />
            <input className="search" value={i.name} onChange={(e) => crud.update(i.id, { name: e.target.value })} />
            <input className="search num" type="number" value={i.price} onChange={(e) => crud.update(i.id, { price: Number(e.target.value) })} />
            <input className="search" value={i.category || ""} onChange={(e) => crud.update(i.id, { category: e.target.value })} />
            <button className="btn-danger" onClick={() => { sRemove(); crud.remove(i.id); showToast("Item removed."); }}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DealsEditor({ deals, crud, showToast }) {
  const [draft, setDraft] = useState({ name: "", desc: "", price: "", img: null });
  const add = () => {
    if (!draft.name || draft.price === "") { sError(); showToast("Deal needs a name and price.", false); return; }
    crud.add({ id: uid(), name: draft.name, desc: draft.desc, price: Number(draft.price), img: draft.img });
    setDraft({ name: "", desc: "", price: "", img: null });
    sSuccess(); showToast("Deal added.");
  };
  return (
    <div>
      <div className="editor-add">
        <ImgUpload value={draft.img} onChange={(img) => setDraft({ ...draft, img })} />
        <input className="search" placeholder="Deal name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="search" placeholder="Description" value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} />
        <input className="search num" type="number" placeholder="Price" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
        <button className="btn-primary" onClick={add}>Add deal</button>
      </div>
      <div className="editor-list">
        {deals.map((d) => (
          <div key={d.id} className="editor-row">
            <ImgUpload value={d.img} onChange={(img) => crud.update(d.id, { img })} />
            <input className="search" value={d.name} onChange={(e) => crud.update(d.id, { name: e.target.value })} />
            <input className="search" value={d.desc} onChange={(e) => crud.update(d.id, { desc: e.target.value })} />
            <input className="search num" type="number" value={d.price} onChange={(e) => crud.update(d.id, { price: Number(e.target.value) })} />
            <button className="btn-danger" onClick={() => { sRemove(); crud.remove(d.id); showToast("Deal removed."); }}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmployeesEditor({ employees, crud, showToast }) {
  const [draft, setDraft] = useState({ name: "", pin: "", role: "employee" });
  const add = () => {
    if (!draft.name || !draft.pin) { sError(); showToast("Employee needs a name and PIN.", false); return; }
    crud.add({ id: uid(), ...draft });
    setDraft({ name: "", pin: "", role: "employee" });
    sSuccess(); showToast("Employee added.");
  };
  const remove = (id) => {
    const mgrs = employees.filter((e) => e.role === "management");
    const target = employees.find((e) => e.id === id);
    if (target.role === "management" && mgrs.length === 1) { sError(); showToast("You need at least one management account.", false); return; }
    sRemove(); crud.remove(id); showToast("Employee removed.");
  };
  return (
    <div>
      <div className="editor-add">
        <input className="search" placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="search num" placeholder="PIN" value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value })} />
        <select className="search" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
          <option value="employee">Employee</option>
          <option value="management">Management</option>
        </select>
        <button className="btn-primary" onClick={add}>Add employee</button>
      </div>
      <div className="editor-list">
        {employees.map((e) => (
          <div key={e.id} className="editor-row">
            <input className="search" value={e.name} onChange={(ev) => crud.update(e.id, { name: ev.target.value })} />
            <input className="search num" value={e.pin} onChange={(ev) => crud.update(e.id, { pin: ev.target.value })} />
            <select className="search" value={e.role} onChange={(ev) => crud.update(e.id, { role: ev.target.value })}>
              <option value="employee">Employee</option>
              <option value="management">Management</option>
            </select>
            <button className="btn-danger" onClick={() => remove(e.id)}>Remove</button>
          </div>
        ))}
      </div>
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
  @import url('https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap');
  :root {
    --bg: ${t.bg}; --panel: ${t.panel}; --accent: ${t.accent};
    --accent2: ${t.accent2}; --text: ${t.text};
    --hazard: repeating-linear-gradient(-45deg, ${t.accent} 0 12px, #1a1a1a 12px 24px);
  }
  * { box-sizing: border-box; margin: 0; }
  body { margin: 0; }
  .app-root {
    min-height: 100vh; background: var(--bg); color: var(--text);
    font-family: "Barlow", "Segoe UI", system-ui, sans-serif;
    background-image:
      linear-gradient(180deg, rgba(255,255,255,.015) 0 1px, transparent 1px),
      radial-gradient(ellipse at 50% -20%, rgba(255,255,255,.04), transparent 50%);
    background-size: 100% 3px, 100% 100%;
  }
  h1, h2, h3, .brand-name, .panel-title, .cart-head, .btn-primary, .nav-btn, .stat-num, .deal-name, .section-label {
    font-family: "Saira Condensed", "Barlow", sans-serif;
  }
  button { font-family: inherit; cursor: pointer; }
  input, select, textarea { font-family: inherit; }

  .topbar {
    position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 20px;
    padding: 12px 22px; background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 90%, white) 0%, var(--panel) 12%, color-mix(in srgb, var(--panel) 85%, black) 100%);
    border-bottom: 6px solid transparent;
    border-image: var(--hazard) 1;
    box-shadow: 0 4px 20px rgba(0,0,0,.5);
  }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 220px; }
  .brand-logo {
    width: 48px; height: 48px; border-radius: 2px; background: color-mix(in srgb, var(--accent) 12%, var(--panel));
    display: flex; align-items: center; justify-content: center; font-size: 24px; overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--accent2) 45%, transparent);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.08), inset 0 -2px 4px rgba(0,0,0,.4);
  }
  .brand-logo img { width: 100%; height: 100%; object-fit: contain; }
  .brand-name { font-weight: 700; letter-spacing: 2px; font-size: 18px; text-transform: uppercase; }
  .brand-sub { font-size: 10px; letter-spacing: 3px; opacity: .5; text-transform: uppercase; }
  .nav { display: flex; gap: 6px; flex: 1; justify-content: center; flex-wrap: wrap; }
  .nav-btn {
    background: transparent; border: 1px solid transparent; color: var(--text); opacity: .6;
    padding: 8px 18px; border-radius: 2px; font-size: 14px; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase;
    transition: all .15s ease;
  }
  .nav-btn:hover { opacity: 1; border-color: color-mix(in srgb, var(--accent2) 40%, transparent); background: rgba(255,255,255,.03); }
  .nav-btn.active { opacity: 1; color: var(--bg); background: var(--accent); font-weight: 700;
    box-shadow: inset 0 -2px 0 rgba(0,0,0,.25), 0 2px 8px rgba(0,0,0,.4); }
  .userbox { display: flex; align-items: center; gap: 12px; }
  .user-name { font-weight: 700; font-size: 14px; }
  .user-role { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--accent); }

  .panel-wrap { animation: panelIn .28s cubic-bezier(.22,.9,.3,1); }
  @keyframes panelIn { from { opacity: 0; transform: translateY(14px) scale(.995); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .panel-wrap { animation: none; } }
  .panel { max-width: 1200px; margin: 0 auto; padding: 28px 22px 60px; }
  .panel-title { font-size: 26px; margin-bottom: 18px; letter-spacing: 3px; text-transform: uppercase;
    border-left: 5px solid var(--accent); padding-left: 14px; line-height: 1.1; }
  .section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; opacity: .55; margin: 22px 0 10px; }
  .muted { opacity: .55; } .pad { padding: 18px; } .sm-text { font-size: 12px; margin-top: 6px; }

  .hero { background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 92%, white) 0%, var(--panel) 8%, color-mix(in srgb, var(--panel) 88%, black) 100%);
    border-radius: 3px; padding: 30px; border: 1px solid color-mix(in srgb, var(--accent2) 30%, transparent);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 6px 18px rgba(0,0,0,.35);
    position: relative; overflow: hidden; }
  .hero::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 5px; background: var(--hazard); }
  .hero h2 { font-size: 30px; letter-spacing: 1.5px; text-transform: uppercase; }
  .hero p { opacity: .6; margin: 6px 0 16px; }
  .big-search { width: 100%; font-size: 17px; padding: 14px 18px; }
  .pc-results { margin-top: 12px; }
  .pc-row { display: flex; justify-content: space-between; padding: 10px 14px; border-radius: 8px; background: color-mix(in srgb, var(--bg) 60%, transparent); margin-bottom: 6px; }
  .pc-price { color: var(--accent); font-weight: 800; }
  .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 18px; }
  .stat-card { background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 92%, white) 0%, var(--panel) 10%, color-mix(in srgb, var(--panel) 90%, black) 100%);
    border: 1px solid color-mix(in srgb, var(--accent2) 30%, transparent); border-radius: 3px; padding: 20px; text-align: left; color: var(--text); transition: all .15s ease;
    border-left: 4px solid var(--accent2);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06); }
  .stat-card:hover { transform: translateY(-2px); border-left-color: var(--accent); box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 8px 20px rgba(0,0,0,.4); }
  .stat-num { font-size: 36px; font-weight: 700; color: var(--accent); letter-spacing: 1px; }
  .stat-label { opacity: .65; margin-top: 2px; }
  .stat-go { margin-top: 12px; font-size: 13px; color: var(--accent2); font-weight: 600; }

  .register-grid { display: grid; grid-template-columns: 1fr 340px; gap: 20px; align-items: start; }
  @media (max-width: 900px) { .register-grid { grid-template-columns: 1fr; } }
  .reg-controls { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
  .search {
    background: color-mix(in srgb, var(--bg) 75%, black); color: var(--text);
    border: 1px solid color-mix(in srgb, var(--accent2) 30%, transparent); border-radius: 2px;
    padding: 10px 14px; font-size: 14px; outline: none; transition: border .15s;
    box-shadow: inset 0 2px 4px rgba(0,0,0,.35);
  }
  .search:focus { border-color: var(--accent); }
  .search.num { width: 110px; } .search.wide { width: 100%; }
  .cat-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .cat-chip, .deal-chip, .emp-chip {
    background: var(--panel); color: var(--text); border: 1px solid color-mix(in srgb, var(--accent2) 35%, transparent);
    padding: 6px 14px; border-radius: 2px; font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; font-weight: 600; transition: all .12s;
  }
  .cat-chip:hover, .deal-chip:hover, .emp-chip:hover { border-color: var(--accent); }
  .cat-chip.sel, .emp-chip.sel { background: var(--accent); color: #17181a; border-color: var(--accent); font-weight: 700;
    box-shadow: inset 0 -2px 0 rgba(0,0,0,.2); }
  .item-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .item-card {
    background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 94%, white) 0%, var(--panel) 12%, color-mix(in srgb, var(--panel) 90%, black) 100%);
    border: 1px solid color-mix(in srgb, var(--accent2) 28%, transparent); border-radius: 3px;
    padding: 12px; color: var(--text); text-align: center; transition: all .12s ease;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.05);
  }
  .item-card:hover { transform: translateY(-2px); border-color: var(--accent); box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 6px 16px rgba(0,0,0,.4); }
  .item-card:active { transform: translateY(0) scale(.97); }
  .item-img { height: 80px; display: flex; align-items: center; justify-content: center; font-size: 32px; margin-bottom: 8px; }
  .item-img img { max-height: 80px; max-width: 100%; object-fit: contain; border-radius: 8px; }
  .item-name { font-size: 13px; font-weight: 600; min-height: 32px; }
  .item-price { color: var(--accent); font-weight: 700; margin-top: 4px; font-family: "Saira Condensed", sans-serif; font-size: 16px; letter-spacing: 1px; }
  .deal-strip { display: flex; gap: 8px; flex-wrap: wrap; }

  .cart { background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 92%, white) 0%, var(--panel) 8%, color-mix(in srgb, var(--panel) 90%, black) 100%);
    border-radius: 3px; border: 1px solid color-mix(in srgb, var(--accent2) 35%, transparent);
    padding: 16px; position: sticky; top: 92px; display: flex; flex-direction: column; gap: 12px;
    position: sticky; overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 8px 24px rgba(0,0,0,.4); }
  .cart::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 5px; background: var(--hazard); }
  .cart-head { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 16px;
    letter-spacing: 3px; text-transform: uppercase; margin-top: 4px; }
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
  .t-row.grand { font-size: 22px; font-weight: 700; opacity: 1; color: var(--accent); font-family: "Saira Condensed", sans-serif; letter-spacing: 1.5px; text-transform: uppercase; }

  .deals-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .deal-card { background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 92%, white) 0%, var(--panel) 8%, color-mix(in srgb, var(--panel) 90%, black) 100%);
    border-radius: 3px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--accent2) 30%, transparent); display: flex; flex-direction: column; transition: all .15s;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.05); }
  .deal-card:hover { transform: translateY(-2px); border-color: var(--accent); box-shadow: 0 8px 20px rgba(0,0,0,.4); }
  .deal-img { height: 120px; display: flex; align-items: center; justify-content: center; font-size: 42px; color: var(--accent);
    background: repeating-linear-gradient(-45deg, rgba(0,0,0,.25) 0 14px, transparent 14px 28px), color-mix(in srgb, var(--panel) 80%, black); }
  .deal-img img { height: 100%; width: 100%; object-fit: cover; }
  .deal-body { padding: 14px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .deal-name { font-weight: 700; font-size: 17px; letter-spacing: 1.5px; text-transform: uppercase; }
  .deal-desc { opacity: .6; font-size: 13px; flex: 1; }
  .deal-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
  .deal-price { color: var(--accent); font-weight: 800; font-size: 18px; }

  .info-card { background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 92%, white) 0%, var(--panel) 6%, color-mix(in srgb, var(--panel) 90%, black) 100%);
    border-radius: 3px; padding: 24px; border: 1px solid color-mix(in srgb, var(--accent2) 30%, transparent);
    border-left: 5px solid var(--accent); line-height: 1.7;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.05); }
  .info-card .spacer { height: 10px; }

  .mg-tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
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
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 90%, white), var(--accent) 40%, color-mix(in srgb, var(--accent) 85%, black));
    color: #17181a; border: none; border-radius: 2px;
    padding: 10px 20px; font-weight: 700; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; transition: all .12s;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.35), inset 0 -2px 0 rgba(0,0,0,.25), 0 3px 8px rgba(0,0,0,.4);
  }
  .btn-primary:hover { filter: brightness(1.08); }
  .btn-primary:active { transform: translateY(1px); box-shadow: inset 0 2px 4px rgba(0,0,0,.3); }
  .btn-primary:disabled { opacity: .5; cursor: wait; }
  .btn-primary.big { padding: 14px; font-size: 16px; width: 100%; }
  .btn-primary.sm { padding: 7px 14px; font-size: 13px; }
  .btn-ghost { background: transparent; border: 1px solid color-mix(in srgb, var(--text) 20%, transparent); color: var(--text); border-radius: 8px; padding: 7px 14px; font-size: 13px; transition: all .15s; }
  .btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
  .btn-ghost.sm { padding: 4px 10px; font-size: 12px; }
  .btn-danger { background: transparent; border: 1px solid #b0413066; color: #e06455; border-radius: 8px; padding: 8px 14px; font-size: 13px; }
  .btn-danger:hover { background: #b0413022; }

  .login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;
    background-image: linear-gradient(180deg, rgba(255,255,255,.015) 0 1px, transparent 1px);
    background-size: 100% 3px; }
  .login-card { background: linear-gradient(180deg, color-mix(in srgb, var(--panel) 92%, white) 0%, var(--panel) 6%, color-mix(in srgb, var(--panel) 88%, black) 100%);
    border-radius: 3px; padding: 40px 36px 36px; width: 100%; max-width: 420px; text-align: center;
    border: 1px solid color-mix(in srgb, var(--accent2) 35%, transparent);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 30px 80px rgba(0,0,0,.55); animation: panelIn .35s ease;
    position: relative; overflow: hidden; }
  .login-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 6px; background: var(--hazard); }
  .login-logo { width: 84px; height: 84px; margin: 0 auto 14px; border-radius: 18px; overflow: hidden;
    background: color-mix(in srgb, var(--accent) 14%, var(--bg)); display: flex; align-items: center; justify-content: center; font-size: 40px; }
  .login-logo img { width: 100%; height: 100%; object-fit: contain; }
  .login-card h1 { font-size: 26px; letter-spacing: 2.5px; text-transform: uppercase; }
  .tagline { font-size: 10px; letter-spacing: 3px; opacity: .5; text-transform: uppercase; margin: 4px 0 22px; }
  .login-emps { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 16px; }
  .mgr-tag { font-size: 9px; margin-left: 6px; padding: 1px 6px; border-radius: 99px; background: color-mix(in srgb, var(--accent2) 30%, transparent); letter-spacing: 1px; }
  .pin-input { width: 100%; text-align: center; letter-spacing: 8px; font-size: 20px; padding: 12px;
    background: color-mix(in srgb, var(--bg) 70%, black); color: var(--text);
    border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); border-radius: 12px; margin-bottom: 14px; outline: none; }
  .pin-input:focus { border-color: var(--accent); }
  .login-err { color: #e06455; font-size: 13px; margin-bottom: 10px; }

  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 100;
    background: var(--panel); color: var(--text); padding: 12px 22px; border-radius: 12px; font-size: 14px; font-weight: 600;
    box-shadow: 0 12px 40px rgba(0,0,0,.5); border-left: 4px solid var(--accent); animation: toastIn .25s ease; }
  .toast.bad { border-left-color: #e06455; }
  @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 14px); } to { opacity: 1; transform: translate(-50%, 0); } }
  `;
}
