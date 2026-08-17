/* ===== HEAT EXCHANGER DESIGN WIZARD — Application Engine ===== */

const HX = (() => {
  'use strict';

  // ========== STATE ==========
  let currentStep = 1;
  const totalSteps = 14;
  const completedSteps = new Set();

  // Store all design data
  const state = {};

  // ========== CONSTANTS DATABASE ==========

  // Bundle diameter constants (Table 12.4) — K1, n1
  // Key: `${layout}_${passes}`
  const bundleConstants = {
    'triangular_1': { K1: 0.319, n1: 2.142 },
    'triangular_2': { K1: 0.249, n1: 2.207 },
    'triangular_4': { K1: 0.175, n1: 2.285 },
    'triangular_6': { K1: 0.0743, n1: 2.499 },
    'triangular_8': { K1: 0.0365, n1: 2.675 },
    'square_1': { K1: 0.215, n1: 2.207 },
    'square_2': { K1: 0.156, n1: 2.291 },
    'square_4': { K1: 0.158, n1: 2.263 },
    'square_6': { K1: 0.0402, n1: 2.617 },
    'square_8': { K1: 0.0331, n1: 2.643 },
    'rotated_square_1': { K1: 0.215, n1: 2.207 },
    'rotated_square_2': { K1: 0.156, n1: 2.291 },
    'rotated_square_4': { K1: 0.158, n1: 2.263 },
    'rotated_square_6': { K1: 0.0402, n1: 2.617 },
    'rotated_square_8': { K1: 0.0331, n1: 2.643 },
  };

  // Bundle-to-shell clearance (mm) approximate lookup by shell type and Db range
  function getBundleClearance(shellType, Db_mm) {
    // Approximate clearances from Figure 12.10 (Coulson & Richardson)
    const clearances = {
      'fixed': { base: 10, slope: 0.01 },   // ~10–16 mm
      'floating': { base: 50, slope: 0.02 },   // ~50–96 mm (pull-through)
      'split': { base: 30, slope: 0.015 },   // ~30–58 mm
      'utube': { base: 15, slope: 0.012 },   // ~15–30 mm
    };
    const c = clearances[shellType] || clearances['fixed'];
    return Math.round(c.base + c.slope * Db_mm);
  }

  // ========== HELPERS ==========
  function $(id) { return document.getElementById(id); }
  function val(id) { const el = $(id); return el ? parseFloat(el.value) : NaN; }
  function setVal(id, v) { const el = $(id); if (el) el.value = v; }
  function setText(id, text) {
    const el = $(id);
    if (!el) return;
    // Preserve eq-symbol span if present
    const eqSpan = el.querySelector('.eq-symbol');
    if (eqSpan) {
      el.innerHTML = '';
      el.appendChild(eqSpan);
      el.appendChild(document.createTextNode(' ' + text));
    } else {
      el.textContent = text;
    }
  }
  function fmt(n, dec = 5) {
    if (n === undefined || n === null || isNaN(n)) return '—';
    if (Math.abs(n) >= 1e9) return n.toExponential(dec);
    if (Math.abs(n) < 0.00001 && n !== 0) return n.toExponential(dec);
    return Number(n.toFixed(dec)).toLocaleString('en-US', { maximumFractionDigits: dec });
  }

  // ========== NAVIGATION ==========
  function goToStep(n) {
    if (n < 1 || n > totalSteps) return;

    // Mark current step completed if moving forward
    if (n > currentStep) {
      completedSteps.add(currentStep);
    }

    // Hide all
    for (let i = 1; i <= totalSteps; i++) {
      const view = $('step' + i);
      if (view) view.classList.remove('step-view--active');
    }
    // Show target
    const target = $('step' + n);
    if (target) target.classList.add('step-view--active');

    currentStep = n;
    updateSidebar();
    updateProgress();
    recalculate();

    // Scroll main content to top
    const mc = $('mainContent');
    if (mc) mc.scrollTop = 0;
  }

  function nextStep() {
    goToStep(currentStep + 1);
  }

  function prevStep() {
    goToStep(currentStep - 1);
  }

  function updateSidebar() {
    const items = document.querySelectorAll('.step-item');
    items.forEach(item => {
      const step = parseInt(item.dataset.step);
      item.classList.remove('step-item--active', 'step-item--completed');
      if (step === currentStep) {
        item.classList.add('step-item--active');
      } else if (completedSteps.has(step)) {
        item.classList.add('step-item--completed');
      }
    });
  }

  function updateProgress() {
    const pct = (completedSteps.size / totalSteps) * 100;
    const fill = $('progressFill');
    const text = $('progressText');
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = `${completedSteps.size} / ${totalSteps} steps`;
  }

  // ========== CALCULATIONS ==========
  function recalculate() {
    calcStep1();
    calcStep2();
    calcStep4();
    calcStep5();
    calcStep6();
    calcStep7();
    calcStep8();
    calcStep9();
    calcStep10();
    calcStep11();
    calcStep12();
    calcStep13();
    calcStep14();
    updateLiveMetrics();
  }

  // Step 1: Temperatures & heat load (Q is a direct input)
  function calcStep1() {
    const T1 = val('T1'), T2 = val('T2'), t1 = val('t1'), t2 = val('t2');
    const Q = val('Qinput'); // kW — direct input

    state.Q = Q;
    state.T1 = T1; state.T2 = T2; state.t1 = t1; state.t2 = t2;

    // Update fluid side labels dynamically
    const tubeFluidType = $('tubeFluidType') ? $('tubeFluidType').value : 'cold';
    const hotLabel = $('hotFluidSideLabel');
    const coldLabel = $('coldFluidSideLabel');
    if (hotLabel) hotLabel.textContent = tubeFluidType === 'hot' ? '(Tube Side)' : '(Shell Side)';
    if (coldLabel) coldLabel.textContent = tubeFluidType === 'cold' ? '(Tube Side)' : '(Shell Side)';
  }

  // Step 2: Derive flow rates from Q, Cp, and temperatures
  function calcStep2() {
    const Q = state.Q;  // kW
    const T1 = state.T1, T2 = state.T2, t1 = state.t1, t2 = state.t2;
    const cpHotJ = val('cpHotJ');   // J/(kg·K)
    const cpColdJ = val('cpColdJ'); // J/(kg·K)

    let mHot = NaN, mCold = NaN;

    // Convert Cp from J to kJ for flow rate calc: m = Q(kW) / (Cp(kJ/kg·K) × ΔT)
    if (!isNaN(Q) && !isNaN(cpHotJ) && cpHotJ > 0 && !isNaN(T1) && !isNaN(T2) && Math.abs(T1 - T2) > 0) {
      const cpHotKJ = cpHotJ / 1000; // kJ/(kg·K)
      mHot = Q / (cpHotKJ * Math.abs(T1 - T2));
    }
    if (!isNaN(Q) && !isNaN(cpColdJ) && cpColdJ > 0 && !isNaN(t1) && !isNaN(t2) && Math.abs(t2 - t1) > 0) {
      const cpColdKJ = cpColdJ / 1000;
      mCold = Q / (cpColdKJ * Math.abs(t2 - t1));
    }

    state.mHot = mHot;
    state.mCold = mCold;

    setText('mHotDisplay', isNaN(mHot) ? '—' : fmt(mHot, 5) + ' kg/s');
    setText('mColdDisplay', isNaN(mCold) ? '—' : fmt(mCold, 5) + ' kg/s');
  }

  // Step 4: LMTD & Ft
  function calcStep4() {
    const { T1, T2, t1, t2 } = state;
    if ([T1, T2, t1, t2].some(isNaN)) return;

    const flow = $('flowArrangement') ? $('flowArrangement').value : 'counter';

    let dT1, dT2;
    if (flow === 'counter') {
      dT1 = T1 - t2;
      dT2 = T2 - t1;
    } else {
      dT1 = T1 - t1;
      dT2 = T2 - t2;
    }

    state.dT1 = dT1;
    state.dT2 = dT2;

    let lmtd;
    if (Math.abs(dT1 - dT2) < 0.01) {
      lmtd = dT1; // Symmetric case
    } else if (dT1 <= 0 || dT2 <= 0) {
      lmtd = NaN; // Temperature cross
    } else {
      lmtd = (dT1 - dT2) / Math.log(dT1 / dT2);
    }
    state.lmtd = lmtd;

    // R and S for Ft correction
    const R = (T1 - T2) / (t2 - t1);
    const S = (t2 - t1) / (T1 - t1);
    state.R = R;
    state.S = S;

    // Ft calculation for 1-shell, even tube passes (Bowman equation)
    const shellPasses = val('shellPasses') || 1;
    let Ft = 1.0;
    if (shellPasses === 1 && Math.abs(R - 1.0) > 0.001) {
      const sqrtR2_1 = Math.sqrt(R * R + 1);
      const num = sqrtR2_1 * Math.log((1 - S) / (1 - R * S));
      const denom = (R - 1) * Math.log((2 - S * (R + 1 - sqrtR2_1)) / (2 - S * (R + 1 + sqrtR2_1)));
      Ft = num / denom;
    } else if (shellPasses === 1 && Math.abs(R - 1.0) <= 0.001) {
      // Special case R = 1
      const sqrt2 = Math.sqrt(2);
      Ft = (sqrt2 * S) / ((1 - S) * Math.log((2 - S * (2 - sqrt2)) / (2 - S * (2 + sqrt2))));
      if (isNaN(Ft) || !isFinite(Ft)) Ft = 1.0;
    }
    if (Ft > 1.0 || Ft < 0.5) Ft = Math.min(Math.max(Ft, 0.5), 1.0);

    // For multi-shell passes, Ft is generally higher (closer to 1)
    if (shellPasses >= 2) {
      // Approximate: use effective S for N shells
      const S_eff = ((1 - (R * S - 1) / (S - 1)) === 0) ? S :
        ((Math.pow((1 - S * R) / (1 - S), 1 / shellPasses) - 1) /
          (Math.pow((1 - S * R) / (1 - S), 1 / shellPasses) - R));
      if (!isNaN(S_eff) && S_eff > 0 && S_eff < 1) {
        const sqrtR2_1 = Math.sqrt(R * R + 1);
        const num = sqrtR2_1 * Math.log((1 - S_eff) / (1 - R * S_eff));
        const denom = (R - 1) * Math.log((2 - S_eff * (R + 1 - sqrtR2_1)) / (2 - S_eff * (R + 1 + sqrtR2_1)));
        const Ft2 = num / denom;
        if (!isNaN(Ft2) && isFinite(Ft2) && Ft2 > 0.5 && Ft2 <= 1.0) Ft = Ft2;
      }
    }

    state.Ft = Ft;
    state.dtm = Ft * lmtd;

    setText('dT1Display', fmt(dT1, 2) + ' °C');
    setText('dT2Display', fmt(dT2, 2) + ' °C');
    setText('lmtdDisplay', fmt(lmtd, 2) + ' °C');
    setText('rDisplay', fmt(R, 4));
    setText('sDisplay', fmt(S, 4));
    setText('ftDisplay', fmt(Ft, 4));
    setText('dtmDisplay', fmt(state.dtm, 2) + ' °C');
  }

  // Step 5: Area
  function calcStep5() {
    const Q = state.Q; // kW
    const U = val('Uassumed');
    const dtm = state.dtm;

    if (isNaN(Q) || isNaN(U) || isNaN(dtm) || U === 0 || dtm === 0) return;

    const A = (Q * 1000) / (U * dtm); // m²
    state.A = A;
    setText('areaDisplay', fmt(A, 3) + ' m²');
  }

  // Step 6: Tube geometry
  function calcStep6() {
    const od = val('tubeOD');
    const thk = val('tubeThk');
    if (!isNaN(od) && !isNaN(thk)) {
      const di = od - 2 * thk;
      state.tubeOD = od / 1000; // m
      state.tubeID = di / 1000; // m
      state.tubeThk = thk / 1000;
      setText('tubeIDDisplay', fmt(di, 2) + ' mm  =  ' + fmt(di / 1000, 5) + ' m');
    }
    state.tubeLength = val('tubeLength') || 4.88;

    // Tube pitch
    let pt = val('tubePitch');
    if (isNaN(pt) && !isNaN(state.tubeOD)) {
      pt = state.tubeOD * 1000 * 1.25;
    }
    state.tubePitch = pt / 1000; // m

    // Wall conductivity
    const kwSel = val('tubeMaterial');
    const kwCustom = val('kwCustom');
    state.kw = !isNaN(kwCustom) && kwCustom > 0 ? kwCustom : kwSel;

    // Layout
    const layout = $('tubeLayout') ? $('tubeLayout').value : 'triangular';
    state.tubeLayout = layout;

    // --- Dynamic Space & Length Optimization Guide Table ---
    const tableBody = $('lengthOptTable')?.querySelector('tbody');
    if (tableBody && !isNaN(state.A) && state.A > 0 && !isNaN(state.tubeOD) && state.tubeOD > 0) {
      const lengthsToCompare = [1.5, 2.0, 3.0, 4.0, 4.88, 6.0];
      const passesStep8 = val('tubePassesStep8');
      const passes = (!isNaN(passesStep8) && passesStep8 > 0) ? passesStep8 : (val('tubePasses') || 2);
      const key = `${layout}_${passes}`;
      const consts = bundleConstants[key] || bundleConstants['triangular_2'];
      const shellType = $('shellType') ? $('shellType').value : 'fixed';

      let html = '';
      lengthsToCompare.forEach(len => {
        const Nt_est = Math.ceil(state.A / (Math.PI * state.tubeOD * len));
        const Db_est = state.tubeOD * Math.pow(Nt_est / consts.K1, 1 / consts.n1);
        const clearance_est = getBundleClearance(shellType, Db_est * 1000);
        const Ds_est_mm = Db_est * 1000 + clearance_est;
        const Ds_est_m = Ds_est_mm / 1000;
        const ratio = len / Ds_est_m;

        let statusBadge = '<span style="color:var(--accent-success)">✓ Optimal</span>';
        if (ratio < 3) {
          statusBadge = '<span style="color:var(--accent-danger)">Too Short (Stubby)</span>';
        } else if (ratio > 15) {
          statusBadge = '<span style="color:var(--accent-warning)">Too Long (Slender)</span>';
        }

        const isCurrent = Math.abs(state.tubeLength - len) < 0.05 ? ' class="selected"' : '';

        html += `
          <tr${isCurrent} data-length="${len}">
            <td>${len.toFixed(2)} m</td>
            <td>${fmt(state.A, 2)} m²</td>
            <td>${Nt_est}</td>
            <td>${Math.round(Ds_est_mm)} mm</td>
            <td>${ratio.toFixed(1)}</td>
            <td>${statusBadge}</td>
          </tr>
        `;
      });
      tableBody.innerHTML = html;

      // Add click events to rows
      tableBody.querySelectorAll('tr').forEach(row => {
        row.onclick = () => {
          const selectedLen = parseFloat(row.dataset.length);
          setVal('tubeLength', selectedLen);
          recalculate();
        };
      });
    }
  }

  // Step 7: Tube count
  function calcStep7() {
    const A = state.A;
    const od = state.tubeOD;
    const di = state.tubeID;
    const L = state.tubeLength;

    if (!A || !od || !L) return;

    // Area per single tube (outer surface area)
    const od_mm = od * 1000; // back to mm for display
    const areaPerTube = Math.PI * od * L; // m²
    state.areaPerTube = areaPerTube;
    setText('areaPerTubeDisplay',
      `π × ${fmt(od_mm, 2)} mm × ${fmt(L, 3)} m  =  ${fmt(areaPerTube, 6)} m²`);

    // Raw tube count (before rounding)
    const NtRaw = A / areaPerTube;
    state.NtCalc = Math.ceil(NtRaw);
    setText('tubeCountRawDisplay',
      `${fmt(A, 4)} / ${fmt(areaPerTube, 6)}  =  ${fmt(NtRaw, 4)}`);

    const override = val('tubeCountOverride');
    state.Nt = (!isNaN(override) && override > 0) ? Math.round(override) : state.NtCalc;

    setText('tubeCountDisplay', state.Nt.toString());

    // Inner tube cross-section area and flow area verification
    if (di && di > 0) {
      const passes = val('tubePasses') || 2;
      const innerCSA = (Math.PI / 4) * di * di; // m² per tube
      const tubesPerPass = Math.round(state.Nt / passes);
      const totalFlowArea = tubesPerPass * innerCSA; // m²

      state.innerCSA = innerCSA;

      setText('innerCSADisplay', fmt(innerCSA, 6) + ' m²');
      setText('tubesPerPassStep7Display', tubesPerPass.toString());
      setText('totalFlowAreaDisplay', fmt(totalFlowArea, 6) + ' m²');
    }
  }

  // Step 8: Bundle & shell diameter
  function calcStep8() {
    const Nt = state.Nt;
    const od = state.tubeOD;
    if (!Nt || !od) return;

    const layout = state.tubeLayout || 'triangular';
    // Read passes from Step 8 selector (primary), fall back to Step 4
    const passesStep8 = val('tubePassesStep8');
    const passes = (!isNaN(passesStep8) && passesStep8 > 0) ? passesStep8 : (val('tubePasses') || 2);

    // Sync Step 4 selector to match Step 8
    const step4Sel = $('tubePasses');
    if (step4Sel && step4Sel.value !== String(Math.round(passes))) {
      step4Sel.value = String(Math.round(passes));
    }

    // Display tube layout name
    const layoutNames = { 'triangular': 'Triangular (30°)', 'square': 'Square (90°)', 'rotated_square': 'Rotated Square (45°)' };
    setText('layoutDisplayStep8', layoutNames[layout] || layout);

    const key = `${layout}_${passes}`;
    const consts = bundleConstants[key] || bundleConstants['triangular_2'];

    state.K1 = consts.K1;
    state.n1 = consts.n1;

    const Db = od * Math.pow(Nt / consts.K1, 1 / consts.n1); // m
    state.Db = Db;

    setText('k1Display', fmt(consts.K1, 4));
    setText('n1Display', fmt(consts.n1, 4));
    setText('dbDisplay', fmt(Db * 1000, 1) + ' mm');

    // Shell diameter
    const shellType = $('shellType') ? $('shellType').value : 'fixed';
    const clearance = getBundleClearance(shellType, Db * 1000);
    state.clearance = clearance;

    const Ds = Db * 1000 + clearance; // mm
    const dsOverride = val('dsOverride');
    state.Ds = (!isNaN(dsOverride) && dsOverride > 0) ? dsOverride : Ds;

    setText('clearanceDisplay', clearance + ' mm');
    setText('dsDisplay', fmt(state.Ds, 1) + ' mm');
  }

  // Step 9: Tube-side coefficient
  function calcStep9() {
    const Nt = state.Nt;
    const di = state.tubeID;
    const passes = val('tubePasses') || 2;
    if (!Nt || !di) return;

    // Determine which fluid is on tube side
    const tubeFluidType = $('tubeFluidType') ? $('tubeFluidType').value : 'cold';
    let rhoTube, muTube, kTube, cpTube, mTube;

    if (tubeFluidType === 'cold') {
      rhoTube = val('rhoCold');
      muTube = val('muCold');
      kTube = val('kCold');
      cpTube = val('cpColdJ');
      mTube = state.mCold;
    } else {
      rhoTube = val('rhoHot');
      muTube = val('muHot');
      kTube = val('kHot');
      cpTube = val('cpHotJ');
      mTube = state.mHot;
    }

    if ([rhoTube, muTube, kTube, cpTube, mTube].some(v => isNaN(v) || v === 0)) return;

    const tubesPerPass = Nt / passes;
    const tubeCSA = (Math.PI / 4) * di * di; // m² per tube
    const totalCSA = tubesPerPass * tubeCSA;   // total flow area
    const volumeFlow = mTube / rhoTube; // m³/s
    const ut = volumeFlow / totalCSA; // m/s

    const Re = (rhoTube * ut * di) / muTube;
    const Pr = (cpTube * muTube) / kTube;

    // Tube-side jH factor method (Coulson & Richardson, Figure 12.23)
    // jH is read from Re vs jH chart; approximated by correlation
    let jH;
    if (Re > 10000) {
      // Turbulent: jH ≈ 0.027 × Re^(-0.2) (fitted to C&R Fig 12.23)
      jH = 0.027 * Math.pow(Re, -0.2);
    } else if (Re < 2100) {
      // Laminar: jH ≈ 1.86 × (Re × Pr × di/L)^(1/3) / (Re × Pr^(1/3))
      // Simplified: Nu = 3.66
      jH = 3.66 / (Re * Math.pow(Pr, 1 / 3));
    } else {
      // Transition: interpolate
      jH = 0.027 * Math.pow(Re, -0.2);
    }

    // Nu = jH × Re × Pr^(1/3) × (μ/μw)^0.14  (assume μ/μw ≈ 1)
    const Nu = jH * Re * Math.pow(Pr, 1 / 3);
    const hi = (Nu * kTube) / di; // W/(m²·K)

    state.tubesPerPass = tubesPerPass;
    state.tubeCSA = totalCSA;
    state.ut = ut;
    state.ReTube = Re;
    state.PrTube = Pr;
    state.NuTube = Nu;
    state.jHTube = jH;
    state.hi = hi;

    setText('tubesPerPassDisplay', Math.round(tubesPerPass).toString());
    setText('tubeCSADisplay', fmt(totalCSA, 6) + ' m²');
    setText('utDisplay', fmt(ut, 3) + ' m/s');
    setText('reTubeDisplay', fmt(Re, 0));
    setText('prTubeDisplay', fmt(Pr, 2));
    setText('nuTubeDisplay', fmt(Nu, 2));
    setText('hiDisplay', fmt(hi, 1) + ' W/(m²·K)');
  }

  // Step 10: Shell-side coefficient (Kern's method)
  function calcStep10() {
    const Ds = state.Ds; // mm
    if (!Ds) return;

    const pt = state.tubePitch; // m
    const od = state.tubeOD;    // m
    if (!pt || !od) return;

    // Baffle spacing
    let lB = val('baffleSpacing');
    if (isNaN(lB) || lB <= 0) {
      lB = 0.4 * Ds; // mm
    }
    state.baffleSpacing = lB; // mm

    const DsM = Ds / 1000; // m
    const lBM = lB / 1000; // m

    // Cross-flow area (Kern)
    const As = (pt - od) * DsM * lBM / pt; // m²

    // Shell-side fluid properties
    const tubeFluidType = $('tubeFluidType') ? $('tubeFluidType').value : 'cold';
    const shellFluidType = tubeFluidType === 'cold' ? 'hot' : 'cold';
    let rhoShell, muShell, kShell, cpShell, mShell;

    if (shellFluidType === 'cold') {
      rhoShell = val('rhoCold') || 995;
      muShell = val('muCold') || 0.0008;
      kShell = val('kCold') || 0.59;
      cpShell = val('cpColdJ') || 4180;
      mShell = state.mCold;
    } else {
      rhoShell = val('rhoHot') || 750;
      muShell = val('muHot') || 0.0003;
      kShell = val('kHot') || 0.19;
      cpShell = val('cpHotJ') || 2840;
      mShell = state.mHot;
    }

    if ([rhoShell, muShell, kShell, cpShell, mShell].some(v => isNaN(v) || v === 0)) return;

    // Mass velocity (Gs) and linear velocity
    const Gs = mShell / As; // kg/(m²·s)
    const us = Gs / rhoShell; // m/s
    state.us = us;
    state.Gs = Gs;

    // Equivalent (hydraulic) diameter
    const layout = state.tubeLayout || 'triangular';
    let de;
    if (layout === 'triangular') {
      // Kern: de = (1.1/do) × (pt² − 0.917 × do²)
      de = (1.1 / od) * (pt * pt - 0.917 * od * od);
    } else {
      // Square pitch: de = 4 × (pt² − π×do²/4) / (π×do)
      de = (4 * (pt * pt - Math.PI * od * od / 4)) / (Math.PI * od);
    }
    state.de = de;

    // Shell-side Re based on mass velocity: Re = Gs × de / μ
    const ReShell = (Gs * de) / muShell;
    const PrShell = (cpShell * muShell) / kShell;

    // Shell-side jH factor (Coulson & Richardson, Figure 12.29)
    // Approximation fitted to the 25% baffle cut curve
    let jh;
    if (ReShell > 10000) {
      jh = 0.36 * Math.pow(ReShell, -0.55);
    } else if (ReShell > 2000) {
      jh = 0.36 * Math.pow(ReShell, -0.55);
    } else if (ReShell > 100) {
      jh = 1.0 * Math.pow(ReShell, -0.5);
    } else {
      jh = 0.5 * Math.pow(ReShell, -0.5);
    }

    // Shell-side Nusselt: Nu = jh × Re × Pr^(1/3) × (μ/μw)^0.14
    // Assume μ/μw ≈ 1
    const NuShell = jh * ReShell * Math.pow(PrShell, 1 / 3);
    const ho = (NuShell * kShell) / de;

    state.As = As;
    state.ReShell = ReShell;
    state.PrShell = PrShell;
    state.jh = jh;
    state.ho = ho;

    setText('asDisplay', fmt(As, 6) + ' m²');
    setText('usDisplay', fmt(us, 3) + ' m/s');
    setText('deDisplay', fmt(de * 1000, 2) + ' mm');
    setText('reShellDisplay', fmt(ReShell, 0));
    setText('prShellDisplay', fmt(PrShell, 2));
    setText('jhDisplay', fmt(jh, 5));
    setText('hoDisplay', fmt(ho, 1) + ' W/(m²·K)');
  }

  // Step 11: Overall U
  function calcStep11() {
    const ho = state.ho;
    const hi = state.hi;
    const kw = state.kw;
    const od = state.tubeOD;
    const di = state.tubeID;
    const Rdi = val('Rdi') || 0.0003;
    const Rdo = val('Rdo') || 0.0003;
    const Uass = val('Uassumed');

    if ([ho, hi, kw, od, di].some(v => !v || v === 0)) return;

    // 1/Uo = 1/ho + Rdo + (do×ln(do/di))/(2kw) + (do/di)×Rdi + (do/di)×(1/hi)
    const ratio = od / di;
    const wallResistance = (od * Math.log(od / di)) / (2 * kw);
    
    const R1 = 1 / ho;
    const R2 = Rdo;
    const R3 = wallResistance;
    const R4 = ratio * Rdi;
    const R5 = ratio * (1 / hi);
    const oneOverU = R1 + R2 + R3 + R4 + R5;
    
    const Ucalc = 1 / oneOverU;

    state.Ucalc = Ucalc;

    setText('resR1', fmt(R1, 8));
    setText('resR2', fmt(R2, 8));
    setText('resR3', fmt(R3, 8));
    setText('resR4', fmt(R4, 8));
    setText('resR5', fmt(R5, 8));
    setText('resTotal', fmt(oneOverU, 8));

    setText('ucalcDisplay', fmt(Ucalc, 1) + ' W/(m²·K)');
    setText('uassDisplay', fmt(Uass, 1) + ' W/(m²·K)');

    // Deviation
    if (!isNaN(Uass) && Uass > 0) {
      const dev = ((Ucalc - Uass) / Uass) * 100;
      state.Udeviation = dev;
      setText('uDeviationDisplay', fmt(dev, 1) + '%');

      const resultEl = $('verificationResult');
      if (resultEl) {
        if (Math.abs(dev) <= 30) {
          resultEl.innerHTML = `<div class="verification-badge verification-badge--pass">✅ PASS — U_calc is within ±30% of U_assumed (${fmt(dev, 1)}% deviation)</div>`;
        } else {
          resultEl.innerHTML = `<div class="verification-badge verification-badge--fail">❌ FAIL — Deviation is ${fmt(dev, 1)}%. Revise U₀ or geometry.</div>`;
        }
      }
    }
  }

  // Step 12: Pressure drops (Kern's method — Coulson & Richardson)
  function calcStep12() {
    const ReTube = state.ReTube;
    const ReShell = state.ReShell;
    if (!ReTube || !ReShell) return;

    const L = state.tubeLength;
    const di = state.tubeID;
    const Ds = state.Ds / 1000; // m
    const de = state.de;
    const ut = state.ut;
    const us = state.us;
    const passes = val('tubePasses') || 2;
    const lB = state.baffleSpacing / 1000; // m

    if (!L || !di || !Ds || !de || !ut || !us) return;

    // Tube-side friction factor (Kern, C&R Figure 12.24)
    // jf = 0.079 × Re^(-0.25) for turbulent (Blasius)
    const jfTube = (ReTube > 2100) ? 0.079 * Math.pow(ReTube, -0.25) : 16 / ReTube;

    // Tube-side ΔP (Kern): ΔPt = Np × (8 × jf × (L/di) + 2.5) × (ρ × ut² / 2)
    // Result in Pascals
    const tubeFluidType = $('tubeFluidType') ? $('tubeFluidType').value : 'cold';
    const rhoTube = (tubeFluidType === 'cold') ? (val('rhoCold') || 995) : (val('rhoHot') || 750);
    const dpTubePa = passes * (8 * jfTube * (L / di) + 2.5) * 0.5 * rhoTube * ut * ut;
    const dpTube = dpTubePa / 1000; // kPa

    state.jfTube = jfTube;
    state.dpTube = dpTube;
    state.dpTubePa = dpTubePa;

    setText('jfTubeDisplay', fmt(jfTube, 6));
    setText('dpTubeDisplay', fmt(dpTube, 3) + ' kPa (' + fmt(dpTubePa, 1) + ' Pa)');

    // Shell-side friction factor (Kern, C&R Figure 12.30)
    // jf = 0.079 × Re^(-0.25) for turbulent (Blasius)
    const jfShell = (ReShell > 2100) ? 0.079 * Math.pow(ReShell, -0.25) : 16 / ReShell;

    // Number of baffles
    const Nb = Math.max(Math.floor(L / (lB > 0 ? lB : 0.2)) - 1, 1);

    // Shell-side ΔP (Kern): ΔPs = 8 × jf × (Ds/de) × (L/lB) × (ρ × us² / 2)
    // Uses (L/lB) ratio per Coulson & Richardson formula
    const shellFluidType = tubeFluidType === 'cold' ? 'hot' : 'cold';
    const rhoShell = (shellFluidType === 'cold') ? (val('rhoCold') || 995) : (val('rhoHot') || 750);
    const dpShellPa = 8 * jfShell * (Ds / de) * (L / lB) * 0.5 * rhoShell * us * us;
    const dpShell = dpShellPa / 1000; // kPa

    state.jfShell = jfShell;
    state.Nb = Nb;
    state.dpShell = dpShell;
    state.dpShellPa = dpShellPa;

    setText('jfShellDisplay', fmt(jfShell, 6));
    setText('nbDisplay', Nb.toString());
    setText('dpShellDisplay', fmt(dpShell, 3) + ' kPa (' + fmt(dpShellPa, 1) + ' Pa)');

    // Verification
    const maxDPt = val('maxDPtube') || 70;
    const maxDPs = val('maxDPshell') || 70;
    const resultEl = $('dpVerificationResult');
    if (resultEl) {
      let html = '';
      if (dpTube <= maxDPt) {
        html += `<div class="verification-badge verification-badge--pass">✅ Tube ΔP OK (${fmt(dpTube, 1)} ≤ ${maxDPt} kPa)</div> `;
      } else {
        html += `<div class="verification-badge verification-badge--fail">❌ Tube ΔP HIGH (${fmt(dpTube, 1)} > ${maxDPt} kPa)</div> `;
      }
      if (dpShell <= maxDPs) {
        html += `<div class="verification-badge verification-badge--pass">✅ Shell ΔP OK (${fmt(dpShell, 1)} ≤ ${maxDPs} kPa)</div>`;
      } else {
        html += `<div class="verification-badge verification-badge--fail">❌ Shell ΔP HIGH (${fmt(dpShell, 1)} > ${maxDPs} kPa)</div>`;
      }
      resultEl.innerHTML = html;
    }
  }

  // Step 13: Cost
  function calcStep13() {
    const A = state.A;
    if (!A) return;

    const baseCost = val('baseCostPerM2') || 800;
    const Fm = val('materialFactor') || 1.0;
    const Fp = val('pressureFactor') || 1.0;
    const Fi = val('installFactor') || 3.5;

    const Cp = baseCost * A * Fm * Fp;
    const Ci = Cp * Fi;

    state.Cp = Cp;
    state.Ci = Ci;

    setText('purchaseCostDisplay', '$' + fmt(Cp, 0));
    setText('installedCostDisplay', '$' + fmt(Ci, 0));
  }

  // Step 14: Summary
  function calcStep14() {
    const grid = $('resultsGrid');
    const body = $('specSheetBody');
    if (!grid || !body) return;

    const results = [
      { label: 'Heat Load (Q)', value: fmt(state.Q, 2), unit: 'kW' },
      { label: 'Area (A₀)', value: fmt(state.A, 3), unit: 'm²' },
      { label: 'Tube Count (Nt)', value: state.Nt || '—', unit: '' },
      { label: 'Shell Diameter', value: fmt(state.Ds, 1), unit: 'mm' },
      { label: 'U calculated', value: fmt(state.Ucalc, 1), unit: 'W/(m²·K)' },
      { label: 'Tube ΔP', value: fmt(state.dpTube, 2), unit: 'kPa' },
      { label: 'Shell ΔP', value: fmt(state.dpShell, 2), unit: 'kPa' },
      { label: 'Installed Cost', value: state.Ci ? '$' + fmt(state.Ci, 0) : '—', unit: '' },
    ];

    grid.innerHTML = results.map(r => `
      <div class="result-card">
        <div class="result-card__label">${r.label}</div>
        <div class="result-card__value">${r.value}</div>
        <div class="result-card__unit">${r.unit}</div>
      </div>
    `).join('');

    // Spec sheet
    const tubeFluidType = $('tubeFluidType') ? $('tubeFluidType').options[$('tubeFluidType').selectedIndex].text : '—';
    const specs = [
      ['Tube-Side Fluid Allocation', tubeFluidType, ''],
      ['Tube-Side Fluid', $('tubeSideFluid')?.value || '—', ''],
      ['Shell-Side Fluid', $('shellSideFluid')?.value || '—', ''],
      ['Hot Inlet / Outlet Temp', `${fmt(state.T1, 1)} / ${fmt(state.T2, 1)}`, '°C'],
      ['Cold Inlet / Outlet Temp', `${fmt(state.t1, 1)} / ${fmt(state.t2, 1)}`, '°C'],
      ['Heat Load (Q)', fmt(state.Q, 2), 'kW'],
      ['LMTD', fmt(state.lmtd, 2), '°C'],
      ['Ft Correction', fmt(state.Ft, 4), ''],
      ['Corrected ΔTm', fmt(state.dtm, 2), '°C'],
      ['U assumed', fmt(val('Uassumed'), 1), 'W/(m²·K)'],
      ['U calculated', fmt(state.Ucalc, 1), 'W/(m²·K)'],
      ['U deviation', fmt(state.Udeviation, 1), '%'],
      ['Provisional Area', fmt(state.A, 3), 'm²'],
      ['Tube OD / ID', `${fmt(state.tubeOD * 1000, 2)} / ${fmt(state.tubeID * 1000, 2)}`, 'mm'],
      ['Tube Length', fmt(state.tubeLength, 2), 'm'],
      ['Tube Layout', state.tubeLayout || '—', ''],
      ['Tube Pitch', fmt(state.tubePitch * 1000, 2), 'mm'],
      ['Tube Count', state.Nt || '—', ''],
      ['Tube Passes', $('tubePasses')?.value || '—', ''],
      ['Shell Passes', $('shellPasses')?.value || '—', ''],
      ['Bundle Diameter', fmt(state.Db * 1000, 1), 'mm'],
      ['Shell Diameter', fmt(state.Ds, 1), 'mm'],
      ['Baffle Spacing', fmt(state.baffleSpacing, 1), 'mm'],
      ['Number of Baffles', state.Nb || '—', ''],
      ['Tube-Side h (hi)', fmt(state.hi, 1), 'W/(m²·K)'],
      ['Shell-Side h (ho)', fmt(state.ho, 1), 'W/(m²·K)'],
      ['Tube-Side Velocity', fmt(state.ut, 3), 'm/s'],
      ['Shell-Side Velocity', fmt(state.us, 3), 'm/s'],
      ['Tube Re', fmt(state.ReTube, 0), ''],
      ['Shell Re', fmt(state.ReShell, 0), ''],
      ['Tube ΔP', fmt(state.dpTube, 2), 'kPa'],
      ['Shell ΔP', fmt(state.dpShell, 2), 'kPa'],
      ['Purchased Cost', state.Cp ? '$' + fmt(state.Cp, 0) : '—', ''],
      ['Installed Cost', state.Ci ? '$' + fmt(state.Ci, 0) : '—', ''],
    ];

    body.innerHTML = specs.map(([p, v, u]) =>
      `<tr><td>${p}</td><td>${v}</td><td>${u}</td></tr>`
    ).join('');
  }

  // Live metrics in top bar
  function updateLiveMetrics() {
    function setMetric(id, value, cls) {
      const el = $(id);
      if (!el) return;
      const valSpan = el.querySelector('.metric-chip__value');
      if (valSpan) valSpan.textContent = value;
      el.className = 'metric-chip' + (cls ? ' metric-chip--' + cls : '');
    }
    setMetric('metricQ', state.Q ? fmt(state.Q, 1) + ' kW' : '—');
    setMetric('metricA', state.A ? fmt(state.A, 2) + ' m²' : '—');
    setMetric('metricNt', state.Nt ? state.Nt : '—');
    setMetric('metricDs', state.Ds ? fmt(state.Ds, 0) + ' mm' : '—');

    const ucalc = state.Ucalc;
    const uass = val('Uassumed');
    if (ucalc && uass) {
      const dev = Math.abs((ucalc - uass) / uass * 100);
      const cls = dev <= 30 ? 'success' : 'danger';
      setMetric('metricUcalc', fmt(ucalc, 0), cls);
    } else {
      setMetric('metricUcalc', '—');
    }

    const maxDPt = val('maxDPtube') || 70;
    const maxDPs = val('maxDPshell') || 70;
    setMetric('metricDPt', state.dpTube ? fmt(state.dpTube, 1) + ' kPa' : '—',
      state.dpTube > maxDPt ? 'danger' : (state.dpTube ? 'success' : undefined));
    setMetric('metricDPs', state.dpShell ? fmt(state.dpShell, 1) + ' kPa' : '—',
      state.dpShell > maxDPs ? 'danger' : (state.dpShell ? 'success' : undefined));
  }

  // ========== EVENT SETUP ==========
  function init() {
    // Sidebar click
    document.querySelectorAll('.step-item').forEach(item => {
      item.addEventListener('click', () => {
        goToStep(parseInt(item.dataset.step));
      });
    });

    // Mobile menu
    const menuBtn = $('menuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', () => {
        const sb = $('sidebar');
        if (sb) sb.classList.toggle('sidebar--open');
      });
    }

    // U preset table click
    const uTable = $('uPresetTable');
    if (uTable) {
      uTable.querySelectorAll('tbody tr').forEach(row => {
        row.addEventListener('click', () => {
          // Deselect all
          uTable.querySelectorAll('tbody tr').forEach(r => r.classList.remove('selected'));
          row.classList.add('selected');
          const umin = parseFloat(row.dataset.umin);
          const umax = parseFloat(row.dataset.umax);
          const uAvg = (umin + umax) / 2;
          setVal('Uassumed', uAvg.toFixed(0));
          recalculate();
        });
      });
    }

    // Auto-recalculate on any input change
    document.addEventListener('input', () => {
      // Sync tube passes selectors (Step 4 ↔ Step 8)
      const s4 = $('tubePasses'), s8 = $('tubePassesStep8');
      if (s4 && s8 && document.activeElement === s4) s8.value = s4.value;
      if (s4 && s8 && document.activeElement === s8) s4.value = s8.value;
      recalculate();
    });
    document.addEventListener('change', () => {
      const s4 = $('tubePasses'), s8 = $('tubePassesStep8');
      if (s4 && s8 && document.activeElement === s4) s8.value = s4.value;
      if (s4 && s8 && document.activeElement === s8) s4.value = s8.value;
      recalculate();
    });

    // Initial calculation
    recalculate();
    updateSidebar();
    updateProgress();
  }

  // Boot
  document.addEventListener('DOMContentLoaded', init);

  // Public API
  return {
    nextStep,
    prevStep,
    goToStep,
    recalculate,
  };
})();
