/* ============================================================================
 * deck_controller.js
 * ----------------------------------------------------------------------------
 * Deterministic Real Estate Diagnostic Deck — visual engine v1.6 (front-end)
 *
 * Pure, zero-dependency vanilla JavaScript. No React / D3 / Lodash.
 *
 * WHAT THIS FILE OWNS
 *   1. ENGINE   — the locked v1.6 math, re-expressed verbatim so the browser
 *                 reproduces the backend numbers (survival model, kappa warps,
 *                 DOM / probability / discount readouts).
 *   2. SVG      — the Slide "Hazard Curve" hero generator (viewBox 0 0 1040 380)
 *                 that bends a survival curve in real time as the asking-price
 *                 slider moves ($600k → $750k).
 *   3. CONTROLLER — the 6-slide deck state machine: keyboard (← / → / d),
 *                 touch swipes, progress dots, Desk/Screen mode.
 *
 * INTEGRATION CONTRACT
 *   - Load after the slide markup (see deck_slides.html) and after
 *     deck_tokens.css (the token stand-in for property_pricer's styles.css).
 *   - Call  REPricerDeck.Deck.init()  once the DOM is ready. Every renderer is
 *     idempotent and guards against missing nodes, so the same file can be
 *     dropped into property_pricer.html with only the DOM ids preserved.
 *   - In Node (smoke tests / CI):  require('./deck_controller.js') exposes
 *     { Engine, SelfTest, VERSION, DEFAULT_STATE }.
 *
 * MATHEMATICAL MODEL (locked, verified — see backend v1.6)
 *   Gilbukh (2025) decaying sale-hazard survival model:
 *     - Weeks 1–3 front-loaded "fresh window": per-week sale odds 9.8%, then
 *       8.4%, then 6.2% (piecewise-linear survival knots below).
 *     - After week 3 the weekly hazard floors at 1.8%/week (stale tail).
 *     - Base median survival: MEDIAN_BASE_WEEKS = 27.1282 wks (189.9 days).
 *     - E[discount | κ] is SURVIVAL-WEIGHTED over the 52-week horizon and
 *       expected offer is ANCHORED TO BASELINE VALUE, carry to the listed
 *       price (see Engine.discountFraction / Engine.scenario). Cost of testing
 *       therefore grows convexly above value (~$266 @ +3% → ~$25,081 @ +20%
 *       on reference inputs).
 * ========================================================================== */

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();              // Node smoke-test / CI entry
  } else {
    root.REPricerDeck = factory();           // Browser global entry
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 'deck-controller-1.6.1';

  const K = {
    MEDIAN_BASE_WEEKS: 27.1282,
    S0: 1.0,
    S1: 0.902,
    S2: 0.82623,
    S3: 0.77501,
    FLOOR_HAZARD: 0.018,
    R_FREE_CAP: 1.03,
    R_SAT: 1.23,
    DILATION_FLOOR: 0.22,
    KAPPA_EFF_FLOOR: 0.05,
    DOM_CAP_WEEKS: 26,
    DISCOUNT_D60: 0.019,
    DISCOUNT_D120: 0.084,
    HORIZON_WEEKS: 52,
    CARRY_RATE: 0.007,
    CARRY_NORM_DAYS: 30,
    DAYS_PER_WEEK: 7,
    DAYS_120: 120.0
  };

  const Engine = {};

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function S_base(w) {
    if (w <= 0) return K.S0;
    if (w <= 1) return K.S0 - (K.S0 - K.S1) * w;
    if (w <= 2) return K.S1 - (K.S1 - K.S2) * (w - 1);
    if (w <= 3) return K.S2 - (K.S2 - K.S3) * (w - 2);
    return K.S3 * Math.pow(1 - K.FLOOR_HAZARD, w - 3);
  }
  Engine.S_base = S_base;

  Engine.baseMedianWeeks = function () {
    return 3 + Math.log(0.5 / K.S3) / Math.log(1 - K.FLOOR_HAZARD);
  };

  function inflate(k) {
    return k <= 1.0 ? 1.45 : 1.0 + 0.45 * Math.exp(-(k - 1.0) / 2.0);
  }
  function kappaT(closedMedianDomDays) {
    const mC = closedMedianDomDays / K.DAYS_PER_WEEK;
    let k = 1.0;
    for (let i = 0; i < 8; i++) {
      const mAll = mC * inflate(k);
      k = K.MEDIAN_BASE_WEEKS / mAll;
    }
    return k;
  }
  Engine.kappaT = kappaT;
  Engine.inflate = inflate;

  function kappaEff(targetAsk, baselineValue, closedMedianDomDays) {
    const r = targetAsk / baselineValue;
    const uEff = clamp((r - K.R_FREE_CAP) / (K.R_SAT - K.R_FREE_CAP), 0.0, 1.0);
    const dilate = Math.max(K.DILATION_FLOOR, Math.pow(1.0 - uEff, 1.15));
    return Math.max(K.KAPPA_EFF_FLOOR, kappaT(closedMedianDomDays) * dilate);
  }
  Engine.kappaEff = kappaEff;

  function expectedDomDays(kappa) {
    const U = K.DOM_CAP_WEEKS * kappa;
    const n = Math.max(1, Math.round(U / 0.02));
    const h = U / n;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const a = i * h;
      area += (S_base(a) + S_base(a + h)) * 0.5 * h;
    }
    const days = (K.DAYS_PER_WEEK / kappa) * area;
    return Math.min(K.DOM_CAP_WEEKS * K.DAYS_PER_WEEK, days);
  }
  Engine.expectedDomDays = expectedDomDays;

  function pBeyond120(kappa) {
    return S_base(kappa * (K.DAYS_120 / K.DAYS_PER_WEEK));
  }
  Engine.pBeyond120 = pBeyond120;

  function pSoldWithin2wk(kappa) {
    return 1.0 - S_base(kappa * 2.0);
  }
  Engine.pSoldWithin2wk = pSoldWithin2wk;

  function discountAtDays(t) {
    if (t <= K.DISCOUNT_D60) return 0.0;
    if (t <= 60) return K.DISCOUNT_D60;
    if (t >= 120) return K.DISCOUNT_D120;
    return K.DISCOUNT_D60 + (K.DISCOUNT_D120 - K.DISCOUNT_D60) * (t - 60) / 60;
  }
  Engine.discountAtDays = discountAtDays;

  function discountFraction(kappa) {
    const W = K.HORIZON_WEEKS;
    let acc = 0;
    for (let w = 1; w <= W; w++) {
      const p = S_base(kappa * (w - 1)) - S_base(kappa * w);
      if (p > 0) acc += discountAtDays(K.DAYS_PER_WEEK * w) * p;
    }
    acc += K.DISCOUNT_D120 * S_base(kappa * W);
    return acc;
  }
  Engine.discountFraction = discountFraction;

  function expectedOffer(baselineValue, kappa) {
    return baselineValue * (1 - discountFraction(kappa));
  }
  Engine.expectedOffer = expectedOffer;

  function carryCost(price, kappa) {
    return K.CARRY_RATE * price * (expectedDomDays(kappa) / K.CARRY_NORM_DAYS);
  }
  Engine.carryCost = carryCost;

  function netExpected(baselineValue, targetAsk, kappaEff) {
    return expectedOffer(baselineValue, kappaEff) - carryCost(targetAsk, kappaEff);
  }
  Engine.netExpected = netExpected;

  function scenario(input) {
    const baselineValue = input.baselineValue;
    const targetAsk = input.targetAsk;
    const closedMedianDomDays = input.closedMedianDomDays;

    const kT = kappaT(closedMedianDomDays);
    const r = targetAsk / baselineValue;
    const uEff = clamp((r - K.R_FREE_CAP) / (K.R_SAT - K.R_FREE_CAP), 0.0, 1.0);
    const kE = Math.max(K.KAPPA_EFF_FLOOR,
                        kT * Math.max(K.DILATION_FLOOR, Math.pow(1.0 - uEff, 1.15)));

    const domDays = expectedDomDays(kE);
    const p120 = pBeyond120(kE);
    const p2 = pSoldWithin2wk(kE);
    const discount = discountFraction(kE);
    const p50Days = K.MEDIAN_BASE_WEEKS * K.DAYS_PER_WEEK / kE;

    const expectedOfferVal = expectedOffer(baselineValue, kE);
    const carry = carryCost(targetAsk, kE);
    const netTarget = expectedOfferVal - carry;

    const discount0 = discountFraction(kT);
    const dom0 = expectedDomDays(kT);
    const offerAnchored = expectedOffer(baselineValue, kT);
    const carryAnchored = carryCost(baselineValue, kT);
    const netAnchored = offerAnchored - carryAnchored;

    const market = {
      ask: baselineValue,
      kappa: kT,
      domDays: dom0,
      p120: pBeyond120(kT),
      p2wk: pSoldWithin2wk(kT),
      discount: discount0,
      offer: offerAnchored,
      carry: carryAnchored,
      net: netAnchored
    };

    return {
      input, r, uEff, kappaT: kT, kappaEff: kE, domDays, p120, p2wk: p2,
      discount, discount0, p50Days, expectedOffer: expectedOfferVal, carry,
      netTarget, offerAnchored, carryAnchored, netAnchored,
      netMarket: netAnchored,
      costOfTesting: Math.max(0, netAnchored - netTarget),
      market
    };
  }
  Engine.scenario = scenario;

  Engine.isDirectionCoherent = function (kappa) {
    return pBeyond120(kappa) < 0.5 === (K.MEDIAN_BASE_WEEKS / kappa) < (K.DAYS_120 / K.DAYS_PER_WEEK);
  };

  Engine.freeCapPrice = function (baselineValue) {
    return baselineValue * K.R_FREE_CAP;
  };

  const VIEW = { w: 1040, h: 380 };
  const PAD = { top: 20, right: 26, bottom: 54, left: 66 };

  function plotDims() {
    return { w: VIEW.w - PAD.left - PAD.right, h: VIEW.h - PAD.top - PAD.bottom };
  }
  function xOf(week) {
    const p = plotDims();
    return PAD.left + (week / 26) * p.w;
  }
  function yOf(s) {
    const p = plotDims();
    return PAD.top + (1 - s) * p.h;
  }
  function weekOfX(x) {
    const p = plotDims();
    return ((x - PAD.left) / p.w) * 26;
  }

  function sampleCurve(kappa, step) {
    const pts = [];
    for (let w = 0; w <= 26.0001; w += step) {
      pts.push({ w: Math.min(26, w), s: S_base(kappa * Math.min(26, w)) });
    }
    return pts;
  }

  function curvePathD(kappa, step) {
    step = step || 0.05;
    let d = '';
    let first = true;
    for (const p of sampleCurve(kappa, step)) {
      d += (first ? 'M' : 'L') + xOf(p.w).toFixed(2) + ' ' + yOf(p.s).toFixed(2);
      first = false;
    }
    return d;
  }

  function areaPathD(kappa, step) {
    step = step || 0.05;
    let d = curvePathD(kappa, step);
    d += 'L' + xOf(26).toFixed(2) + ' ' + yOf(0).toFixed(2);
    d += 'L' + xOf(0).toFixed(2) + ' ' + yOf(0).toFixed(2) + 'Z';
    return d;
  }
  Engine.geometry = { VIEW, PAD, plotDims, xOf, yOf, weekOfX, curvePathD, areaPathD, sampleCurve };

  const $ = function (id) { return document.getElementById(id); };
  const fmtMoney = function (v) { return '$' + Math.round(v).toLocaleString('en-US'); };
  const fmtMoneyK = function (v) { return '$' + (Math.round(v) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'k'; };
  const fmtPct = function (v, d) { d = (d === undefined) ? 1 : d; return (100 * v).toFixed(d) + '%'; };
  const fmtDom = function (days) { return Math.round(days) + 'd' + ' · ' + (days / 7).toFixed(1) + ' wk'; };

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  const DEMO = {
    demandBrackets: [
      { capLo: 575000, n: 640 },
      { capLo: 625000, n: 570 },
      { capLo: 675000, n: 505 },
      { capLo: 725000, n: 445 },
      { capLo: 775000, n: 385 },
      { capLo: 825000, n: 320 },
      { capLo: 875000, n: 265 }
    ],
    stagingCost: 8600,
    replacementHoldback: 30400,
    repairScope: 14000
  };

  const DEFAULT_STATE = {
    slide: 0,
    baselineValue: 660000,
    closedMedianDomDays: 42,
    targetAsk: 700000,
    mode: 'desk'
  };

  const state = Object.assign({}, DEFAULT_STATE);
  let cache = Engine.scenario(state);

  function refreshScenario() {
    cache = Engine.scenario({
      baselineValue: state.baselineValue,
      closedMedianDomDays: state.closedMedianDomDays,
      targetAsk: state.targetAsk
    });
  }

  function renderSlide0() {
    const ask = state.targetAsk;
    const sc = cache;
    let capturedN = 0;
    const rows = DEMO.demandBrackets.map(function (b) {
      const capHi = b.capLo + 50000;
      let frac = 0;
      if (b.capLo >= ask) frac = 1;
      else if (capHi > ask) frac = (capHi - ask) / 50000;
      capturedN += b.n * frac;
      return {
        label: fmtMoneyK(b.capLo + 25000) + ' cap', n: b.n, frac: frac,
        active: ask >= b.capLo && ask < capHi
      };
    });

    const chart = $('s0-chart');
    const maxN = Math.max.apply(null, rows.map(function (r) { return r.n; }));
    if (chart) {
      chart.innerHTML = rows.map(function (r) {
        const pctH = Math.max(4, (r.n / maxN) * 100);
        const cls = r.frac >= 1 ? 'bar captured' : (r.frac > 0 ? 'bar partial' : 'bar muted');
        return '<div class="grain-col" title="' + r.label + ' — ' + r.n + ' searching households">' +
                 '<div class="grain-bar ' + cls + '" style="height:' + pctH.toFixed(1) + '%">' +
                   (r.frac >= 1 ? '<span class="grain-tick">✓</span>' : '') +
                 '</div>' +
                 '<span class="grain-label">' + r.label + '</span>' +
               '</div>';
      }).join('');
    }

    const totalN = rows.reduce(function (a, r) { return a + r.n; }, 0);
    const pctShare = totalN > 0 ? (capturedN / totalN) * 100 : 0;
    const floor50 = Math.floor(ask / 50000) * 50000;
    setText('s0-ask', fmtMoney(ask));
    setText('s0-captured', Math.round(capturedN).toLocaleString('en-US') + ' households');
    setText('s0-share', pctShare.toFixed(0) + '% of in-market demand');
    setText('s0-bracket', fmtMoney(floor50) + ' – ' + fmtMoney(floor50 + 50000));
    const listEl = $('s0-list');
    if (listEl) {
      listEl.innerHTML =
        '<li>Asking ' + fmtMoney(ask) + ' vs value ' + fmtMoney(state.baselineValue) +
        ' (' + fmtPct(sc.r) + ' of value)</li>' +
        '<li>Market-pace ask ' + fmtMoney(state.baselineValue) + ' captures ' +
        fmtMoneyK(state.baselineValue) + ' bracket + all higher caps</li>' +
        '<li>Every $50k above value prunes the highest-count (lowest-cap) brackets first</li>';
    }
  }

  function renderSlide1() {
    const staging = DEMO.stagingCost;
    const holdback = DEMO.replacementHoldback;
    const base = state.baselineValue;
    setText('s1-staging', fmtMoney(staging));
    setText('s1-holdback', fmtMoney(holdback));
    setText('s1-staging-pct', fmtPct(staging / base, 1) + ' of value');
    setText('s1-holdback-pct', fmtPct(holdback / base, 1) + ' of value');
    setText('s1-ratio', (holdback / staging).toFixed(1) + '×');
    const setBar = function (id, w) { const el = $(id); if (el) el.style.width = Math.min(100, Math.max(2, w)) + '%'; };
    setBar('s1-bar-staging', (staging / holdback) * 100);
    setBar('s1-bar-holdback', 100);
    const verdict = $('s1-verdict');
    if (verdict) {
      verdict.innerHTML = '<strong>Stage the presentation, don’t hold it back.</strong> ' +
        'Skipping the ' + fmtMoney(staging) + ' staging pass invites the engine’s ' +
        fmtMoney(holdback) + ' scaled replacement holdback at the negotiating table — a ' +
        (holdback / staging).toFixed(1) + '× gap against a ' + fmtPct(holdback / base) +
        ' value line. Presenting the home finished keeps offer price anchored to the market curve instead of discounting from day one.';
    }
  }

  function buildHeroSvg() {
    const svg = $('h2-svg');
    if (!svg) return;
    const p = plotDims();
    const g = [];
    g.push('<defs><linearGradient id="heroGrad" x1="0" y1="0" x2="0" y2="1">' +
           '<stop offset="0%" stop-color="#38bdf8" stop-opacity="0.34"/>' +
           '<stop offset="100%" stop-color="#38bdf8" stop-opacity="0.02"/>' +
           '</linearGradient></defs>');
    for (let s = 0; s <= 1.0001; s += 0.25) {
      g.push('<line x1="' + PAD.left + '" y1="' + yOf(s) + '" x2="' + (PAD.left + p.w) + '" y2="' + yOf(s) + '" class="grid-h"/>');
      if (s < 1) g.push('<text x="' + (PAD.left - 10) + '" y="' + (yOf(s) + 4) + '" class="axis-label" text-anchor="end">' + Math.round(s * 100) + '%</text>');
    }
    for (let w = 0; w <= 26; w += 2) {
      g.push('<line x1="' + xOf(w) + '" y1="' + PAD.top + '" x2="' + xOf(w) + '" y2="' + (PAD.top + p.h) + '" class="grid-v"/>');
      g.push('<text x="' + xOf(w) + '" y="' + (PAD.top + p.h + 20) + '" class="axis-label" text-anchor="middle">' + w + '</text>');
    }
    g.push('<text x="14" y="' + (PAD.top + p.h / 2) + '" class="axis-caption" transform="rotate(-90 14 ' + (PAD.top + p.h / 2) + ')">P(unsold) — survival</text>');
    g.push('<text x="' + (PAD.left + p.w / 2) + '" y="' + (VIEW.h - 8) + '" class="axis-caption" text-anchor="middle">weeks from listing</text>');
    g.push('<path id="h2-fill-active" class="hero-fill"/>');
    g.push('<path id="h2-path-ref" class="hero-path-ref"/>');
    g.push('<path id="h2-path-active" class="hero-path"/>');
    g.push('<g id="h2-bars"></g>');
    g.push('<line id="h2-line-120" class="hero-120line"/>');
    g.push('<circle id="h2-dot-120" class="hero-120dot"/>');
    g.push('<text id="h2-tag-120" class="hero-120tag">120 d</text>');
    g.push('<circle id="h2-dot-med" class="hero-meddot"/>');
    g.push('<text id="h2-tag-med" class="hero-medtag">p50</text>');
    svg.innerHTML = g.join('\n');
  }

  function updateHero() {
    const sc = cache;
    const kT = sc.kappaT;
    const kE = sc.kappaEff;
    const setPath = function (id, d) { const el = $(id); if (el) el.setAttribute('d', d || ''); };
    setPath('h2-path-active', curvePathD(kE));
    setPath('h2-path-ref', curvePathD(kT, 0.1));
    setPath('h2-fill-active', areaPathD(kE));
    const bars = $('h2-bars');
    if (bars) {
      const mk = [];
      for (let w = 1; w <= 3; w++) {
        const sTop = S_base(kE * (w - 1));
        const sBot = S_base(kE * w);
        const prob = sTop - sBot;
        const cx = xOf(w);
        const yTop = yOf(sTop);
        const yBot = yOf(sBot);
        mk.push('<rect x="' + (cx - 4).toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="8" height="' + Math.max(1, (yBot - yTop)).toFixed(1) + '" rx="2" class="hero-bar"><title>Week ' + w + ': ' + fmtPct(prob) + ' sale probability</title></rect>' +
          '<text x="' + (cx + 10).toFixed(1) + '" y="' + ((yTop + yBot) / 2 + 4).toFixed(1) + '" class="hero-bar-label">wk' + w + ' ' + fmtPct(prob, 1) + '</text>');
      }
      bars.innerHTML = mk.join('');
    }
    const x120 = xOf(K.DAYS_120 / K.DAYS_PER_WEEK);
    const line = $('h2-line-120');
    if (line) { line.setAttribute('x1', x120); line.setAttribute('y1', PAD.top); line.setAttribute('x2', x120); line.setAttribute('y2', PAD.top + plotDims().h); }
    const tag = $('h2-tag-120');
    if (tag) { tag.setAttribute('x', x120 + 6); tag.setAttribute('y', PAD.top + 14); }
    const dot = $('h2-dot-120');
    if (dot) { dot.setAttribute('cx', x120); dot.setAttribute('cy', yOf(sc.p120)); dot.setAttribute('r', 4.5); }
    const medWk = K.MEDIAN_BASE_WEEKS / kE;
    const dotMed = $('h2-dot-med');
    const tagMed = $('h2-tag-med');
    if (dotMed && tagMed) {
      if (medWk <= 26) {
        dotMed.setAttribute('cx', xOf(medWk)); dotMed.setAttribute('cy', yOf(0.5)); dotMed.style.opacity = 1;
        tagMed.setAttribute('x', xOf(medWk) + 8); tagMed.setAttribute('y', yOf(0.5) - 8); tagMed.textContent = 'p50 ≈ ' + medWk.toFixed(1) + ' wk';
      } else {
        dotMed.style.opacity = 0; tagMed.textContent = 'p50 > 26 wk'; tagMed.setAttribute('x', xOf(26) - 110); tagMed.setAttribute('y', yOf(0.5));
      }
    }
    setText('h2-price', fmtMoney(state.targetAsk));
    setText('h2-ratio', fmtPct(sc.r, 1) + ' of value');
    setText('h2-stat-dom', fmtDom(sc.domDays));
    setText('h2-stat-risk', fmtPct(sc.p120, 1) + (sc.p120 < 0.5 ? '' : ' ▲ p50 > 120d'));
    setText('h2-stat-2wk', fmtPct(sc.p2wk, 1));
    setText('h2-stat-cost', sc.costOfTesting > 0 ? fmtMoney(Math.round(sc.costOfTesting)) + ' vs market' : (state.targetAsk === state.baselineValue ? '$0 (at-market)' : '$0 (below value)'));
    setText('h2-stat-disc', fmtPct(sc.discount, 2) + (sc.discount > sc.discount0 ? ' ▲' : ''));
    setText('h2-stat-kappa', sc.kappaT.toFixed(2) + ' → ' + sc.kappaEff.toFixed(2));
    setText('h2-legend-active', 'Asking ' + fmtMoney(state.targetAsk) + ' · κ = ' + sc.kappaEff.toFixed(2));
    setText('h2-legend-ref', 'Market pace · κ = ' + sc.kappaT.toFixed(2) + ' (dashed)');
    const slider = $('h2-slider'); if (slider) slider.value = state.targetAsk;
    const cap = $('h2-free-cap'); if (cap) cap.textContent = '$' + (Engine.freeCapPrice(state.baselineValue) / 1000).toFixed(0) + 'k · 103% cap';
    setText('h2-cost-detail', 'expected offer ' + fmtMoney(Math.round(sc.expectedOffer)) + ' − carry ' + fmtMoney(Math.round(sc.carry)) + ' = net ' + fmtMoney(Math.round(sc.netTarget)) + ' · anchored net ' + fmtMoney(Math.round(sc.netAnchored)));
  }

  function renderSlide3() {
    const sc = cache;
    const B = state.baselineValue;
    const offer = sc.expectedOffer;
    const stale = B * (1 - K.DISCOUNT_D120);
    const setCol = function (id, label, v, cls, note) {
      const el = $(id); if (!el) return;
      const lo = B * 0.88, hi = B;
      const hPct = Math.max(3, ((v - lo) / (hi - lo)) * 100);
      el.innerHTML = '<div class="water-col ' + cls + '" style="height:' + hPct.toFixed(1) + '%"><span class="water-val">' + fmtMoney(Math.round(v)) + '</span><span class="water-note">' + note + '</span></div><span class="water-label">' + label + '</span>';
    };
    setCol('s3-col-ask', 'Value', B, 'w-ask', 'value anchor');
    setCol('s3-col-offer', 'Expected offer', offer, 'w-offer', 'E[disc] ' + fmtPct(sc.discount, 2));
    setCol('s3-col-stale', 'Stale floor', stale, 'w-stale', '−' + fmtPct(K.DISCOUNT_D120) + ' past 120 d');
    setText('s3-ask', fmtMoney(B) + ' value · testing ' + fmtMoney(state.targetAsk));
    setText('s3-offer', fmtMoney(Math.round(offer)));
    setText('s3-stale', fmtMoney(Math.round(stale)));
    setText('s3-d1', '−' + fmtMoney(Math.round(B - offer)) + '  (' + fmtPct(sc.discount, 2) + ' E[disc] @ κ_eff ' + sc.kappaEff.toFixed(2) + ')');
    setText('s3-d2', '−' + fmtMoney(Math.round(offer - stale)) + '  (floor if it crosses 120 d unsold)');
    setText('s3-dom-note', 'Ask ' + fmtMoney(state.targetAsk) + ' (' + fmtPct(sc.r, 1) + ' of value) · E[DOM] ' + fmtDom(sc.domDays) + ' · risk of 120 d+ ' + fmtPct(sc.p120, 1) + ' · expected offer is anchored to value, not to the ask');
  }

  function renderSlide4() {
    const R = DEMO.repairScope;
    const sc = cache;
    const B = state.baselineValue;
    const kT = sc.kappaT;
    const offer = sc.market.offer;
    const carryFix = Engine.carryCost(B, kT);
    const netFix = offer - carryFix - R;
    const askIn = B - R;
    const carryIn = Engine.carryCost(askIn, kT);
    const netIn = offer - carryIn;
    const buildCard = function (id, opts) {
      const el = $(id); if (!el) return;
      el.innerHTML = '<h3>' + opts.title + '</h3>' +
        '<div class="matrix-row"><span>List price</span><strong>' + fmtMoney(opts.ask) + '</strong></div>' +
        '<div class="matrix-row"><span>Expected offer (value)</span><strong>' + fmtMoney(Math.round(offer)) + '</strong></div>' +
        '<div class="matrix-row"><span>Carry (0.7%/30d)</span><strong>−' + fmtMoney(Math.round(opts.carry)) + '</strong></div>' +
        '<div class="matrix-row"><span>' + opts.extraLabel + '</span><strong>' + opts.extra + '</strong></div>' +
        '<div class="matrix-row total"><span>Net to seller</span><strong>' + fmtMoney(Math.round(opts.net)) + '</strong></div>' +
        '<p class="note">' + opts.note + '</p>';
    };
    buildCard('s4-fix', { title: 'Fix-First', ask: B, carry: carryFix, extraLabel: 'Repair outlay', extra: '−' + fmtMoney(R), net: netFix, note: 'Capital tied up ' + fmtMoney(R) + ' before listing; asks full value ' + fmtMoney(B) + ' and closes on the market clock κ_t = ' + kT.toFixed(2) + '.' });
    buildCard('s4-in', { title: 'Price-It-In', ask: askIn, carry: carryIn, extraLabel: 'Repair credit', extra: 'folded into ask', net: netIn, note: 'No pre-close outlay; buyer does the work. Ask sits ' + fmtPct((askIn / B - 1) * -1, 1) + ' under value — still on κ_t, so the expected offer is unchanged.' });
    const verdict = $('s4-verdict');
    if (verdict) {
      const better = netIn >= netFix ? 'Price-It-In' : 'Fix-First';
      const spread = Math.abs(netIn - netFix);
      verdict.innerHTML = '<strong>Model edge: ' + better + ' by ' + fmtMoney(Math.round(spread)) + '.</strong> The survival clock and the value-anchored offer are identical below value, so the ' + fmtMoney(R) + ' outlay only pays when the defect blocks financing, appraisal, or insurance — then fix-first is mandatory regardless of the delta.';
    }
  }

  function renderSlide5() {
    const sc = cache;
    const m = sc.market;
    const buildCard = function (id, opts) {
      const el = $(id); if (!el) return;
      const rows = opts.rows.map(function (r) { return '<div class="matrix-row' + (r.total ? ' total' : '') + '"><span>' + r.k + '</span><strong>' + r.v + '</strong></div>'; }).join('');
      el.innerHTML = '<h3>' + opts.title + '</h3><div class="badge ' + opts.badgeCls + '">' + opts.badge + '</div>' + rows + '<p class="note">' + opts.note + '</p>';
    };
    const marketRows = [
      { k: 'List price', v: fmtMoney(m.ask) }, { k: 'Expected offer (value)', v: fmtMoney(Math.round(m.offer)) },
      { k: 'Expected DOM', v: fmtDom(m.domDays) }, { k: 'Risk of 4+ months', v: fmtPct(m.p120, 1) },
      { k: 'Offer within 2 wks', v: fmtPct(m.p2wk, 1) }, { k: 'E[discount] @ κ_t', v: fmtPct(m.discount, 2) },
      { k: 'Net to seller', v: fmtMoney(Math.round(m.net)), total: true }
    ];
    const ambitRows = [
      { k: 'List price', v: fmtMoney(state.targetAsk) }, { k: 'Expected offer (value)', v: fmtMoney(Math.round(sc.expectedOffer)) },
      { k: 'Expected DOM', v: fmtDom(sc.domDays) }, { k: 'Risk of 4+ months', v: fmtPct(sc.p120, 1) },
      { k: 'Offer within 2 wks', v: fmtPct(sc.p2wk, 1) }, { k: 'E[discount] @ κ_eff', v: fmtPct(sc.discount, 2) + (sc.discount > sc.discount0 ? ' ▲' : '') },
      { k: 'Net to seller', v: fmtMoney(Math.round(sc.netTarget)), total: true }
    ];
    buildCard('s5-market', { title: 'At-Market', badge: 'Recommended path', badgeCls: 'ok', rows: marketRows, note: 'List at 100% of value (' + fmtMoney(m.ask) + '). Runs on the market warp κ_t = ' + sc.kappaT.toFixed(2) + ' — this IS the anchored reference, so cost of testing = $0 by construction.' });
    buildCard('s5-ambitious', { title: 'Ambitious', badge: sc.costOfTesting > 0 ? 'Pay-to-play: ' + fmtMoney(Math.round(sc.costOfTesting)) + ' vs market' : 'At or below value', badgeCls: sc.costOfTesting > 0 ? 'warn' : 'ok', rows: ambitRows, note: fmtPct(sc.r, 1) + ' of value. Time dilation κ_t ' + sc.kappaT.toFixed(2) + ' → κ_eff ' + sc.kappaEff.toFixed(2) + '. Offer stays anchored to value, so every $ over value above 103% buys more E[discount] and carry, not a higher sale price.' });
  }

  const RENDERERS = [renderSlide0, renderSlide1, updateHero, renderSlide3, renderSlide4, renderSlide5];
  function renderAll() { for (let i = 0; i < RENDERERS.length; i++) RENDERERS[i](); }

  const Deck = {};
  let SLIDE_COUNT = 6;

  function currentSlide() {
    const root = $('deck-root');
    if (root) { const n = root.querySelectorAll('.deck-slide').length; if (n) SLIDE_COUNT = n; }
    return SLIDE_COUNT;
  }

  function applySlideVisibility() {
    const root = $('deck-root'); if (!root) return;
    const slides = root.querySelectorAll('.deck-slide');
    const dots = $('deck-progress');
    slides.forEach(function (el, i) { const active = i === state.slide; el.classList.toggle('is-active', active); el.setAttribute('aria-hidden', active ? 'false' : 'true'); });
    if (dots) {
      const kids = dots.children;
      for (let i = 0; i < kids.length; i++) { kids[i].classList.toggle('is-active', i === state.slide); kids[i].setAttribute('aria-current', i === state.slide ? 'step' : 'false'); }
    }
    const pos = $('deck-pos'); if (pos) pos.textContent = (state.slide + 1) + ' / ' + SLIDE_COUNT;
    const meta = Deck.SLIDES[state.slide] || {};
    setText('deck-kicker', meta.kicker || '');
    setText('deck-title', meta.title || '');
  }

  function goTo(i) {
    i = Math.max(0, Math.min(currentSlide() - 1, i));
    if (i === state.slide) return;
    state.slide = i;
    renderAll();
    applySlideVisibility();
  }
  Deck.goTo = goTo;
  Deck.next = function () { goTo(state.slide + 1); };
  Deck.prev = function () { goTo(state.slide - 1); };

  function setInput(partial) {
    let dirty = false;
    if (partial.baselineValue !== undefined && partial.baselineValue !== state.baselineValue) { state.baselineValue = partial.baselineValue; dirty = true; }
    if (partial.closedMedianDomDays !== undefined && partial.closedMedianDomDays !== state.closedMedianDomDays) { state.closedMedianDomDays = partial.closedMedianDomDays; dirty = true; }
    if (partial.targetAsk !== undefined && partial.targetAsk !== state.targetAsk) { state.targetAsk = partial.targetAsk; dirty = true; }
    if (!dirty) return;
    refreshScenario(); renderAll(); applySlideVisibility();
  }
  Deck.setInput = setInput;

  function toggleMode() { state.mode = state.mode === 'desk' ? 'screen' : 'desk'; applyMode(); }
  function applyMode() {
    const root = $('deck-root');
    if (root) { root.classList.toggle('mode-desk', state.mode === 'desk'); root.classList.toggle('mode-screen', state.mode === 'screen'); }
    setText('deck-mode-badge', state.mode === 'desk' ? 'Desk' : 'Screen');
    const btn = $('deck-mode-btn');
    if (btn) { btn.textContent = 'Mode: ' + (state.mode === 'desk' ? 'Desk' : 'Screen'); btn.setAttribute('aria-pressed', state.mode === 'screen' ? 'true' : 'false'); }
  }

  function buildDots() {
    const dots = $('deck-progress'); if (!dots) return;
    dots.innerHTML = '';
    for (let i = 0; i < currentSlide(); i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'deck-dot';
      b.setAttribute('aria-label', 'Go to slide ' + (i + 1) + ': ' + (Deck.SLIDES[i] ? Deck.SLIDES[i].title : ''));
      b.addEventListener('click', function () { goTo(i); });
      dots.appendChild(b);
    }
  }

  function onKey(e) {
    const t = e.target;
    if (t && t.closest && t.closest('input,select,textarea,button,[contenteditable="true"]')) return;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); Deck.prev(); break;
      case 'ArrowRight': e.preventDefault(); Deck.next(); break;
      case 'Home': e.preventDefault(); goTo(0); break;
      case 'End': e.preventDefault(); goTo(currentSlide() - 1); break;
      case 'd': case 'D': e.preventDefault(); toggleMode(); break;
    }
  }

  function wireTouch() {
    const stage = $('deck-stage');
    if (!stage || !('ontouchstart' in window)) return;
    let x0 = null, y0 = null, t0 = null;
    stage.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      const tgt = e.target;
      if (tgt && tgt.closest && tgt.closest('input,select,textarea,button,a')) return;
      const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      const dt = Date.now() - t0;
      x0 = null; y0 = null; t0 = null;
      if (dt > 700) return;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) Deck.next(); else Deck.prev();
    }, { passive: true });
  }

  function wireInputs() {
    const slider = $('h2-slider');
    if (slider) {
      slider.addEventListener('input', function () { setInput({ targetAsk: Number(slider.value) }); });
      slider.min = 600000; slider.max = 750000; slider.step = 1000;
    }
    const inBase = $('in-baseline');
    if (inBase) inBase.addEventListener('change', function () { const v = Number(inBase.value); if (v > 0) setInput({ baselineValue: v }); else inBase.value = state.baselineValue; });
    const inDom = $('in-dom');
    if (inDom) inDom.addEventListener('change', function () { const v = Number(inDom.value); if (v > 0) setInput({ closedMedianDomDays: v }); else inDom.value = state.closedMedianDomDays; });
    const btn = $('deck-mode-btn'); if (btn) btn.addEventListener('click', toggleMode);
  }

  function syncInputFields() {
    const inBase = $('in-baseline'); if (inBase) inBase.value = state.baselineValue;
    const inDom = $('in-dom'); if (inDom) inDom.value = state.closedMedianDomDays;
  }

  Deck.SLIDES = [
    { title: 'Search Brackets', kicker: 'Stage 1 · Demand Capture' },
    { title: 'The Presentation Gap', kicker: 'Stage 2 · Staging vs Holdback' },
    { title: 'The Hazard Curve', kicker: 'Stage 3 · Live Survival Engine' },
    { title: 'The Discount Bridge', kicker: 'Stage 3 · Ask → Offer → Stale' },
    { title: 'Escrow & Close', kicker: 'Stage 4 · Fix-First vs Price-It-In' },
    { title: 'The Decision Matrix', kicker: 'Final · At-Market vs Ambitious' }
  ];

  Deck.init = function (opts) {
    opts = opts || {};
    if (opts.state) Object.assign(state, opts.state);
    refreshScenario();
    buildHeroSvg();
    buildDots();
    wireInputs();
    wireTouch();
    syncInputFields();
    if (!opts.noKeyboard) {
      document.removeEventListener('keydown', onKey);
      document.addEventListener('keydown', onKey);
    }
    renderAll();
    applySlideVisibility();
    applyMode();
    return Deck;
  };

  const SelfTest = {};
  function assert(cond, name, detail) { if (!cond) throw new Error('ASSERT FAILED: ' + name + (detail ? ' — ' + detail : '')); return { pass: true, name: name }; }
  function closeTo(a, b, tol) { return Math.abs(a - b) <= tol; }

  SelfTest.run = function (reporter) {
    const out = [];
    const rec = function (name, ok, detail) { out.push({ name: name, ok: ok, detail: detail || '' }); if (reporter) reporter(name, ok, detail); };
    const check = function (name, fn) { try { fn(); rec(name, true); } catch (e) { rec(name, false, e.message); } };

    check('S_base knots: S(0)=1, S(1)=.902, S(2)=.82623, S(3)=.77501', function () {
      assert(S_base(0) === 1.0, 'S(0)'); assert(S_base(1) === 0.902, 'S(1)'); assert(S_base(2) === 0.82623, 'S(2)'); assert(S_base(3) === 0.77501, 'S(3)');
    });
    check('S_base tail: S(4) = S3 × 0.982', function () { assert(closeTo(S_base(4), 0.77501 * 0.982, 1e-12), 'S(4)'); });
    check('S_base monotone decreasing on [0, 60]', function () {
      let prev = S_base(0);
      for (let w = 0.25; w <= 60; w += 0.25) { const v = S_base(w); assert(v <= prev + 1e-12, 'monotone at w=' + w); prev = v; }
    });
    check('Base median ≈ 27.1282 weeks', function () { assert(closeTo(Engine.baseMedianWeeks(), K.MEDIAN_BASE_WEEKS, 0.02), 'median'); });
    check('E[discount|κ]: bounded by [1.9%, 8.4%], rises as time dilates (κ ↓)', function () {
      const ks = [0.05, 0.5, 1, 2, 4, 8]; let prev = Infinity;
      for (const k of ks) { const e = Engine.discountFraction(k); assert(e >= 0.019 - 1e-12 && e <= 0.084 + 1e-12, 'bounds @κ=' + k + ' got ' + e); assert(e < prev + 1e-12, 'nondecreasing as κ falls @κ=' + k); prev = e; }
      assert(Engine.discountFraction(0.05) > 0.078, 'slow market ≈ 8.4% stale'); assert(Engine.discountFraction(8) < 0.035, 'hot market ≈ 1.9% window');
    });
    check('E[discount|κ]: sale mass conserved Σp(w) + S(κ·52) = 1', function () {
      for (const k of [0.5, 1.3, 2.7, 4.1]) { let mass = S_base(k * 52); for (let w = 1; w <= 52; w++) mass += S_base(k * (w - 1)) - S_base(k * w); assert(closeTo(mass, 1, 1e-9), 'mass @κ=' + k + ' = ' + mass); }
    });
    check('Discount schedule anchors 1.9% ≤60d, 8.4% ≥120d', function () { assert(Engine.discountAtDays(30) === 0.019, '≤60'); assert(closeTo(Engine.discountAtDays(90), 0.0515, 1e-12), 'mid linear'); assert(Engine.discountAtDays(150) === 0.084, '≥120'); });
    check('kappaT(42) converges to fixed point (8-iteration residual < 1e-4)', function () {
      const k = Engine.kappaT(42); const mC = 42 / 7; const residual = Math.abs(k - K.MEDIAN_BASE_WEEKS / (mC * Engine.inflate(k)));
      assert(residual < 1e-4, 'residual ' + residual); assert(k > 1 && k < 10, 'plausible range ' + k);
    });
    check('kappaT monotone decreasing in closed median DOM', function () {
      const a = Engine.kappaT(20), b = Engine.kappaT(42), c = Engine.kappaT(189.9);
      assert(a > b && b > c, 'got ' + a + ', ' + b + ', ' + c); assert(closeTo(c, 0.6896, 0.01), '189.9d → κ ≈ 0.69 (got ' + c + ')');
    });
    check('Direction coherence: P(>120d)<0.5 ⇔ p50<120d across $600–750k', function () {
      let prevRisk = -1, prevDom = -1, prev2 = 2, prevCost = -1;
      for (let ask = 600000; ask <= 750000; ask += 5000) {
        const s = Engine.scenario({ baselineValue: 660000, closedMedianDomDays: 42, targetAsk: ask });
        assert(Engine.isDirectionCoherent(s.kappaEff), 'coherent @ ' + ask);
        assert(s.p120 < 0.5 === (s.p50Days < 120), 'p120/p50 sign match @ ' + ask);
        assert(s.p120 >= prevRisk - 1e-12, 'risk nondecreasing @ ' + ask);
        assert(s.domDays >= prevDom - 1e-9, 'DOM nondecreasing @ ' + ask);
        assert(s.p2wk <= prev2 + 1e-12, '2wk prob nonincreasing @ ' + ask);
        assert(s.costOfTesting >= prevCost - 1e-9, 'cost nondecreasing @ ' + ask);
        assert(s.costOfTesting >= 0, 'cost ≥ 0 @ ' + ask);
        prevRisk = s.p120; prevDom = s.domDays; prev2 = s.p2wk; prevCost = s.costOfTesting;
      }
    });
    check('Cost of testing = $0 at/below value; pure carry delta at +3%', function () {
      const s = Engine.scenario({ baselineValue: 660000, closedMedianDomDays: 42, targetAsk: 660000 });
      assert(s.costOfTesting === 0, 'r=1 cost=' + s.costOfTesting); assert(s.netTarget === s.netAnchored, 'nets equal at r=1');
      const below = Engine.scenario({ baselineValue: 660000, closedMedianDomDays: 42, targetAsk: 620000 });
      assert(below.costOfTesting === 0, 'below value cost=' + below.costOfTesting);
      const s3 = Engine.scenario({ baselineValue: 660000, closedMedianDomDays: 42, targetAsk: 679800 });
      const carryDelta = 0.007 * (679800 - 660000) * (s3.market.domDays / 30);
      assert(closeTo(s3.costOfTesting, carryDelta, 1e-6), 'carry delta @+3%');
    });
    check('Cost of testing convex: ~$300 @+3% → ~$25–35k @+20%', function () {
      const scen = function (r) { return Engine.scenario({ baselineValue: 660000, closedMedianDomDays: 42, targetAsk: Math.round(660000 * r) }); };
      const c3 = scen(1.03).costOfTesting, c10 = scen(1.10).costOfTesting, c20 = scen(1.20).costOfTesting;
      assert(c3 > 200 && c3 < 1500, '@+3% got ' + c3.toFixed(0)); assert(c20 > 15000 && c20 < 60000, '@+20% got ' + c20.toFixed(0));
      assert(c3 < c10 && c10 < c20, 'monotone');
      const slope1 = (c10 - c3) / 0.07, slope2 = (c20 - c10) / 0.10; assert(slope2 > slope1, 'convex');
    });
    check('Expected DOM capped at 26 weeks (182 days)', function () { assert(Engine.expectedDomDays(0.05) <= 182 + 1e-9, 'cap'); assert(Engine.expectedDomDays(4) > 30 && Engine.expectedDomDays(4) < 120, 'plausible hot market'); });
    check('κ_eff floors respected (≥0.05, dilation ≥0.22)', function () {
      const s = Engine.scenario({ baselineValue: 660000, closedMedianDomDays: 42, targetAsk: 750000 });
      assert(s.kappaEff >= 0.05, 'floor'); const ratio = s.kappaEff / s.kappaT; assert(ratio >= 0.22 - 1e-9, 'dilation ratio ' + ratio);
    });

    const fails = out.filter(function (o) { return !o.ok; });
    return { total: out.length, failed: fails.length, results: out };
  };

  return {
    VERSION,
    DEFAULT_STATE,
    Engine,
    Deck,
    SelfTest,
    _helpers: { clamp, fmtMoney, fmtPct, fmtDom, S_base }
  };
});
