/*
 * FRACTURE LATTICE — hero canvas animation.
 * Vanilla <canvas> 2D, no dependencies. Deterministic (seeded PRNG).
 * A gently curved "spine" fissure sweeps across a dark field, sprouting a
 * Voronoi-hairline lattice that visibly grows out of it, over a static 1-bit
 * dither plate. Once settled, a soft translucent sweep loops diagonally
 * across the filled cells, forever.
 */
(function () {
    'use strict';

    var CONTAINER_SELECTOR = '.hero-image';
    var SEED = 133742069;
    var PLATE_SEED = 90210777;

    // ---------------------------------------------------------------
    // small helpers
    // ---------------------------------------------------------------
    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function smoothstep(edge0, edge1, x) {
        var t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    }
    function dist(x0, y0, x1, y1) { return Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)); }
    function lerpPoint(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

    function bezierPoint(P0, P1, P2, t) {
        var mt = 1 - t;
        return [
            mt * mt * P0[0] + 2 * mt * t * P1[0] + t * t * P2[0],
            mt * mt * P0[1] + 2 * mt * t * P1[1] + t * t * P2[1]
        ];
    }
    // De Casteljau subdivision: control points of the sub-curve covering [0, t].
    function bezierTrim(P0, P1, P2, t) {
        var Q1 = lerpPoint(P0, P1, t);
        var R1 = lerpPoint(P1, P2, t);
        var Q2 = lerpPoint(Q1, R1, t);
        return [P0, Q1, Q2];
    }

    function makeValueNoise2D(rng, gridSize) {
        var n = gridSize + 1;
        var g = new Float32Array(n * n);
        for (var i = 0; i < g.length; i++) g[i] = rng();
        return function (x, y) {
            var gx = x * gridSize, gy = y * gridSize;
            var x0 = Math.floor(gx), y0 = Math.floor(gy);
            if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
            if (x0 > gridSize - 1) x0 = gridSize - 1;
            if (y0 > gridSize - 1) y0 = gridSize - 1;
            var x1 = x0 + 1, y1 = y0 + 1;
            var fx = gx - x0, fy = gy - y0;
            var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
            var v00 = g[y0 * n + x0], v10 = g[y0 * n + x1];
            var v01 = g[y1 * n + x0], v11 = g[y1 * n + x1];
            var top = v00 + (v10 - v00) * sx;
            var bot = v01 + (v11 - v01) * sx;
            return top + (bot - top) * sy;
        };
    }

    // ---------------------------------------------------------------
    // Convex-polygon half-plane clipping (tagged edges), used to build
    // Voronoi cells by intersecting half-planes against a bounding box.
    // ---------------------------------------------------------------
    function clipConvexTagged(verts, tags, planeFn, clipTag) {
        var n = verts.length;
        var outV = [], outT = [];
        for (var i = 0; i < n; i++) {
            var cur = verts[i], nxt = verts[(i + 1) % n];
            var tag = tags[i];
            var fc = planeFn(cur[0], cur[1]);
            var fn = planeFn(nxt[0], nxt[1]);
            var cIn = fc <= 0, nIn = fn <= 0;
            if (cIn) { outV.push(cur); outT.push(tag); }
            if (cIn !== nIn) {
                var t = fc / (fc - fn);
                var ip = [cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t];
                outV.push(ip);
                outT.push(cIn ? clipTag : tag);
            }
        }
        return [outV, outT];
    }

    function polygonArea(v) {
        var a = 0, n = v.length;
        for (var i = 0; i < n; i++) {
            var p0 = v[i], p1 = v[(i + 1) % n];
            a += p0[0] * p1[1] - p1[0] * p0[1];
        }
        return a / 2;
    }

    function polygonCentroid(v) {
        var a = polygonArea(v), n = v.length, cx = 0, cy = 0;
        if (Math.abs(a) < 1e-9) {
            for (var i = 0; i < n; i++) { cx += v[i][0]; cy += v[i][1]; }
            return [cx / n, cy / n];
        }
        for (var i2 = 0; i2 < n; i2++) {
            var p0 = v[i2], p1 = v[(i2 + 1) % n];
            var cross = p0[0] * p1[1] - p1[0] * p0[1];
            cx += (p0[0] + p1[0]) * cross;
            cy += (p0[1] + p1[1]) * cross;
        }
        return [cx / (6 * a), cy / (6 * a)];
    }

    function boundingRectPoly(minX, minY, maxX, maxY) {
        return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
    }

    function cellFor(index, points, minX, minY, maxX, maxY) {
        var p = points[index];
        var verts = boundingRectPoly(minX, minY, maxX, maxY);
        var tags = ['rect', 'rect', 'rect', 'rect'];
        for (var j = 0; j < points.length; j++) {
            if (j === index) continue;
            var q = points[j];
            var abx = q[0] - p[0], aby = q[1] - p[1];
            var c = p[0] * p[0] + p[1] * p[1] - q[0] * q[0] - q[1] * q[1];
            var planeFn = (function (abx, aby, c) {
                return function (x, y) { return 2 * (x * abx + y * aby) + c; };
            })(abx, aby, c);
            var res = clipConvexTagged(verts, tags, planeFn, j);
            verts = res[0]; tags = res[1];
            if (verts.length === 0) break;
        }
        return { verts: verts, tags: tags };
    }

    // ---------------------------------------------------------------
    // Build the whole lattice model once, in a fixed virtual coordinate
    // space (independent of actual pixel size) so the pattern and the
    // reveal timeline are fully deterministic and resize-stable.
    // ---------------------------------------------------------------
    function buildLatticeModel() {
        var rng = mulberry32(SEED);

        var VW = 1000;              // virtual R width
        var VH = VW / 0.91;         // virtual R height (aspect 0.91)

        // Lattice rectangle L: offset ~2.5% right/up from R, with an
        // asymmetric overflow so the plate visibly pokes out on the left
        // while the lattice overflows top / right / bottom.
        var Lx0 = 0.02 * VW;                 // left edge inset 2% (plate shows through)
        var Ly0 = -0.03 * VH;                // top overflow 3%
        var Lx1 = VW + 0.03 * VW;            // right overflow 3%
        var Ly1 = VH + 0.025 * VH;           // bottom overflow 2.5%
        var Lw = Lx1 - Lx0, Lh = Ly1 - Ly0;

        // ---- spine geometry: gentle quadratic-bezier crack through R's ----
        // centre, upper-left to lower-right, extending slightly past L.
        var Rcx = VW / 2, Rcy = VH / 2;
        var diagHalf = Math.sqrt(VW * VW + VH * VH) / 2 * 1.09;
        var dirx = Math.SQRT1_2, diry = Math.SQRT1_2;
        var spineP0 = [Rcx - dirx * diagHalf, Rcy - diry * diagHalf];
        var spineP2 = [Rcx + dirx * diagHalf, Rcy + diry * diagHalf];
        var spineStraightLen = dist(spineP0[0], spineP0[1], spineP2[0], spineP2[1]);
        var bowx = diry, bowy = -dirx; // perpendicular to the straight diagonal, bowed upward
        var curveAmt = 0.045 * spineStraightLen;
        var spineP1 = [
            (spineP0[0] + spineP2[0]) / 2 + bowx * curveAmt,
            (spineP0[1] + spineP2[1]) / 2 + bowy * curveAmt
        ];

        var CURVE_SAMPLES = 48;
        var curvePts = [];
        for (var cs = 0; cs <= CURVE_SAMPLES; cs++) {
            curvePts.push(bezierPoint(spineP0, spineP1, spineP2, cs / CURVE_SAMPLES));
        }
        // closest point on the spine polyline: returns [u (0..1 along spine), v (perp distance)]
        function closestOnSpine(px, py) {
            var bestD2 = Infinity, bestU = 0;
            for (var si = 0; si < CURVE_SAMPLES; si++) {
                var a = curvePts[si], b = curvePts[si + 1];
                var abx = b[0] - a[0], aby = b[1] - a[1];
                var abLen2 = abx * abx + aby * aby || 1e-9;
                var t = clamp(((px - a[0]) * abx + (py - a[1]) * aby) / abLen2, 0, 1);
                var cxp = a[0] + abx * t, cyp = a[1] + aby * t;
                var d2 = (px - cxp) * (px - cxp) + (py - cyp) * (py - cyp);
                if (d2 < bestD2) { bestD2 = d2; bestU = (si + t) / CURVE_SAMPLES; }
            }
            return [bestU, Math.sqrt(bestD2)];
        }

        // ---- seed scatter (jittered grid + density modulation) ----
        var padFrac = 0.05;
        var minX = Lx0 - padFrac * Lw, maxX = Lx1 + padFrac * Lw;
        var minY = Ly0 - padFrac * Lh, maxY = Ly1 + padFrac * Lh;

        var cols = 12, rows = 13;
        var cellW = (maxX - minX) / cols, cellH = (maxY - minY) / rows;
        var cx = (Lx0 + Lx1) / 2, cy = (Ly0 + Ly1) / 2;

        var points = [];
        for (var i = 0; i < cols; i++) {
            for (var j = 0; j < rows; j++) {
                var bxc = minX + (i + 0.5) * cellW;
                var byc = minY + (j + 0.5) * cellH;
                var px = bxc + (rng() - 0.5) * cellW * 0.75;
                var py = byc + (rng() - 0.5) * cellH * 0.75;

                var uv = closestOnSpine(px, py);
                var perpNorm = clamp(uv[1] / (Lw * 0.62), 0, 1);
                var centerNorm = clamp(dist(px, py, cx, cy) / (Lw * 0.62), 0, 1);
                var lowerLeftness = clamp(((py - cy) / Lh - (px - cx) / Lw) * 0.9, 0, 1);
                var edgeNorm = clamp(Math.min(px - minX, maxX - px, py - minY, maxY - py) / (0.14 * Lw), 0, 1);

                var weight = 0.62;
                weight += 0.42 * (1 - perpNorm);   // denser near spine
                weight += 0.24 * (1 - centerNorm); // denser near centre
                weight -= 0.34 * lowerLeftness;    // sparser lower-left
                weight -= 0.26 * (1 - edgeNorm);   // sparser near outer edges
                weight = clamp(weight, 0.16, 1.05);

                if (rng() < weight) points.push([px, py]);
            }
        }

        // ---- Lloyd relaxation (2 iterations) ----
        var clipMinX = minX - 0.02 * Lw, clipMaxX = maxX + 0.02 * Lw;
        var clipMinY = minY - 0.02 * Lh, clipMaxY = maxY + 0.02 * Lh;

        for (var iter = 0; iter < 2; iter++) {
            var next = [];
            for (var k = 0; k < points.length; k++) {
                var cell = cellFor(k, points, clipMinX, clipMinY, clipMaxX, clipMaxY);
                if (cell.verts.length < 3) { next.push(points[k]); continue; }
                var c2 = polygonCentroid(cell.verts);
                next.push([lerp(points[k][0], c2[0], 0.85), lerp(points[k][1], c2[1], 0.85)]);
            }
            points = next;
        }

        // ---- spine-hugging seed pairs, added AFTER relaxation (unrelaxed) so ----
        // their bisector edges trace tightly along the curve: the lattice
        // visibly grows out of the spine instead of floating near it.
        for (var st = 0.06; st <= 0.94; st += 0.042) {
            var cpt = bezierPoint(spineP0, spineP1, spineP2, st);
            var tanx = 2 * (1 - st) * (spineP1[0] - spineP0[0]) + 2 * st * (spineP2[0] - spineP1[0]);
            var tany = 2 * (1 - st) * (spineP1[1] - spineP0[1]) + 2 * st * (spineP2[1] - spineP1[1]);
            var tanLen = Math.sqrt(tanx * tanx + tany * tany) || 1;
            var perpx = -tany / tanLen, perpy = tanx / tanLen;
            var sep = 0.0055 * Lw * (0.7 + rng() * 0.6);
            points.push([cpt[0] + perpx * sep, cpt[1] + perpy * sep]);
            points.push([cpt[0] - perpx * sep, cpt[1] - perpy * sep]);
        }

        // ---- global vertex jitter (organic junctions), shared vertices move together ----
        var meanCellDiam = Math.sqrt((Lw * Lh) / Math.max(points.length, 1)) * 1.13;
        var jitterAmt = 0.015 * meanCellDiam;
        var vertMap = {};
        function jitteredVertex(p) {
            var key = Math.round(p[0] * 6) + ':' + Math.round(p[1] * 6);
            var jv = vertMap[key];
            if (!jv) {
                jv = [p[0] + (rng() - 0.5) * 2 * jitterAmt, p[1] + (rng() - 0.5) * 2 * jitterAmt];
                vertMap[key] = jv;
            }
            return jv;
        }

        // ---- final Voronoi pass: extract deduped tagged edges + cell polygons ----
        var edgeMap = {};
        var cells = [];
        var bottomLeft = [Lx0, Ly1], topRight = [Lx1, Ly0];
        var sweepDx = topRight[0] - bottomLeft[0], sweepDy = topRight[1] - bottomLeft[1];
        var sweepLen2 = sweepDx * sweepDx + sweepDy * sweepDy;

        for (var k2 = 0; k2 < points.length; k2++) {
            var cellF = cellFor(k2, points, clipMinX, clipMinY, clipMaxX, clipMaxY);
            var verts = cellF.verts, tags = cellF.tags;
            var nV = verts.length;
            if (nV >= 3) {
                var jpoly = [];
                for (var pv = 0; pv < nV; pv++) jpoly.push(jitteredVertex(verts[pv]));
                var centroid = polygonCentroid(jpoly);
                var sweepProj = ((centroid[0] - bottomLeft[0]) * sweepDx + (centroid[1] - bottomLeft[1]) * sweepDy) / sweepLen2;
                cells.push({ poly: jpoly, sweepProj: sweepProj });
            }
            for (var e = 0; e < nV; e++) {
                var tag = tags[e];
                if (tag === 'rect') continue;
                var other = tag;
                var key = k2 < other ? (k2 + '_' + other) : (other + '_' + k2);
                if (edgeMap[key]) continue;
                var a = verts[e], b = verts[(e + 1) % nV];
                if (dist(a[0], a[1], b[0], b[1]) < 1e-4) continue;
                edgeMap[key] = { a: a, b: b };
            }
        }

        var rawEdges = [];
        for (var key2 in edgeMap) rawEdges.push(edgeMap[key2]);

        var corners = [[Lx0, Ly0], [Lx1, Ly0], [Lx0, Ly1], [Lx1, Ly1]];
        var maxV = 0;
        for (var ci = 0; ci < corners.length; ci++) {
            maxV = Math.max(maxV, closestOnSpine(corners[ci][0], corners[ci][1])[1]);
        }

        var edges = [];
        for (var r = 0; r < rawEdges.length; r++) {
            var ja = jitteredVertex(rawEdges[r].a);
            var jb = jitteredVertex(rawEdges[r].b);
            var elen = dist(ja[0], ja[1], jb[0], jb[1]);
            if (elen < 1e-4) continue;

            var mx = (ja[0] + jb[0]) / 2, my = (ja[1] + jb[1]) / 2;
            var muv = closestOnSpine(mx, my);
            var u = clamp(muv[0], 0, 1);
            var v = clamp(muv[1] / maxV, 0, 1);

            var jitter = (rng() - 0.5) * 0.2;
            var tReveal = 0.20 + 1.15 * u + 1.55 * v + jitter;
            var gate = u * 1.4;
            var effectiveReveal = Math.max(tReveal, gate);

            // grow outward: start from whichever endpoint sits closer to the spine
            var va = closestOnSpine(ja[0], ja[1])[1], vb = closestOnSpine(jb[0], jb[1])[1];
            var p1 = va <= vb ? ja : jb;
            var p2 = va <= vb ? jb : ja;

            var lightness = Math.round(lerp(0xB4, 0xDC, rng()));

            edges.push({
                x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
                revealTime: effectiveReveal,
                steadyLightness: lightness
            });
        }

        var maxDone = 1.4; // spine draw duration
        for (var m = 0; m < edges.length; m++) {
            maxDone = Math.max(maxDone, edges[m].revealTime + 0.12 + 0.6);
        }

        return {
            virtualW: VW, virtualH: VH,
            edges: edges,
            cells: cells,
            spineP0: spineP0, spineP1: spineP1, spineP2: spineP2,
            spineDuration: 1.4,
            totalDuration: maxDone + 0.15,
            sweepLoopDuration: 3.4,
            sweepBandHalfWidth: 0.24
        };
    }

    // ---------------------------------------------------------------
    // Plate (static 1-bit dither grain), rasterised at actual device px.
    // ---------------------------------------------------------------
    function renderPlate(targetCanvas, Rw, Rh) {
        Rw = Math.max(1, Math.round(Rw));
        Rh = Math.max(1, Math.round(Rh));
        targetCanvas.width = Rw;
        targetCanvas.height = Rh;
        var ctx = targetCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, Rw, Rh);

        var rng = mulberry32(PLATE_SEED);
        var noiseLow = makeValueNoise2D(rng, 8);
        var noiseMid = makeValueNoise2D(rng, 18);

        var blockSize = Math.max(1, Math.round(Rw / 145));
        var cols = Math.ceil(Rw / blockSize);
        var rows = Math.ceil(Rh / blockSize);

        for (var by = 0; by < rows; by++) {
            var v = by / rows;
            for (var bx = 0; bx < cols; bx++) {
                var u = bx / cols;
                var n = 0.55 * noiseLow(u, v) + 0.30 * noiseMid(u, v) + 0.15 * rng();
                var leftBoost = 0.30 * (1 - smoothstep(0, 0.6, u));
                var val = n + leftBoost - 0.603;
                if (val <= 0) continue;
                var t = clamp(val * 3.2, 0, 1);
                var lightness = Math.round(lerp(0x1A, 0x3E, clamp(t + leftBoost * 0.4, 0, 1)));
                ctx.fillStyle = 'rgb(' + lightness + ',' + lightness + ',' + lightness + ')';
                ctx.fillRect(bx * blockSize, by * blockSize, blockSize, blockSize);
            }
        }
    }

    // ---------------------------------------------------------------
    // Controller: sizes the canvas, drives the rAF loop, and freezes.
    // ---------------------------------------------------------------
    function init() {
        var container = document.querySelector(CONTAINER_SELECTOR);
        if (!container) return;

        var canvas = container.querySelector('canvas.fracture-lattice-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');

        var model = buildLatticeModel();
        var plateCanvas = document.createElement('canvas');
        var linesCache = document.createElement('canvas');
        var linesCacheValid = false;

        var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        var R = { x: 0, y: 0, w: 0, h: 0 };
        var canvasW = 0, canvasH = 0;
        var t0 = null;
        var rafId = null;

        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function computeRect() {
            var box = container.getBoundingClientRect();
            canvasW = Math.max(1, Math.round(box.width * dpr));
            canvasH = Math.max(1, Math.round(box.height * dpr));

            var maxRw = 620 * dpr;
            var Rw = Math.min(box.width * 0.65 * dpr, maxRw, canvasW);
            var Rh = Rw / 0.91;
            if (Rh > canvasH * 0.92) { Rh = canvasH * 0.92; Rw = Rh * 0.91; }
            R.w = Rw; R.h = Rh;
            R.x = (canvasW - Rw) / 2;
            R.y = (canvasH - Rh) / 2;
        }

        function toDevice(vx, vy) {
            var scale = R.w / model.virtualW;
            return [R.x + vx * scale, R.y + vy * scale];
        }

        function resize() {
            dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
            computeRect();
            canvas.width = canvasW;
            canvas.height = canvasH;
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            renderPlate(plateCanvas, R.w, R.h);
            linesCacheValid = false;
            if (reduceMotion) draw(Infinity);
        }

        function drawSpine(targetCtx, progress) {
            var P0 = toDevice(model.spineP0[0], model.spineP0[1]);
            var P1 = toDevice(model.spineP1[0], model.spineP1[1]);
            var P2 = toDevice(model.spineP2[0], model.spineP2[1]);
            var ctl = progress >= 1 ? [P0, P1, P2] : bezierTrim(P0, P1, P2, progress);
            targetCtx.strokeStyle = '#FFFFFF';
            targetCtx.lineWidth = 2.5;
            targetCtx.shadowColor = '#FFFFFF';
            targetCtx.shadowBlur = 9;
            targetCtx.beginPath();
            targetCtx.moveTo(ctl[0][0], ctl[0][1]);
            targetCtx.quadraticCurveTo(ctl[1][0], ctl[1][1], ctl[2][0], ctl[2][1]);
            targetCtx.stroke();
            targetCtx.shadowBlur = 0;
            targetCtx.shadowColor = 'transparent';
        }

        // Once the growth animation has fully settled, the hairline lattice
        // and the spine no longer change frame to frame — bake them into an
        // offscreen bitmap once so the eternal sweep loop stays cheap.
        function renderLinesCache() {
            linesCache.width = canvasW;
            linesCache.height = canvasH;
            var lctx = linesCache.getContext('2d');
            lctx.clearRect(0, 0, canvasW, canvasH);
            lctx.lineWidth = 1;
            var edges = model.edges;
            for (var i = 0; i < edges.length; i++) {
                var e = edges[i];
                var p1 = toDevice(e.x1, e.y1), p2 = toDevice(e.x2, e.y2);
                lctx.strokeStyle = 'rgb(' + e.steadyLightness + ',' + e.steadyLightness + ',' + e.steadyLightness + ')';
                lctx.beginPath();
                lctx.moveTo(p1[0], p1[1]);
                lctx.lineTo(p2[0], p2[1]);
                lctx.stroke();
            }
            drawSpine(lctx, 1);
            linesCacheValid = true;
        }

        // Soft violet "field" that sweeps diagonally (lower-left to upper-right)
        // across the finished cells and loops forever once the lattice settles.
        function drawSweep(targetCtx, phase) {
            var half = model.sweepBandHalfWidth;
            var bandCenter = phase * (1 + 2 * half) - half;
            var scale = R.w / model.virtualW;
            var cells = model.cells;
            for (var i = 0; i < cells.length; i++) {
                var c = cells[i];
                var d = Math.abs(c.sweepProj - bandCenter);
                if (d > half) continue;
                var tt = 1 - d / half;
                var opacity = 0.22 * (tt * tt * (3 - 2 * tt));
                if (opacity < 0.004) continue;
                var poly = c.poly;
                targetCtx.beginPath();
                for (var pv = 0; pv < poly.length; pv++) {
                    var dpx = R.x + poly[pv][0] * scale, dpy = R.y + poly[pv][1] * scale;
                    if (pv === 0) targetCtx.moveTo(dpx, dpy); else targetCtx.lineTo(dpx, dpy);
                }
                targetCtx.closePath();
                targetCtx.fillStyle = 'rgba(186,148,240,' + opacity.toFixed(3) + ')';
                targetCtx.fill();
            }
        }

        function draw(elapsedSec) {
            var forceFinal = elapsedSec === Infinity;

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.imageSmoothingEnabled = true;
            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
            ctx.fillStyle = '#0A0A0A';
            ctx.fillRect(0, 0, canvasW, canvasH);

            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(plateCanvas, Math.round(R.x), Math.round(R.y));
            ctx.imageSmoothingEnabled = true;

            var settledNow = forceFinal || elapsedSec >= model.totalDuration;

            if (settledNow) {
                if (!linesCacheValid) renderLinesCache();
                if (!forceFinal) {
                    var loopPhase = ((elapsedSec - model.totalDuration) % model.sweepLoopDuration) / model.sweepLoopDuration;
                    drawSweep(ctx, loopPhase);
                }
                ctx.drawImage(linesCache, 0, 0);
                return;
            }

            var edges = model.edges;
            for (var i = 0; i < edges.length; i++) {
                var e = edges[i];
                var localElapsed = elapsedSec - e.revealTime;
                if (localElapsed < 0) continue;

                var growProgress = clamp(localElapsed / 0.12, 0, 1);
                var decayProgress = clamp((localElapsed - 0.12) / 0.6, 0, 1);

                var p1 = toDevice(e.x1, e.y1);
                var p2full = toDevice(e.x2, e.y2);
                var p2 = growProgress < 1
                    ? [lerp(p1[0], p2full[0], growProgress), lerp(p1[1], p2full[1], growProgress)]
                    : p2full;

                var lightByte = Math.round(lerp(255, e.steadyLightness, decayProgress));
                var glow = lerp(6, 0, decayProgress);

                ctx.strokeStyle = 'rgb(' + lightByte + ',' + lightByte + ',' + lightByte + ')';
                ctx.lineWidth = 1;
                if (glow > 0.05) {
                    ctx.shadowColor = '#FFFFFF';
                    ctx.shadowBlur = glow;
                } else {
                    ctx.shadowBlur = 0;
                    ctx.shadowColor = 'transparent';
                }
                ctx.beginPath();
                ctx.moveTo(p1[0], p1[1]);
                ctx.lineTo(p2[0], p2[1]);
                ctx.stroke();
            }

            var spineProgress = clamp(elapsedSec / model.spineDuration, 0, 1);
            drawSpine(ctx, spineProgress);
        }

        function loop(now) {
            if (t0 === null) t0 = now;
            var elapsedSec = (now - t0) / 1000;
            draw(elapsedSec);
            rafId = requestAnimationFrame(loop);
        }

        resize();

        if (reduceMotion) {
            draw(Infinity);
        } else {
            rafId = requestAnimationFrame(loop);
        }

        if (window.ResizeObserver) {
            var ro = new ResizeObserver(function () { resize(); });
            ro.observe(container);
        } else {
            window.addEventListener('resize', resize);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
