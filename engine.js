// Roulette – Spiel-Logik. Läuft im Browser des Hosts (der Host ist der "Server").
// Spieler verbinden sich per Peer-to-Peer mit dem Host; siehe app.js.
(function (root) {
  'use strict';
  const R = root.RShared;

  const SPIN_MS = 11000; // Dauer bis die Kugel liegt
  const CLOSE_MS = 4000; // genau 4 Sekunden setzen nach dem Wurf, danach "Rien ne va plus"

  // Jeder Spieler bekommt eine eigene Farbe (wie Cursor beim gemeinsamen Bearbeiten)
  const PALETTE = ['#ff9f1c', '#2ec4f1', '#ff5fa2', '#b6f03c', '#a78bfa', '#ffd23f', '#ff6b4a', '#4dd6c1',
    '#f472f6', '#7aa2ff', '#f5f5f5', '#d4a373', '#00e5a0', '#ff8fab', '#9bf6ff', '#ffc6ff'];

  function randomInt(min, max) { // [min, max)
    const range = max - min;
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / range) * range;
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return min + (buf[0] % range);
  }
  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const sum = (bets) => Object.values(bets).reduce((a, v) => a + v, 0);

  class GameError extends Error {
    constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; }
  }
  const fail = (msg, status = 400, extra) => { throw new GameError(status, msg, extra); };

  function createEngine(opts = {}) {
    const onChange = opts.onChange || (() => {});
    let joinUrl = opts.joinUrl || '';

    let game = {
      phase: 'betting', // betting | spinning | result
      mode: 'pot', // pot = Pot wird unter Gewinnern aufgeteilt | classic = Bank zahlt Casino-Quoten
      startBalance: 1000,
      carry: 0, // Jackpot-Übertrag, wenn niemand trifft
      round: 1,
      history: [],
      spin: null,
      last: null,
    };
    const players = new Map(); // token -> Spieler
    let hostToken = null;
    const clients = new Set(); // { token, send(view) }
    let timers = [];

    function freeColor() {
      const used = new Set([...players.values()].map((p) => p.color));
      return PALETTE.find((c) => !used.has(c)) || PALETTE[players.size % PALETTE.length];
    }
    function betsOpen() {
      if (game.phase === 'betting') return true;
      return game.phase === 'spinning' && Date.now() < game.spin.closeAt;
    }
    function stakesNow() {
      let s = 0;
      for (const p of players.values()) s += sum(p.bets);
      return s;
    }

    function view(token) {
      const me = players.get(token);
      const host = players.get(hostToken);
      const stakes = stakesNow();
      return {
        now: Date.now(),
        phase: game.phase,
        betsOpen: betsOpen(),
        mode: game.mode,
        startBalance: game.startBalance,
        round: game.round,
        history: game.history,
        carry: game.carry,
        stakes,
        pot: game.mode === 'pot' ? game.carry + stakes : stakes,
        spin: game.spin,
        last: game.phase === 'result' ? game.last : null,
        hostName: host ? host.name : null,
        hostOnline: !!(host && host.online > 0),
        joinUrl,
        players: [...players.values()].map((p) => ({
          id: p.id,
          name: p.name,
          host: p.token === hostToken,
          balance: p.balance,
          stake: sum(p.bets),
          online: p.online > 0,
          color: p.color,
          win: game.phase === 'result' && p.lastResult ? p.lastResult.win : null,
        })),
        // Nur der Host (Hauptbildschirm) bekommt die Einsätze aller Spieler
        table: token && token === hostToken
          ? [...players.values()].filter((p) => Object.keys(p.bets).length)
            .map((p) => ({ id: p.id, name: p.name, color: p.color, bets: p.bets }))
          : null,
        me: me && {
          id: me.id,
          name: me.name,
          role: token === hostToken ? 'host' : 'player',
          balance: me.balance,
          bets: me.bets,
          canUndo: me.stack.length > 0,
          hasLast: !!me.lastBets,
          lastResult: game.phase === 'result' ? me.lastResult : null,
        },
      };
    }

    function broadcast() {
      for (const c of clients) {
        try { c.send(view(c.token)); } catch (e) { /* Verbindung weg – wird beim Schließen entfernt */ }
      }
      onChange();
    }

    function needPlayer(token) {
      const p = players.get(token);
      if (!p) fail('Unbekannter Spieler – bitte neu beitreten', 401);
      return p;
    }
    function needHost(token) {
      if (!token || token !== hostToken) fail('Nur der Host darf das', 403);
      return players.get(token);
    }

    function place(p, items) {
      if (!betsOpen()) fail('Rien ne va plus – keine Einsätze mehr');
      let total = 0;
      for (const it of items) {
        if (!Object.prototype.hasOwnProperty.call(R.BETS, it.key)) fail('Ungültige Wette');
        if (!Number.isInteger(it.amount) || it.amount < 1 || it.amount > 1e7) fail('Ungültiger Betrag');
        total += it.amount;
      }
      if (!items.length) fail('Nichts zu setzen');
      if (total > p.balance) fail('Nicht genug Jetons');
      p.balance -= total;
      for (const it of items) p.bets[it.key] = (p.bets[it.key] || 0) + it.amount;
      p.stack.push(items);
    }
    function refund(p, key, amount) {
      const has = p.bets[key] || 0;
      const back = Math.min(has, amount);
      p.balance += back;
      if (has - back > 0) p.bets[key] = has - back;
      else delete p.bets[key];
    }

    function settle() {
      if (game.phase !== 'spinning' || !game.spin) return;
      const r = game.spin.result;
      const list = [...players.values()];
      let stakes = 0;
      for (const p of list) stakes += sum(p.bets);
      const pot = game.mode === 'pot' ? game.carry + stakes : stakes;
      const wins = new Map();
      let noWinner = false;

      if (game.mode === 'classic') {
        for (const p of list) {
          let w = 0;
          for (const [k, amt] of Object.entries(p.bets)) {
            const b = R.BETS[k];
            if (b.nums.includes(r)) w += amt * (b.odds + 1);
          }
          wins.set(p, w);
        }
      } else {
        // Pot-Modus: Gewinnanteil gewichtet nach echter Roulette-Auszahlung (Einsatz × (Quote+1))
        let total = 0;
        const weights = new Map();
        for (const p of list) {
          let w = 0;
          for (const [k, amt] of Object.entries(p.bets)) {
            const b = R.BETS[k];
            if (b.nums.includes(r)) w += amt * (b.odds + 1);
          }
          weights.set(p, w);
          total += w;
        }
        let paid = 0;
        for (const p of list) {
          const w = total > 0 ? Math.floor((pot * weights.get(p)) / total) : 0;
          wins.set(p, w);
          paid += w;
        }
        noWinner = total === 0;
        game.carry = pot - paid; // Rest (oder ganzer Pot) bleibt als Jackpot
      }

      for (const p of list) {
        const stake = sum(p.bets);
        const win = wins.get(p) || 0;
        p.balance += win;
        p.lastResult = stake > 0 || win > 0 ? { stake, win, net: win - stake } : null;
      }
      game.last = {
        result: r,
        color: R.color(r),
        pot,
        mode: game.mode,
        carry: game.carry,
        noWinner: game.mode === 'pot' ? noWinner : list.every((p) => !wins.get(p)),
        winners: list.filter((p) => wins.get(p) > 0)
          .map((p) => ({ name: p.name, win: wins.get(p), stake: sum(p.bets) }))
          .sort((a, b) => b.win - a.win),
      };
      game.history.unshift(r);
      game.history = game.history.slice(0, 30);
      game.phase = 'result';
      broadcast();
    }

    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function scheduleSpin() {
      clearTimers();
      if (game.phase !== 'spinning' || !game.spin) return;
      const s = game.spin;
      const now = Date.now();
      if (now < s.closeAt) timers.push(setTimeout(broadcast, s.closeAt - now + 30));
      timers.push(setTimeout(settle, Math.max(0, s.start + s.duration - now)));
    }

    function createPlayer(name) {
      const p = {
        id: randomHex(4),
        token: randomHex(16),
        name, color: freeColor(), balance: game.startBalance, bets: {}, stack: [], lastBets: null, lastResult: null, online: 0,
      };
      players.set(p.token, p);
      return p;
    }

    const routes = {
      // local = true nur für den Host selbst (dieses Gerät). Über das Netz kann man nur Spieler werden.
      '/api/join'(b, local) {
        const name = String(b.name || '').trim().slice(0, 20);
        if (!name) fail('Bitte einen Namen eingeben');
        const role = local && b.role === 'host' ? 'host' : 'player';
        let p = b.token && players.get(b.token);
        if (!p) p = createPlayer(name);
        p.name = name;
        if (role === 'host') hostToken = p.token;
        else if (hostToken === p.token) fail('Der Host spielt auf diesem Gerät');
        broadcast();
        return { token: p.token, role };
      },
      '/api/rename'(b) {
        const p = needPlayer(b.token);
        const name = String(b.name || '').trim().slice(0, 20);
        if (!name) fail('Bitte einen Namen / Tag eingeben');
        p.name = name;
      },
      '/api/bet'(b) {
        const p = needPlayer(b.token);
        const keys = Array.isArray(b.keys) ? b.keys.slice(0, 20) : [];
        const amount = Number(b.amount);
        place(p, keys.map((key) => ({ key: String(key), amount })));
      },
      '/api/remove'(b) {
        const p = needPlayer(b.token);
        if (!betsOpen()) fail('Rien ne va plus');
        refund(p, String(b.key), Infinity);
      },
      '/api/undo'(b) {
        const p = needPlayer(b.token);
        if (!betsOpen()) fail('Rien ne va plus');
        const items = p.stack.pop();
        if (items) items.forEach((it) => refund(p, it.key, it.amount));
      },
      '/api/clear'(b) {
        const p = needPlayer(b.token);
        if (!betsOpen()) fail('Rien ne va plus');
        for (const k of Object.keys(p.bets)) refund(p, k, Infinity);
        p.stack = [];
      },
      '/api/repeat'(b) {
        const p = needPlayer(b.token);
        if (!p.lastBets) fail('Keine vorherigen Einsätze');
        place(p, Object.entries(p.lastBets).map(([key, amount]) => ({ key, amount })));
      },
      '/api/double'(b) {
        const p = needPlayer(b.token);
        place(p, Object.entries(p.bets).map(([key, amount]) => ({ key, amount })));
      },
      '/api/spin'(b) {
        needHost(b.token);
        if (game.phase !== 'betting') fail('Die Kugel läuft bereits');
        const start = Date.now(); // ohne Vorlauf: Countdown beginnt sofort bei 4
        game.spin = {
          start,
          duration: SPIN_MS,
          closeAt: start + CLOSE_MS,
          result: randomInt(0, 37),
          turns: 9 + randomInt(0, 4),
          extra: (2 + Math.random()) * Math.PI * 2,
        };
        game.phase = 'spinning';
        scheduleSpin();
      },
      '/api/newround'(b) {
        needHost(b.token);
        if (game.phase !== 'result') fail('Die Runde läuft noch');
        for (const p of players.values()) {
          if (sum(p.bets) > 0) p.lastBets = { ...p.bets };
          p.bets = {};
          p.stack = [];
          p.lastResult = null;
        }
        game.spin = null;
        game.last = null;
        game.round++;
        game.phase = 'betting';
      },
      '/api/settings'(b) {
        needHost(b.token);
        if (b.mode === 'pot' || b.mode === 'classic') {
          if (game.phase !== 'betting' && b.mode !== game.mode) fail('Modus nur zwischen den Runden änderbar');
          game.mode = b.mode;
        }
        const sb = Number(b.startBalance);
        if (Number.isInteger(sb) && sb > 0 && sb <= 1e7) game.startBalance = sb;
      },
      '/api/give'(b) {
        needHost(b.token);
        const p = [...players.values()].find((x) => x.id === b.id);
        const amount = Number(b.amount);
        if (!p || !Number.isInteger(amount) || amount < 1 || amount > 1e7) fail('Ungültig');
        p.balance += amount;
      },
      '/api/kick'(b) {
        needHost(b.token);
        const p = [...players.values()].find((x) => x.id === b.id);
        if (!p) fail('Spieler nicht gefunden');
        if (p.token === hostToken) fail('Der Host kann sich nicht selbst entfernen');
        players.delete(p.token);
        // Verbindung des Spielers bekommt "unbekannt" -> landet wieder auf dem Startbildschirm
        for (const c of clients) if (c.token === p.token) { try { c.send(view(null)); } catch (e) { /* egal */ } }
      },
      // Einsätze zurücksetzen: nur bevor die Kugel geworfen wird
      '/api/resetbets'(b) {
        needHost(b.token);
        if (game.phase !== 'betting') fail('Einsätze können nur zurückgesetzt werden, bevor die Kugel geworfen wird');
        for (const p of players.values()) {
          for (const k of Object.keys(p.bets)) refund(p, k, Infinity);
          p.stack = [];
          p.lastResult = null;
        }
      },
      '/api/reset'(b) {
        needHost(b.token);
        clearTimers();
        for (const p of players.values()) {
          p.balance = game.startBalance;
          p.bets = {}; p.stack = []; p.lastBets = null; p.lastResult = null;
        }
        Object.assign(game, { phase: 'betting', carry: 0, round: 1, history: [], spin: null, last: null });
      },
      '/api/leave'(b) {
        const p = needPlayer(b.token);
        if (sum(p.bets) > 0 && betsOpen()) for (const k of Object.keys(p.bets)) refund(p, k, Infinity);
        if (hostToken === p.token) hostToken = null;
        if (sum(p.bets) === 0) players.delete(p.token);
      },
    };

    // Anfrage ausführen. Wirft GameError bei Fehlern.
    function call(path, body, local) {
      const fn = routes[path];
      if (!fn) fail('Unbekannte Aktion', 404);
      const out = fn(body || {}, !!local) || { ok: true };
      if (path !== '/api/join') broadcast();
      return out;
    }

    // Eine Verbindung (Host-Bildschirm selbst oder Handy) möchte Updates bekommen
    function subscribe(client) {
      clients.add(client);
      const p = players.get(client.token);
      if (p) p.online++;
      client.send(view(client.token));
      if (p) broadcast();
    }
    function unsubscribe(client) {
      if (!clients.delete(client)) return;
      const p = players.get(client.token);
      if (p) { p.online = Math.max(0, p.online - 1); broadcast(); }
    }

    // Spielstand speichern/wiederherstellen (damit ein Neuladen der Host-Seite die Runde nicht löscht)
    function serialize() {
      return {
        v: 1,
        game,
        hostToken,
        players: [...players.values()].map((p) => ({ ...p, online: 0 })),
      };
    }
    function restore(data) {
      if (!data || data.v !== 1 || !data.game) return false;
      game = Object.assign(game, data.game);
      players.clear();
      for (const p of data.players || []) players.set(p.token, { ...p, online: 0 });
      hostToken = data.hostToken && players.has(data.hostToken) ? data.hostToken : null;
      if (game.phase === 'spinning' && !game.spin) game.phase = 'betting';
      if (game.phase === 'result' && !game.last) game.phase = 'betting';
      scheduleSpin();
      return true;
    }

    return {
      call, subscribe, unsubscribe, serialize, restore, broadcast, view,
      setJoinUrl(u) { joinUrl = u; },
      hasPlayer: (t) => players.has(t),
    };
  }

  root.REngine = { createEngine, GameError, SPIN_MS, CLOSE_MS };
})(typeof window !== 'undefined' ? window : globalThis);
