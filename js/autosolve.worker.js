// autosolve.worker.js — Web Worker for brute-force parameter search
// All geometry/construction logic is inlined directly.

function dist(p1, p2) { return Math.hypot(p2.x - p1.x, p2.y - p1.y); }
function midpoint(p1, p2) { return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }; }

function perpBisector(p1, p2, length) {
    length = length || 5000;
    var mid = midpoint(p1, p2);
    var dx = p2.x - p1.x;
    var dy = p2.y - p1.y;
    var len = Math.hypot(dx, dy);
    if (len === 0) return null;
    return {
        p1: { x: mid.x + (-dy / len) * length, y: mid.y + (dx / len) * length },
        p2: { x: mid.x - (-dy / len) * length, y: mid.y - (dx / len) * length }
    };
}

function projectPointOnLine(p, lS, lE) {
    var dx = lE.x - lS.x, dy = lE.y - lS.y;
    var l2 = dx * dx + dy * dy;
    if (l2 === 0) return lS;
    var t = ((p.x - lS.x) * dx + (p.y - lS.y) * dy) / l2;
    return { x: lS.x + t * dx, y: lS.y + t * dy };
}

function rotateLine(line, pivot, angleDeg) {
    var rad = angleDeg * Math.PI / 180;
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    var rot = function (p) {
        var dx = p.x - pivot.x;
        var dy = p.y - pivot.y;
        return {
            x: pivot.x + dx * cos - dy * sin,
            y: pivot.y + dx * sin + dy * cos
        };
    };
    return { p1: rot(line.p1), p2: rot(line.p2) };
}

function lineIntersection(l1, l2) {
    var x1 = l1.p1.x, y1 = l1.p1.y, x2 = l1.p2.x, y2 = l1.p2.y;
    var x3 = l2.p1.x, y3 = l2.p1.y, x4 = l2.p2.x, y4 = l2.p2.y;
    var den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-10) return null;
    var numP1 = x1 * y2 - y1 * x2, numP2 = x3 * y4 - y3 * x4;
    return {
        x: (numP1 * (x3 - x4) - (x1 - x2) * numP2) / den,
        y: (numP1 * (y3 - y4) - (y1 - y2) * numP2) / den
    };
}

function lineCircleIntersection(l, center, radius) {
    var proj = projectPointOnLine(center, l.p1, l.p2);
    var d = dist(center, proj);
    if (d > radius + 1e-6) return [];
    if (Math.abs(d - radius) < 1e-6) return [proj];

    var h = Math.sqrt(Math.max(0, radius * radius - d * d));
    var len = dist(l.p1, l.p2);
    if (len === 0) return [];
    var ux = (l.p2.x - l.p1.x) / len;
    var uy = (l.p2.y - l.p1.y) / len;

    return [
        { x: proj.x + ux * h, y: proj.y + uy * h },
        { x: proj.x - ux * h, y: proj.y - uy * h }
    ];
}

function circleIntersection(c1, r1, c2, r2) {
    var d = dist(c1, c2);
    if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) return [];
    var a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    var h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    var p2 = { x: c1.x + a * (c2.x - c1.x) / d, y: c1.y + a * (c2.y - c1.y) / d };
    return [
        { x: p2.x + h * (c2.y - c1.y) / d, y: p2.y - h * (c2.x - c1.x) / d },
        { x: p2.x - h * (c2.y - c1.y) / d, y: p2.y + h * (c2.x - c1.x) / d }
    ];
}

function rigidTransform(p, frameP1, frameP2, targetP1, targetP2) {
    var aF = Math.atan2(frameP2.y - frameP1.y, frameP2.x - frameP1.x);
    var aT = Math.atan2(targetP2.y - targetP1.y, targetP2.x - targetP1.x);
    var dA = aT - aF;
    var vx = p.x - frameP1.x, vy = p.y - frameP1.y;
    return {
        x: targetP1.x + vx * Math.cos(dA) - vy * Math.sin(dA),
        y: targetP1.y + vx * Math.sin(dA) + vy * Math.cos(dA)
    };
}

function circumcenter(p1, p2, p3) {
    var d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
    if (Math.abs(d) < 1e-5) return null;
    var ux = ((p1.x * p1.x + p1.y * p1.y) * (p2.y - p3.y) + (p2.x * p2.x + p2.y * p2.y) * (p3.y - p1.y) + (p3.x * p3.x + p3.y * p3.y) * (p1.y - p2.y)) / d;
    var uy = ((p1.x * p1.x + p1.y * p1.y) * (p3.x - p2.x) + (p2.x * p2.x + p2.y * p2.y) * (p1.x - p3.x) + (p3.x * p3.x + p3.y * p3.y) * (p2.x - p1.x)) / d;
    return { x: ux, y: uy };
}

function calcTransmissionAngle(A, B, HR) {
    var bax = A.x - B.x, bay = A.y - B.y;
    var bhrx = HR.x - B.x, bhry = HR.y - B.y;
    var dot = bax * bhrx + bay * bhry;
    var magBA = Math.hypot(bax, bay), magBHR = Math.hypot(bhrx, bhry);
    if (magBA === 0 || magBHR === 0) return 90;
    return (Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBHR)))) * 180) / Math.PI;
}

function computeFullPath(C_points, HC, A1, B1, HR, fastSweep) {
    var L1 = dist(HC, A1), L2 = dist(A1, B1), L3 = dist(HR, B1);
    var startAngle = Math.atan2(A1.y - HC.y, A1.x - HC.x);
    var step = fastSweep ? 0.05 : 0.01;
    var maxSteps = Math.floor((Math.PI * 2) / step + 10);
    var minGamma = 180, maxGamma = 0;

    var trace = function (initTheta, dTheta) {
        var path = [], currLastB = { x: B1.x, y: B1.y }, theta = initTheta;
        for (var i = 0; i < maxSteps; i++) {
            var A_next = { x: HC.x + L1 * Math.cos(theta), y: HC.y + L1 * Math.sin(theta) };
            var inters = circleIntersection(A_next, L2, HR, L3);
            if (!inters.length) break;
            var B_next = inters[0];
            if (inters.length > 1 && dist(inters[1], currLastB) < dist(inters[0], currLastB)) B_next = inters[1];
            var gamma = calcTransmissionAngle(A_next, B_next, HR);
            if (gamma < minGamma) minGamma = gamma;
            if (gamma > maxGamma) maxGamma = gamma;
            currLastB = B_next;
            path.push(rigidTransform(C_points[0], A1, B1, A_next, B_next));
            theta += dTheta;
        }
        return path;
    };

    var forwardPath = trace(startAngle, step);
    var backwardPath = trace(startAngle - step, -step).reverse();
    var finalPath = backwardPath.concat(forwardPath);

    var circuitVisited = Array(C_points.length).fill(false), hitIndices = Array(C_points.length).fill(-1);
    for (var idx = 0; idx < C_points.length; idx++) {
        var minD = Infinity, bestK = -1;
        for (var k = 0; k < finalPath.length; k++) {
            var dd = dist(C_points[idx], finalPath[k]);
            if (dd < minD) { minD = dd; bestK = k; }
        }
        if (minD < 15) { circuitVisited[idx] = true; hitIndices[idx] = bestK; }
    }

    return { path: finalPath, circuitVisited: circuitVisited, hitIndices: hitIndices, minGamma: minGamma, maxGamma: maxGamma };
}

function runSynthesisCore(C, HR, HC, R, r, config, fastSweep) {
    var res = {
        A1: null, A2: null, A3: null, A4: null, P2: null, P4: null, B1: null,
        circuitVisited: Array(C.length).fill(false), hitIndices: Array(C.length).fill(-1)
    };
    if (!HR || !C || C.length < 3) return res;

    var int1 = circleIntersection(C[0], r, HR, R);
    var int3 = circleIntersection(C[2], r, HR, R);
    if (int1.length) res.A1 = int1[config.A1 % int1.length];
    if (int3.length) res.A3 = int3[config.A3 % int3.length];
    if (!HC || !res.A1 || C.length < 4) return res;

    var crankR = dist(HC, res.A1);
    var int2 = circleIntersection(C[1], r, HC, crankR);
    var int4 = circleIntersection(C[3], r, HC, crankR);
    if (int2.length) res.A2 = int2[config.A2 % int2.length];
    if (int4.length) res.A4 = int4[config.A4 % int4.length];

    if (res.A1 && res.A2 && res.A4) {
        res.P2 = rigidTransform(HR, C[1], res.A2, C[0], res.A1);
        res.P4 = rigidTransform(HR, C[3], res.A4, C[0], res.A1);
    }

    if (res.P2 && res.P4) {
        res.B1 = circumcenter(res.P2, HR, res.P4);
        if (res.B1) {
            var cpResult = computeFullPath(C, HC, res.A1, res.B1, HR, fastSweep);
            res.circuitVisited = cpResult.circuitVisited;
            res.hitIndices = cpResult.hitIndices;
            res.minGamma = cpResult.minGamma;
            res.maxGamma = cpResult.maxGamma;
        }
    }
    return res;
}

function computeFullState5_inline(C, phi, r, config, HR, fastSweep) {
    var res = {
        A1: null, A2: null, A3: null, A4: null, A5: null,
        P23: null, P4: null, B1: null, HR: HR, HC: null,
        circuitVisited: Array(C.length).fill(false),
        hitIndices: Array(C.length).fill(-1),
        minGamma: 180, maxGamma: 0
    };

    var c23 = perpBisector(C[1], C[2]);
    var c15 = perpBisector(C[0], C[4]);
    if (!c23 || !c15) return res;

    var c15_prime = rotateLine(c15, HR, phi / 2);
    var c23_prime = rotateLine(c23, HR, phi / 2);

    var ints1 = lineCircleIntersection(c15_prime, C[0], r);
    if (ints1.length > 0) res.A1 = ints1[config.A1 % ints1.length];

    var ints2 = lineCircleIntersection(c23_prime, C[2], r);
    if (ints2.length > 0) res.A2 = ints2[config.A2 % ints2.length];

    if (!res.A1 || !res.A2) return res;

    var a12 = perpBisector(res.A1, res.A2);
    if (!a12) return res;

    res.HC = lineIntersection(a12, c23_prime);
    if (!res.HC) return res;

    var crankR = dist(res.HC, res.A1);
    var ints4 = circleIntersection(C[3], r, res.HC, crankR);
    if (ints4.length > 0) res.A4 = ints4[0];

    res.P23 = rigidTransform(HR, C[2], res.A2, C[0], res.A1);
    if (res.A4) {
        res.P4 = rigidTransform(HR, C[3], res.A4, C[0], res.A1);
    }

    if (res.P23 && res.P4) {
        res.B1 = circumcenter(res.P23, HR, res.P4);
    }

    if (res.B1) {
        var cpResult = computeFullPath(C, res.HC, res.A1, res.B1, HR, fastSweep);
        res.circuitVisited = cpResult.circuitVisited;
        res.hitIndices = cpResult.hitIndices;
        res.minGamma = cpResult.minGamma;
        res.maxGamma = cpResult.maxGamma;
    }
    return res;
}

function evaluateGrashof(HC, A1, B1, HR) {
    var L1 = dist(HC, A1), L2 = dist(A1, B1), L3 = dist(B1, HR), L4 = dist(HC, HR);
    var sorted = [L1, L2, L3, L4].sort(function (a, b) { return a - b; });
    var s = sorted[0], p = sorted[1], q = sorted[2], l = sorted[3];
    var isGrashof = (s + l <= p + q);
    var mechType = 'Non-Grashof', inputType = 'Rocker', outputType = 'Rocker';
    if (isGrashof) {
        if (s === L1) { mechType = 'Crank-Rocker'; inputType = 'Crank'; outputType = 'Rocker'; }
        else if (s === L4) { mechType = 'Double-Crank'; inputType = 'Crank'; outputType = 'Crank'; }
        else if (s === L3) { mechType = 'Rocker-Crank'; inputType = 'Rocker'; outputType = 'Crank'; }
        else { mechType = 'Double-Rocker'; inputType = 'Rocker'; outputType = 'Rocker'; }
    }
    return {
        isGrashof: isGrashof, mechType: mechType, inputType: inputType, outputType: outputType,
        linkLengths: { crank: L1, coupler: L2, rocker: L3, frame: L4 },
        ratio: s > 0 ? l / s : Infinity
    };
}

function runSearch(C, filters, maxRatio, mode) {
    var filterDriver = filters && filters.driver ? filters.driver.toLowerCase() : 'any';
    var filterDriven = filters && filters.driven ? filters.driven.toLowerCase() : 'any';
    var filterMinGamma = filters && filters.minGamma !== undefined ? filters.minGamma : 40;
    var filterMaxRatio = maxRatio !== undefined ? maxRatio : 20;
    var filterEnableRatio = filters && filters.enableRatio !== undefined ? filters.enableRatio : true;
    var filterEnableOrder = filters && filters.enableOrder !== undefined ? filters.enableOrder : true;
    var filterEnableGamma = filters && filters.enableGamma !== undefined ? filters.enableGamma : true;
    var synthesisMode = mode || 4;

    var validSolutions = [];
    var cancelled = false;

    var dist_c13 = dist(C[0], C[2]);
    var minVal = 0.5 * dist_c13;
    var maxVal = 3.0 * dist_c13;
    var r_vals = [];
    for (var rri = 0; rri < 10; rri++) {
        r_vals.push(minVal * Math.pow(maxVal / minVal, rri / 9));
    }

    if (synthesisMode === 5) {
        var c23 = perpBisector(C[1], C[2]);
        var c15 = perpBisector(C[0], C[4]);
        var hr = (c23 && c15) ? lineIntersection(c23, c15) : null;

        if (!hr) {
            postMessage({ type: 'done', solutions: [] });
            return;
        }

        var phi_vals = [];
        for (var pi = 0; pi < 36; pi++) {
            phi_vals.push(-180 + (360 * pi / 35));
        }

        for (var pi = 0; pi < phi_vals.length && !cancelled; pi++) {
            var phi = phi_vals[pi];
            var progressPct = Math.round((pi / phi_vals.length) * 100);

            for (var ri = 0; ri < r_vals.length && !cancelled; ri++) {
                var r = r_vals[ri];
                for (var c1 = 0; c1 < 2; c1++) {
                    for (var c2 = 0; c2 < 2; c2++) {
                        var cfg = { A1: c1, A2: c2, A3: 0, A4: 0 };
                        var res = computeFullState5_inline(C, phi, r, cfg, hr, true);

                        if (res.circuitVisited && res.circuitVisited.every(function (v) { return v; })) {
                            var gInfo = evaluateGrashof(res.HC, res.A1, res.B1, hr);

                            if (filterDriver !== 'any' && gInfo.inputType.toLowerCase() !== filterDriver) continue;
                            if (filterDriven !== 'any' && gInfo.outputType.toLowerCase() !== filterDriven) continue;
                            if (filterEnableRatio && gInfo.ratio > filterMaxRatio) continue;

                            if (filterEnableOrder) {
                                var h = res.hitIndices;
                                var isIncreasing = true, isDecreasing = true;
                                for (var ki = 0; ki < h.length - 1; ki++) {
                                    if (h[ki] >= h[ki + 1]) isIncreasing = false;
                                    if (h[ki] <= h[ki + 1]) isDecreasing = false;
                                }
                                if (!isIncreasing && !isDecreasing) continue;
                            }

                            if (filterEnableGamma) {
                                var worst_gamma = Math.min(res.minGamma, 180 - res.maxGamma);
                                if (worst_gamma < filterMinGamma) continue;
                            }

                            validSolutions.push({
                                HR: hr, HC: res.HC, R: phi, r: r, config: cfg, // store phi in R for slider UI compat
                                linkLengths: gInfo.linkLengths,
                                grashof: gInfo.isGrashof,
                                type: gInfo.mechType,
                                inputType: gInfo.inputType,
                                outputType: gInfo.outputType,
                                minGamma: res.minGamma,
                                maxGamma: res.maxGamma,
                                ratio: gInfo.ratio
                            });
                        }
                    }
                }
            }
            if (pi % 2 === 0) postMessage({ type: 'progress', percent: progressPct, found: validSolutions.length });
        }
    } else {
        var c13 = perpBisector(C[0], C[2]);
        if (!c13 || dist_c13 === 0) {
            postMessage({ type: 'done', solutions: [] });
            return;
        }

        var mid_c13 = midpoint(C[0], C[2]);
        var dx = c13.p2.x - c13.p1.x, dy = c13.p2.y - c13.p1.y;
        var length = Math.hypot(dx, dy);
        var ux = dx / length, uy = dy / length;

        var HR_points = [], R_vals = [];
        for (var hi = 0; hi < 8; hi++) {
            var t = -3 * dist_c13 + (6 * dist_c13 * hi / 7);
            HR_points.push({ x: mid_c13.x + t * ux, y: mid_c13.y + t * uy });
        }
        for (var ri = 0; ri < 9; ri++) {
            R_vals.push(minVal * Math.pow(maxVal / minVal, ri / 8));
        }

        for (var i = 0; i < HR_points.length && !cancelled; i++) {
            var hr = HR_points[i];
            var progressPct = Math.round((i / HR_points.length) * 100);

            for (var Ri = 0; Ri < R_vals.length && !cancelled; Ri++) {
                for (var rri2 = 0; rri2 < r_vals.length && !cancelled; rri2++) {
                    var R = R_vals[Ri], r = r_vals[rri2];
                    var int1 = circleIntersection(C[0], r, hr, R);
                    var int3 = circleIntersection(C[2], r, hr, R);
                    if (!int1.length || !int3.length) continue;

                    for (var c1 = 0; c1 < 2; c1++) {
                        for (var c3 = 0; c3 < 2; c3++) {
                            var A1 = int1[c1 % int1.length], A3 = int3[c3 % int3.length];
                            var a13 = perpBisector(A1, A3);
                            if (!a13) continue;

                            var midA = midpoint(A1, A3);
                            var dxa = a13.p2.x - a13.p1.x, dya = a13.p2.y - a13.p1.y;
                            var len_a = Math.hypot(dxa, dya);
                            if (len_a === 0) continue;
                            var hc = { x: midA.x + (dxa / len_a) * R, y: midA.y + (dya / len_a) * R };

                            for (var c2 = 0; c2 < 2; c2++) {
                                for (var c4 = 0; c4 < 2; c4++) {
                                    var cfg = { A1: c1, A2: c2, A3: c3, A4: c4 };
                                    var res = runSynthesisCore(C, hr, hc, R, r, cfg, true);

                                    if (res.circuitVisited.every(function (v) { return v; })) {
                                        var gInfo = evaluateGrashof(hc, res.A1, res.B1, hr);
                                        if (filterDriver !== 'any' && gInfo.inputType.toLowerCase() !== filterDriver) continue;
                                        if (filterDriven !== 'any' && gInfo.outputType.toLowerCase() !== filterDriven) continue;
                                        if (filterEnableRatio && gInfo.ratio > filterMaxRatio) continue;
                                        if (filterEnableOrder) {
                                            var h = res.hitIndices;
                                            var isIncreasing = true, isDecreasing = true;
                                            for (var ki = 0; ki < h.length - 1; ki++) {
                                                if (h[ki] >= h[ki + 1]) isIncreasing = false;
                                                if (h[ki] <= h[ki + 1]) isDecreasing = false;
                                            }
                                            if (!isIncreasing && !isDecreasing) continue;
                                        }
                                        if (filterEnableGamma) {
                                            var worst_gamma = Math.min(res.minGamma, 180 - res.maxGamma);
                                            if (worst_gamma < filterMinGamma) continue;
                                        }

                                        validSolutions.push({
                                            HR: hr, HC: hc, R: R, r: r, config: cfg,
                                            linkLengths: gInfo.linkLengths,
                                            grashof: gInfo.isGrashof,
                                            type: gInfo.mechType,
                                            inputType: gInfo.inputType,
                                            outputType: gInfo.outputType,
                                            minGamma: res.minGamma,
                                            maxGamma: res.maxGamma,
                                            ratio: gInfo.ratio
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (i % 2 === 0) postMessage({ type: 'progress', percent: progressPct, found: validSolutions.length });
        }
    }

    validSolutions.sort(function (a, b) {
        if (a.grashof !== b.grashof) return a.grashof ? -1 : 1;
        return a.ratio - b.ratio;
    });

    postMessage({ type: 'done', solutions: validSolutions.slice(0, 5) });
}

self.onmessage = function (e) {
    var data = e.data;
    if (data && data.C) {
        runSearch(data.C, data.filters, data.maxRatio, data.synthesisMode);
    }
};