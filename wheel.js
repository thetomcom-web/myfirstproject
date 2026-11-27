// Roulette-Kessel auf Canvas – realistische Draufsicht (Holz, Messing, Fächer mit Tiefe, Licht von oben)
(function () {
  const { WHEEL, color } = window.RShared;
  const STEP = (Math.PI * 2) / 37;
  const TAU = Math.PI * 2;

  // fester Zufall, damit die Holzmaserung bei jedem Neuaufbau gleich aussieht
  function rng(seed) {
    return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  }
  function brass(c, r0, r1, a = 0) {
    if (c.createConicGradient) {
      const g = c.createConicGradient(a, 0, 0);
      [['#6e5216', 0], ['#f7e3a1', 0.12], ['#a8812d', 0.3], ['#fff2c4', 0.48], ['#8a6820', 0.65], ['#e9cd7b', 0.85], ['#6e5216', 1]]
        .forEach(([col, s]) => g.addColorStop(s, col));
      return g;
    }
    const g = c.createRadialGradient(0, 0, r0, 0, 0, r1);
    g.addColorStop(0, '#f7e3a1'); g.addColorStop(1, '#8a6820');
    return g;
  }
  function ring(c, r, w, style) {
    c.strokeStyle = style; c.lineWidth = w;
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
  }
  function woodGrain(c, r0, r1, base, rand, n) {
    for (let i = 0; i < n; i++) {
      const r = r0 + (r1 - r0) * rand();
      c.strokeStyle = rand() < 0.5 ? `rgba(20,8,2,${0.08 + rand() * 0.18})` : `rgba(255,200,140,${0.03 + rand() * 0.07})`;
      c.lineWidth = base * (0.3 + rand() * 1.4);
      const a0 = rand() * TAU;
      c.beginPath(); c.arc(0, 0, r, a0, a0 + (0.6 + rand() * 2.6)); c.stroke();
    }
  }

  function createWheel(canvas) {
    const ctx = canvas.getContext('2d');
    let size = 0;
    let off = null;

    function build() {
      const dpr = window.devicePixelRatio || 1;
      off = document.createElement('canvas');
      off.width = off.height = Math.round(size * dpr);
      const c = off.getContext('2d');
      c.scale(dpr, dpr);
      const R = size / 2;
      const rand = rng(7);
      c.translate(R, R);

      // Holzrand (Mahagoni) mit Maserung
      let g = c.createRadialGradient(0, 0, R * 0.86, 0, 0, R);
      g.addColorStop(0, '#2b1206'); g.addColorStop(0.25, '#6b2d10'); g.addColorStop(0.6, '#8a3d17'); g.addColorStop(0.9, '#4a1d08'); g.addColorStop(1, '#1c0a03');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, R * 0.995, 0, TAU); c.fill();
      c.save(); c.beginPath(); c.arc(0, 0, R * 0.99, 0, TAU); c.arc(0, 0, R * 0.875, 0, TAU, true); c.clip();
      woodGrain(c, R * 0.875, R * 0.99, R * 0.004, rand, 140);
      c.restore();
      ring(c, R * 0.993, R * 0.008, 'rgba(0,0,0,0.6)');

      // Kugelbahn (poliertes dunkles Holz, leicht konkav)
      g = c.createRadialGradient(0, 0, R * 0.74, 0, 0, R * 0.875);
      g.addColorStop(0, '#0c0502'); g.addColorStop(0.35, '#2a1307'); g.addColorStop(0.75, '#3d1d0c'); g.addColorStop(1, '#180902');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, R * 0.875, 0, TAU); c.fill();
      c.save(); c.beginPath(); c.arc(0, 0, R * 0.87, 0, TAU); c.arc(0, 0, R * 0.75, 0, TAU, true); c.clip();
      woodGrain(c, R * 0.75, R * 0.87, R * 0.003, rand, 90);
      c.restore();
      ring(c, R * 0.874, R * 0.01, brass(c, R * 0.86, R * 0.88, 0.4));

      // Zahlenring
      for (let i = 0; i < 37; i++) {
        const a0 = -Math.PI / 2 + (i - 0.5) * STEP, a1 = a0 + STEP;
        const col = color(WHEEL[i]);
        g = c.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 0.745);
        if (col === 'red') { g.addColorStop(0, '#6e0a10'); g.addColorStop(0.5, '#b0141c'); g.addColorStop(1, '#8c0f16'); }
        else if (col === 'black') { g.addColorStop(0, '#050505'); g.addColorStop(0.5, '#1c1c1c'); g.addColorStop(1, '#0d0d0d'); }
        else { g.addColorStop(0, '#04401f'); g.addColorStop(0.5, '#0d7a3c'); g.addColorStop(1, '#075a2b'); }
        c.fillStyle = g;
        c.beginPath(); c.arc(0, 0, R * 0.745, a0, a1); c.arc(0, 0, R * 0.6, a1, a0, true); c.closePath(); c.fill();
        // Fächer (Taschen) mit Tiefe
        g = c.createRadialGradient(0, 0, R * 0.48, 0, 0, R * 0.6);
        if (col === 'red') { g.addColorStop(0, '#2a0204'); g.addColorStop(0.6, '#6a080d'); g.addColorStop(1, '#8a0e14'); }
        else if (col === 'black') { g.addColorStop(0, '#000'); g.addColorStop(0.6, '#0b0b0b'); g.addColorStop(1, '#191919'); }
        else { g.addColorStop(0, '#011a0c'); g.addColorStop(0.6, '#05482a'); g.addColorStop(1, '#0a6534'); }
        c.fillStyle = g;
        c.beginPath(); c.arc(0, 0, R * 0.6, a0, a1); c.arc(0, 0, R * 0.48, a1, a0, true); c.closePath(); c.fill();
        // Schatten der linken Fachwand
        c.fillStyle = 'rgba(0,0,0,0.28)';
        c.beginPath(); c.arc(0, 0, R * 0.6, a0, a0 + STEP * 0.22); c.arc(0, 0, R * 0.48, a0 + STEP * 0.22, a0, true); c.closePath(); c.fill();
      }
      // Fachstege aus Chrom
      for (let i = 0; i < 37; i++) {
        const a = -Math.PI / 2 + (i - 0.5) * STEP;
        const cx = Math.cos(a), sy = Math.sin(a);
        c.lineCap = 'round';
        c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = R * 0.012;
        c.beginPath(); c.moveTo(cx * R * 0.485 + R * 0.004, sy * R * 0.485 + R * 0.004); c.lineTo(cx * R * 0.6 + R * 0.004, sy * R * 0.6 + R * 0.004); c.stroke();
        const lg = c.createLinearGradient(cx * R * 0.48, sy * R * 0.48, cx * R * 0.6, sy * R * 0.6);
        lg.addColorStop(0, '#8d8d8d'); lg.addColorStop(0.5, '#ffffff'); lg.addColorStop(1, '#b5b5b5');
        c.strokeStyle = lg; c.lineWidth = R * 0.008;
        c.beginPath(); c.moveTo(cx * R * 0.485, sy * R * 0.485); c.lineTo(cx * R * 0.6, sy * R * 0.6); c.stroke();
        // dünne Goldtrennung im Zahlenring
        c.strokeStyle = 'rgba(230,200,120,0.65)'; c.lineWidth = R * 0.003;
        c.beginPath(); c.moveTo(cx * R * 0.6, sy * R * 0.6); c.lineTo(cx * R * 0.745, sy * R * 0.745); c.stroke();
      }
      // Zahlen
      c.fillStyle = '#fbf7ea';
      c.font = `700 ${Math.round(R * 0.068)}px Georgia, "Times New Roman", serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = R * 0.006;
      for (let i = 0; i < 37; i++) {
        c.save(); c.rotate(-Math.PI / 2 + i * STEP + Math.PI / 2); c.translate(0, -R * 0.675);
        c.fillText(String(WHEEL[i]), 0, 0); c.restore();
      }
      c.shadowColor = 'transparent';
      ring(c, R * 0.745, R * 0.012, brass(c, R * 0.73, R * 0.76, 1.1));
      ring(c, R * 0.6, R * 0.007, brass(c, R * 0.59, R * 0.61, 2.2));
      ring(c, R * 0.483, R * 0.014, brass(c, R * 0.47, R * 0.5, 0.2));

      // Konus (Holz mit radialer Maserung)
      g = c.createRadialGradient(-R * 0.08, -R * 0.1, R * 0.05, 0, 0, R * 0.48);
      g.addColorStop(0, '#b66a35'); g.addColorStop(0.5, '#7a3a16'); g.addColorStop(1, '#3a1606');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, R * 0.476, 0, TAU); c.fill();
      c.save(); c.beginPath(); c.arc(0, 0, R * 0.47, 0, TAU); c.clip();
      for (let i = 0; i < 160; i++) {
        const a = rand() * TAU;
        c.strokeStyle = rand() < 0.5 ? `rgba(30,10,2,${0.06 + rand() * 0.14})` : `rgba(255,190,120,${0.03 + rand() * 0.06})`;
        c.lineWidth = R * (0.002 + rand() * 0.004);
        c.beginPath(); c.moveTo(Math.cos(a) * R * 0.12, Math.sin(a) * R * 0.12); c.lineTo(Math.cos(a) * R * 0.47, Math.sin(a) * R * 0.47); c.stroke();
      }
      c.restore();
      // Messing-Sterne auf dem Konus
      c.fillStyle = brass(c, 0, R * 0.4, 0.8);
      for (let k = 0; k < 8; k++) {
        const a = (k * TAU) / 8 + TAU / 16;
        c.save(); c.rotate(a); c.translate(0, -R * 0.4);
        c.beginPath(); c.moveTo(0, -R * 0.025); c.lineTo(R * 0.01, 0); c.lineTo(0, R * 0.025); c.lineTo(-R * 0.01, 0); c.closePath(); c.fill();
        c.restore();
      }
      // Drehkreuz
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        const ex = Math.cos(a) * R * 0.33, ey = Math.sin(a) * R * 0.33;
        c.lineCap = 'round';
        c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = R * 0.034;
        c.beginPath(); c.moveTo(R * 0.01, R * 0.012); c.lineTo(ex + R * 0.01, ey + R * 0.012); c.stroke();
        const lg = c.createLinearGradient(-Math.sin(a) * R * 0.02, Math.cos(a) * R * 0.02, Math.sin(a) * R * 0.02, -Math.cos(a) * R * 0.02);
        lg.addColorStop(0, '#7a5a18'); lg.addColorStop(0.5, '#fff0b8'); lg.addColorStop(1, '#8f6c22');
        c.strokeStyle = lg; c.lineWidth = R * 0.026;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(ex, ey); c.stroke();
        const bg = c.createRadialGradient(ex - R * 0.012, ey - R * 0.012, 0, ex, ey, R * 0.04);
        bg.addColorStop(0, '#fff6d0'); bg.addColorStop(0.5, '#d8b252'); bg.addColorStop(1, '#6e5016');
        c.fillStyle = bg; c.beginPath(); c.arc(ex, ey, R * 0.038, 0, TAU); c.fill();
      }
      // Mittelkuppel
      c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.arc(R * 0.012, R * 0.015, R * 0.115, 0, TAU); c.fill();
      c.fillStyle = brass(c, 0, R * 0.11, 0.3); c.beginPath(); c.arc(0, 0, R * 0.11, 0, TAU); c.fill();
      g = c.createRadialGradient(-R * 0.035, -R * 0.04, 0, 0, 0, R * 0.075);
      g.addColorStop(0, '#fffbe6'); g.addColorStop(0.45, '#e2c066'); g.addColorStop(1, '#7c5c1a');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, R * 0.072, 0, TAU); c.fill();
    }

    function resize(px) {
      px = Math.max(80, Math.floor(px));
      if (px === size) return;
      size = px;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.height = Math.round(size * dpr);
      canvas.style.width = canvas.style.height = size + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    // angle: Drehung des Kessels; ball: {angle, radius (Anteil von R)} oder null
    function draw(angle, ball) {
      if (!size) return;
      const R = size / 2;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(R, R);
      // Schlagschatten auf den Tisch
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = R * 0.09; ctx.shadowOffsetX = R * 0.025; ctx.shadowOffsetY = R * 0.045;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.965, 0, TAU); ctx.fillStyle = '#1a0a03'; ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.save(); ctx.rotate(angle); ctx.drawImage(off, -R, -R, size, size); ctx.restore();

      // feststehende Messing-Rauten (Deflektoren) auf der Kugelbahn
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + Math.PI / 8;
        ctx.save(); ctx.rotate(a); ctx.translate(0, -R * 0.805);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.moveTo(R * 0.006, -R * 0.03); ctx.lineTo(R * 0.02, R * 0.006); ctx.lineTo(R * 0.006, R * 0.04); ctx.lineTo(-R * 0.008, R * 0.006); ctx.closePath(); ctx.fill();
        const dg = ctx.createLinearGradient(-R * 0.014, 0, R * 0.014, 0);
        dg.addColorStop(0, '#7a5a18'); dg.addColorStop(0.45, '#fff0b8'); dg.addColorStop(1, '#a37b26');
        ctx.fillStyle = dg;
        ctx.beginPath(); ctx.moveTo(0, -R * 0.034); ctx.lineTo(R * 0.014, 0); ctx.lineTo(0, R * 0.034); ctx.lineTo(-R * 0.014, 0); ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      if (ball) {
        const bx = Math.cos(ball.angle) * R * ball.radius;
        const by = Math.sin(ball.angle) * R * ball.radius;
        const br = R * 0.03;
        const sg = ctx.createRadialGradient(bx + br * 0.5, by + br * 0.7, 0, bx + br * 0.5, by + br * 0.7, br * 1.6);
        sg.addColorStop(0, 'rgba(0,0,0,0.65)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(bx + br * 0.5, by + br * 0.7, br * 1.6, 0, TAU); ctx.fill();
        const g = ctx.createRadialGradient(bx - br * 0.4, by - br * 0.45, br * 0.05, bx, by, br);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#f4f2ec'); g.addColorStop(0.8, '#c9c6bd'); g.addColorStop(1, '#8e8b84');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.fill();
      }

      // Licht von oben (Deckenlampe) + Lack-Reflex
      let gl = ctx.createRadialGradient(-R * 0.35, -R * 0.45, 0, -R * 0.2, -R * 0.25, R * 1.25);
      gl.addColorStop(0, 'rgba(255,240,210,0.22)'); gl.addColorStop(0.45, 'rgba(255,240,210,0.04)'); gl.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, R * 0.995, 0, TAU); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R * 0.99, 0, TAU); ctx.arc(0, 0, R * 0.88, 0, TAU, true); ctx.clip();
      gl = ctx.createLinearGradient(-R, -R, R * 0.2, R * 0.2);
      gl.addColorStop(0, 'rgba(255,255,255,0.22)'); gl.addColorStop(0.35, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl; ctx.fillRect(-R, -R, size, size);
      ctx.restore();
      ctx.restore();
    }

    return { resize, draw };
  }

  // Berechnet Kessel- und Kugelposition aus dem Spielzustand (für alle Geräte gleich)
  const OMEGA = 0.22; // rad/s Leerlauf
  let offset = 0;
  let lastSpin = null;
  function track(spin) {
    if (lastSpin && (!spin || spin.start !== lastSpin.start)) offset += lastSpin.extra;
    lastSpin = spin || null;
  }
  function pose(spin, now) {
    let W = ((OMEGA * now) / 1000) % TAU + offset;
    if (!spin) return { angle: W, ball: null, t: 0 };
    const t = Math.min(1, Math.max(0, (now - spin.start) / spin.duration));
    W += spin.extra * (1 - Math.pow(1 - t, 3));
    const idx = WHEEL.indexOf(spin.result);
    const eb = 1 - Math.pow(1 - t, 2.2);
    const rel = -Math.PI / 2 + idx * STEP + spin.turns * TAU * (1 - eb);
    let r;
    if (t < 0.6) r = 0.81;
    else if (t < 0.85) {
      const u = (t - 0.6) / 0.25;
      r = 0.81 - (0.81 - 0.54) * u * u + 0.035 * Math.sin(u * Math.PI * 3) * (1 - u);
    } else {
      const u = (t - 0.85) / 0.15;
      r = 0.54 + 0.02 * Math.abs(Math.sin(u * Math.PI * 4)) * (1 - u);
    }
    return { angle: W, ball: { angle: W + rel, radius: r }, t };
  }

  window.RWheel = { createWheel, track, pose };
})();
