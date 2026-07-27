
(() => {
  "use strict";

  const ROSTER = [{"id": "jace", "name": "Jacey “Jace” Cosmo", "file": "jace.html", "accent": "#8f6bea"}, {"id": "damian", "name": "Damian Crosse", "file": "damian.html", "accent": "#5479b8"}, {"id": "meggie", "name": "Meggie Harmon", "file": "meggie.html", "accent": "#9a7ad1"}, {"id": "juno", "name": "Juno Enyo", "file": "juno.html", "accent": "#ff5dac"}, {"id": "aria", "name": "Aria Matsuda", "file": "aria.html", "accent": "#78a9c7"}, {"id": "kouji", "name": "Kouji Renran Yoshinari", "file": "kouji.html", "accent": "#9fcf74"}, {"id": "tyler", "name": "Tyler “Ty” Ezra", "file": "tyler.html", "accent": "#6f9d58"}];
  const STORAGE_KEY = "character-phone-network.messages.v1";
  const READ_KEY = "character-phone-network.read.v1";
  const config = window.PHONE_NETWORK_CONFIG || { enabled:false };
  const identity = window.PHONE_IDENTITY || {};
  const self = ROSTER.find(c => c.id === identity.id);

  if (!self) {
    console.error("Phone Network: missing or invalid PHONE_IDENTITY.", identity);
    return;
  }

  const messagesApp = document.getElementById("messages");
  if (!messagesApp) {
    console.warn("Phone Network: this phone has no #messages app.");
    return;
  }

  document.documentElement.style.setProperty("--pn-accent", self.accent);
  const head = messagesApp.querySelector(".app-head");
  const originalNodes = [...messagesApp.children].filter(node => node !== head);

  const tabs = document.createElement("div");
  tabs.className = "pn-tabs";
  tabs.innerHTML = `
    <button class="pn-tab active" type="button" data-pn-tab="live">Live Network</button>
    <button class="pn-tab" type="button" data-pn-tab="saved">Saved Threads</button>`;

  const original = document.createElement("div");
  original.className = "pn-original";
  original.hidden = true;
  originalNodes.forEach(node => original.appendChild(node));

  const live = document.createElement("div");
  live.className = "pn-live";
  live.innerHTML = `
    <div class="pn-network-status">
      <span><i class="pn-status-dot"></i><span class="pn-status-text">Starting local network…</span></span>
      <span class="pn-self">${escapeHtml(self.name)}</span>
    </div>
    <div class="pn-contact-row" aria-label="Network contacts"></div>
    <div class="pn-thread-title"><b class="pn-peer-name"></b><small class="pn-mode-label">LOCAL</small></div>
    <div class="pn-messages" aria-live="polite"></div>
    <form class="pn-form">
      <input class="pn-input" maxlength="1000" autocomplete="off" placeholder="Write a message…" aria-label="Message">
      <button class="pn-send" type="submit">Send</button>
    </form>`;

  if (head) head.insertAdjacentElement("afterend", tabs);
  else messagesApp.prepend(tabs);
  tabs.insertAdjacentElement("afterend", live);
  live.insertAdjacentElement("afterend", original);

  const toast = document.createElement("div");
  toast.className = "pn-toast";
  const screen = document.querySelector(".screen") || document.body;
  screen.appendChild(toast);

  const contacts = ROSTER.filter(c => c.id !== self.id);
  let activePeer = contacts[0]?.id || null;
  let cache = [];
  let supabaseClient = null;
  let realtimeChannel = null;
  let mode = "local";
  let unread = loadJson(READ_KEY, {});
  const localClientId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  const statusDot = live.querySelector(".pn-status-dot");
  const statusText = live.querySelector(".pn-status-text");
  const modeLabel = live.querySelector(".pn-mode-label");
  const contactRow = live.querySelector(".pn-contact-row");
  const peerName = live.querySelector(".pn-peer-name");
  const messageList = live.querySelector(".pn-messages");
  const form = live.querySelector(".pn-form");
  const input = live.querySelector(".pn-input");
  const sendButton = live.querySelector(".pn-send");

  const dockMessageButtons = [...document.querySelectorAll('[data-open="messages"]')];
  dockMessageButtons.forEach(btn => {
    const badge = document.createElement("span");
    badge.className = "pn-unread";
    btn.appendChild(badge);
  });

  tabs.addEventListener("click", event => {
    const button = event.target.closest("[data-pn-tab]");
    if (!button) return;
    tabs.querySelectorAll(".pn-tab").forEach(x => x.classList.toggle("active", x === button));
    const showLive = button.dataset.pnTab === "live";
    live.hidden = !showLive;
    original.hidden = showLive;
    if (showLive) markRead(activePeer);
  });

  contactRow.innerHTML = contacts.map(c =>
    `<button class="pn-contact" type="button" data-peer="${c.id}">${escapeHtml(c.name)}</button>`
  ).join("");

  contactRow.addEventListener("click", event => {
    const button = event.target.closest("[data-peer]");
    if (!button) return;
    activePeer = button.dataset.peer;
    renderContacts();
    renderThread();
    markRead(activePeer);
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const body = input.value.trim();
    if (!body || !activePeer) return;
    input.value = "";
    sendButton.disabled = true;
    try {
      await sendMessage(activePeer, body);
    } catch (error) {
      console.error(error);
      setStatus("Message failed; local fallback active.", "error");
      await sendLocal(activePeer, body);
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  });

  window.addEventListener("storage", event => {
    if (event.key === STORAGE_KEY) {
      cache = loadJson(STORAGE_KEY, []);
      receiveUpdate();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && messagesApp.classList.contains("open") && !live.hidden) markRead(activePeer);
  });

  dockMessageButtons.forEach(btn => btn.addEventListener("click", () => {
    setTimeout(() => { if (!live.hidden) markRead(activePeer); }, 50);
  }));

  init();

  async function init() {
    cache = loadJson(STORAGE_KEY, []);
    renderContacts();
    renderThread();
    updateUnreadBadge();

    if (config.enabled && window.supabase?.createClient &&
        config.supabaseUrl && !config.supabaseUrl.includes("YOUR-PROJECT") &&
        config.supabaseAnonKey && !config.supabaseAnonKey.includes("YOUR-ANON")) {
      try {
        await initSupabase();
        return;
      } catch (error) {
        console.error("Supabase setup failed; using local network.", error);
      }
    }
    mode = "local";
    modeLabel.textContent = "LOCAL";
    setStatus("Local network · same browser", "online");
  }

  async function initSupabase() {
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    const { data, error } = await supabaseClient
      .from("phone_messages")
      .select("*")
      .or(`sender_id.eq.${self.id},recipient_id.eq.${self.id}`)
      .order("sent_at", { ascending:true })
      .limit(1000);
    if (error) throw error;
    cache = (data || []).map(normalizeRemote);

    realtimeChannel = supabaseClient
      .channel(`phone-${self.id}-${localClientId}`)
      .on("postgres_changes", { event:"INSERT", schema:"public", table:"phone_messages" }, payload => {
        const msg = normalizeRemote(payload.new);
        if (msg.sender !== self.id && msg.recipient !== self.id) return;
        if (!cache.some(x => x.id === msg.id)) cache.push(msg);
        receiveIncoming(msg);
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED") {
          mode = "supabase";
          modeLabel.textContent = "ONLINE";
          setStatus("Supabase realtime connected", "online");
        }
      });
    mode = "supabase";
    modeLabel.textContent = "ONLINE";
    setStatus("Supabase realtime connected", "online");
    renderThread();
  }

  async function sendMessage(recipient, body) {
    if (mode === "supabase" && supabaseClient) {
      const optimistic = {
        id: `pending-${localClientId}-${Date.now()}`,
        sender:self.id, recipient, body, sentAt:new Date().toISOString(), pending:true
      };
      cache.push(optimistic);
      renderThread();
      const { data, error } = await supabaseClient
        .from("phone_messages")
        .insert({ sender_id:self.id, recipient_id:recipient, body, client_id:localClientId })
        .select()
        .single();
      cache = cache.filter(x => x.id !== optimistic.id);
      if (error) throw error;
      const saved = normalizeRemote(data);
      if (!cache.some(x => x.id === saved.id)) cache.push(saved);
      renderThread();
      return;
    }
    await sendLocal(recipient, body);
  }

  async function sendLocal(recipient, body) {
    mode = "local";
    modeLabel.textContent = "LOCAL";
    const msg = {
      id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sender:self.id, recipient, body, sentAt:new Date().toISOString()
    };
    const all = loadJson(STORAGE_KEY, []);
    all.push(msg);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-2000)));
    cache = all.slice(-2000);
    renderThread();
    setStatus("Local network · same browser", "online");
  }

  function receiveUpdate() {
    const newest = [...cache].reverse().find(m => m.recipient === self.id);
    if (newest) receiveIncoming(newest);
    else renderThread();
  }

  function receiveIncoming(msg) {
    const appOpen = messagesApp.classList.contains("open");
    const threadVisible = appOpen && !live.hidden && activePeer === msg.sender;
    if (threadVisible) markRead(msg.sender);
    else if (msg.recipient === self.id) {
      unread[msg.sender] = (unread[msg.sender] || 0) + 1;
      saveUnread();
      showToast(`${nameFor(msg.sender)}: ${msg.body}`);
    }
    renderThread();
    updateUnreadBadge();
  }

  function renderContacts() {
    contactRow.querySelectorAll("[data-peer]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.peer === activePeer);
      const count = unread[btn.dataset.peer] || 0;
      const base = nameFor(btn.dataset.peer);
      btn.textContent = count ? `${base} · ${count}` : base;
    });
  }

  function renderThread() {
    if (!activePeer) {
      peerName.textContent = "No contacts";
      messageList.innerHTML = '<div class="pn-empty">No other phones are currently registered.</div>';
      return;
    }
    peerName.textContent = nameFor(activePeer);
    const thread = cache
      .filter(m => (m.sender === self.id && m.recipient === activePeer) ||
                   (m.sender === activePeer && m.recipient === self.id))
      .sort((a,b) => new Date(a.sentAt) - new Date(b.sentAt));
    messageList.innerHTML = thread.length ? thread.map(m => `
      <div class="pn-bubble ${m.sender === self.id ? "mine" : "theirs"}">
        ${escapeHtml(m.body)}
        <span class="pn-meta">${formatTime(m.sentAt)}${m.pending ? " · sending" : ""}</span>
      </div>`).join("") :
      `<div class="pn-empty">No live messages with ${escapeHtml(nameFor(activePeer))} yet.<br>Send the first one from this phone.</div>`;
    messageList.scrollTop = messageList.scrollHeight;
    renderContacts();
  }

  function markRead(peer) {
    if (!peer) return;
    unread[peer] = 0;
    saveUnread();
    renderContacts();
    updateUnreadBadge();
  }

  function updateUnreadBadge() {
    const total = Object.values(unread).reduce((a,b) => a + Number(b || 0), 0);
    dockMessageButtons.forEach(btn => {
      const badge = btn.querySelector(".pn-unread");
      if (!badge) return;
      badge.style.display = total ? "grid" : "none";
      badge.textContent = total > 99 ? "99+" : String(total);
    });
  }

  function saveUnread() {
    localStorage.setItem(`${READ_KEY}.${self.id}`, JSON.stringify(unread));
  }

  function loadUnread() {
    return loadJson(`${READ_KEY}.${self.id}`, {});
  }

  function setStatus(text, state) {
    statusText.textContent = text;
    statusDot.className = `pn-status-dot ${state || ""}`;
  }

  function showToast(text) {
    toast.textContent = text.length > 110 ? text.slice(0,107) + "…" : text;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function nameFor(id) {
    return ROSTER.find(c => c.id === id)?.name || id;
  }

  function normalizeRemote(row) {
    return {
      id:String(row.id),
      sender:row.sender_id,
      recipient:row.recipient_id,
      body:row.body,
      sentAt:row.sent_at
    };
  }

  function loadJson(key, fallback) {
    try {
      const actualKey = key === READ_KEY ? `${READ_KEY}.${self.id}` : key;
      return JSON.parse(localStorage.getItem(actualKey) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function formatTime(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[ch]));
  }

  unread = loadUnread();
})();
