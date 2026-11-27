// Gemeinsame Roulette-Regeln (Server + Browser): Kessel, Farben, alle Wettarten, Annoncen.
(function (root) {
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
    16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  const RED_SET = new Set(REDS);
  const color = (n) => (n === 0 ? 'green' : RED_SET.has(n) ? 'red' : 'black');
  const colorName = (n) => (n === 0 ? 'Grün' : RED_SET.has(n) ? 'Rot' : 'Schwarz');

  // Auszahlungsquoten wie im europäischen Roulette (x : 1)
  const ODDS = {
    straight: 35, split: 17, street: 11, trio: 11, corner: 8, four: 8, line: 5,
    column: 2, dozen: 2, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
  };

  const BETS = {};
  function add(type, nums, key) {
    nums = nums.slice().sort((a, b) => a - b);
    key = key || type + ':' + nums.join('-');
    BETS[key] = { key, type, nums, odds: ODDS[type] };
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

  for (let n = 0; n <= 36; n++) add('straight', [n]);
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) add('split', [n, n + 1]);
    if (n <= 33) add('split', [n, n + 3]);
  }
  [1, 2, 3].forEach((k) => add('split', [0, k]));
  for (let r = 0; r < 12; r++) add('street', range(3 * r + 1, 3 * r + 3));
  add('trio', [0, 1, 2]);
  add('trio', [0, 2, 3]);
  for (let n = 1; n <= 32; n++) if (n % 3 !== 0) add('corner', [n, n + 1, n + 3, n + 4]);
  add('four', [0, 1, 2, 3]);
  for (let r = 0; r < 11; r++) add('line', range(3 * r + 1, 3 * r + 6));
  for (let c = 0; c < 3; c++) add('column', range(1, 36).filter((n) => (n - 1) % 3 === c), 'column:' + (c + 1));
  for (let d = 0; d < 3; d++) add('dozen', range(12 * d + 1, 12 * d + 12), 'dozen:' + (d + 1));
  add('red', REDS, 'red');
  add('black', range(1, 36).filter((n) => !RED_SET.has(n)), 'black');
  add('odd', range(1, 36).filter((n) => n % 2 === 1), 'odd');
  add('even', range(1, 36).filter((n) => n % 2 === 0), 'even');
  add('low', range(1, 18), 'low');
  add('high', range(19, 36), 'high');

  function label(key) {
    const b = BETS[key];
    if (!b) return key;
    const j = b.nums.join('/');
    switch (b.type) {
      case 'straight': return 'Plein ' + b.nums[0];
      case 'split': return 'Cheval ' + j;
      case 'street': return 'Transversale pleine ' + b.nums[0] + '–' + b.nums[2];
      case 'trio': return 'Transversale ' + j;
      case 'corner': return 'Carré ' + j;
      case 'four': return 'Les quatre premiers 0–3';
      case 'line': return 'Transversale simple ' + b.nums[0] + '–' + b.nums[5];
      case 'column': return key.split(':')[1] + '. Kolonne';
      case 'dozen': {
        const d = Number(key.split(':')[1]);
        return d + '. Dutzend (' + (12 * d - 11) + '–' + 12 * d + ')';
      }
      case 'red': return 'Rouge (Rot)';
      case 'black': return 'Noir (Schwarz)';
      case 'odd': return 'Impair (Ungerade)';
      case 'even': return 'Pair (Gerade)';
      case 'low': return 'Manque (1–18)';
      case 'high': return 'Passe (19–36)';
    }
    return key;
  }

  // Kesselwetten / Annoncen (Anzahl Stücke = Anzahl Einträge)
  const ANNONCES = {
    voisins: {
      name: 'Voisins du Zéro',
      keys: ['trio:0-2-3', 'trio:0-2-3', 'split:4-7', 'split:12-15', 'split:18-21', 'split:19-22',
        'split:32-35', 'corner:25-26-28-29', 'corner:25-26-28-29'],
    },
    tiers: {
      name: 'Tiers du Cylindre',
      keys: ['split:5-8', 'split:10-11', 'split:13-16', 'split:23-24', 'split:27-30', 'split:33-36'],
    },
    orphelins: {
      name: 'Orphelins',
      keys: ['straight:1', 'split:6-9', 'split:14-17', 'split:17-20', 'split:31-34'],
    },
    zero: {
      name: 'Jeu Zéro',
      keys: ['split:0-3', 'split:12-15', 'split:32-35', 'straight:26'],
    },
  };

  function neighbours(n, k = 2) {
    const i = WHEEL.indexOf(n);
    const out = [];
    for (let d = -k; d <= k; d++) out.push('straight:' + WHEEL[(i + d + 37) % 37]);
    return out;
  }

  const api = { WHEEL, REDS, color, colorName, ODDS, BETS, label, ANNONCES, neighbours };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RShared = api;
})(typeof window !== 'undefined' ? window : globalThis);
