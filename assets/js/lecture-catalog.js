/* Catálogo de Lectures (Página Principal)
   - filtro por categoria, ordenação e busca na tabela
   - botão "⋯" abre o painel com as primeiras páginas da lecture
   - o grafo do painel é desenhado aqui: um nó central (a lecture)
     ligado a um nó por página; passar o mouse num card destaca o nó. */
(function () {
    'use strict';

    var root = document.getElementById('catalogo-lectures');
    if (!root) return;

    var list = root.querySelector('[data-lc-list]');
    var rows = Array.prototype.slice.call(list.querySelectorAll('.lc-row'));
    var filterEl = root.querySelector('[data-lc-filter]');
    var sortEl = root.querySelector('[data-lc-sort]');
    var searchEl = root.querySelector('[data-lc-search]');
    var countEl = root.querySelector('[data-lc-count]');
    var countLabelEl = root.querySelector('[data-lc-count-label]');
    var emptyEl = root.querySelector('[data-lc-empty]');
    var SVG = 'http://www.w3.org/2000/svg';

    /* Paletas dos nós por categoria: pares [cor base, cor da metade] */
    var PALETTES = {
        'class-lecture': [['#3b5b7a', '#7fa6c9'], ['#2f4a63', '#5b86ad'], ['#4a6f8f', '#a9c4dc'], ['#26394d', '#6d98bf']],
        'lecture': [['#55663a', '#93a86a'], ['#3f4f2c', '#7d9356'], ['#6b7a4a', '#b3c48a'], ['#4a5a33', '#8fa565']],
        'tec-lecture': [['#7a5a33', '#c9a06a'], ['#634a2a', '#ad8656'], ['#8f6f45', '#dcc09a'], ['#4d3a22', '#bf9a6d']]
    };

    function normalize(s) {
        return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    rows.forEach(function (row) {
        row._search = normalize(row.textContent);
        row._title = row.querySelector('.lc-row__title').textContent.trim();
    });

    /* ---------- filtro, ordenação e busca ---------- */
    function apply() {
        var cat = filterEl.value;
        var q = normalize(searchEl.value.trim());
        var sort = sortEl.value;

        var sorted = rows.slice().sort(function (a, b) {
            if (sort === 'az') return a._title.localeCompare(b._title, 'pt-BR');
            var da = a.getAttribute('data-date'), db = b.getAttribute('data-date');
            return sort === 'oldest' ? da.localeCompare(db) : db.localeCompare(da);
        });

        var visible = 0;
        sorted.forEach(function (row) {
            var show = (cat === 'all' || row.getAttribute('data-category') === cat) &&
                (!q || row._search.indexOf(q) !== -1);
            row.hidden = !show;
            if (!show && row.classList.contains('is-open')) close(row);
            if (show) visible++;
            list.appendChild(row);
        });

        countEl.textContent = visible;
        countLabelEl.textContent = visible === 1 ? 'lecture' : 'lectures';
        emptyEl.hidden = visible !== 0;
    }

    filterEl.addEventListener('change', apply);
    sortEl.addEventListener('change', apply);
    searchEl.addEventListener('input', apply);

    /* ---------- painel "⋯" ---------- */
    function open(row) {
        rows.forEach(function (r) { if (r !== row && r.classList.contains('is-open')) close(r); });
        var visual = row.querySelector('.lc-visual');
        if (visual && !visual.firstChild) drawGraph(row, visual);
        row.classList.add('is-open');
        row.querySelector('.lc-row__panel').removeAttribute('inert');
        var btn = row.querySelector('.lc-row__toggle');
        btn.setAttribute('aria-expanded', 'true');
        btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace('Mostrar', 'Ocultar'));
    }

    function close(row) {
        row.classList.remove('is-open');
        row.querySelector('.lc-row__panel').setAttribute('inert', '');
        var btn = row.querySelector('.lc-row__toggle');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace('Ocultar', 'Mostrar'));
    }

    list.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.lc-row__toggle');
        if (!btn) return;
        var row = btn.closest('.lc-row');
        if (row.classList.contains('is-open')) close(row); else open(row);
    });

    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape') return;
        var row = list.querySelector('.lc-row.is-open');
        if (!row) return;
        close(row);
        row.querySelector('.lc-row__toggle').focus();
    });

    /* ---------- grafo ---------- */
    function el(name, attrs) {
        var node = document.createElementNS(SVG, name);
        for (var k in attrs) node.setAttribute(k, attrs[k]);
        return node;
    }

    function drawGraph(row, visual) {
        var cards = Array.prototype.slice.call(row.querySelectorAll('.lc-card'));
        var palette = PALETTES[row.getAttribute('data-category')] || PALETTES.lecture;
        var W = 300, H = 170, cx = 150, cy = 92, R = 22;
        var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'presentation' });
        var defs = el('defs', {});
        svg.appendChild(defs);

        /* posições dos satélites, espalhadas em leque ao redor do centro */
        var layouts = {
            1: [[255, 92]],
            2: [[48, 118], [252, 118]],
            3: [[42, 120], [205, 34], [262, 112]],
            4: [[40, 122], [112, 36], [196, 34], [264, 116]]
        };
        var pts = layouts[Math.min(cards.length, 4)] || [];

        if (!cards.length) {
            svg.appendChild(el('circle', { class: 'lc-orbit', cx: cx, cy: cy, r: 52 }));
            svg.appendChild(el('circle', { class: 'lc-orbit', cx: cx, cy: cy, r: 74 }));
        }

        var nodes = [];
        pts.forEach(function (p, i) {
            var dx = p[0] - cx, dy = p[1] - cy, len = Math.sqrt(dx * dx + dy * dy);
            var r = 12 + (i % 2 ? 0 : 3);
            var ux = dx / len, uy = dy / len;
            var edge = el('line', {
                class: 'lc-edge',
                x1: (cx + ux * (R + 6)).toFixed(1), y1: (cy + uy * (R + 6)).toFixed(1),
                x2: (p[0] - ux * (r + 5)).toFixed(1), y2: (p[1] - uy * (r + 5)).toFixed(1)
            });
            svg.appendChild(edge);

            var id = 'lc-clip-' + Math.random().toString(36).slice(2, 8);
            var clip = el('clipPath', { id: id });
            clip.appendChild(el('circle', { cx: p[0], cy: p[1], r: r }));
            defs.appendChild(clip);

            var colors = palette[i % palette.length];
            var g = el('g', { class: 'lc-node' });
            g.appendChild(el('circle', { cx: p[0], cy: p[1], r: r, fill: colors[0] }));
            /* metade inclinada, como uma fase lunar */
            var ang = (i * 67 + 30) * Math.PI / 180;
            var ox = Math.cos(ang) * r * 0.9, oy = Math.sin(ang) * r * 0.9;
            g.appendChild(el('circle', {
                cx: (p[0] + ox).toFixed(1), cy: (p[1] + oy).toFixed(1), r: r,
                fill: colors[1], 'clip-path': 'url(#' + id + ')'
            }));
            g.appendChild(el('circle', { class: 'lc-node-ring', cx: p[0], cy: p[1], r: r }));
            svg.appendChild(g);
            nodes.push({ g: g, edge: edge });
        });

        /* nó central: a própria lecture */
        svg.appendChild(el('circle', { class: 'lc-hub-ring', cx: cx, cy: cy, r: R + 4 }));
        svg.appendChild(el('circle', { class: 'lc-hub-fill', cx: cx, cy: cy, r: R }));
        var label = el('text', { class: 'lc-hub-label', x: cx, y: cy });
        label.textContent = visual.getAttribute('data-code') || '';
        svg.appendChild(label);

        visual.appendChild(svg);

        cards.forEach(function (card, i) {
            var n = nodes[i];
            if (!n) return;
            var on = function () { n.g.classList.add('is-active'); n.edge.classList.add('is-active'); };
            var off = function () { n.g.classList.remove('is-active'); n.edge.classList.remove('is-active'); };
            card.addEventListener('mouseenter', on);
            card.addEventListener('mouseleave', off);
            card.addEventListener('focus', on);
            card.addEventListener('blur', off);
        });
    }

    apply();
})();
