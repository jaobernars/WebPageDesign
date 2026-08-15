/*
 * Landing background gallery — the same flickering, pixelated "sensor
 * plate" treatment used behind the hero lattice, applied full-bleed behind
 * the landing page. One image from assets/images/Início is picked at
 * random on every load and rendered as a coarse, twinkling block grid.
 */
(function () {
    'use strict';

    var CANVAS_ID = 'landing-plate-canvas';
    var PLATE_SEED = 90210777;

    var GALLERY_FILES = [
        'agAkX76PzJWDuNrJLtLw6R.jpg',
        'Hubble_ultra_deep_field.jpg',
        'images (1).jpg',
        'images.jpg',
        'pilares-da-criacao.webp'
    ];

    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Resolved against this script's own URL, so the page's directory depth
    // does not matter.
    var GALLERY_DIR_URL = (function () {
        var rel = '../images/Início/';
        try {
            var s = document.currentScript && document.currentScript.src;
            if (s) return new URL(rel, s).href;
        } catch (e) { /* fall through */ }
        return 'assets/images/Início/';
    })();

    function pickImageURL() {
        var name = GALLERY_FILES[Math.floor(Math.random() * GALLERY_FILES.length)];
        return new URL(name, GALLERY_DIR_URL).href;
    }

    // scale the source image to cover the block grid, centred
    function drawCover(ctx, img, cols, rows) {
        var iw = img.naturalWidth || img.width;
        var ih = img.naturalHeight || img.height;
        if (!iw || !ih) return;
        var scale = Math.max(cols / iw, rows / ih);
        var dw = iw * scale, dh = ih * scale;
        ctx.drawImage(img, (cols - dw) / 2, (rows - dh) / 2, dw, dh);
    }

    var PLATE_VARIANTS = 6;
    var PLATE_FPS = 11;
    var PLATE_BLOCKS_ACROSS = 145;

    function renderPlate(targetCanvas, Rw, Rh, variant, img, scratch) {
        Rw = Math.max(1, Math.round(Rw));
        Rh = Math.max(1, Math.round(Rh));
        targetCanvas.width = Rw;
        targetCanvas.height = Rh;
        var ctx = targetCanvas.getContext('2d');
        ctx.clearRect(0, 0, Rw, Rh);

        var blockSize = Math.max(1, Math.round(Rw / PLATE_BLOCKS_ACROSS));
        var cols = Math.ceil(Rw / blockSize);
        var rows = Math.ceil(Rh / blockSize);

        scratch.width = cols;
        scratch.height = rows;
        var sctx = scratch.getContext('2d');
        sctx.clearRect(0, 0, cols, rows);

        // 1. the gallery image, averaged down to one pixel per block
        if (img) {
            sctx.imageSmoothingEnabled = true;
            sctx.filter = 'brightness(1.85) contrast(1.28) saturate(1.6)';
            drawCover(sctx, img, cols, rows);
            sctx.filter = 'none';
        }

        // 2. sensor grain on top: a stable speckle plus a per-variant one, so
        //    part of the noise holds still and part of it twinkles
        var stableRng = mulberry32(PLATE_SEED + 104729);
        var flickerRng = mulberry32(PLATE_SEED + 7919 * (variant + 1));
        sctx.globalCompositeOperation = 'lighter';
        for (var by = 0; by < rows; by++) {
            for (var bx = 0; bx < cols; bx++) {
                var stable = stableRng(), flick = flickerRng();
                var n = 0;
                if (stable > 0.928) n += 0x0C + stable * 0x10;
                if (flick > 0.952) n += 0x0E + flick * 0x14;
                if (n < 1) continue;
                n = Math.round(Math.min(n, 0x34));
                sctx.fillStyle = 'rgb(' + n + ',' + n + ',' + n + ')';
                sctx.fillRect(bx, by, 1, 1);
            }
        }
        sctx.globalCompositeOperation = 'source-over';

        // 3. blow the block grid up with no interpolation, so every block
        //    stays a crisp square
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(scratch, 0, 0, cols, rows, 0, 0, cols * blockSize, rows * blockSize);
    }

    function init() {
        var canvas = document.getElementById(CANVAS_ID);
        if (!canvas) return;
        var ctx = canvas.getContext('2d');

        var plateFrames = [];
        for (var pf = 0; pf < PLATE_VARIANTS; pf++) plateFrames.push(document.createElement('canvas'));
        var plateScratch = document.createElement('canvas');
        var plateImage = null;

        var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        var canvasW = 0, canvasH = 0;
        var t0 = null;
        var rafId = null;

        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function resize() {
            dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
            canvasW = Math.max(1, Math.round(window.innerWidth * dpr));
            canvasH = Math.max(1, Math.round(window.innerHeight * dpr));
            canvas.width = canvasW;
            canvas.height = canvasH;
            for (var pi = 0; pi < plateFrames.length; pi++) {
                renderPlate(plateFrames[pi], canvasW, canvasH, pi, plateImage, plateScratch);
            }
            if (reduceMotion) draw(Infinity);
        }

        function draw(elapsedSec) {
            var forceFinal = elapsedSec === Infinity;
            var plateIdx = forceFinal ? 0 : Math.floor(elapsedSec * PLATE_FPS) % plateFrames.length;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(plateFrames[plateIdx], 0, 0);
        }

        function loop(now) {
            if (t0 === null) t0 = now;
            draw((now - t0) / 1000);
            rafId = requestAnimationFrame(loop);
        }

        function start() {
            resize();
            if (reduceMotion) { draw(Infinity); return; }
            draw(0);
            rafId = requestAnimationFrame(loop);
        }

        window.addEventListener('resize', resize);

        var img = new Image();
        img.onload = function () { plateImage = img; start(); };
        img.onerror = function () { plateImage = null; start(); };
        img.src = pickImageURL();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
