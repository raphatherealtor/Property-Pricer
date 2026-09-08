# Real Estate Diagnostic Deck — Front-End Visual Engine (v1.6)

Hand-off package for the **locked & verified v1.6 deterministic real-estate
diagnostic engine** — front-end layer only. The visual engine wires the backend
survival math into a live 6-slide presentation with a real-time SVG
curve-bending hero.

**Status: complete.** Engine math verified locally: **14/14 self-test
assertions pass** (see [Verification](#verification)).

---

## 1. Files in this folder

| File | Role | Load order |
|---|---|---|
| `deck_controller.js` | Whole engine: locked v1.6 math + SVG curve generator + 6-slide deck controller. Zero dependencies. UMD (browser global `REPricerDeck`, or `module.exports` in Node). | Last |
| `deck_slides.html` | Six `<section class="deck-slide">` blocks as a **paste-in fragment** for `property_pricer.html` — byte-identical to the slides embedded in the demo. | Into the page |
| `deck_tokens.css` | Token stylesheet. Alias its `:root` custom properties to `property_pricer`'s `styles.css` tokens when merging. | First |
| `deck_demo.html` | **Self-contained demo** — no server, no CDN, no build. Double-click it. Append `?selftest=1` for an on-page PASS/FAIL stamp. | — |
| `deck_engine.smoke.js` | Node smoke test runner. | Run only |
| `README.md` | This file. | — |

---

## 2. Run the demo

```powershell
cd "C:\Users\skeez\OneDrive\Desktop\VS-Vibe-X\DeepSeek Zone"
# A — no server:  double-click deck_demo.html
# B — or serve (any static server):
python -m http.server 3000 --bind 127.0.0.1
#    → http://localhost:3000/deck_demo.html
```

Controls:

| Input | Action |
|---|---|
| `◄` / `►` arrows | Previous / next slide |
| `d` | Toggle Desk ↔ Screen mode |
| Drag the price slider | Bends the hazard curve live ($600k–$750k) |
| Swipe left/right (touch) | Previous / next slide |
| `Value $` / `Closed med DOM (d)` (top bar) | Engine inputs (backend outputs in production) |
| `?selftest=1` on the URL | Runs all math + DOM + interaction checks; prints `__SELFTEST__ PASS` |

---

## 3. Merge into property_pricer.html (for Claude Code)

1. Paste the `<main id="deck-stage">…</main>` block from **`deck_slides.html`**
   into the page where the deck mounts. All DOM ids must survive (the
   controller binds purely by id).
2. Load **`deck_tokens.css`** and alias its variables to the app's existing
   `styles.css` tokens (every rule reads colors/spacing from `:root`
   custom properties — no hard-coded hex).
3. Load **`deck_controller.js`** after the markup and boot once the DOM is
   ready:

   ```js
   document.addEventListener('DOMContentLoaded', function () {
     REPricerDeck.Deck.init();
   });
   ```

4. Optional chrome the controller updates if present: `#deck-kicker`,
   `#deck-title`, `#deck-pos`, `#deck-mode-btn`, `#deck-mode-badge`,
   inputs `#in-baseline` / `#in-dom`, and `#deck-progress` (dots).
   Missing nodes are skipped gracefully — a partial merge still renders.

---

## 4. Locked mathematical model (embedded verbatim)

Survival base — Gilbukh (2025) decaying sale hazard:

```
w ≤ 0:   S = 1.0
0<w≤1:   1 − 0.098·w                                  → S(1)=0.902
1<w≤2:   0.902 − 0.07577·(w−1)                        → S(2)=0.82623
2<w≤3:   0.82623 − 0.05122·(w−2)                      → S(3)=0.77501
w > 3:   0.77501 · (1 − 0.018)^(w−3)                  (1.8%/wk stale floor)
Median base: 27.1282 weeks (189.9 days)
```

Market warp κ_t (closed-median DOM → all-listing median, 8 fixed-point iters):

```
infl(k) = k ≤ 1 ? 1.45 : 1 + 0.45·exp(−(k−1)/2)
mC      = closed_median_dom / 7
k       = 27.1282 / (mC · infl(k))        ← iterate 8×
```

Price time-dilation κ_eff:

```
r     = ask / baseline_value
u_eff = clamp((r − 1.03) / 0.20, 0, 1)
κ_eff = max(0.05, κ_t · max(0.22, (1 − u_eff)^1.15))
```

Readouts:

```
E[DOM]   = min(182, (7/κ_eff) · ∫₀^{26·κ_eff} S_base(u) du)      # trapezoid
P(>120d) = S_base(κ_eff · 120/7)
P(≤2wk)  = 1 − S_base(κ_eff · 2)
```

**Survival-weighted E[discount | κ]** (locked backend semantics — offer is
anchored to *baseline value*, carry to the *listed price*):

```
d(t)          = 0.019                    t ≤ 60 d
                0.019 → 0.084 linear      60 < t ≤ 120 d
                0.084                     t > 120 d
p(w)          = S_base(κ·(w−1)) − S_base(κ·w)              # weekly sale prob
E[discount]   = Σ_{w=1..52} d(7w)·p(w)  +  0.084 · S_base(κ·52)
expected_offer = baseline_value · (1 − E[discount | κ_eff])
e_carry        = 0.007 · target_price · (E[DOM | κ_eff] / 30)
net_expected   = expected_offer − e_carry
net_anchored   = baseline_value·(1 − E[discount | κ_t]) − 0.007·baseline_value·(E[DOM | κ_t]/30)
cost_of_testing = max(0, net_anchored − net_expected)
```

Cost of testing therefore scales **convexly** above value:
demo inputs give **~$304 @ +3% → ~$27,077 @ +20%** (reference figures
~$266 / ~$25,081 reproduce when fed the backend's own baseline/median inputs).

---

## 5. Verification

```powershell
node deck_engine.smoke.js
```

Current result: **14/14 assertions pass**:

- spec-exact survival knots & tail, base median 27.1282
- E[discount|κ] bounded [1.9%, 8.4%], monotone in κ, sale mass conserved
- κ_t fixed point (8-iteration) & monotonicity vs closed median DOM
- direction coherence across the whole $600k–$750k slider
- cost of testing: $0 at/below value, pure carry delta at +3%, convex growth
- E[DOM] 26-week cap; κ_eff floors

Browser-level checks (slides, dots, hero SVG paths, keyboard nav, Desk/Screen
toggle, live slider bend) run **on page load** at `deck_demo.html?selftest=1`
and print a `__SELFTEST__ PASS` stamp — run that in any browser to complete the
interaction check (this repo's DSH sandbox blocks headless browsers/servers, so
browser verification must run on your side).

---

## 6. Demo stand-ins → replace before client use

| Value | Where | Production source |
|---|---|---|
| Search-demand brackets (slide 1) | `DEMO.demandBrackets` | backend comp/demand scan |
| Staging investment `$8,600` | `DEMO.stagingCost` | real vendor quote |
| Repair scope `$14,000` | `DEMO.repairScope` | inspection estimate |
| Baseline value `$660,000`, closed med DOM `42 d` | top-bar inputs / `DEFAULT_STATE` | backend diagnostic outputs |

All engine numerics (survival, warps, DOM, probabilities, discounts, nets,
cost of testing) are the locked formulas — only the listed *inputs* are
placeholders.

---

## 7. Known modeling note (intentional)

Because expected offer is anchored to baseline value, asking below value does
not lower the expected sale price in the model — it only reduces carry, so
`cost_of_testing` reads $0 for any ask at or below value. That is a property of
the locked engine, preserved faithfully here.
