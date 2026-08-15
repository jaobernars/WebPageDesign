/*
 * FRACTURE LATTICE — hero canvas animation.
 * Vanilla <canvas> 2D, no dependencies. Deterministic (seeded PRNG).
 *
 * A Voronoi web grows outward from a main fissure over a flickering 1-bit
 * dither plate. The web is built as a real graph — shared nodes, deduped
 * edges — and every junction is filleted, so edges curve into each other
 * near the nodes like a spider web instead of meeting at hard corners.
 * The main line is not drawn on top of the web: it IS a chain of the web's
 * own edges (seeded by placing cell centres in pairs straddling it), so
 * branches meet it at genuine, visibly rounded nodes.
 *
 * Once settled, a soft translucent sweep loops diagonally across the cells.
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

    function bezierPoint(P0, P1, P2, t) {
        var mt = 1 - t;
        return [
            mt * mt * P0[0] + 2 * mt * t * P1[0] + t * t * P2[0],
            mt * mt * P0[1] + 2 * mt * t * P1[1] + t * t * P2[1]
        ];
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

        // Lattice rectangle L: offset from R with an asymmetric overflow so
        // the grain plate pokes out on the left while the web overflows top,
        // right and bottom.
        var Lx0 = 0.02 * VW;
        var Ly0 = -0.03 * VH;
        var Lx1 = VW + 0.03 * VW;
        var Ly1 = VH + 0.025 * VH;
        var Lw = Lx1 - Lx0, Lh = Ly1 - Ly0;

        // ---- main-line guide path -----------------------------------
        // A chain of slightly-angled straight segments whose chord bows
        // gently upward, running upper-left to lower-right through the
        // centre. Nothing is drawn from this directly — it only tells the
        // seed scatter where to straddle, so the Voronoi itself produces
        // the main line as a chain of its own edges.
        var Rcx = VW / 2, Rcy = VH / 2;
        var diagHalf = Math.sqrt(VW * VW + VH * VH) / 2 * 1.04;
        var dirx = Math.SQRT1_2, diry = Math.SQRT1_2;
        var guideStart = [Rcx - dirx * diagHalf, Rcy - diry * diagHalf];
        var guideEnd = [Rcx + dirx * diagHalf, Rcy + diry * diagHalf];
        var spineStraightLen = dist(guideStart[0], guideStart[1], guideEnd[0], guideEnd[1]);
        var bowx = diry, bowy = -dirx;   // perpendicular, bowed upward
        var guideMid = [
            (guideStart[0] + guideEnd[0]) / 2 + bowx * (0.05 * spineStraightLen),
            (guideStart[1] + guideEnd[1]) / 2 + bowy * (0.05 * spineStraightLen)
        ];

        var SPINE_SEGMENTS = 5;
        var spinePts = [guideStart];
        for (var wi = 1; wi < SPINE_SEGMENTS; wi++) {
            var wt = wi / SPINE_SEGMENTS;
            var g = bezierPoint(guideStart, guideMid, guideEnd, wt);
            var wobble = (rng() - 0.5) * 2 * (0.014 * spineStraightLen);
            spinePts.push([g[0] + bowx * wobble, g[1] + bowy * wobble]);
        }
        spinePts.push(guideEnd);

        var spineSegLen = [], spineCumLen = [0], spineTotalLen = 0, spineTangents = [];
        for (var sg = 0; sg < spinePts.length - 1; sg++) {
            var sdx = spinePts[sg + 1][0] - spinePts[sg][0];
            var sdy = spinePts[sg + 1][1] - spinePts[sg][1];
            var slen = Math.sqrt(sdx * sdx + sdy * sdy) || 1e-6;
            spineSegLen.push(slen);
            spineTotalLen += slen;
            spineCumLen.push(spineTotalLen);
            spineTangents.push([sdx / slen, sdy / slen]);
        }

        // [u (0..1 by arc length), v (perpendicular distance)]
        function closestOnSpine(px, py) {
            var bestD2 = Infinity, bestU = 0;
            for (var si = 0; si < spinePts.length - 1; si++) {
                var a = spinePts[si], b = spinePts[si + 1];
                var abx = b[0] - a[0], aby = b[1] - a[1];
                var abLen2 = abx * abx + aby * aby || 1e-9;
                var t = clamp(((px - a[0]) * abx + (py - a[1]) * aby) / abLen2, 0, 1);
                var cxp = a[0] + abx * t, cyp = a[1] + aby * t;
                var d2 = (px - cxp) * (px - cxp) + (py - cyp) * (py - cyp);
                if (d2 < bestD2) {
                    bestD2 = d2;
                    bestU = (spineCumLen[si] + t * spineSegLen[si]) / spineTotalLen;
                }
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
                var px = minX + (i + 0.5) * cellW + (rng() - 0.5) * cellW * 0.75;
                var py = minY + (j + 0.5) * cellH + (rng() - 0.5) * cellH * 0.75;

                var uv = closestOnSpine(px, py);
                var perpNorm = clamp(uv[1] / (Lw * 0.62), 0, 1);
                var centerNorm = clamp(dist(px, py, cx, cy) / (Lw * 0.62), 0, 1);
                var lowerLeftness = clamp(((py - cy) / Lh - (px - cx) / Lw) * 0.9, 0, 1);
                var edgeNorm = clamp(Math.min(px - minX, maxX - px, py - minY, maxY - py) / (0.14 * Lw), 0, 1);

                var weight = 0.62;
                weight += 0.34 * (1 - perpNorm);
                weight += 0.24 * (1 - centerNorm);
                weight -= 0.34 * lowerLeftness;
                weight -= 0.26 * (1 - edgeNorm);
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
                var cellR = cellFor(k, points, clipMinX, clipMinY, clipMaxX, clipMaxY);
                if (cellR.verts.length < 3) { next.push(points[k]); continue; }
                var c2 = polygonCentroid(cellR.verts);
                next.push([lerp(points[k][0], c2[0], 0.85), lerp(points[k][1], c2[1], 0.85)]);
            }
            points = next;
        }

        var meanCellDiam = Math.sqrt((Lw * Lh) / Math.max(points.length, 1)) * 1.13;

        // ---- straddle seeds: the main line as real Voronoi edges ------
        // Pairs of cell centres mirrored across the guide path. The Voronoi
        // boundary between each pair is exactly the guide path, so the main
        // line emerges as a continuous chain of ordinary web edges — every
        // branch that reaches it terminates in a genuine shared node.
        // Separation is a healthy fraction of a cell so the neighbours are
        // normal-sized cells, not slivers.
        var straddleStep = 0.92 * meanCellDiam;
        var straddleSep = 0.44 * meanCellDiam;
        var nStraddle = Math.max(2, Math.round(spineTotalLen / straddleStep));
        for (var sIdx = 0; sIdx <= nStraddle; sIdx++) {
            var su = sIdx / nStraddle;
            var sArc = su * spineTotalLen;
            var segI = 0;
            while (segI < spineSegLen.length - 1 && sArc > spineCumLen[segI + 1]) segI++;
            var localT = clamp((sArc - spineCumLen[segI]) / spineSegLen[segI], 0, 1);
            var basePt = [
                spinePts[segI][0] + (spinePts[segI + 1][0] - spinePts[segI][0]) * localT,
                spinePts[segI][1] + (spinePts[segI + 1][1] - spinePts[segI][1]) * localT
            ];
            var tan = spineTangents[segI];
            var nx = -tan[1], ny = tan[0];
            // slide along the tangent a little so junctions are not evenly spaced
            var slide = (rng() - 0.5) * straddleStep * 0.45;
            var sepA = straddleSep * (0.85 + rng() * 0.3);
            var sepB = straddleSep * (0.85 + rng() * 0.3);
            points.push([basePt[0] + tan[0] * slide + nx * sepA, basePt[1] + tan[1] * slide + ny * sepA]);
            points.push([basePt[0] + tan[0] * slide - nx * sepB, basePt[1] + tan[1] * slide - ny * sepB]);
        }

        // ---- Voronoi -> graph (deduped nodes + edges) ----------------
        var nodes = [];
        var nodeKey = {};
        var vertJitter = 0.02 * meanCellDiam;
        function nodeIndex(p) {
            var key = Math.round(p[0] * 4) + ':' + Math.round(p[1] * 4);
            var idx = nodeKey[key];
            if (idx === undefined) {
                idx = nodes.length;
                nodes.push([
                    p[0] + (rng() - 0.5) * 2 * vertJitter,
                    p[1] + (rng() - 0.5) * 2 * vertJitter
                ]);
                nodeKey[key] = idx;
            }
            return idx;
        }

        var rawEdges = [];
        var edgeKey = {};
        function addEdge(ia, ib) {
            if (ia === ib) return;
            var k = ia < ib ? (ia + '_' + ib) : (ib + '_' + ia);
            if (edgeKey[k] !== undefined) return;
            edgeKey[k] = rawEdges.length;
            rawEdges.push({ a: ia, b: ib });
        }

        var cells = [];
        var bottomLeft = [Lx0, Ly1];
        var sweepDx = Lx1 - Lx0, sweepDy = Ly0 - Ly1;
        var sweepLen2 = sweepDx * sweepDx + sweepDy * sweepDy;

        for (var k2 = 0; k2 < points.length; k2++) {
            var cellF = cellFor(k2, points, clipMinX, clipMinY, clipMaxX, clipMaxY);
            var verts = cellF.verts, tags = cellF.tags, nV = verts.length;
            if (nV < 3) continue;

            var idxRing = [];
            for (var pv = 0; pv < nV; pv++) idxRing.push(nodeIndex(verts[pv]));

            var ringPts = [];
            for (var rp = 0; rp < idxRing.length; rp++) ringPts.push(nodes[idxRing[rp]]);
            var centroid = polygonCentroid(ringPts);
            var sweepProj = ((centroid[0] - bottomLeft[0]) * sweepDx + (centroid[1] - bottomLeft[1]) * sweepDy) / sweepLen2;
            cells.push({ ring: idxRing, sweepProj: sweepProj });

            for (var e = 0; e < nV; e++) {
                if (tags[e] === 'rect') continue;   // never draw the clip box
                addEdge(idxRing[e], idxRing[(e + 1) % nV]);
            }
        }

        // per-edge and per-node position along / distance from the guide path
        var nodeUV = [];
        for (var nu = 0; nu < nodes.length; nu++) {
            nodeUV.push(closestOnSpine(nodes[nu][0], nodes[nu][1]));
        }
        for (var ce = 0; ce < rawEdges.length; ce++) {
            var ed = rawEdges[ce];
            var pa = nodes[ed.a], pb = nodes[ed.b];
            var mM = closestOnSpine((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2);
            ed.isSpine = false;
            ed.uMid = mM[0];
            ed.vMid = mM[1];
            ed.uA = nodeUV[ed.a][0];
            ed.uB = nodeUV[ed.b][0];
        }

        // ---- adjacency, sorted by angle around each node -------------
        var adj = [];
        for (var an = 0; an < nodes.length; an++) adj.push([]);
        for (var ae = 0; ae < rawEdges.length; ae++) {
            var eRec = rawEdges[ae];
            var pA = nodes[eRec.a], pB = nodes[eRec.b];
            adj[eRec.a].push({ edge: ae, other: eRec.b, angle: Math.atan2(pB[1] - pA[1], pB[0] - pA[0]) });
            adj[eRec.b].push({ edge: ae, other: eRec.a, angle: Math.atan2(pA[1] - pB[1], pA[0] - pB[0]) });
        }
        for (var sa = 0; sa < adj.length; sa++) {
            adj[sa].sort(function (p, q) { return p.angle - q.angle; });
        }

        // ---- trace the main line as ONE connected path ---------------
        // Marking every edge that merely sits near the guide path leaves gaps
        // wherever the Voronoi wanders off it, and a greedy walk dead-ends.
        // Instead take the cheapest path through the graph from the entry
        // node to the exit node, where an edge costs its own length inflated
        // by how far it strays from the guide. The result hugs the guide and
        // is connected by construction.
        var entryNode = -1, entryScore = Infinity;
        var exitNode = -1, exitScore = Infinity;
        var corridor = 1.3 * meanCellDiam;
        for (var cs2 = 0; cs2 < nodes.length; cs2++) {
            // vertices that only ever belonged to the clip box have no edges
            if (adj[cs2].length < 2) continue;
            var cvv = nodeUV[cs2][1];
            if (cvv > corridor) continue;
            var cuu = nodeUV[cs2][0];
            var nearness = cvv / (8 * meanCellDiam);   // tiebreak among clamped u
            if (cuu + nearness < entryScore) { entryScore = cuu + nearness; entryNode = cs2; }
            if ((1 - cuu) + nearness < exitScore) { exitScore = (1 - cuu) + nearness; exitNode = cs2; }
        }

        if (entryNode >= 0 && exitNode >= 0 && entryNode !== exitNode) {
            var INF = Infinity;
            var distTo = new Float64Array(nodes.length);
            var prevEdge = new Int32Array(nodes.length);
            var prevNode = new Int32Array(nodes.length);
            var done = new Uint8Array(nodes.length);
            for (var di = 0; di < nodes.length; di++) {
                distTo[di] = INF; prevEdge[di] = -1; prevNode[di] = -1;
            }
            distTo[entryNode] = 0;

            for (var step = 0; step < nodes.length; step++) {
                var pick = -1, pickD = INF;
                for (var pi2 = 0; pi2 < nodes.length; pi2++) {
                    if (!done[pi2] && distTo[pi2] < pickD) { pickD = distTo[pi2]; pick = pi2; }
                }
                if (pick < 0) break;
                done[pick] = 1;
                var ringD = adj[pick];
                for (var rd = 0; rd < ringD.length; rd++) {
                    var nb = ringD[rd].other;
                    if (done[nb]) continue;
                    var eIdx = ringD[rd].edge;
                    var pP = nodes[pick], pQ = nodes[nb];
                    var segLen = dist(pP[0], pP[1], pQ[0], pQ[1]);
                    var strayed = (nodeUV[pick][1] + nodeUV[nb][1]) / 2 / meanCellDiam;
                    var w = segLen * (1 + 6 * strayed * strayed);
                    if (distTo[pick] + w < distTo[nb]) {
                        distTo[nb] = distTo[pick] + w;
                        prevEdge[nb] = eIdx;
                        prevNode[nb] = pick;
                    }
                }
            }

            // if the chosen exit turned out unreachable, settle for the
            // reachable node that gets furthest along the guide
            var target = exitNode;
            if (distTo[target] === INF) {
                var bestU = -Infinity;
                for (var fb = 0; fb < nodes.length; fb++) {
                    if (distTo[fb] === INF || nodeUV[fb][1] > corridor) continue;
                    if (nodeUV[fb][0] > bestU) { bestU = nodeUV[fb][0]; target = fb; }
                }
            }

            var back = target, hops = 0;
            while (back !== entryNode && prevEdge[back] >= 0 && hops++ < 600) {
                rawEdges[prevEdge[back]].isSpine = true;
                back = prevNode[back];
            }
        }

        // ---- reveal timing ------------------------------------------
        var corners = [[Lx0, Ly0], [Lx1, Ly0], [Lx0, Ly1], [Lx1, Ly1]];
        var maxV = 1;
        for (var ci = 0; ci < corners.length; ci++) {
            maxV = Math.max(maxV, closestOnSpine(corners[ci][0], corners[ci][1])[1]);
        }

        var SPINE_DURATION = 1.5;
        var LATTICE_GROW = 0.13;

        for (var te = 0; te < rawEdges.length; te++) {
            var t = rawEdges[te];
            if (t.isSpine) {
                var u0 = Math.min(t.uA, t.uB), u1 = Math.max(t.uA, t.uB);
                t.revealTime = u0 * SPINE_DURATION;
                t.growDuration = Math.max(0.05, (u1 - u0) * SPINE_DURATION);
                t.growFromA = t.uA <= t.uB;
                t.steadyLightness = 244;
            } else {
                var vN = clamp(t.vMid / maxV, 0, 1);
                var uN = clamp(t.uMid, 0, 1);
                var jitter = (rng() - 0.5) * 0.2;
                // cannot appear before the main line's tip has swept past it
                t.revealTime = Math.max(0.18 + 1.05 * uN + 1.7 * vN + jitter, uN * SPINE_DURATION);
                t.growDuration = LATTICE_GROW;
                var vA = closestOnSpine(nodes[t.a][0], nodes[t.a][1])[1];
                var vB = closestOnSpine(nodes[t.b][0], nodes[t.b][1])[1];
                t.growFromA = vA <= vB;   // grow outward, away from the main line
                t.steadyLightness = Math.round(lerp(0xB4, 0xDC, rng()));
            }
        }

        // ---- trim every edge back from its nodes, so the gap can be ---
        // filled by a fillet curve that bends one edge into the next.
        var filletR = 0.27 * meanCellDiam;
        var edges = [];
        for (var fe = 0; fe < rawEdges.length; fe++) {
            var re = rawEdges[fe];
            var na = nodes[re.a], nb = nodes[re.b];
            var ex = nb[0] - na[0], ey = nb[1] - na[1];
            var elen = Math.sqrt(ex * ex + ey * ey);
            if (elen < 1e-4) { edges.push(null); continue; }
            var ux = ex / elen, uy = ey / elen;
            // the main line barely pulls back, so it still reads as one line
            var want = re.isSpine ? filletR * 0.34 : filletR;
            var trim = Math.min(want, elen * 0.34);

            var ax = na[0] + ux * trim, ay = na[1] + uy * trim;
            var bx = nb[0] - ux * trim, by = nb[1] - uy * trim;

            edges.push({
                ax: ax, ay: ay, bx: bx, by: by,
                trimA: trim, trimB: trim,
                revealTime: re.revealTime,
                growDuration: re.growDuration,
                growFromA: re.growFromA,
                steadyLightness: re.steadyLightness,
                isSpine: re.isSpine
            });
        }

        // ---- fillets: bend each edge into its angular neighbour ------
        // Control point is the node itself, so the curve leaves along one
        // edge's direction and arrives along the other's — the join is
        // tangent-continuous and reads as a soft web node.
        var fillets = [];
        for (var nn = 0; nn < nodes.length; nn++) {
            var ring = adj[nn];
            if (ring.length < 2) continue;
            var nodePt = nodes[nn];
            for (var ri = 0; ri < ring.length; ri++) {
                var eiA = ring[ri].edge;
                var eiB = ring[(ri + 1) % ring.length].edge;
                if (eiA === eiB) continue;
                if (ring.length === 2 && ri === 1) break;   // avoid drawing the pair twice

                var recA = edges[eiA], recB = edges[eiB];
                if (!recA || !recB) continue;
                var srcA = rawEdges[eiA], srcB = rawEdges[eiB];

                var startX = srcA.a === nn ? recA.ax : recA.bx;
                var startY = srcA.a === nn ? recA.ay : recA.by;
                var endX = srcB.a === nn ? recB.ax : recB.bx;
                var endY = srcB.a === nn ? recB.ay : recB.by;

                var bothSpine = recA.isSpine && recB.isSpine;
                fillets.push({
                    x0: startX, y0: startY,
                    cx: nodePt[0], cy: nodePt[1],
                    x1: endX, y1: endY,
                    revealTime: Math.max(
                        recA.revealTime + recA.growDuration,
                        recB.revealTime + recB.growDuration
                    ),
                    steadyLightness: bothSpine
                        ? 244
                        : Math.min(recA.steadyLightness, recB.steadyLightness),
                    isSpine: bothSpine
                });
            }
        }

        var compact = [];
        for (var ke = 0; ke < edges.length; ke++) if (edges[ke]) compact.push(edges[ke]);
        edges = compact;

        var maxDone = SPINE_DURATION;
        for (var m = 0; m < edges.length; m++) {
            maxDone = Math.max(maxDone, edges[m].revealTime + edges[m].growDuration + 0.6);
        }
        for (var mf = 0; mf < fillets.length; mf++) {
            maxDone = Math.max(maxDone, fillets[mf].revealTime + 0.6);
        }

        return {
            virtualW: VW, virtualH: VH,
            nodes: nodes,
            edges: edges,
            fillets: fillets,
            cells: cells,
            spineDuration: SPINE_DURATION,
            totalDuration: maxDone + 0.15,
            sweepLoopDuration: 3.4,
            sweepBandHalfWidth: 0.24
        };
    }

    // ---------------------------------------------------------------
    // Plate — 1-bit dither grain, rasterised at actual device px.
    // The large-scale clump structure comes from a fixed noise field, so it
    // stays put across variants; only the per-block grain is re-rolled per
    // variant. Cycling the variants makes the plate flicker like a noisy
    // sensor readout without the clumps swimming around.
    // ---------------------------------------------------------------
    var PLATE_VARIANTS = 6;
    var PLATE_FPS = 11;

    function renderPlate(targetCanvas, Rw, Rh, variant) {
        Rw = Math.max(1, Math.round(Rw));
        Rh = Math.max(1, Math.round(Rh));
        targetCanvas.width = Rw;
        targetCanvas.height = Rh;
        var ctx = targetCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, Rw, Rh);

        var structRng = mulberry32(PLATE_SEED);
        var noiseLow = makeValueNoise2D(structRng, 8);
        var noiseMid = makeValueNoise2D(structRng, 18);
        // Stable grain keeps most blocks put; the small per-variant jitter only
        // flips the ones sitting near the threshold, so the plate shimmers
        // instead of boiling into static.
        var stableGrainRng = mulberry32(PLATE_SEED + 104729);
        var flickerRng = mulberry32(PLATE_SEED + 7919 * (variant + 1));

        var blockSize = Math.max(1, Math.round(Rw / 145));
        var cols = Math.ceil(Rw / blockSize);
        var rows = Math.ceil(Rh / blockSize);

        for (var by = 0; by < rows; by++) {
            var v = by / rows;
            for (var bx = 0; bx < cols; bx++) {
                var u = bx / cols;
                var n = 0.55 * noiseLow(u, v) + 0.30 * noiseMid(u, v)
                    + 0.075 * stableGrainRng() + 0.075 * flickerRng();
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
    // Controller: sizes the canvas, drives the rAF loop.
    // ---------------------------------------------------------------
    function init() {
        var container = document.querySelector(CONTAINER_SELECTOR);
        if (!container) return;

        var canvas = container.querySelector('canvas.fracture-lattice-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');

        var model = buildLatticeModel();
        var plateFrames = [];
        for (var pf = 0; pf < PLATE_VARIANTS; pf++) plateFrames.push(document.createElement('canvas'));
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

        function sx(vx) { return R.x + vx * (R.w / model.virtualW); }
        function sy(vy) { return R.y + vy * (R.w / model.virtualW); }

        function resize() {
            dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
            computeRect();
            canvas.width = canvasW;
            canvas.height = canvasH;
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            for (var pi = 0; pi < plateFrames.length; pi++) {
                renderPlate(plateFrames[pi], R.w, R.h, pi);
            }
            linesCacheValid = false;
            if (reduceMotion) draw(Infinity);
        }

        function styleFor(targetCtx, lightByte, isSpine, glow) {
            targetCtx.strokeStyle = 'rgb(' + lightByte + ',' + lightByte + ',' + lightByte + ')';
            targetCtx.lineWidth = isSpine ? 1.7 : 1;
            if (glow > 0.05) {
                targetCtx.shadowColor = '#FFFFFF';
                targetCtx.shadowBlur = glow;
            } else {
                targetCtx.shadowBlur = 0;
                targetCtx.shadowColor = 'transparent';
            }
        }

        // Draws the settled web: trimmed edge bodies plus the fillet curves
        // that round every junction.
        function paintWeb(targetCtx) {
            targetCtx.lineCap = 'round';
            var edges = model.edges, i;
            for (i = 0; i < edges.length; i++) {
                var e = edges[i];
                styleFor(targetCtx, e.steadyLightness, e.isSpine, e.isSpine ? 2.2 : 0);
                targetCtx.beginPath();
                targetCtx.moveTo(sx(e.ax), sy(e.ay));
                targetCtx.lineTo(sx(e.bx), sy(e.by));
                targetCtx.stroke();
            }
            var fils = model.fillets;
            for (i = 0; i < fils.length; i++) {
                var f = fils[i];
                styleFor(targetCtx, f.steadyLightness, f.isSpine, f.isSpine ? 2.2 : 0);
                targetCtx.beginPath();
                targetCtx.moveTo(sx(f.x0), sy(f.y0));
                targetCtx.quadraticCurveTo(sx(f.cx), sy(f.cy), sx(f.x1), sy(f.y1));
                targetCtx.stroke();
            }
            targetCtx.shadowBlur = 0;
            targetCtx.shadowColor = 'transparent';
        }

        // Once growth has settled the web no longer changes frame to frame —
        // bake it once so the eternal sweep loop stays cheap.
        function renderLinesCache() {
            linesCache.width = canvasW;
            linesCache.height = canvasH;
            var lctx = linesCache.getContext('2d');
            lctx.clearRect(0, 0, canvasW, canvasH);
            paintWeb(lctx);
            linesCacheValid = true;
        }

        // Soft violet "field" that sweeps diagonally (lower-left to upper-right)
        // across the finished cells and loops forever once the web settles.
        function drawSweep(targetCtx, phase) {
            var half = model.sweepBandHalfWidth;
            var bandCenter = phase * (1 + 2 * half) - half;
            var cells = model.cells, nodes = model.nodes;
            for (var i = 0; i < cells.length; i++) {
                var c = cells[i];
                var d = Math.abs(c.sweepProj - bandCenter);
                if (d > half) continue;
                var tt = 1 - d / half;
                var opacity = 0.22 * (tt * tt * (3 - 2 * tt));
                if (opacity < 0.004) continue;
                var ring = c.ring;
                targetCtx.beginPath();
                for (var pv = 0; pv < ring.length; pv++) {
                    var p = nodes[ring[pv]];
                    if (pv === 0) targetCtx.moveTo(sx(p[0]), sy(p[1]));
                    else targetCtx.lineTo(sx(p[0]), sy(p[1]));
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
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvasW, canvasH);

            var plateIdx = forceFinal ? 0 : Math.floor(elapsedSec * PLATE_FPS) % plateFrames.length;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(plateFrames[plateIdx], Math.round(R.x), Math.round(R.y));
            ctx.imageSmoothingEnabled = true;

            if (forceFinal || elapsedSec >= model.totalDuration) {
                if (!linesCacheValid) renderLinesCache();
                if (!forceFinal) {
                    var loopPhase = ((elapsedSec - model.totalDuration) % model.sweepLoopDuration) / model.sweepLoopDuration;
                    drawSweep(ctx, loopPhase);
                }
                ctx.drawImage(linesCache, 0, 0);
                return;
            }

            ctx.lineCap = 'round';

            var edges = model.edges, i;
            for (i = 0; i < edges.length; i++) {
                var e = edges[i];
                var local = elapsedSec - e.revealTime;
                if (local < 0) continue;

                var grow = clamp(local / e.growDuration, 0, 1);
                var decay = clamp((local - e.growDuration) / 0.6, 0, 1);

                var fromX = e.growFromA ? e.ax : e.bx;
                var fromY = e.growFromA ? e.ay : e.by;
                var toX = e.growFromA ? e.bx : e.ax;
                var toY = e.growFromA ? e.by : e.ay;

                var lightByte = e.isSpine
                    ? e.steadyLightness
                    : Math.round(lerp(255, e.steadyLightness, decay));
                var glow = e.isSpine ? 2.2 : lerp(6, 0, decay);

                styleFor(ctx, lightByte, e.isSpine, glow);
                ctx.beginPath();
                ctx.moveTo(sx(fromX), sy(fromY));
                ctx.lineTo(sx(lerp(fromX, toX, grow)), sy(lerp(fromY, toY, grow)));
                ctx.stroke();
            }

            var fils = model.fillets;
            for (i = 0; i < fils.length; i++) {
                var f = fils[i];
                var flocal = elapsedSec - f.revealTime;
                if (flocal < 0) continue;
                var fdecay = clamp(flocal / 0.6, 0, 1);
                var fLight = f.isSpine
                    ? f.steadyLightness
                    : Math.round(lerp(255, f.steadyLightness, fdecay));
                var fGlow = f.isSpine ? 2.2 : lerp(6, 0, fdecay);

                styleFor(ctx, fLight, f.isSpine, fGlow);
                ctx.beginPath();
                ctx.moveTo(sx(f.x0), sy(f.y0));
                ctx.quadraticCurveTo(sx(f.cx), sy(f.cy), sx(f.x1), sy(f.y1));
                ctx.stroke();
            }

            ctx.shadowBlur = 0;
            ctx.shadowColor = 'transparent';
        }

        function loop(now) {
            if (t0 === null) t0 = now;
            draw((now - t0) / 1000);
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
