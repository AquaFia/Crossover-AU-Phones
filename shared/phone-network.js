
(() => {
  "use strict";

  const ROSTER = [{"id": "jace", "name": "Jacey “Jace” Cosmo", "file": "jace.html", "accent": "#8f6bea"}, {"id": "damian", "name": "Damian Crosse", "file": "damian.html", "accent": "#5479b8"}, {"id": "meggie", "name": "Meggie Harmon", "file": "meggie.html", "accent": "#9a7ad1"}, {"id": "juno", "name": "Juno Enyo", "file": "juno.html", "accent": "#ff5dac"}, {"id": "aria", "name": "Aria Matsuda", "file": "aria.html", "accent": "#78a9c7"}, {"id": "kouji", "name": "Kouji Renran Yoshinari", "file": "kouji.html", "accent": "#9fcf74"}, {"id": "tyler", "name": "Tyler “Ty” Ezra", "file": "tyler.html", "accent": "#6f9d58"}];
  const STORAGE_KEY = "character-phone-network.messages.v2";
  const READ_KEY = "character-phone-network.read.v2";
  const config = window.PHONE_NETWORK_CONFIG || { enabled:false };
  const identity = window.PHONE_IDENTITY || {};
  const self = ROSTER.find(c => c.id === identity.id);
  if (!self) return;

  const app = document.getElementById("messages");
  if (!app) return;

  document.documentElement.style.setProperty("--pn-accent", self.accent);

  const head = app.querySelector(".app-head");
  const originalNodes = [...app.children].filter(n => n !== head);
  const seeds = parseSeedThreads(originalNodes);

  originalNodes.forEach(n => n.remove());

  const shell = document.createElement("div");
  shell.className = "pn-shell";
  shell.innerHTML = `
    <section class="pn-list">
      <div class="pn-tools">
        <small class="pn-status">Connecting…</small>
        <button class="pn-reset" type="button">Reset sent messages</button>
      </div>
      <div class="pn-contact-list"></div>
    </section>
    <section class="pn-thread" hidden>
      <div class="pn-thread-bar">
        <button class="pn-thread-back" type="button">‹</button>
        <div class="pn-thread-who"><b></b><small></small></div>
      </div>
      <div class="pn-message-area"></div>
      <form class="pn-compose">
        <input class="pn-input" maxlength="1000" autocomplete="off" placeholder="Message…" aria-label="Message">
        <button class="pn-send" type="submit">Send</button>
      </form>
      <div class="pn-network-note">Hardcoded messages are permanent. Reset removes only messages sent through the network.</div>
    </section>`;
  app.appendChild(shell);

  const listView = shell.querySelector(".pn-list");
  const threadView = shell.querySelector(".pn-thread");
  const contactList = shell.querySelector(".pn-contact-list");
  const threadBack = shell.querySelector(".pn-thread-back");
  const threadName = shell.querySelector(".pn-thread-who b");
  const threadStatus = shell.querySelector(".pn-thread-who small");
  const messageArea = shell.querySelector(".pn-message-area");
  const compose = shell.querySelector(".pn-compose");
  const input = shell.querySelector(".pn-input");
  const sendButton = shell.querySelector(".pn-send");
  const resetButton = shell.querySelector(".pn-reset");
  const status = shell.querySelector(".pn-status");

  const toast = document.createElement("div");
  toast.className = "pn-toast";
  (document.querySelector(".screen") || document.body).appendChild(toast);

  const confirm = document.createElement("div");
  confirm.className = "pn-confirm";
  confirm.innerHTML = `
    <div class="pn-confirm-box">
      <h3>Reset network messages?</h3>
      <p>This removes every message sent through the live network by you or your friends. The original hardcoded conversations in each phone will remain.</p>
      <div class="pn-confirm-actions">
        <button type="button" data-cancel>Cancel</button>
        <button type="button" class="danger" data-confirm>Reset</button>
      </div>
    </div>`;
  (document.querySelector(".screen") || document.body).appendChild(confirm);

  const dockButtons = [...document.querySelectorAll('[data-open="messages"]')];
  dockButtons.forEach(btn => {
    const badge = document.createElement("span");
    badge.className = "pn-unread";
    btn.appendChild(badge);
  });

  let activePeer = null;
  let dynamicMessages = [];
  let unread = loadJson(`${READ_KEY}.${self.id}`, {});
  let mode = "local";
  let client = null;
  let channel = null;

  threadBack.addEventListener("click", showList);
  compose.addEventListener("submit", onSend);
  resetButton.addEventListener("click", () => confirm.classList.add("open"));
  confirm.querySelector("[data-cancel]").addEventListener("click", () => confirm.classList.remove("open"));
  confirm.querySelector("[data-confirm]").addEventListener("click", resetAllNetworkMessages);

  window.addEventListener("storage", e => {
    if (e.key === STORAGE_KEY) {
      dynamicMessages = loadJson(STORAGE_KEY, []);
      handleRefresh();
    }
    if (e.key === "character-phone-network.reset.v2") {
      dynamicMessages = [];
      unread = {};
      saveUnread();
      renderList();
      if (activePeer) renderThread();
      showToast("Network messages were reset.");
    }
  });

  dockButtons.forEach(btn => btn.addEventListener("click", () => {
    setTimeout(() => {
      if (!threadView.hidden && activePeer) markRead(activePeer);
    }, 50);
  }));

  init();

  async function init() {
    dynamicMessages = loadJson(STORAGE_KEY, []);
    renderList();
    updateUnreadBadge();

    const validConfig = config.enabled &&
      window.supabase?.createClient &&
      config.supabaseUrl &&
      !config.supabaseUrl.includes("YOUR-PROJECT") &&
      config.supabaseAnonKey &&
      !config.supabaseAnonKey.includes("YOUR-ANON");

    if (validConfig) {
      try {
        client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
        const { data, error } = await client.from("phone_messages").select("*").order("sent_at", {ascending:true}).limit(5000);
        if (error) throw error;
        dynamicMessages = (data || []).map(normalizeRemote);
        mode = "online";
        status.textContent = "Supabase realtime online";
        renderList();

        channel = client.channel(`all-phone-messages-${self.id}-${Date.now()}`)
          .on("postgres_changes", {event:"INSERT",schema:"public",table:"phone_messages"}, payload => {
            const msg = normalizeRemote(payload.new);
            if (!dynamicMessages.some(x => x.id === msg.id)) dynamicMessages.push(msg);
            receive(msg);
          })
          .on("postgres_changes", {event:"DELETE",schema:"public",table:"phone_messages"}, () => {
            reloadRemote();
          })
          .subscribe();
        return;
      } catch (err) {
        console.error(err);
      }
    }

    mode = "local";
    status.textContent = "Local network · same browser";
  }

  function parseSeedThreads(nodes) {
    const result = {};
    let current = null;

    for (const node of nodes) {
      const isContact = node.classList?.contains("card") &&
        (node.classList.contains("row") || node.classList.contains("contact"));
      if (isContact) {
        const name = node.querySelector("b")?.textContent.trim() || "Unknown";
        const subtitle = node.querySelector("small")?.textContent.trim() || "";
        current = matchRoster(name);
        if (!current) {
          current = {id:`external-${slug(name)}`, name, external:true};
        }
        if (!result[current.id]) result[current.id] = {contact:current, subtitle, messages:[]};
        continue;
      }
      if (node.classList?.contains("msg") && current) {
        result[current.id].messages.push({
          sender: node.classList.contains("me") ? self.id : current.id,
          recipient: node.classList.contains("me") ? current.id : self.id,
          body: node.textContent.trim(),
          seed: true
        });
      }
    }
    return result;
  }

  function allContacts() {
    const map = new Map();
    ROSTER.filter(c => c.id !== self.id).forEach(c => map.set(c.id, {contact:c, subtitle:"Network contact", messages:[]}));
    Object.values(seeds).forEach(s => map.set(s.contact.id, s));
    return [...map.values()];
  }

  function renderList() {
    const contacts = allContacts();
    contactList.innerHTML = contacts.map(entry => {
      const id = entry.contact.id;
      const latest = latestMessageFor(id);
      const preview = latest?.body || entry.messages.at(-1)?.body || entry.subtitle || "No messages yet";
      const count = Number(unread[id] || 0);
      const initial = (entry.contact.name || "?").trim().charAt(0).toUpperCase();
      const external = entry.contact.external ? "Saved contact" : (mode === "online" ? "Online network" : "Local network");
      return `
        <div class="card ${entry.contact.external ? "row" : "row"} pn-contact-card ${count ? "unread" : ""}" data-peer="${escapeHtml(id)}">
          <div class="avatar">${escapeHtml(initial)}</div>
          <div style="min-width:0;flex:1"><b>${escapeHtml(entry.contact.name)}</b><small class="pn-preview">${escapeHtml(preview)}</small></div>
          <span class="pn-count">${count}</span>
        </div>`;
    }).join("");

    contactList.querySelectorAll("[data-peer]").forEach(card => {
      card.addEventListener("click", () => openThread(card.dataset.peer));
    });
  }

  function openThread(peer) {
    activePeer = peer;
    listView.hidden = true;
    threadView.hidden = false;
    markRead(peer);
    renderThread();
    setTimeout(() => input.focus(), 50);
  }

  function showList() {
    activePeer = null;
    threadView.hidden = true;
    listView.hidden = false;
    renderList();
  }

  function renderThread() {
    const entry = allContacts().find(x => x.contact.id === activePeer);
    if (!entry) return;
    threadName.textContent = entry.contact.name;
    threadStatus.textContent = entry.contact.external ? "Saved hardcoded contact" : (mode === "online" ? "Supabase network" : "Local browser network");

    const seedMsgs = entry.messages || [];
    const liveMsgs = dynamicMessages
      .filter(m => (m.sender === self.id && m.recipient === activePeer) ||
                   (m.sender === activePeer && m.recipient === self.id))
      .sort((a,b) => new Date(a.sentAt) - new Date(b.sentAt));

    let html = "";
    if (seedMsgs.length) {
      html += `<div class="pn-seed-label">Saved conversation</div>`;
      html += seedMsgs.map(renderBubble).join("");
    }
    if (liveMsgs.length) {
      html += `<div class="pn-seed-label">Live messages</div>`;
      html += liveMsgs.map(renderBubble).join("");
    }
    if (!seedMsgs.length && !liveMsgs.length) {
      html = `<div class="card"><h3>NEW CONVERSATION</h3><p>No messages yet. Send the first one.</p></div>`;
    }
    messageArea.innerHTML = html;
    messageArea.scrollTop = messageArea.scrollHeight;

    const external = entry.contact.external;
    input.disabled = external;
    sendButton.disabled = external;
    input.placeholder = external ? "This saved contact is not in the network" : "Message…";
  }

  function renderBubble(m) {
    const mine = m.sender === self.id;
    const time = m.seed ? "" : `<span style="display:block;margin-top:4px;font-size:8px;opacity:.48">${formatTime(m.sentAt)}</span>`;
    return `<div class="msg ${mine ? "me" : "them"}">${escapeHtml(m.body)}${time}</div>`;
  }

  async function onSend(event) {
    event.preventDefault();
    const body = input.value.trim();
    if (!body || !activePeer) return;
    const target = ROSTER.find(c => c.id === activePeer);
    if (!target) return;

    input.value = "";
    sendButton.disabled = true;
    try {
      if (mode === "online" && client) {
        const {data,error} = await client.from("phone_messages")
          .insert({sender_id:self.id,recipient_id:activePeer,body})
          .select().single();
        if (error) throw error;
        const saved = normalizeRemote(data);
        if (!dynamicMessages.some(x => x.id === saved.id)) dynamicMessages.push(saved);
      } else {
        const msg = {
          id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,
          sender:self.id,recipient:activePeer,body,sentAt:new Date().toISOString()
        };
        dynamicMessages.push(msg);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dynamicMessages.slice(-5000)));
      }
      renderThread();
      renderList();
    } catch (err) {
      console.error(err);
      showToast("Message could not be sent.");
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  }

  function receive(msg) {
    if (msg.recipient === self.id) {
      const viewing = app.classList.contains("open") && !threadView.hidden && activePeer === msg.sender;
      if (viewing) markRead(msg.sender);
      else {
        unread[msg.sender] = Number(unread[msg.sender] || 0) + 1;
        saveUnread();
        showToast(`${nameFor(msg.sender)}: ${msg.body}`);
      }
    }
    renderList();
    if (activePeer) renderThread();
    updateUnreadBadge();
  }

  function handleRefresh() {
    renderList();
    if (activePeer) renderThread();
    updateUnreadBadge();
  }

  async function resetAllNetworkMessages() {
    const confirmButton = confirm.querySelector("[data-confirm]");
    confirmButton.disabled = true;
    confirmButton.textContent = "Resetting…";
    try {
      if (mode === "online" && client) {
        const {error} = await client.from("phone_messages").delete().gte("id", 0);
        if (error) throw error;
        dynamicMessages = [];
      } else {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem("character-phone-network.reset.v2", String(Date.now()));
        dynamicMessages = [];
      }
      unread = {};
      saveUnread();
      confirm.classList.remove("open");
      renderList();
      if (activePeer) renderThread();
      updateUnreadBadge();
      showToast("All live messages reset. Saved conversations remain.");
    } catch (err) {
      console.error(err);
      showToast("Reset failed. Check the Supabase delete policy.");
    } finally {
      confirmButton.disabled = false;
      confirmButton.textContent = "Reset";
    }
  }

  async function reloadRemote() {
    if (!client) return;
    const {data,error} = await client.from("phone_messages").select("*").order("sent_at",{ascending:true}).limit(5000);
    if (!error) {
      dynamicMessages = (data || []).map(normalizeRemote);
      handleRefresh();
    }
  }

  function markRead(peer) {
    if (!peer) return;
    unread[peer] = 0;
    saveUnread();
    renderList();
    updateUnreadBadge();
  }

  function updateUnreadBadge() {
    const total = Object.values(unread).reduce((a,b)=>a+Number(b||0),0);
    dockButtons.forEach(btn => {
      const badge = btn.querySelector(".pn-unread");
      if (!badge) return;
      badge.style.display = total ? "grid" : "none";
      badge.textContent = total > 99 ? "99+" : String(total);
    });
  }

  function latestMessageFor(peer) {
    return dynamicMessages
      .filter(m => (m.sender === self.id && m.recipient === peer) || (m.sender === peer && m.recipient === self.id))
      .sort((a,b) => new Date(b.sentAt) - new Date(a.sentAt))[0];
  }

  function matchRoster(name) {
    const normalized = normalize(name);
    return ROSTER.find(c => {
      const full = normalize(c.name);
      const first = normalize(c.name.split(/[“"]/)[0].trim().split(" ")[0]);
      const last = normalize(c.name.trim().split(" ").at(-1));
      return normalized === full || normalized === first || normalized === last ||
             full.includes(normalized) || normalized.includes(first);
    });
  }

  function normalizeRemote(row) {
    return {id:String(row.id),sender:row.sender_id,recipient:row.recipient_id,body:row.body,sentAt:row.sent_at};
  }
  function nameFor(id) { return ROSTER.find(c=>c.id===id)?.name || id; }
  function saveUnread() { localStorage.setItem(`${READ_KEY}.${self.id}`, JSON.stringify(unread)); }
  function loadJson(key,fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
  function formatTime(v) { const d=new Date(v); return Number.isNaN(d.getTime())?"":d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}); }
  function normalize(v) { return String(v||"").toLowerCase().replace(/[“”"'’]/g,"").replace(/[^a-z0-9]+/g," ").trim(); }
  function slug(v) { return normalize(v).replace(/\s+/g,"-"); }
  function escapeHtml(v) { return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch])); }
  function showToast(text) {
    toast.textContent = text.length > 110 ? text.slice(0,107)+"…" : text;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(()=>toast.classList.remove("show"),3200);
  }
})();
