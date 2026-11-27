(function () {
  const R = window.RShared;
  const { fmt, chipColor } = window.RTable;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignorieren */ } },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => Number(v || 0).toLocaleString('de-DE');

  // ================================================================
  // Verbindung: Der Host-Browser ist der Spielserver (engine.js).
  // Host und Handys tauschen Nachrichten über einen öffentlichen Vermittlungs-Server aus
  // (MQTT über sichere WebSockets). Dadurch läuft das Spiel als reine Website, z. B. auf
  // GitHub Pages, und funktioniert in jedem Netz (WLAN, Mobilfunk) – wie eine normale Webseite.
  // ================================================================
  const BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ];
  const TOPIC_BASE = 'tomhilger-roulette/v1/';
  const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  function randomStr(n, abc) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return [...a].map((b) => abc[b % abc.length]).join('');
  }
  const newCode = () => randomStr(6, CODE_ABC);
  const readJSON = (k) => { try { return JSON.parse(store.get(k) || 'null'); } catch (e) { return null; } };
  const enc = (o) => JSON.stringify(o);
  const dec = (buf) => { try { return JSON.parse(typeof buf === 'string' ? buf : new TextDecoder().decode(buf)); } catch (e) { return null; } };
  const mqttOk = () => !!(window.mqtt && window.mqtt.connect);

  const params = new URLSearchParams(location.search);
  let room = cleanCode(params.get('room')) || null; // Raum, dem dieses Gerät als Spieler beitritt
  let roomBroker = Math.min(BROKERS.length - 1, Math.max(0, parseInt(params.get('s'), 10) || 0));
  let token = null;
  let role = null; // 'host' | 'player'
  let S = null;
  let offsets = [];
  let offset = 0;
  const serverNow = () => Date.now() + offset;
  function noteTime(now) {
    if (role === 'host' || typeof now !== 'number') { if (role === 'host') offset = 0; return; }
    // Bester Schätzwert für die Uhr des Hosts: Maximum der letzten Messungen (Übertragungszeit ist nie negativ)
    offsets.push(now - Date.now());
    if (offsets.length > 20) offsets.shift();
    offset = Math.max(...offsets);
  }

  let joinBase = location.origin + location.pathname;

  // ---------- Host ----------
  let engine = null, hostMq = null, hostCode = null, hostBroker = 0, localClient = null;
  const sessions = new Map(); // cid -> { cid, client, seen, done: Map(reqId -> Antwort) }
  let hostPeerState = 'off';
  let saveT = null;
  const joinUrlFor = (code) => joinBase + '?room=' + code + (hostBroker ? '&s=' + hostBroker : '');

  function saveHost() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!engine) return;
      store.set('rt_host', enc({ code: hostCode, token, broker: hostBroker }));
      store.set('rt_host_state', enc(engine.serialize()));
    }, 150);
  }
  window.addEventListener('pagehide', () => {
    if (engine) { clearTimeout(saveT); store.set('rt_host', enc({ code: hostCode, token, broker: hostBroker })); store.set('rt_host_state', enc(engine.serialize())); }
  });

  function setRoomStatus(state) {
    hostPeerState = state;
    const el = $('#room-status');
    if (!el) return;
    el.className = 'room-status ' + (state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : '');
    el.textContent = state === 'ok' ? '● bereit für Spieler' : state === 'bad' ? '● keine Verbindung – versuche es erneut …' : '● verbinde …';
  }

  function startEngine(saved) {
    engine = window.REngine.createEngine({ onChange: saveHost });
    if (saved) engine.restore(saved);
  }
  function updateJoinUrl() {
    if (!engine || !hostCode) return;
    engine.setJoinUrl(joinUrlFor(hostCode));
    engine.broadcast();
  }

  const hostTopic = () => TOPIC_BASE + hostCode;
  function hostSend(cid, obj, qos = 1) {
    if (hostMq && hostMq.connected) hostMq.publish(hostTopic() + '/c/' + cid, enc(obj), { qos });
  }

  // Verbindung zum Vermittlungs-Server aufbauen. Neuer Raum: nimmt den ersten Server, der antwortet.
  function startHostRelay(fixedBroker) {
    if (!mqttOk()) { setRoomStatus('bad'); toast('Verbindungs-Bibliothek nicht geladen – bitte Internet prüfen und neu laden'); return; }
    const order = fixedBroker != null ? [fixedBroker] : BROKERS.map((_, i) => i);
    let attempt = 0;
    const tryNext = () => {
      const idx = order[attempt % order.length];
      attempt++;
      if (hostMq) { try { hostMq.end(true); } catch (e) { /* egal */ } }
      setRoomStatus('wait');
      const mq = window.mqtt.connect(BROKERS[idx], {
        clientId: 'rth_' + randomStr(12, 'abcdefghijklmnopqrstuvwxyz0123456789'),
        clean: true, keepalive: 30, connectTimeout: 8000, reconnectPeriod: 2500, resubscribe: true,
      });
      hostMq = mq;
      let everConnected = false;
      const giveUp = setTimeout(() => {
        // Server nicht erreichbar -> nächsten probieren (nur solange der Raum noch neu ist)
        if (!everConnected && hostMq === mq && fixedBroker == null && attempt < order.length * 2) tryNext();
      }, 9000);
      mq.on('connect', () => {
        if (hostMq !== mq) return;
        everConnected = true;
        clearTimeout(giveUp);
        if (hostBroker !== idx) { hostBroker = idx; updateJoinUrl(); saveHost(); }
        fixedBroker = idx; // ab jetzt auf diesem Server bleiben
        mq.subscribe(hostTopic() + '/h', { qos: 1 });
        // Allen Handys Bescheid geben, dass der Host (wieder) da ist
        mq.publish(hostTopic() + '/all', enc({ t: 'hostup' }), { qos: 1 });
        setRoomStatus('ok');
      });
      mq.on('reconnect', () => { if (hostMq === mq) setRoomStatus('wait'); });
      mq.on('offline', () => { if (hostMq === mq) setRoomStatus('bad'); });
      mq.on('error', () => { if (hostMq === mq && !mq.connected) setRoomStatus('bad'); });
      mq.on('message', (topic, buf) => { if (hostMq === mq) onHostMsg(dec(buf)); });
    };
    tryNext();
  }

  function getSession(cid) {
    let s = sessions.get(cid);
    if (!s) {
      s = { cid, seen: Date.now(), done: new Map(), client: { token: null, send: (v) => hostSend(cid, { t: 'state', d: v }) } };
      sessions.set(cid, s);
    }
    s.seen = Date.now();
    return s;
  }
  function dropSession(cid) {
    const s = sessions.get(cid);
    if (!s) return;
    sessions.delete(cid);
    if (engine) engine.unsubscribe(s.client);
  }

  function onHostMsg(msg) {
    if (!engine || !msg || typeof msg !== 'object' || typeof msg.cid !== 'string' || msg.cid.length > 40) return;
    const cid = msg.cid;
    if (msg.t === 'bye') return dropSession(cid);
    const s = getSession(cid);
    if (msg.t === 'hello') return hostSend(cid, { t: 'welcome', now: Date.now() });
    if (msg.t === 'beat') return;
    if (msg.t === 'sub') {
      engine.unsubscribe(s.client);
      s.client.token = typeof msg.token === 'string' ? msg.token : null;
      engine.subscribe(s.client);
      return;
    }
    if (msg.t === 'req') {
      // Doppelt angekommene Anfragen nicht nochmal ausführen (z. B. nach Verbindungsabbruch)
      if (s.done.has(msg.id)) return hostSend(cid, s.done.get(msg.id));
      let reply;
      try {
        const body = (msg.body && typeof msg.body === 'object') ? msg.body : {};
        reply = { t: 'res', id: msg.id, ok: true, d: engine.call(String(msg.path), body, false) };
      } catch (e) {
        reply = { t: 'res', id: msg.id, ok: false, error: e.message || 'Fehler', status: e.status || 400, extra: e.extra || null };
      }
      s.done.set(msg.id, reply);
      if (s.done.size > 30) s.done.delete(s.done.keys().next().value);
      hostSend(cid, reply);
    }
  }
  // Lebenszeichen an alle Handys; Handys, von denen nichts mehr kommt, gelten als offline
  setInterval(() => {
    if (!engine) return;
    const now = Date.now();
    for (const s of [...sessions.values()]) {
      if (now - s.seen > 16000) dropSession(s.cid);
      else hostSend(s.cid, { t: 'ping', now }, 0);
    }
  }, 4000);

  async function becomeHost(name) {
    const saved = readJSON('rt_host');
    const state = readJSON('rt_host_state');
    if (!engine) {
      startEngine(saved && state ? state : null);
      hostCode = saved && saved.code ? saved.code : newCode();
      hostBroker = saved && Number.isInteger(saved.broker) ? saved.broker : 0;
      engine.setJoinUrl(joinUrlFor(hostCode));
    }
    role = 'host';
    const res = engine.call('/api/join', { name, role: 'host', token: saved && saved.token }, true);
    token = res.token;
    saveHost();
    subscribeLocal();
    startHostRelay(saved && saved.code ? hostBroker : null);
  }
  function resumeHost() {
    const saved = readJSON('rt_host');
    const state = readJSON('rt_host_state');
    if (!saved || !state || !saved.code) return false;
    startEngine(state);
    hostCode = saved.code;
    hostBroker = Number.isInteger(saved.broker) ? saved.broker : 0;
    token = saved.token;
    if (!engine.hasPlayer(token)) { engine = null; return false; }
    engine.setJoinUrl(joinUrlFor(hostCode));
    role = 'host';
    subscribeLocal();
    startHostRelay(hostBroker);
    return true;
  }
  function subscribeLocal() {
    if (localClient) engine.unsubscribe(localClient);
    localClient = { token, send: (v) => onState(v) };
    engine.subscribe(localClient);
  }
  function stopHost() {
    if (hostMq) {
      const mq = hostMq;
      hostMq = null;
      // Spieler informieren, dass das Spiel vorbei ist
      for (const cid of sessions.keys()) { try { mq.publish(TOPIC_BASE + hostCode + '/c/' + cid, enc({ t: 'state', d: { now: Date.now(), me: null, ended: true } }), { qos: 1 }); } catch (e) { /* egal */ } }
      setTimeout(() => { try { mq.end(true); } catch (e) { /* egal */ } }, 800);
    }
    sessions.clear();
    engine = null; localClient = null; hostCode = null;
    clearTimeout(saveT);
    store.set('rt_host', null); store.set('rt_host_state', null);
  }

  // ---------- Spieler ----------
  const cid = randomStr(12, 'abcdefghijklmnopqrstuvwxyz0123456789'); // eigene Kennung dieses Tabs
  let pMq = null, pWanted = false, pLinked = false, pLastMsg = 0;
  let reqId = 0;
  const pending = new Map();
  let welcomeWait = null;

  const pTopic = () => TOPIC_BASE + room;
  function pSend(obj, qos = 1) {
    if (!pMq || !pMq.connected) return false;
    pMq.publish(pTopic() + '/h', enc({ ...obj, cid }), { qos });
    return true;
  }

  // Mit dem Vermittlungs-Server verbinden (einmal pro Raum)
  let pMqP = null;
  function playerRelay() {
    if (pMq && pMq.connected && pMq._room === room) return Promise.resolve(pMq);
    if (pMqP) return pMqP;
    pMqP = new Promise((resolve, reject) => {
      if (!mqttOk()) return reject(new Error('Verbindungs-Bibliothek nicht geladen – bitte Internet prüfen und neu laden'));
      if (pMq) { try { pMq.end(true); } catch (e) { /* egal */ } }
      const mq = window.mqtt.connect(BROKERS[roomBroker], {
        clientId: 'rtp_' + cid,
        clean: true, keepalive: 30, connectTimeout: 8000, reconnectPeriod: 2500, resubscribe: true,
      });
      mq._room = room;
      pMq = mq;
      const to = setTimeout(() => reject(new Error('Keine Verbindung zum Internet')), 12000);
      mq.on('connect', () => {
        clearTimeout(to);
        mq.subscribe([pTopic() + '/c/' + cid, pTopic() + '/all'], { qos: 1 }, () => {
          resolve(mq);
          // Nach einem Verbindungsabbruch automatisch wieder beim Host melden
          if (pWanted && token) pSend({ t: 'sub', token });
        });
      });
      mq.on('offline', () => { if (pMq === mq && S && role === 'player') $('#p-status').dataset.offline = '1'; });
      mq.on('message', (topic, buf) => { if (pMq === mq) onPlayerMsg(dec(buf)); });
    }).finally(() => { pMqP = null; });
    return pMqP;
  }

  // Prüfen, ob der Host im Raum ist
  async function openConn() {
    await playerRelay();
    if (pLinked && Date.now() - pLastMsg < 8000) return;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => { welcomeWait = null; reject(new Error('Raum ' + room + ' nicht gefunden – ist die Seite des Hosts geöffnet?')); }, 8000);
      welcomeWait = () => { clearTimeout(t); welcomeWait = null; resolve(); };
      pSend({ t: 'hello' });
    });
  }

  // Herzschlag zum Host; wenn vom Host länger nichts kommt, neu anmelden
  setInterval(() => {
    if (!pWanted || !pMq || !pMq.connected) return;
    pSend({ t: 'beat' }, 0);
    if (Date.now() - pLastMsg > 12000) {
      pLinked = false;
      if (S && role === 'player') $('#p-status').dataset.offline = '1';
      pSend({ t: 'sub', token });
    }
  }, 4000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pWanted) {
      if (pMq && pMq.connected) pSend({ t: 'sub', token });
      else playerRelay().catch(() => {});
    }
  });

  function onPlayerMsg(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hostup') { if (pWanted && token) pSend({ t: 'sub', token }); return; }
    pLastMsg = Date.now();
    pLinked = true;
    if (msg.t === 'welcome') { noteTime(msg.now); if (welcomeWait) welcomeWait(); }
    else if (msg.t === 'state') { if (pWanted) onState(msg.d); }
    else if (msg.t === 'ping') noteTime(msg.now);
    else if (msg.t === 'res') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.d);
      else { const e = new Error(msg.error || 'Fehler'); e.status = msg.status; e.data = msg.extra || {}; p.reject(e); }
    }
  }

  async function api(path, body = {}) {
    const payload = { token, ...body };
    if (role === 'host' && engine) {
      try { return engine.call(path, payload, true); } catch (e) { const err = new Error(e.message || 'Fehler'); err.status = e.status; err.data = e.extra || {}; throw err; }
    }
    await playerRelay();
    const id = cid + ':' + (++reqId);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { pending.delete(id); reject(new Error('Der Host antwortet nicht – bitte nochmal versuchen')); }, 10000);
      pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      if (!pSend({ t: 'req', id, path, body: payload })) { clearTimeout(t); pending.delete(id); reject(new Error('Keine Verbindung – bitte nochmal versuchen')); }
    });
  }
  const act = (path, body) => api(path, body).catch((e) => toast(e.message));

  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 3200);
  }

  function show(id) {
    $$('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
    document.body.dataset.screen = id;
    document.documentElement.classList.toggle("host-mode", id === "screen-host");
  }

  // ---------- Start ----------
  $('#name-in').value = store.get('rt_name') || '';
  function updateStartScreen() {
    // Über einen Einladungs-Link kommt man nur als Spieler in den Raum
    $('.role[data-role="host"]').classList.toggle('hidden', !!room);
    const info = $('#room-info');
    info.classList.toggle('hidden', !room);
    if (room) info.innerHTML = `Du trittst Raum <b>${esc(room)}</b> bei · <button type="button" class="room-change">ändern</button>`;
  }
  // Falscher Link? Raum wechseln oder selbst Host werden
  $('#room-info').addEventListener('click', (e) => {
    if (!e.target.closest('.room-change') || joining) return;
    pWanted = false;
    room = null; roomBroker = 0; token = null; role = null;
    if (pMq) { try { pMq.end(true); } catch (x) { /* egal */ } pMq = null; }
    history.replaceState(null, '', location.pathname);
    updateStartScreen();
  });
  updateStartScreen();
  $$('.role').forEach((b) => b.addEventListener('click', () => join(b.dataset.role)));
  $('#name-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') join('player'); });

  let joining = false;
  async function join(r) {
    if (joining) return;
    const name = $('#name-in').value.trim();
    if (!name) { toast('Bitte zuerst deinen Namen eingeben'); $('#name-in').focus(); return; }
    store.set('rt_name', name);
    if (r === 'host') {
      try { await becomeHost(name); } catch (e) { toast(e.message); }
      return;
    }
    if (!room) {
      const code = cleanCode(await ask('Raum-Code vom Host eingeben (steht beim Host in den ⚙︎ Einstellungen):', { input: true, yes: 'Beitreten' }));
      if (!code) return;
      room = code;
      roomBroker = 0;
      history.replaceState(null, '', '?room=' + room);
      updateStartScreen();
    }
    joining = true;
    toast('Verbinde mit dem Host …');
    try {
      role = 'player';
      await openConn();
      const res = await api('/api/join', { name, role: 'player', token: store.get('rt_p_' + room) });
      token = res.token;
      store.set('rt_p_' + room, token);
      pWanted = true;
      pSend({ t: 'sub', token });
      $('#toast').classList.add('hidden');
    } catch (e) {
      if (!pWanted) role = null;
      toast(e.message);
    } finally { joining = false; }
  }

  function resumePlayer() {
    if (!room) return false;
    const t = store.get('rt_p_' + room);
    if (!t) return false;
    token = t; role = 'player'; pWanted = true;
    // Startbildschirm zeigen, bis der Host antwortet (dann geht es automatisch weiter)
    show('screen-start');
    $('#room-info').innerHTML = `Verbinde wieder mit Raum <b>${esc(room)}</b> …`;
    playerRelay().catch(() => {}); // meldet sich nach dem Verbinden selbst beim Host
    return true;
  }

  function logout() {
    if (role === 'host') stopHost();
    else {
      if (pMq && pMq.connected) pSend({ t: 'bye' });
      if (room && token) store.set('rt_p_' + room, null);
    }
    pWanted = false; pLinked = false;
    token = null; role = null; S = null;
    offsets = []; offset = 0;
    updateStartScreen();
    show('screen-start');
  }

  // Neuer Spielstand (vom eigenen Engine oder vom Host über das Netz)
  function onState(data) {
    if (!data) return;
    noteTime(data.now);
    if (!data.me) {
      // Unbekannt (z. B. vom Host entfernt oder Spiel beendet) -> zurück zum Start
      if (role === 'player') toast(data.ended ? 'Der Host hat das Spiel beendet' : 'Du bist nicht mehr im Spiel – bitte neu beitreten');
      logout();
      return;
    }
    role = data.me.role;
    window.RWheel.track(data.spin);
    const prev = S;
    S = data;
    if (role === 'player') delete $('#p-status').dataset.offline;
    render(prev);
  }

  function rename(name) {
    name = String(name || '').trim();
    if (!name) return toast('Bitte einen Namen / Tag eingeben');
    store.set('rt_name', name);
    api('/api/rename', { name }).then(() => toast('Name geändert: ' + name)).catch((e) => toast(e.message));
  }

  // ---------- Setz-Panel (Spieler und Host) ----------
  const CHIPS = [1, 5, 10, 25, 100, 500, 1000];
  function createPanel(root, popts = {}) {
    root.classList.add('panel');
    const orientNow = () => (typeof popts.orient === 'function' ? popts.orient() : popts.orient || 'v');
    let orient = orientNow();
    root.innerHTML = `
      <div class="chips">${CHIPS.map((v) => `<button class="chipbtn" data-v="${v}" style="--c:${chipColor(v)}"><span>${fmt(v)}</span></button>`).join('')}</div>
      <div class="table-wrap"></div>
      <div class="actions">
        <button data-a="undo">↶ <span class="full">Rückgängig</span><span class="short">Zurück</span></button>
        <button data-a="clear">✕ <span class="full">Alles weg</span><span class="short">Leeren</span></button>
        <button data-a="repeat">⟳ <span class="full">Wiederholen</span><span class="short">Nochmal</span></button>
        <button data-a="double">×2 <span class="full">Verdoppeln</span></button>
        <button data-a="remove" class="toggle">⌫ <span class="full">Entfernen</span><span class="short">Entf.</span></button>
      </div>
      <div class="annonces">
        <div class="lbl">Annoncen</div>
        <button data-ann="voisins">Voisins<span class="full"> du Zéro</span> <small>9 Stk.</small></button>
        <button data-ann="tiers">Tiers <small>6 Stk.</small></button>
        <button data-ann="orphelins">Orphelins <small>5 Stk.</small></button>
        <button data-ann="zero"><span class="full">Jeu </span>Zéro <small>4 Stk.</small></button>
        <button data-a="neigh" class="toggle">Nachbarn <small>Zahl ±2</small></button>
      </div>
      <div class="mybets"></div>
      <p class="hint">Tippe auf eine Zahl (Plein), auf eine Linie zwischen zwei Zahlen (Cheval), auf eine Ecke (Carré), auf den Außenrand der Reihe (Transversale) oder auf die Außenfelder.</p>`;
    let chip = Number(store.get('rt_chip')) || 10;
    let mode = null; // 'remove' | 'neigh' | null
    const wrap = $('.table-wrap', root);
    let table, curRh = null;
    function build(rh) {
      wrap.textContent = '';
      orient = orientNow();
      root.classList.toggle('panel-h', orient === 'h');
      table = window.RTable.createBetTable(wrap, { onBet, orient, rh });
      curRh = rh;
    }
    build(popts.fit ? 34 : undefined);
    // Handy: Zeilenhöhe so wählen, dass das Tableau den freien Platz ohne Scrollen ausfüllt
    function fit() {
      if (!popts.fit || orient !== 'v') return;
      const cs = getComputedStyle(wrap);
      const w = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (w <= 0 || h <= 0) return;
      const s = w / 302;
      const rh = Math.max(24, Math.min(46, Math.floor((h / s - 8) / 13.95)));
      if (rh !== curRh) { build(rh); update(); }
    }
    const setMode = (m) => {
      mode = mode === m ? null : m;
      $$('.toggle', root).forEach((b) => b.classList.toggle('on', b.dataset.a === mode));
      root.classList.toggle('removing', mode === 'remove');
    };
    function onBet(key) {
      if (!S || !S.betsOpen) return toast('Rien ne va plus – keine Einsätze mehr');
      if (mode === 'remove') return act('/api/remove', { key });
      if (mode === 'neigh') {
        if (!key.startsWith('straight:')) return toast('Für Nachbarn bitte eine einzelne Zahl antippen');
        const keys = R.neighbours(Number(key.split(':')[1]));
        setMode('neigh');
        table.flash(keys);
        return act('/api/bet', { keys, amount: chip });
      }
      table.flash([key]);
      act('/api/bet', { keys: [key], amount: chip });
    }
    $$('.chipbtn', root).forEach((b) => b.addEventListener('click', () => { chip = Number(b.dataset.v); store.set('rt_chip', chip); update(); }));
    $$('[data-a]', root).forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'remove' || a === 'neigh') return setMode(a);
      act('/api/' + a);
    }));
    $$('[data-ann]', root).forEach((b) => b.addEventListener('click', () => {
      const keys = R.ANNONCES[b.dataset.ann].keys;
      table.flash(keys);
      act('/api/bet', { keys, amount: chip });
    }));

    function update() {
      if (!S) return;
      const me = S.me;
      const open = S.betsOpen;
      root.classList.toggle('closed', !open);
      $$('.chipbtn', root).forEach((b) => {
        b.classList.toggle('sel', Number(b.dataset.v) === chip);
        b.disabled = Number(b.dataset.v) > me.balance && Number(b.dataset.v) !== chip;
      });
      const has = Object.keys(me.bets).length > 0;
      const btn = (a) => $(`[data-a="${a}"]`, root);
      btn('undo').disabled = !open || !me.canUndo;
      btn('clear').disabled = !open || !has;
      btn('repeat').disabled = !open || !me.hasLast || has;
      btn('double').disabled = !open || !has;
      if (orientNow() !== orient) build(popts.fit ? curRh || 34 : undefined);
      const resN = S.phase === 'result' ? S.spin.result : null;
      const layers = popts.layers && popts.layers();
      if (layers) table.setMulti(layers, resN);
      else table.setChips(me.bets, resN);
      const entries = Object.entries(me.bets).sort((a, b) => b[1] - a[1]);
      const res = S.phase === 'result' ? S.spin.result : null;
      $('.mybets', root).innerHTML = entries.length
        ? `<div class="lbl">Deine Einsätze</div><ul>${entries.map(([k, v]) => {
          const cls = res == null ? '' : R.BETS[k].nums.includes(res) ? 'win' : 'lose';
          return `<li class="${cls}"><span>${esc(R.label(k))}</span><span class="q">${R.BETS[k].odds}:1</span><b>${money(v)}</b></li>`;
        }).join('')}</ul>`
        : '';
    }
    return { update, fit };
  }

  // ---------- Host ----------
  let hostWheel, hostPanel, qrDone = '';
  function initHost() {
    if (hostWheel) return;
    hostWheel = window.RWheel.createWheel($('#host-wheel'));
    // Im Querformat (Fernseher) zeigt das Tableau die Einsätze aller Spieler mit Namen und Farbe
    const landscape = window.matchMedia('(orientation: landscape)');
    // Host am Handy im Hochformat: Tableau hochkant wie bei den Spielern (gut lesbar)
    const hostOrient = () => (window.matchMedia('(orientation: portrait)').matches && window.innerWidth < 600 ? 'v' : 'h');
    hostPanel = createPanel($('#h-panel'), { orient: hostOrient, layers: () => (landscape.matches && S && S.table ? S.table : null) });
    landscape.addEventListener('change', () => { hostPanel.update(); updateTableLabel(); });
    $('#btn-spin').onclick = () => act('/api/spin');
    $('#btn-new').onclick = () => act('/api/newround');
    $('#btn-settings').onclick = () => { fillSettings(); openModal('#modal-settings'); };
    $('#btn-full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}));
    $('#save-name').onclick = () => rename($('#host-name-in').value);
    $('#save-settings').onclick = async () => {
      const mode = ($('input[name="mode"]:checked') || {}).value;
      await act('/api/settings', { mode, startBalance: Number($('#start-bal').value) });
      toast('Gespeichert');
    };
    const resetBets = async () => {
      if (S.phase !== 'betting') return toast('Geht nur, bevor die Kugel geworfen wurde');
      if (await ask('Alle Einsätze dieser Runde an die Spieler zurückgeben, damit alle neu setzen können?', { yes: 'Zurücksetzen' })) {
        await act('/api/resetbets');
        closeModals();
        toast('Einsätze zurückgesetzt – bitte neu setzen');
      }
    };
    $('#btn-resetbets').onclick = resetBets;
    $('#btn-resetbets2').onclick = resetBets;
    $('#btn-reset').onclick = async () => {
      if (await ask('Wirklich alles auf Anfang? Guthaben aller Spieler, Einsätze, Jackpot und Verlauf werden zurückgesetzt.', { yes: 'Alles zurücksetzen' })) {
        await act('/api/reset');
        toast('Spiel komplett zurückgesetzt');
      }
    };
    $('#btn-host-leave').onclick = async () => {
      if (await ask('Spiel beenden? Alle Spieler werden getrennt und der Spielstand wird gelöscht.', { yes: 'Spiel beenden' })) { closeModals(); logout(); }
    };
    $('#btn-copy').onclick = async () => {
      const url = S && S.joinUrl;
      if (!url) return;
      try { await navigator.clipboard.writeText(url); toast('Link kopiert – jetzt an deine Freunde schicken'); } catch (e) { await ask('Link zum Kopieren:', { input: true, value: url, yes: 'Fertig' }); }
    };
    $('#manage-players').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.give) act('/api/give', { id: b.dataset.id, amount: Number(b.dataset.give) });
      if (b.dataset.kick) ask('Spieler entfernen?', { yes: 'Entfernen' }).then((ok) => ok && act('/api/kick', { id: b.dataset.id }));
    });
    document.addEventListener('keydown', (e) => {
      if (role !== 'host' || !S || e.code !== 'Space' || e.target.closest('input, button') || $('.modal:not(.hidden)')) return;
      e.preventDefault();
      if (S.phase === 'betting') act('/api/spin');
      else if (S.phase === 'result') act('/api/newround');
    });
    window.addEventListener('resize', () => { fitPlayers(); sizeHostWheel(); if (S) hostPanel.update(); });
    sizeHostWheel();
  }

  // Spielerleiste passt sich an: Spalten, Schriftgröße und Höhe so, dass alle Spieler auf einmal sichtbar sind
  function fitPlayers() {
    const grid = $('#host-players'), card = $('.players-card'), bottom = $('.host-bottom');
    if (!grid || !card || !bottom) return;
    const n = grid.children.length;
    const vh = window.innerHeight / 100;
    const narrow = window.matchMedia('(orientation: portrait)').matches;
    // Im Hochformat wird die Spielerleiste ausgeblendet (nur im Querformat / Fernseher sichtbar)
    if (window.matchMedia('(orientation: portrait)').matches) {
      bottom.style.minHeight = ''; bottom.style.gridTemplateColumns = '';
      return;
    }
    const minH = 17 * vh, maxH = narrow ? 70 * vh : 32 * vh;
    // bei vielen Spielern bekommt die Leiste mehr Breite
    bottom.style.gridTemplateColumns = narrow ? '' : n > 12 ? '0.8fr 0.55fr 2.8fr' : n > 6 ? '0.95fr 0.7fr 2.1fr' : '';
    const cs = getComputedStyle(card);
    const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + card.querySelector('.lbl').offsetHeight + 8;
    const gap = 0.8 * vh, pad = 1.4 * vh, lineK = 2.35;
    const W = grid.clientWidth || card.clientWidth;
    if (!n) { bottom.style.minHeight = narrow ? '' : minH + 'px'; return; }
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const tileW = (W - gap * (cols - 1)) / cols;
      const fsW = tileW / 10.5;
      const fsH = ((maxH - chrome - gap * (rows - 1)) / rows - pad) / lineK;
      const fs = Math.min(fsW, fsH, 2.2 * vh);
      if (!best || fs > best.fs + 0.3 || (fs > best.fs - 0.3 && rows < best.rows)) best = { cols, rows, fs };
    }
    const fs = Math.max(9, best.fs);
    grid.style.gridTemplateColumns = `repeat(${best.cols}, minmax(0, 1fr))`;
    grid.style.setProperty('--pfs', fs + 'px');
    const need = chrome + best.rows * (fs * lineK + pad) + gap * (best.rows - 1);
    bottom.style.minHeight = narrow ? '' : Math.min(maxH, Math.max(minH, need)) + 'px';
  }
  function updateTableLabel() {
    const l = $('#h-table-lbl');
    if (l) l.textContent = window.matchMedia('(orientation: landscape)').matches ? 'Tableau · Einsätze aller Spieler' : 'Tableau · Einsätze des Hosts';
  }
  function sizeHostWheel() {
    const box = $('.wheel-box');
    if (!box || !hostWheel) return;
    hostWheel.resize(Math.min(box.clientWidth, box.clientHeight));
  }
  function fillSettings() {
    $$('input[name="mode"]').forEach((i) => { i.checked = i.value === S.mode; });
    $('#host-name-in').value = S.me.name;
    $('#start-bal').value = S.startBalance;
    $('#room-code').textContent = hostCode || '–';
    setRoomStatus(hostPeerState);
    renderManage();
  }
  function renderManage() {
    $('#manage-players').innerHTML = S.players.map((p) => `
      <div class="mrow"><span>${p.host ? '👑 ' : ''}${esc(p.name)} <small>${money(p.balance)}</small></span>
      <span><button class="btn sm" data-id="${p.id}" data-give="500">+500</button>
      ${p.host ? '' : `<button class="btn sm danger" data-id="${p.id}" data-kick="1">Entfernen</button>`}</span></div>`).join('') || '<small>Noch keine Spieler</small>';
  }

  function renderHost(prev) {
    initHost();
    sizeHostWheel();
    const ph = $('#host-phase'), sub = $('#host-sub');
    const res = S.phase === 'result' ? S.last : null;
    $('#btn-spin').classList.toggle('hidden', S.phase !== 'betting');
    $('#btn-new').classList.toggle('hidden', S.phase !== 'result');
    // Einsätze zurücksetzen nur, solange die Kugel noch nicht geworfen wurde
    $('#btn-resetbets').disabled = S.phase !== 'betting';
    $('#btn-resetbets2').disabled = S.phase !== 'betting';
    $('#host-count').classList.toggle('hidden', S.phase !== 'spinning');
    $('#host-result').classList.toggle('hidden', !res);
    if (res) {
      $('#host-result').innerHTML = `<div class="rnum n-${res.color}">${res.result}</div><div class="rname">${R.colorName(res.result)}${res.result ? ' · ' + (res.result % 2 ? 'Impair' : 'Pair') + ' · ' + (res.result <= 18 ? 'Manque' : 'Passe') : ''}</div>`;
    }

    if (S.phase === 'betting') {
      ph.textContent = 'Faites vos jeux';
      sub.textContent = 'Bitte setzen Sie – Runde ' + S.round;
    } else if (S.phase === 'spinning') {
      ph.textContent = S.betsOpen ? 'Die Kugel rollt …' : 'Rien ne va plus';
      sub.innerHTML = S.betsOpen ? 'Noch <b class="cd-num"></b> s – letzte Einsätze!' : 'Nichts geht mehr';
    } else if (res) {
      ph.innerHTML = `<span class="dotnum n-${res.color}">${res.result}</span> ${R.colorName(res.result)}`;
      sub.innerHTML = res.winners.length
        ? 'Gewinner: ' + res.winners.map((w) => `<b>${esc(w.name)}</b> +${money(w.win)}`).join(', ')
        : res.mode === 'pot' && res.pot > 0 ? 'Niemand hat getroffen – der Pot bleibt als Jackpot!' : 'Kein Gewinner in dieser Runde';
    }

    $('#pot-label').textContent = S.mode === 'pot' ? 'Pot' : 'Einsätze gesamt';
    const potVal = res ? res.pot : S.pot;
    $('#host-pot').textContent = money(potVal);
    $('#host-carry').textContent = S.mode === 'pot'
      ? (res ? (res.carry ? `Jackpot für die nächste Runde: ${money(res.carry)}` : 'Pot wurde vollständig ausgezahlt')
        : S.carry ? `inkl. Jackpot ${money(S.carry)}` : 'wird unter den Gewinnern aufgeteilt')
      : 'Bank zahlt Casino-Quoten';

    const list = S.players.slice().sort((a, b) => (res ? (b.win || 0) - (a.win || 0) : 0) || b.stake - a.stake);
    $('#host-empty').classList.toggle('hidden', list.length > 0);
    $('#host-players').innerHTML = list.map((p) => `
      <div class="pc ${p.online ? '' : 'off'} ${res && p.win ? 'won' : ''}" style="--pc:${p.color || '#888'}">
        <div class="pn">${p.host ? '👑 ' : ''}${esc(p.name)}</div>
        <div class="ps">${p.stake ? money(p.stake) : '–'}</div>
        <div class="pb">${money(p.balance)}${res && p.win ? ` <span class="pw">+${money(p.win)}</span>` : ''}</div>
      </div>`).join('');
    fitPlayers();
    sizeHostWheel();

    $('#host-history').innerHTML = S.history.slice(0, 18).map((n, i) => `<span class="hn n-${R.color(n)} ${i === 0 && res ? 'new' : ''}">${n}</span>`).join('');

    $('#join-url-big').textContent = S.joinUrl;
    $('#host-round').textContent = S.round;
    $('#h-name').textContent = S.me.name;
    updateTableLabel();
    if (qrDone !== S.joinUrl && window.QRCode && S.joinUrl) {
      $('#qr-big').textContent = '';
      new window.QRCode($('#qr-big'), { text: S.joinUrl, width: 180, height: 180, colorDark: '#111', colorLight: '#fff' });
      qrDone = S.joinUrl;
      $('#room-code').textContent = hostCode || '–';
    }
    $('#h-balance').textContent = money(S.me.balance);
    hostPanel.update();
    if (!$('#modal-settings').classList.contains('hidden')) renderManage();
  }

  // ---------- Spieler ----------
  function fillPlayerSettings() {
    if (!S || !S.me) return;
    const stake = Object.values(S.me.bets).reduce((a, v) => a + v, 0);
    $('#p-info').innerHTML = `
      <div class="info-row"><span>Guthaben</span><b>${money(S.me.balance)}</b></div>
      <div class="info-row"><span>Einsatz diese Runde</span><b>${money(stake)}</b></div>
      <div class="info-row"><span>Runde</span><b>${S.round}</b></div>
      <div class="info-row"><span>Auszahlung</span><b>${S.mode === 'pot' ? 'Pot wird aufgeteilt' : 'Klassisch (Casino-Quoten)'}</b></div>
      <div class="info-row"><span>Host</span><b>${S.hostName ? esc(S.hostName) : '–'}</b></div>`;
    $('#p-betlist').innerHTML = $('#p-panel .mybets').innerHTML.replace('<div class="lbl">Deine Einsätze</div>', '') || '<small class="muted">Noch keine Einsätze</small>';
  }
  let playerPanel, playerWheel;
  function renderPlayer() {
    if (!playerPanel) {
      // Handy quer: Tableau quer wie am echten Tisch; Handy hochkant: Tableau hochkant
      playerPanel = createPanel($('#p-panel'), { fit: true, orient: () => (window.matchMedia('(orientation: landscape)').matches ? 'h' : 'v') });
      window.addEventListener('resize', () => requestAnimationFrame(() => { if (S && role !== 'host') renderPlayer(); }));
      playerWheel = window.RWheel.createWheel($('#p-wheel'));
      $('#p-name').onclick = async () => {
        const n = await ask('Dein Name / Tag:', { input: true, value: S.me.name, yes: 'Speichern' });
        if (n) rename(n);
      };
      $('#p-leave').onclick = async () => {
        if (await ask('Abmelden? Dein Guthaben geht verloren.', { yes: 'Abmelden' })) { closeModals(); act('/api/leave').then(logout); }
      };
      $('#p-settings').onclick = () => { $('#p-name-in').value = S.me.name; fillPlayerSettings(); openModal('#modal-psettings'); };
      $('#p-save-name').onclick = () => rename($('#p-name-in').value);
      $('#p-name-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') rename(e.target.value); });
    }
    const me = S.me;
    if (!$('#modal-psettings').classList.contains('hidden')) setTimeout(fillPlayerSettings, 0);
    $('#p-name').textContent = me.name;
    $('#p-balance').textContent = money(me.balance);
    $('#p-stake').textContent = money(Object.values(me.bets).reduce((a, v) => a + v, 0));
    const st = $('#p-status');
    delete st.dataset.offline;
    st.className = 'p-status';
    let html = '';
    if (!S.hostName) html = '<b>Warte auf den Host …</b><small>Du kannst schon setzen.</small>';
    else if (S.phase === 'betting') html = '<b>Faites vos jeux</b><small>Bitte setzen – nur du siehst deine Einsätze</small>';
    else if (S.phase === 'spinning') {
      if (S.betsOpen) html = `<b>Noch <span class="cd-num big"></span> s</b><small>Die Kugel rollt – jetzt noch schnell setzen!</small>`;
      else { html = '<b>Rien ne va plus</b><small>Nichts geht mehr</small>'; st.classList.add('closed'); }
    } else if (S.last) {
      const r = S.last.result;
      const lr = me.lastResult;
      let line = 'Du hast nicht gesetzt';
      if (lr) {
        if (lr.win > 0) { line = `Du gewinnst <b>+${money(lr.win)}</b>` + (lr.net < 0 ? ` (netto ${money(lr.net)})` : ' 🎉'); st.classList.add('won'); }
        else { line = `Leider verloren (−${money(lr.stake)})`; st.classList.add('lost'); }
      }
      html = `<b><span class="dotnum n-${S.last.color}">${r}</span> ${R.colorName(r)}</b><small>${line}</small>`;
    }
    st.innerHTML = html;
    const land = window.matchMedia('(orientation: landscape)').matches;
    playerWheel.resize(Math.round(land ? Math.min(150, window.innerHeight * 0.3, window.innerWidth * 0.14) : Math.min(84, window.innerHeight * 0.1)));
    playerPanel.update();
    requestAnimationFrame(() => playerPanel.fit());
  }

  // ---------- Allgemein ----------
  function render(prev) {
    if (role === 'host') { show('screen-host'); renderHost(prev); }
    else { show('screen-player'); renderPlayer(prev); }
  }

  function openModal(sel) { $(sel).classList.remove('hidden'); }
  function closeModals() { $$('.modal:not(#modal-ask)').forEach((m) => m.classList.add('hidden')); }

  // Eigene Rückfrage statt confirm()/prompt() – die werden in manchen Browsern/TVs blockiert
  let askDone = null;
  function ask(text, opts = {}) {
    if (askDone) askDone(null);
    const box = $('#modal-ask'), inp = $('#ask-input');
    $('#ask-text').textContent = text;
    $('#ask-yes').textContent = opts.yes || 'OK';
    inp.classList.toggle('hidden', !opts.input);
    inp.value = opts.value || '';
    box.classList.remove('hidden');
    if (opts.input) setTimeout(() => { inp.focus(); inp.select(); }, 30);
    return new Promise((resolve) => {
      askDone = (v) => { askDone = null; box.classList.add('hidden'); resolve(v); };
    });
  }
  $('#ask-yes').onclick = () => askDone && askDone(($('#ask-input').classList.contains('hidden')) ? true : $('#ask-input').value.trim());
  $('#ask-no').onclick = () => askDone && askDone(null);
  $('#modal-ask').addEventListener('click', (e) => { if (e.target.id === 'modal-ask' && askDone) askDone(null); });
  $('#ask-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ask-yes').click(); });
  // Schließen-Knopf / Klick daneben schließt nur dieses Fenster (z. B. Anleitung über den Einstellungen)
  $$('.modal:not(#modal-ask)').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.classList.add('hidden'); }));
  // Anleitung (gleicher Text wie auf dem Startbildschirm)
  $('#modal-help .help-copy').innerHTML = $('#screen-intro .help').innerHTML;
  document.addEventListener('click', (e) => { if (e.target.closest('[data-help]')) { $('#modal-help .help-copy').scrollTop = 0; openModal('#modal-help'); } });
  $('#intro-ok').onclick = () => { show('screen-start'); setTimeout(() => $('#name-in').focus(), 50); };
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; if (askDone) askDone(null); else closeModals(); });

  function loop() {
    requestAnimationFrame(loop);
    if (!S) return;
    const p = window.RWheel.pose(S.spin, serverNow());
    if (role === 'host' && hostWheel) hostWheel.draw(p.angle, p.ball);
    else if (playerWheel) playerWheel.draw(p.angle, p.ball);
    updateCountdown();
  }
  // Countdown bis "Rien ne va plus" (Host und Spieler): genau 4 → 3 → 2 → 1, dann "Rien ne va plus"
  function updateCountdown() {
    if (S && S.phase === 'spinning' && S.spin) {
      const left = Math.max(0, Math.ceil((S.spin.closeAt - Math.max(serverNow(), S.spin.start)) / 1000 - 0.001));
      // Zeit abgelaufen: sofort "Rien ne va plus" zeigen, ohne auf die Nachricht vom Host zu warten
      if (left === 0 && S.betsOpen) { S.betsOpen = false; render(S); return; }
      $$('.cd-num').forEach((e) => { if (e.textContent !== String(left)) e.textContent = left; });
      const hc = $('#host-count');
      if (hc) {
        const html = left > 0
          ? `<span class="cd-big">${left}</span><span class="cd-lbl">Sekunden zum Setzen</span>`
          : '<span class="cd-rnvp">Rien ne va plus</span>';
        if (hc.dataset.v !== String(left)) { hc.innerHTML = html; hc.dataset.v = left; hc.classList.toggle('closed', left === 0); }
      }
    }
  }
  requestAnimationFrame(loop);
  setInterval(updateCountdown, 200); // eigener Takt, falls ein Gerät die Animation drosselt

  // Lokal gestartet (node server.js): Link mit der WLAN-Adresse statt "localhost"
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    fetch('lan.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j || !j.base) return;
      joinBase = j.base;
      if (engine && hostCode) { engine.setJoinUrl(joinUrlFor(hostCode)); engine.broadcast(); }
    }).catch(() => {});
  }

  if (room) { if (!resumePlayer()) show('screen-intro'); }
  else if (!resumeHost()) show('screen-intro'); // zuerst Hinweis + Anleitung, danach Namen eingeben
})();
