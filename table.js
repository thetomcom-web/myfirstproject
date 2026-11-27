// Roulette-Tableau als SVG mit allen Setzfeldern.
// orient 'v' = hochkant (Handy), orient 'h' = quer wie am echten Tisch neben dem Kessel (TV).
(function () {
  const { BETS, color } = window.RShared;
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const chipColor = (v) => (v >= 1000 ? '#c9a646' : v >= 500 ? '#6a2bb3' : v >= 100 ? '#1b1b1b' : v >= 25 ? '#1d8a3c' : v >= 10 ? '#1f5fbf' : v >= 5 ? '#c0262d' : '#e8e8e8');
  const fmt = (v) => (v >= 10000 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'k' : String(v));

  // rh = Zeilenhöhe im Hochformat; wird kleiner, damit das Tableau ohne Scrollen auf jedes Handy passt
  function geometry(horizontal, rh) {
    if (!horizontal) {
      const RH = rh || 46, ZH = Math.round(RH * 1.15), CH = Math.round(RH * 0.85);
      const M = 18, T = 4, CW = 62, DW = 44, OW = 56;
      const x0 = M, y0 = T + ZH;
      return {
        W: x0 + 3 * CW + DW + OW + 4, H: y0 + 12 * RH + CH + 4,
        A: CW, B: RH,
        P: (a, b) => [x0 + a * CW, y0 + b * RH],
        size: (wa, wb) => [wa, wb],
        zero: { points: `${x0},${y0} ${x0},${T + ZH * 0.3} ${x0 + 1.5 * CW},${T} ${x0 + 3 * CW},${T + ZH * 0.3} ${x0 + 3 * CW},${y0}`, c: [x0 + 1.5 * CW, T + ZH / 2 + 4] },
        column: (c) => ({ x: x0 + c * CW, y: y0 + 12 * RH, w: CW, h: CH }),
        dozen: (d) => ({ x: x0 + 3 * CW, y: y0 + d * 4 * RH, w: DW, h: 4 * RH, rot: true }),
        outside: (i) => ({ x: x0 + 3 * CW + DW, y: y0 + i * 2 * RH, w: OW, h: 2 * RH, rot: true }),
        diamond: [17, Math.min(26, RH * 0.56)],
        rh: RH,
      };
    }
    const L = 6, ZW = 50, CW = 58, RH = 60, CH = 52, DW = 44, OW = 52, T = 6;
    const x0 = L + ZW, y0 = T;
    return {
      W: x0 + 12 * CW + CH + 6, H: y0 + 3 * RH + DW + OW + 6,
      A: RH, B: CW,
      P: (a, b) => [x0 + b * CW, y0 + (3 - a) * RH],
      size: (wa, wb) => [wb, wa],
      zero: { points: `${x0},${y0} ${L + 18},${y0} ${L},${y0 + 1.5 * RH} ${L + 18},${y0 + 3 * RH} ${x0},${y0 + 3 * RH}`, c: [L + ZW / 2 + 5, y0 + 1.5 * RH] },
      column: (c) => ({ x: x0 + 12 * CW, y: y0 + (2 - c) * RH, w: CH, h: RH }),
      dozen: (d) => ({ x: x0 + d * 4 * CW, y: y0 + 3 * RH, w: 4 * CW, h: DW }),
      outside: (i) => ({ x: x0 + i * 2 * CW, y: y0 + 3 * RH + DW, w: 2 * CW, h: OW }),
      diamond: [26, 20],
    };
  }

  function createBetTable(container, opts) {
    const G = geometry(opts.orient === 'h', opts.rh);
    const svg = el('svg', { viewBox: `0 0 ${G.W} ${G.H}`, class: 'bet-table ' + (opts.orient === 'h' ? 'horizontal' : 'vertical') });
    if (G.rh) {
      svg.style.setProperty('--numfs', Math.min(19, G.rh * 0.62) + 'px');
      svg.style.setProperty('--lblfs', Math.min(12.5, G.rh * 0.4) + 'px');
    }
    const edgeT = G.rh ? Math.min(16, G.rh * 0.35) : 16; // Dicke der Linien-Hotspots
    const dotR = G.rh ? Math.min(11, G.rh * 0.3) : 11;
    container.appendChild(svg);
    const gBase = el('g', {}, svg);
    const gHot = el('g', {}, svg);
    const gChips = el('g', { 'pointer-events': 'none' }, svg);
    const cells = {};
    const anchors = {};
    const uid = 't' + Math.random().toString(36).slice(2, 8);
    const defs = el('defs', {}, svg);
    defs.innerHTML = `
      <radialGradient id="${uid}f" cx="50%" cy="38%" r="80%"><stop offset="0" stop-color="#1d8c50"/><stop offset=".6" stop-color="#106538"/><stop offset="1" stop-color="#083f22"/></radialGradient>
      <filter id="${uid}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .32 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
      <radialGradient id="${uid}s" cx="35%" cy="28%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".45" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></radialGradient>`;
    const shine = `url(#${uid}s)`;

    el('rect', { x: 0, y: 0, width: G.W, height: G.H, rx: 12, class: 'felt', fill: `url(#${uid}f)` }, gBase);

    function hot(node, key) {
      node.classList.add('hot');
      node.dataset.key = key;
      node.addEventListener('click', () => opts.onBet(key));
      node.addEventListener('pointerenter', () => highlight(BETS[key].nums, true));
      node.addEventListener('pointerleave', () => highlight(BETS[key].nums, false));
    }
    function highlight(nums, on) {
      nums.forEach((n) => cells[n] && cells[n].classList.toggle('hl', on));
    }
    function label(text, b) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const t = el('text', { x: cx, y: cy, dy: 5, class: 'lbl' }, gBase);
      if (b.rot) t.setAttribute('transform', `rotate(90 ${cx} ${cy})`);
      t.textContent = text;
    }

    // Null
    const zero = el('polygon', { points: G.zero.points, class: 'cell n-green' }, gBase);
    cells[0] = zero;
    el('text', { x: G.zero.c[0], y: G.zero.c[1] + 6, class: 'num' }, gBase).textContent = '0';
    hot(zero, 'straight:0');
    anchors['straight:0'] = G.zero.c;

    // Zahlen 1–36
    for (let n = 1; n <= 36; n++) {
      const r = Math.floor((n - 1) / 3), c = (n - 1) % 3;
      const p1 = G.P(c, r), p2 = G.P(c + 1, r + 1);
      const x = Math.min(p1[0], p2[0]), y = Math.min(p1[1], p2[1]);
      const w = Math.abs(p2[0] - p1[0]), h = Math.abs(p2[1] - p1[1]);
      const rect = el('rect', { x, y, width: w, height: h, class: 'cell n-' + color(n) }, gBase);
      cells[n] = rect;
      const [cx, cy] = G.P(c + 0.5, r + 0.5);
      el('text', { x: cx, y: cy + 7, class: 'num', 'pointer-events': 'none' }, gBase).textContent = n;
      hot(rect, 'straight:' + n);
      anchors['straight:' + n] = [cx, cy];
    }

    function box(b, key) {
      const rect = el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'cell out' }, gBase);
      hot(rect, key);
      anchors[key] = [b.x + b.w / 2, b.y + b.h / 2];
      return rect;
    }
    for (let c = 0; c < 3; c++) { const b = G.column(c); box(b, 'column:' + (c + 1)); label('2 : 1', b); }
    for (let d = 0; d < 3; d++) { const b = G.dozen(d); box(b, 'dozen:' + (d + 1)); label(['1. Dutzend', '2. Dutzend', '3. Dutzend'][d], b); }
    const outs = [['low', '1–18'], ['even', 'PAIR'], ['red', ''], ['black', ''], ['odd', 'IMPAIR'], ['high', '19–36']];
    outs.forEach(([key, text], i) => {
      const b = G.outside(i);
      box(b, key);
      if (text) label(text, b);
      else {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, [dx, dy] = G.diamond;
        el('polygon', { points: `${cx},${cy - dy} ${cx + dx},${cy} ${cx},${cy + dy} ${cx - dx},${cy}`, class: 'n-' + key, 'pointer-events': 'none', stroke: '#e9d48a', 'stroke-width': 1.5 }, gBase);
      }
    });

    // Filzstruktur über allem Gedruckten
    el('rect', { x: 0, y: 0, width: G.W, height: G.H, rx: 12, class: 'grain', filter: `url(#${uid}n)`, 'pointer-events': 'none' }, gBase);

    // Kanten- und Eck-Hotspots. a = Position quer zu den 3 Reihen, b = entlang der 12 Querreihen
    const edge = (key, a, b, wa, wb) => {
      const [cx, cy] = G.P(a, b), [w, h] = G.size(wa, wb);
      hot(el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, class: 'edge' }, gHot), key);
      anchors[key] = [cx, cy];
    };
    const edgeA = (key, a, b) => edge(key, a, b, 18, Math.max(8, G.B - 22)); // Linie zwischen zwei Reihen
    const edgeB = (key, a, b) => edge(key, a, b, G.A - 26, edgeT); // Linie zwischen zwei Querreihen
    const dot = (key, a, b) => {
      const [cx, cy] = G.P(a, b);
      hot(el('circle', { cx, cy, r: dotR, class: 'edge' }, gHot), key);
      anchors[key] = [cx, cy];
    };
    for (let n = 1; n <= 36; n++) {
      const r = Math.floor((n - 1) / 3), c = (n - 1) % 3;
      if (c < 2) edgeA(`split:${n}-${n + 1}`, c + 1, r + 0.5);
      if (r < 11) edgeB(`split:${n}-${n + 3}`, c + 0.5, r + 1);
    }
    for (let c = 0; c < 3; c++) edgeB(`split:0-${c + 1}`, c + 0.5, 0);
    for (let r = 0; r < 12; r++) edgeA(`street:${3 * r + 1}-${3 * r + 2}-${3 * r + 3}`, 0, r + 0.5);
    for (let n = 1; n <= 32; n++) {
      if (n % 3 === 0) continue;
      const r = Math.floor((n - 1) / 3), c = (n - 1) % 3;
      dot(`corner:${n}-${n + 1}-${n + 3}-${n + 4}`, c + 1, r + 1);
    }
    for (let r = 0; r < 11; r++) {
      const a = 3 * r + 1;
      dot(`line:${a}-${a + 1}-${a + 2}-${a + 3}-${a + 4}-${a + 5}`, 0, r + 1);
    }
    dot('trio:0-1-2', 1, 0);
    dot('trio:0-2-3', 2, 0);
    dot('four:0-1-2-3', 0, 0);

    // Echter Casino-Jeton: Grundfarbe, 6 Kanteneinlagen, helle Mitte mit Wert, Glanz; bei höheren Beträgen ein Stapel
    function drawChip(g, amt) {
      const col = chipColor(amt);
      const light = amt < 5;
      const insert = light ? '#1f5fbf' : '#f7f3e8';
      const stack = amt >= 100 ? 3 : amt >= 25 ? 2 : 1;
      for (let i = stack - 1; i >= 1; i--) {
        el('circle', { cy: i * 2.4, r: 12.5, fill: col, stroke: 'rgba(0,0,0,.55)', 'stroke-width': 0.6 }, g);
        el('circle', { cy: i * 2.4, r: 12.5, fill: 'rgba(0,0,0,.35)' }, g);
      }
      el('circle', { r: 12.5, fill: col, stroke: 'rgba(0,0,0,.5)', 'stroke-width': 0.6 }, g);
      el('circle', { r: 10.9, fill: 'none', stroke: insert, 'stroke-width': 3.2, 'stroke-dasharray': '5.2 6.2', transform: 'rotate(-12)' }, g);
      el('circle', { r: 7.7, fill: '#f5efe0', stroke: 'rgba(0,0,0,.35)', 'stroke-width': 0.6 }, g);
      el('circle', { r: 6.6, fill: 'none', stroke: light ? '#1f5fbf' : col, 'stroke-width': 0.6, 'stroke-dasharray': '1 1.1' }, g);
      const t = el('text', { y: 2.6, class: 'chip-t', fill: light ? '#1f3f7f' : amt >= 1000 ? '#6b4f12' : col, 'font-size': fmt(amt).length > 3 ? 5.6 : 7.2 }, g);
      t.textContent = fmt(amt);
      el('circle', { r: 12.5, fill: shine }, g);
    }

    function setChips(bets, result) {
      prevSeen = null;
      gChips.textContent = '';
      Object.values(cells).forEach((c) => c.classList.remove('winning'));
      if (result != null) cells[result].classList.add('winning');
      for (const [key, amt] of Object.entries(bets || {})) {
        const a = anchors[key];
        if (!a) continue;
        const cls = result == null ? 'chip' : BETS[key].nums.includes(result) ? 'chip win' : 'chip lose';
        const g = el('g', { class: cls, transform: `translate(${a[0]} ${a[1]})` }, gChips);
        drawChip(g, amt);
      }
    }
    // Einsätze aller Spieler, jeder in seiner Farbe mit Namensschild (wie Cursor beim gemeinsamen Bearbeiten)
    let prevSeen = null;
    function setMulti(layers, result) {
      gChips.textContent = '';
      Object.values(cells).forEach((c) => c.classList.remove('winning'));
      if (result != null) cells[result].classList.add('winning');
      const byKey = {};
      layers.forEach((L) => Object.entries(L.bets).forEach(([key, amt]) => (byKey[key] = byKey[key] || []).push({ L, amt })));
      const seen = new Set();
      const tags = el('g', {}, null);
      for (const [key, list] of Object.entries(byKey)) {
        const a = anchors[key];
        if (!a) continue;
        const won = result != null && BETS[key].nums.includes(result);
        list.forEach(({ L, amt }, i) => {
          const dx = (i - (list.length - 1) / 2) * 9;
          const dy = -i * 3;
          const id = L.id + '|' + key + '|' + amt;
          seen.add(id);
          const fresh = prevSeen && !prevSeen.has(id);
          const cls = 'chip' + (result == null ? '' : won ? ' win' : ' lose') + (fresh ? ' pop' : '');
          const g = el('g', { class: cls, transform: `translate(${a[0] + dx} ${a[1] + dy})` }, gChips);
          el('circle', { r: 14.6, fill: 'none', stroke: L.color, 'stroke-width': 2.6 }, g);
          drawChip(g, amt);
          // Namensschild
          const name = L.name.length > 10 ? L.name.slice(0, 9) + '…' : L.name;
          const w = name.length * 6.6 + 12;
          const ty = a[1] + dy - 21 - i * 14;
          const tg = el('g', { class: 'tag' + (fresh ? ' pop' : '') + (result != null && !won ? ' lose' : ''), transform: `translate(${a[0] + dx} ${ty})` }, tags);
          el('rect', { x: -w / 2, y: -8, width: w, height: 15, rx: 7.5, fill: L.color, stroke: 'rgba(0,0,0,.55)', 'stroke-width': 0.6 }, tg);
          el('path', { d: 'M-4 6.5 L0 11 L4 6.5 Z', fill: L.color }, tg);
          const t = el('text', { y: 3.4, class: 'tag-t' }, tg);
          t.textContent = name;
        });
      }
      gChips.appendChild(tags); // Schilder über allen Jetons
      prevSeen = seen;
    }

    function flash(keys) {
      const nums = new Set();
      keys.forEach((k) => BETS[k] && BETS[k].nums.forEach((n) => nums.add(n)));
      nums.forEach((n) => {
        const c = cells[n];
        c.classList.remove('flash'); void c.getBBox(); c.classList.add('flash');
      });
    }
    return { setChips, setMulti, flash };
  }

  window.RTable = { createBetTable, chipColor, fmt };
})();
