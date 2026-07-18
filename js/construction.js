// construction.js — Port of the Flask /calculate endpoint logic
import {
    dist, perpBisector, circleIntersection, rigidTransform,
    circumcenter, computeFullPath, lineIntersection,
    rotateLine, lineCircleIntersection
} from './geometry.js';

export function computeFullState(C, HR, HC, R, r, config, fastSweep = false, mode = 4) {
    const res = {
        A1: null, A2: null, A3: null, A4: null,
        P2: null, P4: null, B1: null,
        fullCouplerCurve: [],
        circuitVisited: [false, false, false, false, false],
        hitIndices: [-1, -1, -1, -1, -1],
        minGamma: 180, maxGamma: 0,
        lines: { c13: null, a13: null }
    };

    if (!C || C.length < 3) return res;

    res.lines.c13 = perpBisector(C[0], C[2]);

    if (mode === 5) return res;
    if (!HR) return res;

    const int1 = circleIntersection(C[0], r, HR, R);
    const int3 = circleIntersection(C[2], r, HR, R);

    if (int1.length) res.A1 = int1[config.A1 % int1.length];
    if (int3.length) res.A3 = int3[config.A3 % int3.length];

    if (res.A1 && res.A3) {
        res.lines.a13 = perpBisector(res.A1, res.A3);
    }

    if (!HC || !res.A1 || C.length < 4) return res;

    const crankR = dist(HC, res.A1);
    const int2 = circleIntersection(C[1], r, HC, crankR);
    const int4 = circleIntersection(C[3], r, HC, crankR);

    if (int2.length) res.A2 = int2[config.A2 % int2.length];
    if (int4.length) res.A4 = int4[config.A4 % int4.length];

    if (res.A1 && res.A2 && res.A4) {
        res.P2 = rigidTransform(HR, C[1], res.A2, C[0], res.A1);
        res.P4 = rigidTransform(HR, C[3], res.A4, C[0], res.A1);
    }

    if (res.P2 && res.P4) {
        res.B1 = circumcenter(res.P2, HR, res.P4);
        if (res.B1) {
            const { path, circuitVisited, hitIndices, minGamma, maxGamma } = computeFullPath(C, HC, res.A1, res.B1, HR, fastSweep);
            res.fullCouplerCurve = path;
            res.circuitVisited = circuitVisited;
            res.hitIndices = hitIndices;
            res.minGamma = minGamma;
            res.maxGamma = maxGamma;
        }
    }

    return res;
}

export function computeFullState5(C, phi, r, config, fastSweep = false) {
    const res = {
        A1: null, A2: null, A3: null, A4: null, A5: null,
        P23: null, P4: null, B1: null, HR: null, HC: null,
        fullCouplerCurve: [],
        circuitVisited: [false, false, false, false, false],
        hitIndices: [-1, -1, -1, -1, -1],
        minGamma: 180, maxGamma: 0,
        lines: { c15: null, c23: null, c15_prime: null, c23_prime: null, a12: null }
    };

    if (!C || C.length < 5) return res;

    res.lines.c23 = perpBisector(C[1], C[2]);
    res.lines.c15 = perpBisector(C[0], C[4]);
    if (!res.lines.c23 || !res.lines.c15) return res;

    res.HR = lineIntersection(res.lines.c23, res.lines.c15);
    if (!res.HR) return res;

    res.lines.c15_prime = rotateLine(res.lines.c15, res.HR, phi / 2);
    res.lines.c23_prime = rotateLine(res.lines.c23, res.HR, phi / 2);

    // Pivot 1 based off C1
    const ints1 = lineCircleIntersection(res.lines.c15_prime, C[0], r);
    if (ints1.length > 0) res.A1 = ints1[config.A1 % ints1.length];

    // Pivot "2" (Internal mathematical node matching C3 physically, to sync smoothly with the UI)
    const ints2 = lineCircleIntersection(res.lines.c23_prime, C[2], r);
    if (ints2.length > 0) res.A2 = ints2[config.A2 % ints2.length];

    if (!res.A1 || !res.A2) return res;

    res.lines.a12 = perpBisector(res.A1, res.A2);
    if (!res.lines.a12) return res;

    // Enforce dead center geometry limitation to form valid 5-point mechanism
    res.HC = lineIntersection(res.lines.a12, res.lines.c23_prime);
    if (!res.HC) return res;

    const crankR = dist(res.HC, res.A1);

    // Evaluate constraints on remaining precision points along crank trace
    const ints3 = circleIntersection(C[1], r, res.HC, crankR);
    if (ints3.length > 0) res.A3 = ints3[0];

    const ints4 = circleIntersection(C[3], r, res.HC, crankR);
    if (ints4.length > 0) res.A4 = ints4[0];

    const ints5 = circleIntersection(C[4], r, res.HC, crankR);
    if (ints5.length > 0) res.A5 = ints5[0];

    // Invert point 3 logic
    res.P23 = rigidTransform(res.HR, C[2], res.A2, C[0], res.A1);
    if (res.A4) {
        res.P4 = rigidTransform(res.HR, C[3], res.A4, C[0], res.A1);
    }

    if (res.P23 && res.P4) {
        res.B1 = circumcenter(res.P23, res.HR, res.P4);
    }

    if (res.B1) {
        const { path, circuitVisited, hitIndices, minGamma, maxGamma } = computeFullPath(C, res.HC, res.A1, res.B1, res.HR, fastSweep);
        res.fullCouplerCurve = path;
        res.circuitVisited = circuitVisited;
        res.hitIndices = hitIndices;
        res.minGamma = minGamma;
        res.maxGamma = maxGamma;
    }

    return res;
}