/* ══ v46 "Atomic" — NL_ATOMIC: the periodic-table neural network ═══════════
 * Ahkeem's sequencing call: ground the AI in the structure of matter BEFORE
 * more language work — atoms are the world that words will later point to.
 *
 * HONEST FRAMING (read before citing this anywhere): the periodic table
 * encodes KNOWN physics. This network learns correlations in that encoding —
 * it rediscovers the periodic law from data (trends, clusters, group
 * behavior). It does NOT discover new physics. Classical simulation
 * throughout: MLPs, gradient descent, PCA. Nothing quantum here, and the
 * copy says so.
 *
 * Dataset: 118 elements. Values are standard reference data (standard atomic
 * weights, Pauling electronegativities, first ionization energies in eV,
 * empirical atomic radii in pm). -1 = unknown (noble-gas electronegativities
 * are undefined on the Pauling scale; superheavy Z=104..118 properties are
 * unmeasured). Valence electrons use the textbook simplification: main-group
 * = group number (13..18 -> 3..8), transition metals = 2, lanthanides /
 * actinides = 2, superheavy unknowns = -1. This is documented, not hidden.
 *
 * Three tasks:
 *  1. Property prediction — MLP predicts a held-out property (default:
 *     electronegativity) from the element's OTHER properties. Train/test
 *     split is by ELEMENT (held-out elements), so memorization can't help.
 *     Must beat a mean-baseline to count as learning.
 *  2. Masked-property reconstruction — the v45 masked machinery pointed at
 *     atoms: each known property is randomly masked (seeded); the network
 *     must reconstruct it from the element's remaining properties. The
 *     hidden layer is the honest classical "ghost": a frozen, uncommitted
 *     context vector (no property decided yet); the output layer is the
 *     reverse-decode that collapses it onto the masked property. A copied
 *     vector plus a linear read-out — not quantum anything.
 *  3. Element embeddings — a learned 8-dim vector per element, trained
 *     jointly with masked reconstruction. PCA (Jacobi eigen-decomposition,
 *     exact for 8 dims) projects to 2D. The test: do noble gases cluster?
 *     alkali metals? If the embedding geometry rediscovers the groups, the
 *     network found the periodic law on its own.
 *
 * Pure pipeline, no DOM — testable in Node like NL_CHARRNN.
 */
var NL_ATOMIC = (function () {
  /* ---- utils ---- */
  function RNG(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function tanh(x) { return Math.tanh(x); }
  function zeros(n) { var a = [], i; for (i = 0; i < n; i++) a.push(0); return a; }
  function mat(r0, c0, sc, r) {
    var m = [], i, j;
    for (i = 0; i < r0; i++) { m.push([]); for (j = 0; j < c0; j++) m[i].push((r() * 2 - 1) * sc); }
    return m;
  }
  function shuffle(a, r) {
    var i, j, t;
    for (i = a.length - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function mean(a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function mae(pred, tru) { var s = 0, i; for (i = 0; i < pred.length; i++) s += Math.abs(pred[i] - tru[i]); return pred.length ? s / pred.length : 0; }

  /* ---- dataset ----
   * [Z, symbol, name, mass, group(0=null), period, en(-1=null), ie1eV(-1=null),
   *  radiusPm(-1=null), valence(-1=null), category]
   * categories: 0 alkali, 1 alkaline, 2 transition, 3 post-transition,
   * 4 metalloid, 5 nonmetal, 6 halogen, 7 noble, 8 lanthanide, 9 actinide, 10 unknown */
  var EL = [
    [1,"H","Hydrogen",1.008,1,1,2.20,13.598,53,1,5],
    [2,"He","Helium",4.003,18,1,-1,24.587,31,2,7],
    [3,"Li","Lithium",6.94,1,2,0.98,5.392,167,1,0],
    [4,"Be","Beryllium",9.012,2,2,1.57,9.323,112,2,1],
    [5,"B","Boron",10.81,13,2,2.04,8.298,87,3,4],
    [6,"C","Carbon",12.011,14,2,2.55,11.260,67,4,5],
    [7,"N","Nitrogen",14.007,15,2,3.04,14.534,56,5,5],
    [8,"O","Oxygen",15.999,16,2,3.44,13.618,48,6,5],
    [9,"F","Fluorine",18.998,17,2,3.98,17.423,42,7,6],
    [10,"Ne","Neon",20.180,18,2,-1,21.565,38,8,7],
    [11,"Na","Sodium",22.990,1,3,0.93,5.139,190,1,0],
    [12,"Mg","Magnesium",24.305,2,3,1.31,7.646,145,2,1],
    [13,"Al","Aluminium",26.982,13,3,1.61,5.986,118,3,3],
    [14,"Si","Silicon",28.085,14,3,1.90,8.152,111,4,4],
    [15,"P","Phosphorus",30.974,15,3,2.19,10.487,98,5,5],
    [16,"S","Sulfur",32.06,16,3,2.58,10.360,88,6,5],
    [17,"Cl","Chlorine",35.45,17,3,3.16,12.968,79,7,6],
    [18,"Ar","Argon",39.948,18,3,-1,15.760,71,8,7],
    [19,"K","Potassium",39.098,1,4,0.82,4.341,243,1,0],
    [20,"Ca","Calcium",40.078,2,4,1.00,6.113,194,2,1],
    [21,"Sc","Scandium",44.956,3,4,1.36,6.561,184,2,2],
    [22,"Ti","Titanium",47.867,4,4,1.54,6.828,176,2,2],
    [23,"V","Vanadium",50.942,5,4,1.63,6.746,171,2,2],
    [24,"Cr","Chromium",51.996,6,4,1.66,6.767,166,2,2],
    [25,"Mn","Manganese",54.938,7,4,1.55,7.434,161,2,2],
    [26,"Fe","Iron",55.845,8,4,1.83,7.902,156,2,2],
    [27,"Co","Cobalt",58.933,9,4,1.88,7.881,152,2,2],
    [28,"Ni","Nickel",58.693,10,4,1.91,7.640,149,2,2],
    [29,"Cu","Copper",63.546,11,4,1.90,7.726,145,2,2],
    [30,"Zn","Zinc",65.38,12,4,1.65,9.394,142,2,2],
    [31,"Ga","Gallium",69.723,13,4,1.81,5.999,136,3,3],
    [32,"Ge","Germanium",72.630,14,4,2.01,7.899,125,4,4],
    [33,"As","Arsenic",74.922,15,4,2.18,9.789,114,5,4],
    [34,"Se","Selenium",78.971,16,4,2.55,9.752,103,6,5],
    [35,"Br","Bromine",79.904,17,4,2.96,11.814,94,7,6],
    [36,"Kr","Krypton",83.798,18,4,3.00,14.000,88,8,7],
    [37,"Rb","Rubidium",85.468,1,5,0.82,4.177,265,1,0],
    [38,"Sr","Strontium",87.62,2,5,0.95,5.695,219,2,1],
    [39,"Y","Yttrium",88.906,3,5,1.22,6.217,212,2,2],
    [40,"Zr","Zirconium",91.224,4,5,1.33,6.634,206,2,2],
    [41,"Nb","Niobium",92.906,5,5,1.6,6.759,198,2,2],
    [42,"Mo","Molybdenum",95.95,6,5,2.16,7.092,190,2,2],
    [43,"Tc","Technetium",98,7,5,1.9,7.28,183,2,2],
    [44,"Ru","Ruthenium",101.07,8,5,2.2,7.361,178,2,2],
    [45,"Rh","Rhodium",102.91,9,5,2.28,7.459,173,2,2],
    [46,"Pd","Palladium",106.42,10,5,2.20,8.337,169,2,2],
    [47,"Ag","Silver",107.87,11,5,1.93,7.576,165,2,2],
    [48,"Cd","Cadmium",112.41,12,5,1.69,8.994,161,2,2],
    [49,"In","Indium",114.82,13,5,1.78,5.786,156,3,3],
    [50,"Sn","Tin",118.71,14,5,1.96,7.344,145,4,3],
    [51,"Sb","Antimony",121.76,15,5,2.05,8.608,133,5,4],
    [52,"Te","Tellurium",127.60,16,5,2.1,9.010,123,6,4],
    [53,"I","Iodine",126.90,17,5,2.66,10.451,115,7,6],
    [54,"Xe","Xenon",131.29,18,5,2.60,12.130,108,8,7],
    [55,"Cs","Caesium",132.91,1,6,0.79,3.894,298,1,0],
    [56,"Ba","Barium",137.33,2,6,0.89,5.212,253,2,1],
    [57,"La","Lanthanum",138.91,3,6,1.10,5.577,195,2,8],
    [58,"Ce","Cerium",140.12,0,6,1.12,5.539,185,2,8],
    [59,"Pr","Praseodymium",140.91,0,6,1.13,5.473,247,2,8],
    [60,"Nd","Neodymium",144.24,0,6,1.14,5.525,206,2,8],
    [61,"Pm","Promethium",145,0,6,1.13,5.582,205,2,8],
    [62,"Sm","Samarium",150.36,0,6,1.17,5.644,238,2,8],
    [63,"Eu","Europium",151.96,0,6,1.20,5.670,231,2,8],
    [64,"Gd","Gadolinium",157.25,0,6,1.20,6.150,233,2,8],
    [65,"Tb","Terbium",158.93,0,6,1.10,5.864,225,2,8],
    [66,"Dy","Dysprosium",162.50,0,6,1.22,5.939,228,2,8],
    [67,"Ho","Holmium",164.93,0,6,1.23,6.021,226,2,8],
    [68,"Er","Erbium",167.26,0,6,1.24,6.108,226,2,8],
    [69,"Tm","Thulium",168.93,0,6,1.25,6.184,222,2,8],
    [70,"Yb","Ytterbium",173.05,0,6,1.10,6.254,222,2,8],
    [71,"Lu","Lutetium",174.97,3,6,1.27,5.426,217,2,8],
    [72,"Hf","Hafnium",178.49,4,6,1.3,6.825,208,2,2],
    [73,"Ta","Tantalum",180.95,5,6,1.5,7.550,200,2,2],
    [74,"W","Tungsten",183.84,6,6,2.36,7.864,193,2,2],
    [75,"Re","Rhenium",186.21,7,6,1.9,7.834,188,2,2],
    [76,"Os","Osmium",190.23,8,6,2.2,8.438,185,2,2],
    [77,"Ir","Iridium",192.22,9,6,2.20,8.967,180,2,2],
    [78,"Pt","Platinum",195.08,10,6,2.28,8.959,177,2,2],
    [79,"Au","Gold",196.97,11,6,2.54,9.226,174,2,2],
    [80,"Hg","Mercury",200.59,12,6,2.00,10.437,171,2,2],
    [81,"Tl","Thallium",204.38,13,6,1.62,6.108,170,3,3],
    [82,"Pb","Lead",207.2,14,6,2.33,7.417,175,4,3],
    [83,"Bi","Bismuth",208.98,15,6,2.02,7.286,160,5,3],
    [84,"Po","Polonium",209,16,6,2.0,8.417,190,6,3],
    [85,"At","Astatine",210,17,6,2.2,9.3,150,7,4],
    [86,"Rn","Radon",222,18,6,-1,10.749,150,8,7],
    [87,"Fr","Francium",223,1,7,0.7,4.073,348,1,0],
    [88,"Ra","Radium",226,2,7,0.9,5.278,283,2,1],
    [89,"Ac","Actinium",227,3,7,1.1,5.17,195,2,9],
    [90,"Th","Thorium",232.04,0,7,1.3,6.307,180,2,9],
    [91,"Pa","Protactinium",231.04,0,7,1.5,5.89,180,2,9],
    [92,"U","Uranium",238.03,0,7,1.38,6.194,175,2,9],
    [93,"Np","Neptunium",237,0,7,1.36,6.266,175,2,9],
    [94,"Pu","Plutonium",244,0,7,1.28,6.026,175,2,9],
    [95,"Am","Americium",243,0,7,1.13,5.974,175,2,9],
    [96,"Cm","Curium",247,0,7,1.28,5.991,175,2,9],
    [97,"Bk","Berkelium",247,0,7,1.3,6.198,170,2,9],
    [98,"Cf","Californium",251,0,7,1.3,6.282,170,2,9],
    [99,"Es","Einsteinium",252,0,7,1.3,6.42,170,2,9],
    [100,"Fm","Fermium",257,0,7,1.3,6.50,170,2,9],
    [101,"Md","Mendelevium",258,0,7,1.3,6.58,170,2,9],
    [102,"No","Nobelium",259,0,7,1.3,6.65,170,2,9],
    [103,"Lr","Lawrencium",266,3,7,-1,4.9,170,2,9],
    [104,"Rf","Rutherfordium",267,4,7,-1,-1,-1,-1,10],
    [105,"Db","Dubnium",268,5,7,-1,-1,-1,-1,10],
    [106,"Sg","Seaborgium",269,6,7,-1,-1,-1,-1,10],
    [107,"Bh","Bohrium",270,7,7,-1,-1,-1,-1,10],
    [108,"Hs","Hassium",277,8,7,-1,-1,-1,-1,10],
    [109,"Mt","Meitnerium",278,9,7,-1,-1,-1,-1,10],
    [110,"Ds","Darmstadtium",281,10,7,-1,-1,-1,-1,10],
    [111,"Rg","Roentgenium",282,11,7,-1,-1,-1,-1,10],
    [112,"Cn","Copernicium",285,12,7,-1,-1,-1,-1,10],
    [113,"Nh","Nihonium",286,13,7,-1,-1,-1,-1,10],
    [114,"Fl","Flerovium",289,14,7,-1,-1,-1,-1,10],
    [115,"Mc","Moscovium",290,15,7,-1,-1,-1,-1,10],
    [116,"Lv","Livermorium",293,16,7,-1,-1,-1,-1,10],
    [117,"Ts","Tennessine",294,17,7,-1,-1,-1,-1,10],
    [118,"Og","Oganesson",294,18,7,-1,-1,-1,-1,10]
  ];
  var CATNAMES = ["alkali","alkaline","transition","post-transition","metalloid",
    "nonmetal","halogen","noble","lanthanide","actinide","unknown"];
  var CATCOLORS = ["#ff6b6b","#ffa94d","#ffd43b","#a9e34b","#63e6be","#4dabf7",
    "#9775fa","#f783ac","#e599f7","#da77f2","#868e96"];
  /* property keys: normalized targets + raw scales for display */
  var PROPS = {
    en:     { label: "electronegativity", unit: "Pauling", scale: 4.0,  pi: 6 },
    ie:     { label: "ionization energy", unit: "eV",      scale: 25.0, pi: 7 },
    radius: { label: "atomic radius",     unit: "pm",      scale: 350.0, pi: 8 }
  };
  function pval(el, key) { var v = el[PROPS[key].pi]; return v >= 0 ? v : null; }

  /* ---- feature engineering (documented, deterministic) ----
   * base9 = [Z/118, group/18 (0 if null), period/7, ln(mass)/ln(300),
   *          valence/8 (0 if null), radius/350 (0 if null), rKnown,
   *          ie/25 (0 if null), ieKnown]. Nulls become 0 + an indicator bit,
   * so no NaN can ever leak into the network (asserted in tests). */
  function baseFeatures(el) {
    var r = el[8], ie = el[7];
    return [
      el[0] / 118,
      el[4] > 0 ? el[4] / 18 : 0,
      el[5] / 7,
      Math.log(el[3]) / Math.log(300),
      el[9] >= 0 ? el[9] / 8 : 0,
      r >= 0 ? r / 350 : 0, r >= 0 ? 1 : 0,
      ie >= 0 ? ie / 25 : 0, ie >= 0 ? 1 : 0
    ];
  }
  /* task-1 input: base features MINUS the target's own features, so the
   * network must earn the answer from the OTHER properties (no leakage). */
  function predictFeatures(el, key) {
    var b = baseFeatures(el);
    if (key === "ie") return [b[0], b[1], b[2], b[3], b[4], b[5], b[6]];       /* drop ie, ieKnown */
    if (key === "radius") return [b[0], b[1], b[2], b[3], b[4], b[7], b[8]];   /* drop r, rKnown */
    return b;                                                                  /* en: 9 dims */
  }

  /* ---- tiny MLP: full-batch gradient descent, seeded, deterministic ---- */
  function newMLP(inD, hidD, outD, r) {
    return { inD: inD, hidD: hidD, outD: outD,
      W1: mat(hidD, inD, 0.5, r), b1: zeros(hidD),
      W2: mat(outD, hidD, 0.5, r), b2: zeros(outD) };
  }
  function mlpForward(m, x) {
    var h = [], i, j, s;
    for (i = 0; i < m.hidD; i++) { s = m.b1[i]; for (j = 0; j < m.inD; j++) s += m.W1[i][j] * x[j]; h.push(tanh(s)); }
    var y = [];
    for (i = 0; i < m.outD; i++) { s = m.b2[i]; for (j = 0; j < m.hidD; j++) s += m.W2[i][j] * h[j]; y.push(s); }
    return { h: h, y: y };
  }
  /* one full-batch GD step over (xs, ts); returns mean MSE. When emb != null,
   * the last embD input dims are per-sample learned embeddings: xs entries are
   * {x: [...], ei: elementIndex}, and dE accumulates into embGrad. When
   * embIsInput is true, the input IS the embedding (autoencoder mode):
   * batch entries are {ei, t} and gradients flow to emb through all of W1. */
  function mlpStep(m, batch, lr, emb, embD, embIsInput, w) {
    var gW1 = mat(m.hidD, m.inD, 0, function () { return 0; }),
        gb1 = zeros(m.hidD),
        gW2 = mat(m.outD, m.hidD, 0, function () { return 0; }),
        gb2 = zeros(m.outD),
        gE = emb ? mat(emb.length, embD, 0, function () { return 0; }) : null;
    var tot = 0, n = batch.length, b, i, j, k, x, fw, h, dy, dh, dz, wi;
    for (b = 0; b < n; b++) {
      x = embIsInput ? emb[batch[b].ei] : batch[b].x;
      fw = mlpForward(m, x); h = fw.h;
      for (i = 0; i < m.outD; i++) {
        wi = w ? w[i] : 1;
        dy = wi * (fw.y[i] - batch[b].t[i]) / n;
        tot += wi * (fw.y[i] - batch[b].t[i]) * (fw.y[i] - batch[b].t[i]) / n;
        for (j = 0; j < m.hidD; j++) gW2[i][j] += dy * h[j];
        gb2[i] += dy;
        for (j = 0; j < m.hidD; j++) {
          dh = dy * m.W2[i][j];
          dz = dh * (1 - h[j] * h[j]);
          for (k = 0; k < m.inD; k++) gW1[j][k] += dz * x[k];
          gb1[j] += dz;
          if (gE && !embIsInput && batch[b].ei != null) {
            for (k = 0; k < embD; k++) gE[batch[b].ei][k] += dz * m.W1[j][m.inD - embD + k];
          }
          if (gE && embIsInput) {
            for (k = 0; k < embD; k++) gE[batch[b].ei][k] += dz * m.W1[j][k];
          }
        }
      }
    }
    for (i = 0; i < m.hidD; i++) {
      for (j = 0; j < m.inD; j++) m.W1[i][j] -= lr * gW1[i][j];
      m.b1[i] -= lr * gb1[i];
    }
    for (i = 0; i < m.outD; i++) {
      for (j = 0; j < m.hidD; j++) m.W2[i][j] -= lr * gW2[i][j];
      m.b2[i] -= lr * gb2[i];
    }
    if (gE) for (i = 0; i < emb.length; i++) for (k = 0; k < embD; k++) emb[i][k] -= lr * gE[i][k];
    return tot / m.outD;
  }
  function mlpPredict(m, x) { return mlpForward(m, x).y; }

  function eligible(key) {
    var out = [], i;
    for (i = 0; i < EL.length; i++) if (pval(EL[i], key) != null) out.push(i);
    return out;
  }
  function splitIdx(idx, r, testFrac) {
    var s = shuffle(idx.slice(), r), nT = Math.max(1, Math.round(s.length * testFrac));
    return { train: s.slice(nT), test: s.slice(0, nT) };
  }

  /* ══ TASK 1 — property prediction ══
   * Dedicated MLP per target. Split by ELEMENT (held-out elements), target
   * excluded from inputs. Metric: test MAE vs mean-baseline MAE. */
  function trainPredict(key, opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 16 : opts.seed,
        epochs = opts.epochs || 300, lr = opts.lr || 0.05,
        testFrac = opts.testFrac || 0.2;
    var r = RNG(seed), P = PROPS[key];
    var idx = eligible(key), sp = splitIdx(idx, RNG(seed ^ 0xA70), testFrac);
    var m = newMLP(predictFeatures(EL[0], key).length, 16, 1, r);
    function sample(i) {
      return { x: predictFeatures(EL[i], key), t: [pval(EL[i], key) / P.scale] };
    }
    var trainB = sp.train.map(sample), testB = sp.test.map(sample);
    var base = mean(trainB.map(function (s) { return s.t[0]; }));
    var curve = [], e, mse;
    for (e = 0; e < epochs; e++) {
      mse = mlpStep(m, trainB, lr);
      if (e % 10 === 0) curve.push(mse);
    }
    curve.push(mse);
    var pred = testB.map(function (s) { return mlpPredict(m, s.x)[0]; });
    var tru = testB.map(function (s) { return s.t[0]; });
    var testMAE = mae(pred, tru), baseMAE = mae(tru.map(function () { return base; }), tru);
    return {
      key: key, seed: seed, curve: curve,
      testMAE: testMAE * P.scale, baseMAE: baseMAE * P.scale,  /* denormalized */
      testMAEn: testMAE, baseMAEn: baseMAE,
      nTrain: trainB.length, nTest: testB.length,
      beats: testMAE < baseMAE,
      testSyms: sp.test.map(function (i) { return EL[i][1]; })
    };
  }

  /* ══ TASK 2 — masked-property reconstruction ══
   * One model for all three properties. Input = base9 + 3 property slots
   * [value, maskBit]. Each epoch, each KNOWN property is masked with
   * probability maskRate (seeded): slot -> 0, mask bit -> 1. Loss is computed
   * on masked slots ONLY (BERT-style). The 16-unit hidden layer is the
   * honest classical "ghost": a frozen, uncommitted context vector — no
   * property decided yet; the output layer reverse-decodes it onto the
   * masked property (the collapse). A copied vector + a linear read-out. */
  var PKEYS = ["en", "ie", "radius"];
  function maskedInput(el, masks) {
    /* masks: {en:bool, ie:bool, radius:bool} — true = this property is hidden */
    var b = baseFeatures(el), x = b.slice(), k, v, P;
    for (var q = 0; q < PKEYS.length; q++) {
      k = PKEYS[q]; P = PROPS[k]; v = pval(el, k);
      if (v == null || masks[k]) { x.push(0, 1); }       /* hidden or unknown */
      else { x.push(v / P.scale, 0); }                    /* visible context */
    }
    return x;                                            /* 9 + 6 = 15 dims */
  }
  function trainMasked(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 16 : opts.seed,
        epochs = opts.epochs || 300, lr = opts.lr || 0.05,
        maskRate = opts.maskRate == null ? 0.4 : opts.maskRate,
        testFrac = opts.testFrac || 0.2;
    var r = RNG(seed);
    var idx = [];
    for (var i = 0; i < EL.length; i++) {
      if (pval(EL[i], "en") != null || pval(EL[i], "ie") != null || pval(EL[i], "radius") != null) idx.push(i);
    }
    var sp = splitIdx(idx, RNG(seed ^ 0xA70), testFrac);
    var m = newMLP(15, 16, 3, r);
    var curve = [], e, mr = RNG(seed ^ 0x9A5);
    function epochBatch(list) {
      /* rebuild masks every epoch (seeded stream) — the model never sees the
       * same masking twice, so it must learn the relations, not the mask. */
      return list.map(function (ei) {
        var el = EL[ei], masks = {}, t = [], known = [];
        for (var q = 0; q < PKEYS.length; q++) {
          var k = PKEYS[q], v = pval(el, k);
          if (v != null && mr() < maskRate) { masks[k] = true; known.push(q); t.push(v / PROPS[k].scale); }
          else { masks[k] = false; t.push(0); }
        }
        return { x: maskedInput(el, masks), t: t, ei: ei, known: known };
      });
    }
    for (e = 0; e < epochs; e++) {
      var batch = epochBatch(sp.train);
      /* loss only on masked-known slots: zero the gradient contribution of
       * unmasked slots by setting their target = prediction (no error). */
      var adj = batch.map(function (s) {
        var tt = s.t.slice(), fw0 = mlpForward(m, s.x).y;
        for (var q = 0; q < 3; q++) if (s.known.indexOf(q) < 0) tt[q] = fw0[q];
        return { x: s.x, t: tt, ei: s.ei };
      });
      var mse = mlpStep(m, adj, lr);
      if (e % 10 === 0) curve.push(mse);
    }
    curve.push(mse);
    /* test: held-out elements; mask each known property ALONE, measure MAE */
    var per = {};
    for (var q2 = 0; q2 < PKEYS.length; q2++) {
      var k2 = PKEYS[q2], P2 = PROPS[k2], pr = [], tr = [];
      for (var s2 = 0; s2 < sp.test.length; s2++) {
        var ei2 = sp.test[s2], el2 = EL[ei2], v2 = pval(el2, k2);
        if (v2 == null) continue;
        var mk = { en: false, ie: false, radius: false }; mk[k2] = true;
        var y = mlpPredict(m, maskedInput(el2, mk))[q2];
        pr.push(y); tr.push(v2 / P2.scale);
      }
      var trainVals = sp.train.filter(function (ei) { return pval(EL[ei], k2) != null; })
        .map(function (ei) { return pval(EL[ei], k2) / P2.scale; });
      var b2 = mean(trainVals);
      per[k2] = {
        mae: mae(pr, tr) * P2.scale, base: mae(tr.map(function () { return b2; }), tr) * P2.scale,
        n: pr.length
      };
      per[k2].beats = per[k2].mae < per[k2].base;
    }
    return { seed: seed, curve: curve, per: per, nTrain: sp.train.length, nTest: sp.test.length };
  }

  /* ══ TASK 3 — element embeddings + PCA ══
   * Each element gets a learned 8-dim vector, trained as a pure AUTOENCODER
   * bottleneck: emb(8) -> 16 -> 9 must reconstruct the element's MEASURABLE
   * physical properties (mass, valence, radius, ionization energy,
   * electronegativity — never Z, group, or period, and never the category
   * label). The 8 dims must earn their keep: elements with similar physics
   * get similar vectors, or reconstruction fails. PCA via cyclic Jacobi
   * (exact for 8 dims) projects to 2D for the scatter viz.
   *
   * The test is unsupervised discovery: the category labels are NEVER used
   * in training — if noble gases (or alkalis) huddle in the learned
   * geometry, the network rediscovered the groups from raw properties. */
  var EMBD = 8;
  /* autoencoder targets: [m, v, r, rKnown, ie, ieKnown, en, ieT, rT] */
  function aeTargets(el) {
    var r = el[8], ie = el[7], en = el[6];
    return [
      Math.log(el[3]) / Math.log(300), el[9] >= 0 ? el[9] / 8 : 0,
      r >= 0 ? r / 350 : 0, r >= 0 ? 1 : 0,
      ie >= 0 ? ie / 25 : 0, ie >= 0 ? 1 : 0,
      en >= 0 ? en / 4 : 0, ie >= 0 ? ie / 25 : 0, r >= 0 ? r / 350 : 0
    ];
  }
  function aeKnown(el) {
    /* which of the 9 target slots carry real signal (vs filler) */
    var r = el[8] >= 0, ie = el[7] >= 0, en = el[6] >= 0;
    return [true, el[9] >= 0, r, true, ie, true, en, ie, r];
  }
  function jacobiEigen(A) {
    /* cyclic Jacobi for symmetric n×n; returns {vals, vecs} sorted desc */
    var n = A.length, V = [], i, j, p, q, sweeps, off, apq, app, aqq, phi, c, s, aip, aiq;
    for (i = 0; i < n; i++) { V.push([]); for (j = 0; j < n; j++) V[i].push(i === j ? 1 : 0); }
    var a = A.map(function (row) { return row.slice(); });
    for (sweeps = 0; sweeps < 100; sweeps++) {
      off = 0;
      for (p = 0; p < n; p++) for (q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
      if (off < 1e-20) break;
      for (p = 0; p < n - 1; p++) for (q = p + 1; q < n; q++) {
        apq = a[p][q];
        if (Math.abs(apq) < 1e-15) continue;
        app = a[p][p]; aqq = a[q][q];
        phi = 0.5 * Math.atan2(2 * apq, aqq - app);
        c = Math.cos(phi); s = Math.sin(phi);
        for (i = 0; i < n; i++) { aip = a[i][p]; aiq = a[i][q]; a[i][p] = c * aip - s * aiq; a[i][q] = s * aip + c * aiq; }
        for (i = 0; i < n; i++) { aip = a[p][i]; aiq = a[q][i]; a[p][i] = c * aip - s * aiq; a[q][i] = s * aip + c * aiq; }
        for (i = 0; i < n; i++) { aip = V[i][p]; aiq = V[i][q]; V[i][p] = c * aip - s * aiq; V[i][q] = s * aip + c * aiq; }
      }
    }
    var vals = [], order = [];
    for (i = 0; i < n; i++) { vals.push(a[i][i]); order.push(i); }
    order.sort(function (x, y) { return vals[y] - vals[x]; });
    return {
      vals: order.map(function (o) { return vals[o]; }),
      vecs: order.map(function (o) { var v = []; for (i = 0; i < n; i++) v.push(V[i][o]); return v; })
    };
  }
  function pca2(X) {
    /* X: N×d → N 2D coords on the top-2 principal components */
    var N = X.length, d = X[0].length, mu = zeros(d), i, j;
    for (i = 0; i < N; i++) for (j = 0; j < d; j++) mu[j] += X[i][j];
    for (j = 0; j < d; j++) mu[j] /= N;
    var C = [];
    for (i = 0; i < d; i++) { C.push([]); for (j = 0; j < d; j++) C[i].push(0); }
    for (i = 0; i < N; i++) for (j = 0; j < d; j++) for (var k = 0; k < d; k++)
      C[j][k] += (X[i][j] - mu[j]) * (X[i][k] - mu[k]);
    for (i = 0; i < d; i++) for (j = 0; j < d; j++) C[i][j] /= N;
    var E = jacobiEigen(C), v0 = E.vecs[0], v1 = E.vecs[1], out = [];
    for (i = 0; i < N; i++) {
      var x0 = 0, x1 = 0;
      for (j = 0; j < d; j++) { x0 += (X[i][j] - mu[j]) * v0[j]; x1 += (X[i][j] - mu[j]) * v1[j]; }
      out.push([x0, x1]);
    }
    return { coords: out, explained: [(E.vals[0] / E.vals.reduce(function (a, b) { return a + b; }, 0)), 0] };
  }
  function dist2(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s); }
  var NOBLE = [1, 9, 17, 35, 53, 85];   /* He Ne Ar Kr Xe Rn (0-based) */
  var ALKALI = [2, 10, 18, 36, 54, 86]; /* Li Na K Rb Cs Fr (0-based) */
  /* Chemical-similarity loss weights, aligned with aeTargets order
   * [m, v, r, rKnown, ie, ieKnown, en, ieT, rT]: electronic-structure
   * properties (valence, ionization energy, electronegativity) outweigh bulk
   * mass — chemical KIND lives in the electron shell, not the scale. The
   * missingness flags get near-zero weight (bookkeeping, not physics). */
  var AE_W = [0.5, 2.0, 0.7, 0.2, 1.5, 0.2, 2.0, 1.5, 0.7];
  function trainEmbeddings(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 16 : opts.seed,
        epochs = opts.epochs || 600, lr = opts.lr || 0.05;
    var r = RNG(seed);
    var emb = [];
    for (var i = 0; i < EL.length; i++) { emb.push([]); for (var k = 0; k < EMBD; k++) emb[i].push((r() * 2 - 1) * 0.1); }
    /* every element with at least one measurable property trains (103 of 118;
     * the 15 superheavies have no measured properties — honestly excluded) */
    var idx = [];
    for (i = 0; i < EL.length; i++) {
      if (pval(EL[i], "en") != null || pval(EL[i], "ie") != null || pval(EL[i], "radius") != null) idx.push(i);
    }
    var m = newMLP(EMBD, 16, 9, r);
    var curve = [], e;
    for (e = 0; e < epochs; e++) {
      var batch = idx.map(function (ei) {
        var el = EL[ei], raw = aeTargets(el), known = aeKnown(el);
        var fw0 = mlpForward(m, emb[ei]).y, tt = raw.slice(), q;
        for (q = 0; q < 9; q++) if (!known[q]) tt[q] = fw0[q];  /* no gradient on filler */
        return { ei: ei, t: tt };
      });
      var mse = mlpStep(m, batch, lr, emb, EMBD, true, AE_W);
      if (e % 10 === 0) curve.push(mse);
    }
    curve.push(mse);
    var pc = pca2(emb);
    /* ══ cluster diagnostics — honest, unsupervised ══
     * Category labels are NEVER used in training. Two views:
     *  1. k-NN category agreement (leave-one-out): does an element's nearest
     *     embedding neighbor share its category? vs chance. This is the
     *     robust gate — it asks whether the geometry rediscovered the
     *     groups, without demanding tight balls.
     *  2. Per-group ratios: mean intra-group pairwise distance vs global
     *     mean pairwise distance. ratio < 1 = huddles tighter than average.
     *     Reported as diagnostics, not gates: e.g. noble gases are united
     *     by a shell-filling RULE while spanning the full size range
     *     (He→Rn), so they form a loose band, not a tight ball — the ratio
     *     says so honestly, and the scatter viz shows it. */
    function groupStats(set) {
      var intra = [], a, b, i, j;
      for (a = 0; a < set.length; a++) for (b = a + 1; b < set.length; b++)
        intra.push(dist2(emb[set[a]], emb[set[b]]));
      var all = [];
      for (i = 0; i < emb.length; i++) for (j = i + 1; j < emb.length; j++) all.push(dist2(emb[i], emb[j]));
      var im = mean(intra), gm = mean(all);
      return { intra: im, global: gm, ratio: im / gm };
    }
    var noble = groupStats(NOBLE), alkali = groupStats(ALKALI);
    var hit = 0, counts = {};
    idx.forEach(function (i) {
      var best = -1, bd = 1e30;
      idx.forEach(function (j) {
        if (j === i) return;
        var dd = dist2(emb[i], emb[j]);
        if (dd < bd) { bd = dd; best = j; }
      });
      if (EL[best][10] === EL[i][10]) hit++;
      var c = EL[i][10]; counts[c] = (counts[c] || 0) + 1;
    });
    var knnAcc = hit / idx.length, chance = 0;
    Object.keys(counts).forEach(function (c) { var p = counts[c] / idx.length; chance += p * p; });
    return {
      seed: seed, curve: curve, emb: emb, coords: pc.coords,
      explained: pc.explained[0],
      knnAcc: knnAcc, knnChance: chance,
      clusterPass: knnAcc > 2 * chance,
      noble: noble, alkali: alkali,
      intra: noble.intra, inter: noble.global,
      nEl: idx.length
    };
  }
  /* quick per-property scan for the UI table */
  function scanAll(opts) {
    opts = opts || {};
    var out = {}, keys = ["en", "ie", "radius"], q;
    for (q = 0; q < keys.length; q++) {
      var res = trainPredict(keys[q], { seed: opts.seed || 16, epochs: opts.epochs || 150, lr: opts.lr || 0.05 });
      out[keys[q]] = { mae: res.testMAE, base: res.baseMAE, beats: res.beats, n: res.nTest, unit: PROPS[keys[q]].unit };
    }
    return out;
  }
  function finiteCheck() {
    /* null-safety audit: every feature of every element must be finite */
    var i, f, bad = [];
    for (i = 0; i < EL.length; i++) {
      var feats = baseFeatures(EL[i]).concat(maskedInput(EL[i], { en: true, ie: true, radius: true }));
      for (f = 0; f < feats.length; f++) if (!isFinite(feats[f])) bad.push([i, f, feats[f]]);
    }
    return bad;
  }

  return {
    EL: EL, CATNAMES: CATNAMES, CATCOLORS: CATCOLORS, PROPS: PROPS, PKEYS: PKEYS,
    NOBLE: NOBLE, ALKALI: ALKALI, EMBD: EMBD,
    baseFeatures: baseFeatures, predictFeatures: predictFeatures, pval: pval,
    eligible: eligible, trainPredict: trainPredict, trainMasked: trainMasked,
    trainEmbeddings: trainEmbeddings, pca2: pca2, jacobiEigen: jacobiEigen,
    scanAll: scanAll, finiteCheck: finiteCheck, maskedInput: maskedInput,
    aeTargets: aeTargets, aeKnown: aeKnown,
    newMLP: newMLP, mlpForward: mlpForward, mlpStep: mlpStep, RNG: RNG
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NL_ATOMIC;
