// === TOP-LEVEL IMPORTS ===
import { dist, projectPointOnLine, circleIntersection, rigidTransform, calcTransmissionAngle } from './geometry.js';
import { computeFullState, computeFullState5 } from './construction.js';
import { drawGrid, drawPoint, drawLine, drawDashedLine, drawCircle, drawGroundSymbol, drawLinkage, drawCouplerCurve } from './canvas.js';

// === GLOBAL APP HANDLES ===
let app4 = null;
let app5 = null;

// === MODE SWITCH ===
window.switchMode = function(mode) {
    document.getElementById('app-4point').style.display = (mode === 4) ? 'flex' : 'none';
    document.getElementById('app-5point').style.display = (mode === 5) ? 'flex' : 'none';
    
    document.querySelectorAll('.mode-switcher .mode-btn').forEach(btn => btn.classList.remove('active'));
    if (mode === 4) {
        document.querySelectorAll('#sidebar-left .mode-switcher .mode-btn:nth-child(1)').forEach(b => b.classList.add('active'));
        document.querySelectorAll('#sidebar-left-5 .mode-switcher .mode-btn:nth-child(1)').forEach(b => b.classList.add('active'));
        if (app5 && app5.anim) app5.anim.path = [];
        if (app4) { app4.resize(); app4.draw(); }
    } else {
        document.querySelectorAll('#sidebar-left .mode-switcher .mode-btn:nth-child(2)').forEach(b => b.classList.add('active'));
        document.querySelectorAll('#sidebar-left-5 .mode-switcher .mode-btn:nth-child(2)').forEach(b => b.classList.add('active'));
        if (app4 && app4.anim) app4.anim.path = [];
        if (app5) { app5.resize(); app5.draw(); }
    }
};

window.addEventListener('resize', () => {
    if (document.getElementById('app-4point').style.display !== 'none' && app4) app4.resize();
    else if (document.getElementById('app-5point').style.display !== 'none' && app5) app5.resize();
});

// ==========================================
// --- Global Splitter Constructor ---
// ==========================================
function makeSplitter(splitterId, options) {
    const splitter = document.getElementById(splitterId);
    if (!splitter) return;
    const { getTarget, getSize, setSize, axis, min = 150, max = Infinity, onDone } = options;

    let dragging = false;
    let startPos = 0;
    let startSize = 0;

    splitter.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        startPos = axis === 'x' ? e.clientX : e.clientY;
        startSize = getSize(getTarget());
        splitter.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const delta = axis === 'x' ? e.clientX - startPos : e.clientY - startPos;
        const newSize = Math.min(Math.max(startSize + delta, min), max);
        setSize(getTarget(), newSize);
        if (onDone) onDone();
    });

    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        splitter.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        if (onDone) onDone();
    });
}

function init4Point() {
const canvas = document.getElementById('mechCanvas');
const ctx = canvas.getContext('2d');
const warningBox = document.getElementById('warning-box');
let width, height;

let synthesisMode = 4;
let currentStep = 0;
let showConstruction = true;
let points = { C: [], HR: null, A1: null, A3: null, HC: null, A2: null, A4: null, B1: null, P2: null, P4: null };
let lines = { c13: { p1: null, p2: null }, a13: { p1: null, p2: null } };
let radii = { R: 100, r: 100 };
let config = { A1: 0, A2: 0, A3: 0, A4: 0 };
let fullCouplerCurve = [];
let circuitVisited = [false, false, false, false];
let transform = { x: 0, y: 0, k: 1 };
let isPanning = false, startPan = { x: 0, y: 0 }, hasMoved = false;

let isDraggingHR = false, isDraggingHC = false, hoveredPivot = null; 
function hitTestPivot(p, sx, sy, hitRadius = 10) { if (!p) return false; const sp = toScreen(p); return Math.hypot(sx - sp.x, sy - sp.y) <= hitRadius; }

let anim = { initialized: false, playing: false, reqId: null, angle: 0, speedMult: 0.025, dir: 1, lastB: null, path: [], lengths: {}, A_current: null, B_current: null, C_current: null, B_alt: null, C_alt: null };
let autosolveWorker = null;

const stepsInfo4 = [
    { title: 'SETUP', desc: 'Precision points placed. Run Auto-Solve or click Next to build manually.' },
    { title: 'STEP 1: Mid-normal C₁C₃', desc: 'Perpendicular bisector c₁₃ computed.' },
    { title: 'STEP 2: Choose H_R', desc: 'Click on dashed line c₁₃ to place H_R.' },
    { title: 'STEP 3: Arc from H_R', desc: 'Adjust R in the inspector below.' },
    { title: 'STEP 4: Find A₁ and A₃', desc: 'Adjust r in the inspector below.' },
    { title: 'STEP 5: Mid-normal A₁A₃', desc: 'Bisector a₁₃ computed.' },
    { title: 'STEP 6: Choose H_C', desc: 'Click on line a₁₃ to place H_C.' },
    { title: 'STEP 7: Crank Circle', desc: 'Drawn automatically.' },
    { title: 'STEP 8: Find A₂ and A₄', desc: 'Finding A₂, A₄ on crank circle.' },
    { title: 'STEP 9: Coupler Edges', desc: 'Coupler edges drawn.' },
    { title: 'STEP 10: Inversion on Follower', desc: 'Locate Point 2 & 4 via rigid transformation.' },
    { title: 'STEP 11: Compute Rocker Tip B₁', desc: 'B₁ found as circumcenter. Analyses defects.' }
];

function toScreen(p) { return { x: p.x * transform.k + transform.x, y: p.y * transform.k + transform.y }; }
function toWorld(p) { return { x: (p.x - transform.x) / transform.k, y: (p.y - transform.y) / transform.k }; }
function setWarning(msg) { if (msg) { warningBox.innerHTML = msg; warningBox.style.display = 'block'; } else { warningBox.style.display = 'none'; } }

function syncPivotInputs() {
    const hrX = document.getElementById('hr-x'), hrY = document.getElementById('hr-y');
    const hcX = document.getElementById('hc-x'), hcY = document.getElementById('hc-y');
    if (points.HR) { hrX.value = Math.round(points.HR.x); hrY.value = Math.round(points.HR.y); } else { hrX.value = ''; hrY.value = ''; }
    if (points.HC) { hcX.value = Math.round(points.HC.x); hcY.value = Math.round(points.HC.y); } else { hcX.value = ''; hcY.value = ''; }
}

function applyPivotInputs() {
    const hrX = parseFloat(document.getElementById('hr-x').value), hrY = parseFloat(document.getElementById('hr-y').value);
    const hcX = parseFloat(document.getElementById('hc-x').value), hcY = parseFloat(document.getElementById('hc-y').value);
    let changed = false;
    if (!isNaN(hrX) && !isNaN(hrY)) { points.HR = { x: hrX, y: hrY }; changed = true; if (currentStep === 2) currentStep = 3; }
    if (!isNaN(hcX) && !isNaN(hcY)) { points.HC = { x: hcX, y: hcY }; changed = true; if (currentStep === 6) currentStep = 7; }
    if (changed) { updateUI(); calculateKinematics(); }
}

['hr-x', 'hr-y', 'hc-x', 'hc-y'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') applyPivotInputs(); });
    el.addEventListener('blur', applyPivotInputs);
});

function calculateKinematics() {
    let data = computeFullState(points.C, points.HR, points.HC, radii.R, radii.r, config, false, synthesisMode);
    points.A1 = data.A1; points.A2 = data.A2; points.A3 = data.A3; points.A4 = data.A4;
    points.P2 = data.P2; points.P4 = data.P4; points.B1 = data.B1;
    lines.c13 = data.lines.c13 || { p1: null, p2: null }; lines.a13 = data.lines.a13 || { p1: null, p2: null };
    fullCouplerCurve = data.fullCouplerCurve; circuitVisited = data.circuitVisited;
    syncPivotInputs(); updateConfigUI(); draw();
}

function displayResults(solutions) {
    document.getElementById('btn-cancel-search').style.display = 'none';
    document.getElementById('btn-autosolve').disabled = false;
    document.getElementById('autosolve-status').innerHTML = 'Search complete.';
    document.getElementById('progress-bar').style.width = '100%';
    renderResults(solutions);
}

document.getElementById('btn-autosolve').addEventListener('click', () => {
    if (points.C.length < 4) return;
    if (autosolveWorker) { autosolveWorker.terminate(); autosolveWorker = null; }

    document.getElementById('progress-container').style.display = 'block';
    document.getElementById('btn-cancel-search').style.display = 'inline-block';
    document.getElementById('btn-autosolve').disabled = true;
    document.getElementById('autosolve-results').innerHTML = '';
    document.getElementById('autosolve-status').innerHTML = 'Starting search…';
    document.getElementById('progress-bar').style.width = '0%';

    autosolveWorker = new Worker('./js/autosolve.worker.js?v=' + Date.now());
    autosolveWorker.onmessage = (e) => {
        if (e.data.type === 'progress') {
            document.getElementById('progress-bar').style.width = `${e.data.percent}%`;
            document.getElementById('autosolve-status').innerHTML = `Searching… ${e.data.percent}% — ${e.data.found} found`;
        }
        if (e.data.type === 'done') { autosolveWorker.terminate(); autosolveWorker = null; displayResults(e.data.solutions); }
    };
    autosolveWorker.postMessage({ C: points.C, filters: { 
        driver: document.getElementById('filter-driver').value, driven: document.getElementById('filter-driven').value, 
        minGamma: parseInt(document.getElementById('filter-min-gamma').value) || 40,
        enableRatio: document.getElementById('filter-enable-ratio').checked,
        enableOrder: document.getElementById('filter-enable-order').checked,
        enableGamma: document.getElementById('filter-enable-gamma').checked 
    }, maxRatio: parseFloat(document.getElementById('slider-max-ratio').value), synthesisMode });
});

document.getElementById('btn-cancel-search').addEventListener('click', () => {
    if (autosolveWorker) { autosolveWorker.terminate(); autosolveWorker = null; }
    document.getElementById('autosolve-status').innerHTML = 'Search cancelled.';
    document.getElementById('btn-cancel-search').style.display = 'none';
    document.getElementById('btn-autosolve').disabled = false;
    document.getElementById('progress-bar').style.width = '0%';
});

function renderResults(solutions) {
    const resultsPanel = document.getElementById('autosolve-results'); resultsPanel.innerHTML = '';
    if (solutions.length === 0) { resultsPanel.innerHTML = '<div style="color:#fca5a5; font-size:0.8rem; padding:5px;">No continuous circuits found.</div>'; return; }
    solutions.forEach((sol, idx) => {
        const card = document.createElement('div'); card.className = 'sol-card';
        const icon = sol.grashof ? '✅' : '⚠️', gText = sol.grashof ? '(Grashof)' : '(Non-Grashof)';
        card.innerHTML = `<strong>${icon} Sol ${idx + 1} — ${sol.type} <span style="font-size:0.7rem; opacity:0.7;">${gText}</span></strong>
            <div style="opacity:0.75; font-size:0.75rem;">Cr: ${sol.linkLengths.crank.toFixed(1)} | Co: ${sol.linkLengths.coupler.toFixed(1)}<br>
            Ro: ${sol.linkLengths.rocker.toFixed(1)} | Fr: ${sol.linkLengths.frame.toFixed(1)}<br>
            <span style="color:var(--accent);">γ_min: ${sol.minGamma !== undefined ? sol.minGamma.toFixed(1) : '--'}° | γ_max: ${sol.maxGamma !== undefined ? sol.maxGamma.toFixed(1) : '--'}°</span></div>`;
        card.onclick = () => loadSolution(sol, idx);
        resultsPanel.appendChild(card);
    });
}

function loadSolution(sol, idx) {
    stopAnimationHelper();
    document.querySelectorAll('.sol-card').forEach((c, i) => i === idx ? c.classList.add('active') : c.classList.remove('active'));
    points = { C: points.C, HR: sol.HR, A1: null, A3: null, HC: sol.HC, A2: null, A4: null, B1: null, P2: null, P4: null };
    lines = { c13: { p1: null, p2: null }, a13: { p1: null, p2: null } }; fullCouplerCurve = []; circuitVisited = [false, false, false, false];
    radii.R = sol.R; radii.r = sol.r; config = sol.config;
    document.getElementById('slider-R').value = sol.R; document.getElementById('val-R').innerText = Math.round(sol.R);
    document.getElementById('slider-r').value = sol.r; document.getElementById('val-r').innerText = Math.round(sol.r);
    currentStep = 11; updateUI(); draw(); calculateKinematics(); setTimeout(autoFit, 100);
}

document.getElementById('btn-export').addEventListener('click', () => {
    if (currentStep < 11 || !points.HC || !points.B1 || !points.A1 || !points.HR) return;
    const L1 = dist(points.HC, points.A1), L2 = dist(points.A1, points.B1), L3 = dist(points.B1, points.HR), L4 = dist(points.HC, points.HR);
    const [s, p2, q, l] = [L1, L2, L3, L4].sort((a, b) => a - b);
    const grashof = (s + l <= p2 + q);
    let type = grashof ? (s === L1 ? 'Crank-Rocker' : (s === L4 ? 'Double-Crank' : 'Double-Rocker')) : 'Non-Grashof';
    const data = { precision_points: points.C, fixed_pivots: { HC: points.HC, HR: points.HR }, link_lengths: { crank: L1, coupler: L2, rocker: L3, frame: L4 }, grashof, type, driver: 'crank', driven: 'rocker' };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'linkage_solution.json'; a.click(); URL.revokeObjectURL(a.href);
});

function autoFit() {
    let activePts = [];
    if (points.C) activePts.push(...points.C); if (points.HR) activePts.push(points.HR); if (points.HC) activePts.push(points.HC);
    ['A1', 'A2', 'A3', 'A4', 'B1', 'P2', 'P4'].forEach(k => { if (points[k]) activePts.push(points[k]); });
    if (fullCouplerCurve.length > 0) activePts.push(...fullCouplerCurve);
    if (activePts.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    activePts.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    let newScale = Math.min((width * 0.8) / Math.max(maxX - minX, 10), (height * 0.8) / Math.max(maxY - minY, 10));
    newScale = Math.max(0.1, Math.min(newScale, 10));
    transform.k = newScale; transform.x = width / 2 - ((minX + maxX) / 2) * newScale; transform.y = height / 2 - ((minY + maxY) / 2) * newScale;
    document.getElementById('val-zoom').innerText = Math.round(newScale * 100);
    document.getElementById('slider-zoom').value = Math.max(-100, Math.min(100, 100 * Math.log10(newScale)));
    if (!anim.playing) draw();
}
document.getElementById('btn-autofit').addEventListener('click', autoFit);

function updateLegend() {
    const box = document.getElementById('legend-content'); if (!box) return;
    let html = '';
    if (points.C.length > 0) html += `<div><span style="color:#f87171; font-size:1.1em;">●</span> C — Precision</div>`;
    if (points.A1 || points.A2) html += `<div><span style="color:#fb923c; font-size:1.1em;">●</span> A — Crank pos</div>`;
    if (points.HC) html += `<div><span style="color:#94a3b8; font-size:1.1em;">●</span> H<sub>C</sub> — Crank pv</div>`;
    if (points.HR) html += `<div><span style="color:#94a3b8; font-size:1.1em;">●</span> H<sub>R</sub> — Rocker pv</div>`;
    if (points.B1) html += `<div><span style="color:#94a3b8; font-size:1.1em;">●</span> B₁ — Rocker tip</div>`;
    if (currentStep >= 7 && points.HC && points.A1) html += `<div><span style="color:#4ade80; font-weight:700;">—</span> Crank circle</div>`;
    if (fullCouplerCurve.length > 0) html += `<div><span style="color:#f87171; font-weight:700;">—</span> Coupler curve</div>`;
    box.innerHTML = html;
}
document.getElementById('btn-toggle-legend').addEventListener('click', () => {
    const b = document.getElementById('legend-box'); b.style.display = b.style.display === 'none' ? 'block' : 'none';
});

function drawPivotHighlight(p, color) {
    if (!p) return; const sp = toScreen(p);
    ctx.save(); ctx.beginPath(); ctx.arc(sp.x, sp.y, 14, 0, Math.PI * 2);
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.stroke(); ctx.restore();
}

function draw() {
    ctx.clearRect(0, 0, width, height); drawGrid(ctx, width, height, transform);
    let activeWarning = '';
    if (currentStep >= 11 && fullCouplerCurve.length > 0) {
        points.C.forEach((p, i) => drawPoint(ctx, p, `C${i + 1}${circuitVisited[i] ? ' ✓' : ' ❌'}`, transform, circuitVisited[i] ? 'rgba(40, 167, 69, 0.9)' : 'rgba(220, 53, 69, 0.9)', 6));
    } else {
        points.C.forEach((p, i) => drawPoint(ctx, p, `C${i + 1}`, transform, 'rgba(255, 0, 0, 0.9)', 6));
    }

    if (fullCouplerCurve.length > 1) drawCouplerCurve(ctx, fullCouplerCurve, transform, false);
    if (anim.path && anim.path.length > 1) drawCouplerCurve(ctx, anim.path, transform, true);

    if (showConstruction) {
        ctx.save(); if (currentStep >= 11) ctx.globalAlpha = 0.15;
        if (currentStep >= 1 && points.C.length >= 3) { drawDashedLine(ctx, points.C[0], points.C[2], transform, '#999'); if (lines.c13.p1) drawDashedLine(ctx, lines.c13.p1, lines.c13.p2, transform, '#999'); }
        if (currentStep >= 2) drawGroundSymbol(ctx, points.HR, 'H_R', transform);
        if (currentStep >= 3) drawCircle(ctx, points.HR, radii.R, transform, '#999', true);
        if (currentStep >= 4) { drawCircle(ctx, points.C[0], radii.r, transform, '#ccc', true); drawCircle(ctx, points.C[2], radii.r, transform, '#ccc', true); if (points.A1) drawPoint(ctx, points.A1, 'A1', transform, 'orange'); if (points.A3) drawPoint(ctx, points.A3, 'A3', transform, 'orange'); if (!points.A1 || !points.A3) activeWarning = '⚠️ Arcs do not intersect! Adjust R and r.'; }
        if (currentStep >= 5 && points.A1 && points.A3) { if (lines.a13.p1) drawDashedLine(ctx, lines.a13.p1, lines.a13.p2, transform, '#999'); drawDashedLine(ctx, points.A1, points.A3, transform, '#999'); }
        if (currentStep >= 6 && points.HC) drawGroundSymbol(ctx, points.HC, 'H_C', transform);
        if (currentStep >= 7 && points.HC && points.A1) drawCircle(ctx, points.HC, dist(points.HC, points.A1), transform, 'green');
        if (currentStep >= 8 && points.HC && points.A1) { drawCircle(ctx, points.C[1], radii.r, transform, '#ddd', true); drawCircle(ctx, points.C[3], radii.r, transform, '#ddd', true); if (points.A2) drawPoint(ctx, points.A2, 'A2', transform, 'orange'); if (points.A4) drawPoint(ctx, points.A4, 'A4', transform, 'orange'); if (!points.A2 || !points.A4) activeWarning = '⚠️ Arcs cannot reach Crank Circle.'; }
        if (currentStep >= 9) ['A1', 'A2', 'A3', 'A4'].forEach((a, i) => { if (points[a]) drawLine(ctx, points.C[i], points[a], transform, 'blue'); });
        if (currentStep >= 10 && points.P2 && points.P4) { drawPoint(ctx, points.P2, 'P2', transform, 'magenta'); drawPoint(ctx, points.P4, 'P4', transform, 'magenta'); drawDashedLine(ctx, points.HR, points.P2, transform, '#f0f'); drawDashedLine(ctx, points.HR, points.P4, transform, '#f0f'); drawDashedLine(ctx, points.P2, points.P4, transform, '#f0f'); }
        if (currentStep >= 11 && points.HR) { if (points.B1) drawCircle(ctx, points.B1, dist(points.B1, points.HR), transform, '#6f42c1', true); else if (currentStep === 11) activeWarning = '⚠️ Algorithm failed: Collinear inversion.'; }
        ctx.restore();
    }

    if (currentStep >= 11 && anim.initialized && anim.B_alt && anim.C_alt) {
        drawLinkage(ctx, points.HC, points.HR, anim.A_current, anim.B_alt, anim.C_alt, transform, true);
        drawPoint(ctx, anim.B_alt, '', transform, 'rgba(180,160,220,0.55)', 4); drawPoint(ctx, anim.C_alt, '', transform, 'rgba(200,200,255,0.55)', 4);
    }
    if (currentStep >= 11 && points.HC && points.B1 && points.A1 && points.HR) {
        const drawA = anim.initialized ? anim.A_current : points.A1, drawB = anim.initialized ? anim.B_current : points.B1, drawC = anim.initialized ? anim.C_current : points.C[0];
        const gamma = calcTransmissionAngle(drawA, drawB, points.HR);
        document.getElementById('live-gamma').innerHTML = `Live γ: ${gamma.toFixed(1)}°`;
        drawLinkage(ctx, points.HC, points.HR, drawA, drawB, drawC, transform, false, gamma, parseInt(document.getElementById('filter-min-gamma').value), document.getElementById('filter-enable-gamma').checked);
        drawGroundSymbol(ctx, points.HC, 'H_C', transform); drawGroundSymbol(ctx, points.HR, 'H_R', transform);
        drawPoint(ctx, drawA, 'A', transform, 'orange', 6); drawPoint(ctx, drawB, 'B₁', transform, 'black', 6); drawPoint(ctx, drawC, anim.initialized ? 'Tracker' : 'C₁', transform, 'red', 6);
    } else { document.getElementById('live-gamma').innerHTML = `Live γ: --°`; }

    if (isDraggingHR || hoveredPivot === 'HR') drawPivotHighlight(points.HR, '#60a5fa');
    if (isDraggingHC || hoveredPivot === 'HC') drawPivotHighlight(points.HC, '#34d399');
    setWarning(activeWarning); updateLegend();
}

function animationLoop() {
    if (!anim.playing) return;
    anim.angle += anim.speedMult * anim.dir;
    const A_next = { x: points.HC.x + anim.lengths.L1 * Math.cos(anim.angle), y: points.HC.y + anim.lengths.L1 * Math.sin(anim.angle) };
    const intersects = circleIntersection(A_next, anim.lengths.L2, points.HR, anim.lengths.L3);
    if (intersects.length === 0) { anim.dir *= -1; anim.angle += anim.speedMult * anim.dir * 2; }
    else {
        let B_next, B_other;
        if (intersects.length > 1) {
            if (dist(intersects[1], anim.lastB) < dist(intersects[0], anim.lastB)) { B_next = intersects[1]; B_other = intersects[0]; }
            else { B_next = intersects[0]; B_other = intersects[1]; }
            anim.B_alt = B_other; anim.C_alt = rigidTransform(points.C[0], points.A1, points.B1, A_next, B_other);
        } else { B_next = intersects[0]; anim.B_alt = null; anim.C_alt = null; }
        anim.lastB = B_next; anim.A_current = A_next; anim.B_current = B_next;
        anim.C_current = rigidTransform(points.C[0], points.A1, points.B1, A_next, B_next);
        anim.path.push(anim.C_current); if (anim.path.length > 800) anim.path.shift();
        const btnBranch = document.getElementById('btn-switch-branch');
        if (btnBranch) { const hasAlt = anim.B_alt !== null; btnBranch.disabled = !hasAlt; btnBranch.style.opacity = hasAlt ? '1' : '0.45'; btnBranch.style.cursor = hasAlt ? 'pointer' : 'not-allowed'; }
    }
    draw(); anim.reqId = requestAnimationFrame(animationLoop);
}

function resize() {
    const area = document.getElementById('canvas-area');
    if(!area || area.clientWidth === 0) return;
    canvas.width = area.clientWidth; canvas.height = area.clientHeight; width = canvas.width; height = canvas.height;
    if (transform.x === 0 && transform.y === 0 && width > 0) { transform.x = width / 2; transform.y = height / 2; }
    draw();
}

function updateConfigUI() {
    ['a1','a2','a3','a4'].forEach(k => { const el = document.getElementById(`btn-cfg-${k}`); if(el) el.innerText = `${k.toUpperCase()}: ${config[k.toUpperCase()] === 0 ? '●1 / 2' : '1 / ●2'}`; });
    document.getElementById('btn-cfg-a2').disabled = currentStep < 8; document.getElementById('btn-cfg-a4').disabled = currentStep < 8;
    document.getElementById('btn-autosolve').disabled = points.C.length < 4; document.getElementById('btn-export').disabled = (currentStep < 11 || !points.HC || !points.B1);
    const checkEl = document.getElementById('config-circuit-check');
    if (currentStep >= 11 && fullCouplerCurve.length > 0) {
        const reached = circuitVisited.filter(v => v).length;
        checkEl.style.display = 'block'; checkEl.innerHTML = reached === 4 ? `✅ All 4 points on same circuit` : `⚠️ Circuit defect: ${reached}/4 points reached`;
        checkEl.style.color = reached === 4 ? '#22c55e' : '#ef4444';
    } else { checkEl.style.display = 'none'; }
}

function updateUI() {
    for (let i = 0; i < stepsInfo4.length; i++) { const el = document.getElementById(`step-${i}`); if (el) el.className = `step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}`; }
    const activeEl = document.getElementById(`step-${currentStep}`); if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('slider-R').value = radii.R; document.getElementById('val-R').innerText = radii.R;
    document.getElementById('slider-R-group').style.display = (currentStep === 3 || currentStep === 4 || currentStep >= 11) ? 'flex' : 'none';
    document.getElementById('div-R').style.display = (currentStep === 3 || currentStep === 4 || currentStep >= 11) ? 'block' : 'none';
    document.getElementById('slider-r-group').style.display = (currentStep >= 4) ? 'flex' : 'none';
    document.getElementById('div-r').style.display = (currentStep >= 4) ? 'block' : 'none';
    document.getElementById('config-panel').style.display = (currentStep >= 4) ? 'flex' : 'none';
    document.getElementById('btn-next').style.display = currentStep < 11 ? 'block' : 'none';
    document.getElementById('btn-toggle-const').style.display = currentStep >= 11 ? 'block' : 'none';
    document.getElementById('animation-palette').style.display = currentStep >= 11 ? 'flex' : 'none';
    updateConfigUI();
}

function initUI() {
    const c = document.getElementById('steps-container'); c.innerHTML = '';
    stepsInfo4.forEach((s, i) => { const d = document.createElement('div'); d.className = `step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}`; d.id = `step-${i}`; d.innerHTML = `<div class="step-title">${s.title}</div><div class="step-desc">${s.desc}</div>`; c.appendChild(d); });
    updateUI();
}

function stopAnimationHelper() {
    anim.initialized = false; anim.playing = false; cancelAnimationFrame(anim.reqId);
    const btn = document.getElementById('btn-play-pause'); if (btn) { btn.innerText = 'Play Simulation'; btn.style.backgroundColor = ''; btn.style.color = ''; }
}

makeSplitter('splitter-left', { axis: 'x', min: 200, max: 520, getTarget: () => document.getElementById('sidebar-left'), getSize: (el) => el.getBoundingClientRect().width, setSize: (el, px) => { el.style.width = px + 'px'; el.style.minWidth = px + 'px'; }, onDone: () => resize() });
makeSplitter('splitter-bottom', { axis: 'y', min: 90, max: 280, getTarget: () => document.getElementById('inspector'), getSize: (el) => el.getBoundingClientRect().height, setSize: (el, px) => { el.style.height = px + 'px'; el.style.minHeight = px + 'px'; }, onDone: () => resize() });
makeSplitter('splitter-right', { axis: 'x', min: 200, max: 520, getTarget: () => document.getElementById('right-sidebar'), getSize: (el) => el.getBoundingClientRect().width, setSize: (el, px) => { el.style.width = px + 'px'; el.style.minWidth = px + 'px'; }, onDone: () => resize() });

makeSplitter('splitter-left-5', { axis: 'x', min: 200, max: 520, getTarget: () => document.getElementById('sidebar-left-5'), getSize: (el) => el.getBoundingClientRect().width, setSize: (el, px) => { el.style.width = px + 'px'; el.style.minWidth = px + 'px'; }, onDone: () => resize() });
makeSplitter('splitter-bottom-5', { axis: 'y', min: 90, max: 280, getTarget: () => document.getElementById('inspector-5'), getSize: (el) => el.getBoundingClientRect().height, setSize: (el, px) => { el.style.height = px + 'px'; el.style.minHeight = px + 'px'; }, onDone: () => resize() });
makeSplitter('splitter-right-5', { axis: 'x', min: 200, max: 520, getTarget: () => document.getElementById('right-sidebar-5'), getSize: (el) => el.getBoundingClientRect().width, setSize: (el, px) => { el.style.width = px + 'px'; el.style.minWidth = px + 'px'; }, onDone: () => resize() });


['a1', 'a2', 'a3', 'a4'].forEach((a) => { document.getElementById(`btn-cfg-${a}`).addEventListener('click', () => { stopAnimationHelper(); const key = a.toUpperCase(); config[key] = 1 - config[key]; calculateKinematics(); }); });
document.getElementById('btn-apply-coords').addEventListener('click', () => {
    const newPts = [];
    for (let i = 1; i <= 4; i++) { const x = document.getElementById(`c${i}-x`).value, y = document.getElementById(`c${i}-y`).value; if (x !== '' && y !== '') newPts.push({ x: parseFloat(x), y: parseFloat(y) }); }
    points.C = newPts; draw(); updateConfigUI(); if (newPts.length === 4) calculateKinematics();
});

canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect(), sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (hitTestPivot(points.HR, sx, sy)) { isDraggingHR = true; hasMoved = false; stopAnimationHelper(); canvas.style.cursor = 'grabbing'; return; }
    if (hitTestPivot(points.HC, sx, sy)) { isDraggingHC = true; hasMoved = false; stopAnimationHelper(); canvas.style.cursor = 'grabbing'; return; }
    isPanning = true; hasMoved = false; startPan = { x: e.clientX - transform.x, y: e.clientY - transform.y };
});

window.addEventListener('mousemove', (e) => {
    if (document.getElementById('app-4point').style.display === 'none') return;
    const rect = canvas.getBoundingClientRect(), sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (isDraggingHR || isDraggingHC) {
        hasMoved = true; const wPt = toWorld({ x: sx, y: sy });
        if (isDraggingHR) points.HR = wPt; else points.HC = wPt;
        syncPivotInputs(); calculateKinematics(); return;
    }
    if (isPanning) {
        const nx = e.clientX - startPan.x, ny = e.clientY - startPan.y;
        if (Math.abs(nx - transform.x) > 3 || Math.abs(ny - transform.y) > 3) hasMoved = true;
        transform.x = nx; transform.y = ny; if (!anim.playing) draw(); return;
    }
    const prevHovered = hoveredPivot;
    if (hitTestPivot(points.HR, sx, sy)) { hoveredPivot = 'HR'; canvas.style.cursor = 'grab'; }
    else if (hitTestPivot(points.HC, sx, sy)) { hoveredPivot = 'HC'; canvas.style.cursor = 'grab'; }
    else { hoveredPivot = null; canvas.style.cursor = 'crosshair'; }
    if (hoveredPivot !== prevHovered && !anim.playing) draw();
});

window.addEventListener('mouseup', () => {
    if (document.getElementById('app-4point').style.display === 'none') return;
    if (isDraggingHR || isDraggingHC) { isDraggingHR = false; isDraggingHC = false; canvas.style.cursor = 'crosshair'; calculateKinematics(); updateUI(); return; }
    isPanning = false;
});

canvas.addEventListener('wheel', (e) => { e.preventDefault(); const delta = -e.deltaY * 0.001, newScale = Math.min(Math.max(0.1, transform.k * Math.exp(delta)), 10), rect = canvas.getBoundingClientRect(), mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top; transform.x = mouseX - (mouseX - transform.x) * (newScale / transform.k); transform.y = mouseY - (mouseY - transform.y) * (newScale / transform.k); transform.k = newScale; document.getElementById('val-zoom').innerText = Math.round(newScale * 100); document.getElementById('slider-zoom').value = Math.max(-100, Math.min(100, 100 * Math.log10(newScale))); if (!anim.playing) draw(); }, { passive: false });
document.getElementById('slider-zoom').addEventListener('input', (e) => { const newScale = Math.pow(10, parseInt(e.target.value) / 100); document.getElementById('val-zoom').innerText = Math.round(newScale * 100); const cx = width / 2, cy = height / 2; transform.x = cx - (cx - transform.x) * (newScale / transform.k); transform.y = cy - (cy - transform.y) * (newScale / transform.k); transform.k = newScale; if (!anim.playing) draw(); });

canvas.addEventListener('click', (e) => {
    if (hasMoved) return;
    const p = toWorld({ x: e.clientX - canvas.getBoundingClientRect().left, y: e.clientY - canvas.getBoundingClientRect().top });
    if (currentStep === 0 && points.C.length < 4) { points.C.push(p); document.getElementById(`c${points.C.length}-x`).value = Math.round(p.x); document.getElementById(`c${points.C.length}-y`).value = Math.round(p.y); }
    else if (currentStep === 2 && lines.c13.p1) { points.HR = projectPointOnLine(p, lines.c13.p1, lines.c13.p2); syncPivotInputs(); }
    else if (currentStep === 6 && lines.a13.p1) { points.HC = projectPointOnLine(p, lines.a13.p1, lines.a13.p2); syncPivotInputs(); }
    updateUI(); draw(); calculateKinematics();
});

document.getElementById('slider-R').addEventListener('input', (e) => { radii.R = parseInt(e.target.value); document.getElementById('val-R').innerText = radii.R; calculateKinematics(); });
document.getElementById('slider-r').addEventListener('input', (e) => { radii.r = parseInt(e.target.value); document.getElementById('val-r').innerText = radii.r; calculateKinematics(); });
document.getElementById('slider-speed').addEventListener('input', (e) => { const v = parseInt(e.target.value); document.getElementById('val-speed').innerText = v; anim.speedMult = v * 0.0005; });
document.getElementById('btn-toggle-const').addEventListener('click', (e) => { showConstruction = !showConstruction; e.target.innerText = showConstruction ? 'Hide Construction' : 'Show Construction'; if (!anim.playing) draw(); });

document.getElementById('btn-play-pause').addEventListener('click', (e) => {
    if (!anim.initialized) {
        anim.initialized = true; anim.playing = true; anim.angle = Math.atan2(points.A1.y - points.HC.y, points.A1.x - points.HC.x); anim.lastB = { x: points.B1.x, y: points.B1.y }; anim.path = []; anim.dir = 1; anim.lengths = { L1: dist(points.HC, points.A1), L2: dist(points.A1, points.B1), L3: dist(points.HR, points.B1) }; animationLoop();
    } else { anim.playing = !anim.playing; if (anim.playing) animationLoop(); else cancelAnimationFrame(anim.reqId); }
    e.target.innerText = anim.playing ? 'Pause' : 'Play Simulation'; e.target.style.backgroundColor = anim.playing ? '#ca8a04' : ''; e.target.style.color = anim.playing ? '#fff' : ''; updateUI();
});

document.getElementById('btn-stop-anim').addEventListener('click', () => { stopAnimationHelper(); anim.B_alt = null; anim.C_alt = null; const b = document.getElementById('btn-switch-branch'); if(b){b.disabled=true; b.style.opacity='0.45'; b.style.cursor='not-allowed';} draw(); updateUI(); });
document.getElementById('btn-switch-branch').addEventListener('click', () => { if (!anim.initialized || !anim.B_alt) return; [anim.B_current, anim.B_alt] = [anim.B_alt, anim.B_current]; [anim.C_current, anim.C_alt] = [anim.C_alt, anim.C_current]; anim.lastB = anim.B_current; anim.path = []; draw(); });

document.getElementById('btn-next').addEventListener('click', () => {
    if (currentStep === 0 && points.C.length < 4) { alert('Place 4 points first.'); return; }
    if (currentStep === 11) return;
    if (currentStep === 2 && !points.HR) { alert('Place H_R.'); return; }
    if (currentStep === 4 && (!points.A1 || !points.A3)) { alert('Adjust R and r so arcs intersect.'); return; }
    if (currentStep === 6 && !points.HC) { alert('Place H_C.'); return; }
    if (currentStep === 8 && (!points.A2 || !points.A4)) { alert('Arcs do not intersect crank circle.'); return; }
    currentStep++; updateUI(); draw(); calculateKinematics();
});

document.getElementById('btn-new-problem').addEventListener('click', () => {
    stopAnimationHelper(); anim.path = []; anim.A_current = null; anim.B_current = null; anim.C_current = null; anim.B_alt = null; anim.C_alt = null;
    currentStep = 0; showConstruction = true; document.getElementById('btn-toggle-const').innerText = 'Hide Construction';
    points = { C: [], HR: null, A1: null, A3: null, HC: null, A2: null, A4: null, B1: null, P2: null, P4: null }; lines = { c13: { p1: null, p2: null }, a13: { p1: null, p2: null } }; fullCouplerCurve = []; circuitVisited = [false, false, false, false]; config = { A1: 0, A2: 0, A3: 0, A4: 0 };
    for (let i = 1; i <= 4; i++) { document.getElementById(`c${i}-x`).value = ''; document.getElementById(`c${i}-y`).value = ''; }
    ['hr-x', 'hr-y', 'hc-x', 'hc-y'].forEach(id => document.getElementById(id).value = ''); syncPivotInputs();
    document.getElementById('autosolve-status').style.display = 'none'; document.getElementById('autosolve-results').innerHTML = ''; document.getElementById('progress-container').style.display = 'none';
    if (autosolveWorker) { autosolveWorker.terminate(); autosolveWorker = null; }
    transform = { x: width / 2, y: height / 2, k: 1 }; document.getElementById('slider-zoom').value = 0; document.getElementById('val-zoom').innerText = 100; updateUI(); draw();
});

document.getElementById('btn-reset').addEventListener('click', () => {
    stopAnimationHelper(); currentStep = 0; showConstruction = true; document.getElementById('btn-toggle-const').innerText = 'Hide Construction';
    points = { C: points.C, HR: null, A1: null, A3: null, HC: null, A2: null, A4: null, B1: null, P2: null, P4: null }; lines = { c13: { p1: null, p2: null }, a13: { p1: null, p2: null } }; fullCouplerCurve = []; circuitVisited = [false, false, false, false]; config = { A1: 0, A2: 0, A3: 0, A4: 0 };
    document.querySelectorAll('.sol-card').forEach(c => c.classList.remove('active')); syncPivotInputs(); transform = { x: width / 2, y: height / 2, k: 1 }; document.getElementById('slider-zoom').value = 0; document.getElementById('val-zoom').innerText = 100; updateUI(); draw();
});

document.getElementById('btn-back').addEventListener('click', () => {
    stopAnimationHelper(); if (currentStep > 0) currentStep--;
    if (currentStep < 11) { points.B1 = null; fullCouplerCurve = []; circuitVisited = [false, false, false, false]; }
    if (currentStep < 10) { points.P2 = null; points.P4 = null; }
    if (currentStep < 8) { points.A2 = null; points.A4 = null; }
    if (currentStep < 6) { points.HC = null; }
    if (currentStep < 5) { lines.a13 = { p1: null, p2: null }; }
    if (currentStep < 4) { points.A1 = null; points.A3 = null; }
    if (currentStep < 2) { points.HR = null; }
    showConstruction = true; document.getElementById('btn-toggle-const').innerText = 'Hide Construction'; syncPivotInputs(); updateUI(); draw(); calculateKinematics();
});

initUI(); setTimeout(resize, 100);
return { resize, draw, anim };
}

// === 5-POINT INIT ===
(function() {
    try {
        const canvas = document.getElementById('mechCanvas-5');
        const ctx = canvas.getContext('2d');
        const warningBox = document.getElementById('warning-box-5');
        let width, height;

        let currentStep = 0;
        let showConstruction = true;
        let activeWarning = "";
        
        let points = { C: [], HR: null, A_p1: null, A_p2: null, HC: null, A_p3: null, P2: null, P3: null, B1: null };
        let lines = { L1: null, L2: null, L1p: null, L2p: null, axis_p: null, a_p12: null };
        let radii = { alpha: 0, r: 100 };
        let config = { Ap1: 0, Ap2: 0, Ap3: 0 }; 

        let fullCouplerCurve = []; 
        let circuitVisited = [false, false, false, false, false]; 

        let transform = { x: 0, y: 0, k: 1 };
        let isPanning = false, hasMoved = false, startPan = { x: 0, y: 0 };

        let anim = { initialized: false, playing: false, reqId: null, angle: 0, speedMult: 0.025, dir: 1, lastB: null, path: [], lengths: {}, A_current: null, B_current: null, C_current: null };

        const stepsInfo = [
            { title: "SETUP", desc: "Click to place 5 precision points (Coupler path): C₁, C₂, C₃, C₄, C₅." },
            { title: "STEP 1: Select Point Pairs", desc: "Choose two pairs of points to define your mid-normals L₁ and L₂. H_R is exactly at their intersection." },
            { title: "STEP 2: Coincident Mid-normals & Overlay", desc: "Line H_R-to-P1 is rotated so its mid-normal aligns perfectly with the 2nd mid-normal. Adjust slider α to rotate these lines together." },
            { title: "STEP 3: Find Crank Pins 1 & 2", desc: "Adjust slider r. Intersections from your chosen points onto L₁' and L₂' yield your first two crank pins." },
            { title: "STEP 4: Locate Crank Pivot H_C", desc: "Draw mid-normal between the two pins. It intersects the coincident mid-normal (dashed line) precisely at H_C. Draw Crank Circle." },
            { title: "STEP 5: Find 3rd Crank Pin", desc: "Using the remaining unselected precision point with radius r, find its pin on the crank circle." },
            { title: "STEP 6: Inversion on Follower", desc: "Locate inverted points such that △CᵢAᵢH_R ≅ △C_base A_base Pᵢ. Both points of Pair 2 invert to the same location." },
            { title: "STEP 7: Locate Rocker Tip B₁", desc: "Draw the mid-normals of the lines joining H_R to the two inverted points from Step 6. Their intersection yields B₁." },
            { title: "STEP 8: Final 5-Point Mechanism", desc: "The four-bar linkage is synthesized. Press play to trace the curve." }
        ];



        function dist(p1, p2) { return Math.hypot(p2.x - p1.x, p2.y - p1.y); }
        function midpoint(p1, p2) { return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }; }
        function perpBisector(p1, p2, length = 5000) {
            const mid = midpoint(p1, p2); const dx = p2.x - p1.x; const dy = p2.y - p1.y; const len = Math.hypot(dx, dy);
            if (len === 0) return null;
            return { p1: { x: mid.x + (-dy/len) * length, y: mid.y + (dx/len) * length }, p2: { x: mid.x - (-dy/len) * length, y: mid.y - (dx/len) * length } };
        }
        function lineIntersection(p1, p2, p3, p4) {
            let x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
            let x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;
            let den = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
            if (Math.abs(den) < 1e-5) return null;
            let t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / den;
            return {x: x1 + t*(x2-x1), y: y1 + t*(y2-y1)};
        }
        function circleLineIntersection(center, r, linePt, lineDir) {
            let U = { x: linePt.x - center.x, y: linePt.y - center.y };
            let B = 2 * (lineDir.x * U.x + lineDir.y * U.y);
            let Ceq = U.x*U.x + U.y*U.y - r*r;
            let disc = B*B - 4*Ceq;
            if (disc < 0) return [];
            let t1 = (-B + Math.sqrt(disc)) / 2;
            let t2 = (-B - Math.sqrt(disc)) / 2;
            return [ {x: linePt.x + t1*lineDir.x, y: linePt.y + t1*lineDir.y}, {x: linePt.x + t2*lineDir.x, y: linePt.y + t2*lineDir.y} ];
        }
        function circleIntersection(center1, r1, center2, r2) {
            let d = dist(center1, center2); if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) return []; 
            let a = (r1*r1 - r2*r2 + d*d) / (2*d); let h = Math.sqrt(Math.max(0, r1*r1 - a*a));
            let p2 = { x: center1.x + a * (center2.x - center1.x) / d, y: center1.y + a * (center2.y - center1.y) / d };
            return [ { x: p2.x + h * (center2.y - center1.y) / d, y: p2.y - h * (center2.x - center1.x) / d }, { x: p2.x - h * (center2.y - center1.y) / d, y: p2.y + h * (center2.x - center1.x) / d } ];
        }
        function rigidTransform(p, frameP1, frameP2, targetP1, targetP2) {
            let angleFrame = Math.atan2(frameP2.y - frameP1.y, frameP2.x - frameP1.x); let angleTarget = Math.atan2(targetP2.y - targetP1.y, targetP2.x - targetP1.x);
            let deltaAngle = angleTarget - angleFrame; let vx = p.x - frameP1.x; let vy = p.y - frameP1.y;
            let rx = vx * Math.cos(deltaAngle) - vy * Math.sin(deltaAngle); let ry = vx * Math.sin(deltaAngle) + vy * Math.cos(deltaAngle);
            return { x: targetP1.x + rx, y: targetP1.y + ry };
        }
        function circumcenter(p1, p2, p3) {
            let d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y)); if (Math.abs(d) < 1e-5) return null; 
            let ux = ((p1.x*p1.x + p1.y*p1.y) * (p2.y - p3.y) + (p2.x*p2.x + p2.y*p2.y) * (p3.y - p1.y) + (p3.x*p3.x + p3.y*p3.y) * (p1.y - p2.y)) / d;
            let uy = ((p1.x*p1.x + p1.y*p1.y) * (p3.x - p2.x) + (p2.x*p2.x + p2.y*p2.y) * (p1.x - p3.x) + (p3.x*p3.x + p3.y*p3.y) * (p2.x - p1.x)) / d;
            return {x: ux, y: uy};
        }

        function toScreen(p) { return { x: p.x * transform.k + transform.x, y: p.y * transform.k + transform.y }; }
        function toWorld(p) { return { x: (p.x - transform.x) / transform.k, y: (p.y - transform.y) / transform.k }; }
        function setWarning(msg) { if (msg) { warningBox.innerHTML = msg; warningBox.style.display = 'block'; } else { warningBox.style.display = 'none'; } }
        function drawPoint(p, label, color = '#3b82f6', size = 5) {
            if (!p) return; let sp = toScreen(p);
            ctx.fillStyle = color; ctx.beginPath(); ctx.arc(sp.x, sp.y, size, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#333'; ctx.font = '600 14px Montserrat, sans-serif'; ctx.fillText(label, sp.x + 8, sp.y - 8);
        }
        function drawLine(p1, p2, color = '#666', dashed = false, thick = 1.5) {
            if(!p1 || !p2) return; let sp1 = toScreen(p1), sp2 = toScreen(p2);
            ctx.strokeStyle = color; ctx.lineWidth = thick; ctx.setLineDash(dashed ? [5, 5] : []);
            ctx.beginPath(); ctx.moveTo(sp1.x, sp1.y); ctx.lineTo(sp2.x, sp2.y); ctx.stroke(); ctx.setLineDash([]);
        }
        function drawCircle(center, radius, color, dashed = false) {
            if(!center) return; let sc = toScreen(center);
            ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash(dashed ? [5, 5] : []);
            ctx.beginPath(); ctx.arc(sc.x, sc.y, radius * transform.k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        function drawGroundPivot(p, label) {
            if (!p) return; let sp = toScreen(p);
            ctx.fillStyle = '#ccc'; ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(sp.x - 12, sp.y + 18); ctx.lineTo(sp.x + 12, sp.y + 18); ctx.closePath(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sp.x - 18, sp.y + 18); ctx.lineTo(sp.x + 18, sp.y + 18); ctx.stroke();
            for(let i = -12; i <= 12; i += 6) { ctx.beginPath(); ctx.moveTo(sp.x + i, sp.y + 18); ctx.lineTo(sp.x + i - 6, sp.y + 26); ctx.stroke(); }
            ctx.fillStyle = '#333'; ctx.font = 'bold 16px Montserrat, sans-serif'; ctx.fillText(label, sp.x + 18, sp.y + 5);
            ctx.fillStyle = '#1e1e1e'; ctx.beginPath(); ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        function drawFilledTriangle(p1, p2, p3, fillColor, strokeColor) {
            let sp1 = toScreen(p1), sp2 = toScreen(p2), sp3 = toScreen(p3);
            ctx.fillStyle = fillColor; ctx.strokeStyle = strokeColor; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(sp1.x, sp1.y); ctx.lineTo(sp2.x, sp2.y); ctx.lineTo(sp3.x, sp3.y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        }
        function drawGrid() {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'; ctx.lineWidth = 0.5; const gridSize = 50; 
            let tl = toWorld({x: 0, y: 0}), br = toWorld({x: width, y: height});
            let startX = Math.floor(tl.x / gridSize) * gridSize, startY = Math.floor(tl.y / gridSize) * gridSize;
            for (let x = startX; x <= br.x; x += gridSize) { let sp1 = toScreen({x: x, y: tl.y}), sp2 = toScreen({x: x, y: br.y}); ctx.beginPath(); ctx.moveTo(sp1.x, sp1.y); ctx.lineTo(sp2.x, sp2.y); ctx.stroke(); }
            for (let y = startY; y <= br.y; y += gridSize) { let sp1 = toScreen({x: tl.x, y: y}), sp2 = toScreen({x: br.x, y: y}); ctx.beginPath(); ctx.moveTo(sp1.x, sp1.y); ctx.lineTo(sp2.x, sp2.y); ctx.stroke(); }
        }

        function computeFullPath() {
            let i1a = parseInt(document.getElementById('p1a-5').value);
            if(!points.HC || !points.A_p1 || !points.HR || !points.B1) return [];
            let L1 = dist(points.HC, points.A_p1); let L2 = dist(points.A_p1, points.B1); let L3 = dist(points.HR, points.B1);
            let startAngle = Math.atan2(points.A_p1.y - points.HC.y, points.A_p1.x - points.HC.x); let lastB = {x: points.B1.x, y: points.B1.y};
            
            let step = 0.01; let maxSteps = (Math.PI * 2) / step + 10;
            let forwardPath = [], backwardPath = [];
            
            let theta = startAngle;
            for(let i=0; i<maxSteps; i++) {
                let A_next = { x: points.HC.x + L1 * Math.cos(theta), y: points.HC.y + L1 * Math.sin(theta) };
                let intersects = circleIntersection(A_next, L2, points.HR, L3);
                if(intersects.length === 0) break;
                let B_next = intersects[0];
                if(intersects.length > 1 && dist(intersects[1], lastB) < dist(intersects[0], lastB)) B_next = intersects[1];
                lastB = B_next;
                forwardPath.push(rigidTransform(points.C[i1a], points.A_p1, points.B1, A_next, B_next)); theta += step;
            }

            theta = startAngle - step; lastB = {x: points.B1.x, y: points.B1.y};
            for(let i=0; i<maxSteps; i++) {
                let A_next = { x: points.HC.x + L1 * Math.cos(theta), y: points.HC.y + L1 * Math.sin(theta) };
                let intersects = circleIntersection(A_next, L2, points.HR, L3);
                if(intersects.length === 0) break; 
                let B_next = intersects[0];
                if(intersects.length > 1 && dist(intersects[1], lastB) < dist(intersects[0], lastB)) B_next = intersects[1];
                lastB = B_next;
                backwardPath.push(rigidTransform(points.C[i1a], points.A_p1, points.B1, A_next, B_next)); theta -= step;
            }

            backwardPath.reverse();
            let finalPath = backwardPath.concat(forwardPath);
            circuitVisited = [false, false, false, false, false];
            points.C.forEach((c, idx) => {
                let minDist = Infinity;
                finalPath.forEach(p => { let d = dist(c, p); if (d < minDist) minDist = d; });
                if (minDist < 12) circuitVisited[idx] = true; 
            });
            return finalPath;
        }

        function recalculate() {
            activeWarning = "";
            if (points.C.length < 5) return;

            let i1a = parseInt(document.getElementById('p1a-5').value);
            let i1b = parseInt(document.getElementById('p1b-5').value);
            let i2a = parseInt(document.getElementById('p2a-5').value);
            let i2b = parseInt(document.getElementById('p2b-5').value);
            
            let usedIndices = [i1a, i1b, i2a, i2b];
            let i3 = [0, 1, 2, 3, 4].find(idx => !usedIndices.includes(idx));
            if (i3 === undefined) i3 = [0, 1, 2, 3, 4].find(idx => idx !== i1a && idx !== i1b && idx !== i2a) || 0;

            if(i1a === i1b || i2a === i2b) { activeWarning = "Invalid pairs. A pair must consist of two different points."; return; }

            lines.L1 = perpBisector(points.C[i1a], points.C[i1b]);
            lines.L2 = perpBisector(points.C[i2a], points.C[i2b]);

            if(lines.L1 && lines.L2) { points.HR = lineIntersection(lines.L1.p1, lines.L1.p2, lines.L2.p1, lines.L2.p2); } 
            else { points.HR = null; activeWarning = "Points are coincident. Cannot compute H_R."; return; }
            
            if(!points.HR) { activeWarning = "Midnormals parallel. Cannot compute H_R."; return; }

            if (currentStep >= 2) {
                let angle1 = Math.atan2(lines.L1.p2.y - lines.L1.p1.y, lines.L1.p2.x - lines.L1.p1.x);
                let angle2 = Math.atan2(lines.L2.p2.y - lines.L2.p1.y, lines.L2.p2.x - lines.L2.p1.x);
                let deltaTheta = angle2 - angle1;
                let angle_C1 = Math.atan2(points.C[i1a].y - points.HR.y, points.C[i1a].x - points.HR.x);
                let angle_C2 = Math.atan2(points.C[i2a].y - points.HR.y, points.C[i2a].x - points.HR.x);
                
                let angle_C1_aligned = angle_C1 + deltaTheta;
                let alphaRad = radii.alpha * Math.PI / 180;
                
                let final_C1 = angle_C1_aligned + alphaRad;
                let final_C2 = angle_C2 + alphaRad;
                let final_axis = angle2 + alphaRad;

                let V1 = {x: Math.cos(final_C1), y: Math.sin(final_C1)};
                let V2 = {x: Math.cos(final_C2), y: Math.sin(final_C2)};
                let Vaxis = {x: Math.cos(final_axis), y: Math.sin(final_axis)};

                lines.L1p = { p1: points.HR, p2: {x: points.HR.x + V1.x*5000, y: points.HR.y + V1.y*5000}, p0: {x: points.HR.x - V1.x*5000, y: points.HR.y - V1.y*5000}, dir: V1 };
                lines.L2p = { p1: points.HR, p2: {x: points.HR.x + V2.x*5000, y: points.HR.y + V2.y*5000}, p0: {x: points.HR.x - V2.x*5000, y: points.HR.y - V2.y*5000}, dir: V2 };
                lines.axis_p = { p1: points.HR, p2: {x: points.HR.x + Vaxis.x*5000, y: points.HR.y + Vaxis.y*5000}, p0: {x: points.HR.x - Vaxis.x*5000, y: points.HR.y - Vaxis.y*5000}, dir: Vaxis };
            }

            if (currentStep >= 3 && lines.L1p && lines.L2p) {
                let int1 = circleLineIntersection(points.C[i1a], radii.r, points.HR, lines.L1p.dir);
                let int2 = circleLineIntersection(points.C[i2a], radii.r, points.HR, lines.L2p.dir);
                points.A_p1 = int1.length > 0 ? int1[config.Ap1 % int1.length] : null;
                points.A_p2 = int2.length > 0 ? int2[config.Ap2 % int2.length] : null;
                if(!points.A_p1 || !points.A_p2) activeWarning = "Radius r is too small. Arcs do not intersect lines.";
            } else { points.A_p1 = null; points.A_p2 = null; }

            if (currentStep >= 4 && points.A_p1 && points.A_p2) {
                lines.a_p12 = perpBisector(points.A_p1, points.A_p2);
                if(lines.a_p12) { points.HC = lineIntersection(lines.a_p12.p1, lines.a_p12.p2, lines.axis_p.p0, lines.axis_p.p2); } 
                else { points.HC = null; activeWarning = "Crank pins are coincident."; }
            } else { points.HC = null; }

            if (currentStep >= 5 && points.HC && points.A_p1) {
                let crankR = dist(points.HC, points.A_p1);
                let int3 = circleIntersection(points.C[i3], radii.r, points.HC, crankR);
                points.A_p3 = int3.length > 0 ? int3[config.Ap3 % int3.length] : null;
                if(!points.A_p3) activeWarning = "Arc does not reach crank circle for 3rd point.";
            } else { points.A_p3 = null; }

            if (currentStep >= 6 && points.HR && points.A_p1 && points.A_p2 && points.A_p3) {
                points.P2 = rigidTransform(points.HR, points.C[i2a], points.A_p2, points.C[i1a], points.A_p1);
                points.P3 = rigidTransform(points.HR, points.C[i3], points.A_p3, points.C[i1a], points.A_p1);
            } else { points.P2 = null; points.P3 = null; }

            if (currentStep >= 7 && points.HR && points.P2 && points.P3) {
                points.B1 = circumcenter(points.P2, points.HR, points.P3);
                if(!points.B1) activeWarning = "Inverted points and H_R are collinear. Cannot compute B1.";
            } else { points.B1 = null; }

            if (currentStep >= 8 && points.B1) {
                fullCouplerCurve = computeFullPath();
                if (anim.initialized) anim.lengths = { L1: dist(points.HC, points.A_p1), L2: dist(points.A_p1, points.B1), L3: dist(points.HR, points.B1) };
            } else { fullCouplerCurve = []; circuitVisited = [false, false, false, false, false]; }
            
            setWarning(activeWarning); updateCircuitDefectUI();
        }

        function draw() {
            ctx.clearRect(0, 0, width, height); drawGrid();

            let i1a = parseInt(document.getElementById('p1a-5').value);
            let i1b = parseInt(document.getElementById('p1b-5').value);
            let i2a = parseInt(document.getElementById('p2a-5').value);
            let i2b = parseInt(document.getElementById('p2b-5').value);
            
            let usedIndices = [i1a, i1b, i2a, i2b];
            let i3 = [0, 1, 2, 3, 4].find(idx => !usedIndices.includes(idx));
            if (i3 === undefined) i3 = [0, 1, 2, 3, 4].find(idx => idx !== i1a && idx !== i1b && idx !== i2a) || 0;

            if (fullCouplerCurve.length > 1) {
                ctx.strokeStyle = 'rgba(255, 82, 82, 0.3)'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 6]); ctx.beginPath();
                let sp0 = toScreen(fullCouplerCurve[0]); ctx.moveTo(sp0.x, sp0.y);
                for(let i=1; i<fullCouplerCurve.length; i++) { let sp = toScreen(fullCouplerCurve[i]); ctx.lineTo(sp.x, sp.y); }
                ctx.stroke(); ctx.setLineDash([]);
            }

            if (anim.path && anim.path.length > 1) {
                ctx.strokeStyle = 'rgba(255, 82, 82, 0.8)'; ctx.lineWidth = 3; ctx.beginPath();
                let sp0 = toScreen(anim.path[0]); ctx.moveTo(sp0.x, sp0.y);
                for(let i=1; i<anim.path.length; i++) { let sp = toScreen(anim.path[i]); ctx.lineTo(sp.x, sp.y); }
                ctx.stroke();
            }

            if (currentStep >= 8 && fullCouplerCurve.length > 0) {
                points.C.forEach((p, i) => { let color = circuitVisited[i] ? 'rgba(0, 230, 118, 0.9)' : 'rgba(255, 82, 82, 0.9)'; drawPoint(p, `C${i+1}`, color, 6); });
            } else {
                points.C.forEach((p, i) => drawPoint(p, `C${i+1}`, 'rgba(255, 82, 82, 0.9)', 6));
            }

            ctx.save();
            if (currentStep >= 8) ctx.globalAlpha = 0.2; 
            if (!showConstruction && currentStep >= 8) { ctx.restore(); drawFinalMechanism(); return; }

            if (currentStep >= 1 && points.C.length >= 5) {
                drawLine(points.C[i1a], points.C[i1b], '#666', true); drawLine(points.C[i2a], points.C[i2b], '#666', true);
                if(lines.L1) drawLine(lines.L1.p1, lines.L1.p2, '#888', true);
                if(lines.L2) drawLine(lines.L2.p1, lines.L2.p2, '#888', true);
                drawGroundPivot(points.HR, 'H_R');
            }

            if (currentStep >= 2 && lines.L1p && lines.L2p) {
                if(lines.axis_p) drawLine(lines.axis_p.p0, lines.axis_p.p2, '#888', true, 1.5);
                drawLine(lines.L1p.p0, lines.L1p.p2, '#00e5ff', false, 1.5);
                drawLine(lines.L2p.p0, lines.L2p.p2, '#00e5ff', false, 1.5);
            }

            if (currentStep >= 3) {
                drawCircle(points.C[i1a], radii.r, '#777', true); drawCircle(points.C[i2a], radii.r, '#777', true);
                if (points.A_p1) { drawLine(points.C[i1a], points.A_p1, '#ff9800', true); drawPoint(points.A_p1, 'A_p1', '#ff9800', 5); }
                if (points.A_p2) { drawLine(points.C[i2a], points.A_p2, '#ff9800', true); drawPoint(points.A_p2, 'A_p2', '#ff9800', 5); }
            }

            if (currentStep >= 4 && points.HC && points.A_p1) {
                if(lines.a_p12) drawLine(lines.a_p12.p1, lines.a_p12.p2, '#bbb', true);
                drawGroundPivot(points.HC, 'H_C'); drawCircle(points.HC, dist(points.HC, points.A_p1), '#00e676');
            }

            if (currentStep >= 5 && points.HC && points.A_p1) {
                drawCircle(points.C[i3], radii.r, '#777', true);
                if (points.A_p3) { drawLine(points.C[i3], points.A_p3, '#ff9800', true); drawPoint(points.A_p3, 'A_p3', '#ff9800', 5); }
            }

            if (currentStep >= 6 && points.HR && points.A_p1 && points.A_p2 && points.A_p3) {
                drawFilledTriangle(points.C[i2a], points.A_p2, points.HR, 'rgba(0, 229, 255, 0.15)', '#00e5ff');
                drawFilledTriangle(points.C[i1a], points.A_p1, points.P2, 'rgba(0, 229, 255, 0.15)', '#00e5ff');
                drawFilledTriangle(points.C[i3], points.A_p3, points.HR, 'rgba(255, 152, 0, 0.15)', '#ff9800');
                drawFilledTriangle(points.C[i1a], points.A_p1, points.P3, 'rgba(255, 152, 0, 0.15)', '#ff9800');
                
                drawPoint(points.P2, 'Point ' + (i2a+1) + ',' + (i2b+1), '#e040fb'); 
                drawPoint(points.P3, 'Point ' + (i3+1), '#e040fb');
            }

            if (currentStep >= 7 && points.P2 && points.P3 && points.HR) {
                drawLine(points.HR, points.P2, '#666', true, 1); drawLine(points.HR, points.P3, '#666', true, 1);
                let bisect1 = perpBisector(points.HR, points.P2, 2000); let bisect2 = perpBisector(points.HR, points.P3, 2000);
                if (bisect1) drawLine(bisect1.p1, bisect1.p2, '#00e676', true, 1.5);
                if (bisect2) drawLine(bisect2.p1, bisect2.p2, '#00e676', true, 1.5);
                if(points.B1) { drawCircle(points.B1, dist(points.B1, points.HR), '#b388ff', true); drawPoint(points.B1, 'B₁', '#b388ff', 6); } 
            }
            ctx.restore();
            drawFinalMechanism();
        }

        function drawFinalMechanism() {
            let i1a = parseInt(document.getElementById('p1a-5').value);
            if (currentStep >= 8 && points.HC && points.B1 && points.A_p1 && points.HR) {
                let drawA = anim.initialized ? anim.A_current : points.A_p1;
                let drawB = anim.initialized ? anim.B_current : points.B1;
                let drawC = anim.initialized ? anim.C_current : points.C[i1a];

                drawLine(points.HC, points.HR, '#aaaaaa', true, 2); 
                drawLine(points.HC, drawA, '#ff5252', false, 4); 
                drawLine(points.HR, drawB, '#69f0ae', false, 4); 
                
                let spA = toScreen(drawA), spB = toScreen(drawB), spC = toScreen(drawC);
                ctx.fillStyle = 'rgba(255, 215, 0, 0.2)'; ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(spA.x, spA.y); ctx.lineTo(spB.x, spB.y); ctx.lineTo(spC.x, spC.y);
                ctx.closePath(); ctx.fill(); ctx.stroke();

                drawGroundPivot(points.HC, 'H_C'); drawGroundPivot(points.HR, 'H_R'); 
                drawPoint(drawA, 'A', '#ff9800', 6); drawPoint(drawB, 'B₁', '#10b981', 6); 
                drawPoint(drawC, anim.initialized ? 'Tracker' : 'C_base', '#ff5252', 6); 
            }
        }

        function animationLoop() {
            if (!anim.playing) return;
            anim.angle += (anim.speedMult * anim.dir);
            let HC = points.HC, HR = points.HR; let i1a = parseInt(document.getElementById('p1a-5').value);

            let A_next = { x: HC.x + anim.lengths.L1 * Math.cos(anim.angle), y: HC.y + anim.lengths.L1 * Math.sin(anim.angle) };
            let intersects = circleIntersection(A_next, anim.lengths.L2, HR, anim.lengths.L3);
            if (intersects.length === 0) {
                anim.dir *= -1; anim.angle += (anim.speedMult * anim.dir * 2); 
            } else {
                let B_next = intersects[0];
                if (intersects.length > 1) {
                    let d1 = dist(intersects[0], anim.lastB); let d2 = dist(intersects[1], anim.lastB);
                    if (d2 < d1) B_next = intersects[1];
                }
                anim.lastB = B_next; anim.A_current = A_next; anim.B_current = B_next;
                anim.C_current = rigidTransform(points.C[i1a], points.A_p1, points.B1, A_next, B_next);
                anim.path.push(anim.C_current);
                if(anim.path.length > 800) anim.path.shift();
            }
            draw(); anim.reqId = requestAnimationFrame(animationLoop);
        }

        function updateCircuitDefectUI() {
            let checkEl = document.getElementById('config-circuit-check-5'); if (!checkEl) return;
            if (currentStep >= 8 && fullCouplerCurve.length > 0) {
                let reached = circuitVisited.filter(v => v).length;
                checkEl.style.display = 'block';
                if (reached === 5) { checkEl.innerHTML = `✅ All 5 points on same circuit`; checkEl.style.color = 'var(--accent-done)'; } 
                else { checkEl.innerHTML = `⚠️ Circuit defect: ${reached}/5 points reached`; checkEl.style.color = '#ff5252'; }
            } else { checkEl.style.display = 'none'; }
        }

        function updateUI() {
            for (let i = 0; i < stepsInfo.length; i++) { let el = document.getElementById(`step-${i}-5`); if(el) el.className = `step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}`; }
            let activeEl = document.getElementById(`step-${currentStep}-5`); if (activeEl && activeEl.scrollIntoView) { activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" }); }

            document.getElementById('step1-controls-5').style.display = (currentStep >= 1) ? 'flex' : 'none';
            document.getElementById('slider-alpha-group-5').style.display = (currentStep === 2 || currentStep === 3) ? 'flex' : 'none';
            document.getElementById('slider-r-group-5').style.display = (currentStep >= 3) ? 'flex' : 'none';
            document.getElementById('config-panel-5').style.display = (currentStep >= 3) ? 'flex' : 'none';
            document.getElementById('btn-next-5').style.display = (currentStep < 8) ? 'block' : 'none';
            document.getElementById('btn-toggle-const-5').style.display = (currentStep >= 8) ? 'block' : 'none';
            document.getElementById('animation-palette-5').style.display = (currentStep >= 8) ? 'flex' : 'none';

            let elA2 = document.getElementById('btn-cfg-ap2-5'); if(elA2) elA2.disabled = currentStep < 3;
            let elA3 = document.getElementById('btn-cfg-ap3-5'); if(elA3) elA3.disabled = currentStep < 5;

            document.getElementById('btn-cfg-ap1-5').innerText = `A(P1): ${config.Ap1 === 0 ? '●1 / 2' : '1 / ●2'}`;
            document.getElementById('btn-cfg-ap2-5').innerText = `A(P2): ${config.Ap2 === 0 ? '●1 / 2' : '1 / ●2'}`;
            document.getElementById('btn-cfg-ap3-5').innerText = `A(P3): ${config.Ap3 === 0 ? '●1 / 2' : '1 / ●2'}`;
            
            updateCircuitDefectUI();
        }

        function initUI() {
            const container = document.getElementById('steps-container-5'); if(!container) return;
            container.innerHTML = '';
            stepsInfo.forEach((step, i) => {
                let div = document.createElement('div'); div.className = `step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}`; div.id = `step-${i}-5`;
                div.innerHTML = `<div class="step-title">${step.title}</div><div class="step-desc">${step.desc}</div>`; container.appendChild(div);
            });
            updateUI();
        }

        function stopAnimationHelper() {
            anim.initialized = false; anim.playing = false; cancelAnimationFrame(anim.reqId);
            let btnPlay = document.getElementById('btn-play-pause-5');
            if (btnPlay) { btnPlay.innerText = "Play Simulation"; btnPlay.style.backgroundColor = "var(--accent-done)"; btnPlay.style.color = "#000"; }
        }

        function autoFit() {
            let allPoints = [];
            if (points.C && points.C.length) allPoints.push(...points.C);
            if (points.HR) allPoints.push(points.HR); if (points.HC) allPoints.push(points.HC);
            if (points.A_p1) allPoints.push(points.A_p1); if (points.B1) allPoints.push(points.B1);
            if (currentStep >= 3 && points.HR) { allPoints.push({x: points.HR.x + radii.r, y: points.HR.y + radii.r}); allPoints.push({x: points.HR.x - radii.r, y: points.HR.y - radii.r}); }
            if (currentStep >= 4 && points.HC && points.A_p1) { let crankR = dist(points.HC, points.A_p1); allPoints.push({x: points.HC.x + crankR, y: points.HC.y + crankR}); allPoints.push({x: points.HC.x - crankR, y: points.HC.y - crankR}); }
            if (fullCouplerCurve && fullCouplerCurve.length) allPoints.push(...fullCouplerCurve);
            if (anim.path && anim.path.length) allPoints.push(...anim.path);
            
            if (allPoints.length === 0) return; 

            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            allPoints.forEach(p => { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; });
            let wX = maxX - minX; let wY = maxY - minY;
            if (wX === 0) wX = 100; if (wY === 0) wY = 100;
            let padX = wX * 0.15; let padY = wY * 0.15;
            minX -= padX; maxX += padX; minY -= padY; maxY += padY; wX = maxX - minX; wY = maxY - minY;

            let scaleX = width / wX; let scaleY = height / wY;
            let newScale = Math.min(scaleX, scaleY); newScale = Math.min(Math.max(newScale, 0.1), 10); 
            let cx = (minX + maxX) / 2; let cy = (minY + maxY) / 2;
            transform.k = newScale; transform.x = width / 2 - cx * newScale; transform.y = height / 2 - cy * newScale;

            let zoomPct = Math.round(newScale * 100); let sld = document.getElementById('slider-zoom-5'); let vld = document.getElementById('val-zoom-5');
            if(sld) sld.value = zoomPct; if(vld) vld.innerText = zoomPct; draw();
        }

        function resize() { 
            const area = document.getElementById('canvas-area-5'); 
            if (!area || area.clientWidth === 0) return; 
            canvas.width = area.clientWidth; canvas.height = area.clientHeight; 
            width = canvas.width; height = canvas.height; 
            if (transform.x === 0 && transform.y === 0 && width > 0) { transform.x = width / 2; transform.y = height / 2; }
            draw(); 
        }
        
        let baf = document.getElementById('btn-autofit-5'); if(baf) baf.addEventListener('click', autoFit);

        ['p1a-5', 'p1b-5', 'p2a-5', 'p2b-5'].forEach(id => {
            let el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => {
                    stopAnimationHelper(); recalculate(); updateUI();
                    if (currentStep > 0) autoFit(); else draw();
                });
            }
        });

        ['ap1','ap2','ap3'].forEach((a) => {
            let btn = document.getElementById(`btn-cfg-${a}-5`);
            if(btn) btn.addEventListener('click', () => {
                stopAnimationHelper(); let key = a.toUpperCase(); config[key] = 1 - config[key];
                recalculate(); updateUI(); autoFit();
            });
        });

        canvas.addEventListener('mousedown', (e) => { 
            isPanning = true; hasMoved = false; startPan = { x: e.clientX - transform.x, y: e.clientY - transform.y }; 
        });
        window.addEventListener('mousemove', (e) => {
            if (document.getElementById('app-5point').style.display === 'none') return;
            if (isPanning) {
                let newX = e.clientX - startPan.x; let newY = e.clientY - startPan.y;
                if (Math.abs(newX - transform.x) > 3 || Math.abs(newY - transform.y) > 3) hasMoved = true;
                transform.x = newX; transform.y = newY; if(!anim.playing) draw();
            }
        });
        window.addEventListener('mouseup', () => { isPanning = false; });
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault(); const zoomSensitivity = 0.001; const delta = -e.deltaY * zoomSensitivity;
            const newScale = Math.min(Math.max(0.1, transform.k * Math.exp(delta)), 10);
            const rect = canvas.getBoundingClientRect(); const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
            transform.x = mouseX - (mouseX - transform.x) * (newScale / transform.k); transform.y = mouseY - (mouseY - transform.y) * (newScale / transform.k); transform.k = newScale;
            let zoomPct = Math.round(newScale * 100); let sld = document.getElementById('slider-zoom-5'); if(sld) sld.value = zoomPct; 
            let vld = document.getElementById('val-zoom-5'); if(vld) vld.innerText = zoomPct; if(!anim.playing) draw();
        }, {passive: false});

        canvas.addEventListener('click', (e) => {
            if (hasMoved) return; 
            const rect = canvas.getBoundingClientRect(); const p = toWorld({x: e.clientX - rect.left, y: e.clientY - rect.top}); 
            if (currentStep === 0 && points.C.length < 5) { 
                points.C.push(p); 
                document.getElementById(`c${points.C.length}-x-5`).value = Math.round(p.x);
                document.getElementById(`c${points.C.length}-y-5`).value = Math.round(p.y);
                draw(); 
            }
            updateUI();
        });

        document.getElementById('btn-apply-coords-5').addEventListener('click', () => {
            points.C = [];
            for (let i = 1; i <= 5; i++) {
                const vx = parseFloat(document.getElementById(`c${i}-x-5`).value);
                const vy = parseFloat(document.getElementById(`c${i}-y-5`).value);
                if (!isNaN(vx) && !isNaN(vy)) points.C.push({ x: vx, y: vy });
            }
            recalculate(); updateUI(); draw();
        });

        let sA = document.getElementById('slider-alpha-5'); if(sA) sA.addEventListener('input', (e) => { radii.alpha = parseInt(e.target.value); document.getElementById('val-alpha-5').innerText = radii.alpha; stopAnimationHelper(); recalculate(); draw(); });
        let sr = document.getElementById('slider-r-5'); if(sr) sr.addEventListener('input', (e) => { radii.r = parseInt(e.target.value); document.getElementById('val-r-5').innerText = radii.r; stopAnimationHelper(); recalculate(); draw(); });
        let sZ = document.getElementById('slider-zoom-5'); if(sZ) sZ.addEventListener('input', (e) => {
            let zoomPct = parseInt(e.target.value); document.getElementById('val-zoom-5').innerText = zoomPct;
            let newScale = zoomPct / 100; let centerX = width / 2; let centerY = height / 2;
            transform.x = centerX - (centerX - transform.x) * (newScale / transform.k); transform.y = centerY - (centerY - transform.y) * (newScale / transform.k); transform.k = newScale;
            if(!anim.playing) draw();
        });
        let sS = document.getElementById('slider-speed-5'); if(sS) sS.addEventListener('input', (e) => { let val = parseInt(e.target.value); document.getElementById('val-speed-5').innerText = val; anim.speedMult = val * 0.0005; });
        
        let tgl = document.getElementById('btn-toggle-const-5'); if(tgl) tgl.addEventListener('click', (e) => {
            showConstruction = !showConstruction; e.target.innerText = showConstruction ? "Hide Construction" : "Show Construction"; if(!anim.playing) draw();
        });

        let ply = document.getElementById('btn-play-pause-5'); if(ply) ply.addEventListener('click', (e) => {
            if(currentStep < 8 || !points.HC || !points.HR || !points.A_p1 || !points.B1) return;
            if (!anim.initialized) {
                anim.initialized = true; anim.playing = true;
                anim.angle = Math.atan2(points.A_p1.y - points.HC.y, points.A_p1.x - points.HC.x); anim.lastB = {x: points.B1.x, y: points.B1.y}; anim.path = []; anim.dir = 1;
                anim.lengths = { L1: dist(points.HC, points.A_p1), L2: dist(points.A_p1, points.B1), L3: dist(points.HR, points.B1) };
                animationLoop();
            } else {
                anim.playing = !anim.playing;
                if (anim.playing) animationLoop(); else cancelAnimationFrame(anim.reqId);
            }
            e.target.innerText = anim.playing ? "Pause" : "Play Simulation";
            e.target.style.backgroundColor = anim.playing ? "#ffb300" : "var(--accent-done)"; e.target.style.color = "#000";
            updateUI();
        });

        let stp = document.getElementById('btn-stop-anim-5'); if(stp) stp.addEventListener('click', () => { stopAnimationHelper(); anim.path = []; draw(); updateUI(); });

        let nxt = document.getElementById('btn-next-5'); if(nxt) nxt.addEventListener('click', () => {
            if (currentStep === 0 && points.C.length < 5) { alert("Please place 5 precision points on the canvas first."); return; }
            if (currentStep < 8) {
                currentStep++; recalculate(); updateUI(); if (currentStep > 0) autoFit(); 
            }
        });

        let rnw = document.getElementById('btn-new-problem-5'); if (rnw) rnw.addEventListener('click', () => {
            stopAnimationHelper(); currentStep = 0; showConstruction = true; 
            points = { C: [], HR: null, A_p1: null, A_p2: null, HC: null, A_p3: null, P2: null, P3: null, B1: null };
            lines = { L1: null, L2: null, L1p: null, L2p: null, axis_p: null, a_p12: null };
            fullCouplerCurve = []; circuitVisited = [false, false, false, false, false]; anim.path = [];
            config = { Ap1: 0, Ap2: 0, Ap3: 0 }; radii = { alpha: 0, r: 100 };
            document.getElementById('slider-alpha-5').value = 0; document.getElementById('val-alpha-5').innerText = 0;
            document.getElementById('slider-r-5').value = 100; document.getElementById('val-r-5').innerText = 100;
            for (let i = 1; i <= 5; i++) { document.getElementById(`c${i}-x-5`).value = ''; document.getElementById(`c${i}-y-5`).value = ''; }
            transform = { x: width/2, y: height/2, k: 1 }; updateUI(); draw();
        });

        let rst = document.getElementById('btn-reset-5'); if(rst) rst.addEventListener('click', () => {
            stopAnimationHelper(); currentStep = 0; showConstruction = true; 
            let tglC = document.getElementById('btn-toggle-const-5'); if(tglC) tglC.innerText = "Hide Construction";
            points = { C: points.C, HR: null, A_p1: null, A_p2: null, HC: null, A_p3: null, P2: null, P3: null, B1: null };
            lines = { L1: null, L2: null, L1p: null, L2p: null, axis_p: null, a_p12: null };
            fullCouplerCurve = []; circuitVisited = [false, false, false, false, false]; anim.path = [];
            config = { Ap1: 0, Ap2: 0, Ap3: 0 }; radii = { alpha: 0, r: 100 };
            document.getElementById('slider-alpha-5').value = 0; document.getElementById('val-alpha-5').innerText = 0;
            document.getElementById('slider-r-5').value = 100; document.getElementById('val-r-5').innerText = 100;
            document.getElementById('btn-cfg-ap1-5').innerText = "A(P1): ●1 / 2"; document.getElementById('btn-cfg-ap2-5').innerText = "A(P2): ●1 / 2"; document.getElementById('btn-cfg-ap3-5').innerText = "A(P3): ●1 / 2";
            transform = { x: width/2, y: height/2, k: 1 }; let sld = document.getElementById('slider-zoom-5'); if(sld) sld.value = 0; let vld = document.getElementById('val-zoom-5'); if(vld) vld.innerText = 100;
            updateUI(); draw();
        });

        let bck = document.getElementById('btn-back-5'); if(bck) bck.addEventListener('click', () => {
            stopAnimationHelper(); if(currentStep > 0) currentStep--;
            if(currentStep < 8) { fullCouplerCurve = []; circuitVisited = [false, false, false, false, false]; anim.path = []; }
            if(currentStep === 0) points.C = [];
            showConstruction = true; let tglC = document.getElementById('btn-toggle-const-5'); if(tglC) tglC.innerText = "Hide Construction";
            recalculate(); updateUI(); if (currentStep > 0) autoFit(); else draw();
        });

        initUI(); setTimeout(resize, 50);
        window.app5 = { resize: resize, draw: draw, anim: anim };

    } catch (err) {
        const errBox = document.getElementById('steps-container-5');
        if (errBox) { errBox.innerHTML = '<div style="color:#ff5252; padding:15px; font-weight:bold; word-wrap: break-word;">Engine Error:<br><br>' + err.message + '<br><br>' + err.stack + '</div>'; } 
        else { alert("Fatal Error: " + err.message); }
    }
})();

// === BOOT ===
app4 = init4Point();
app5 = window.app5;
window.switchMode(4);
