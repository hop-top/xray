(function (global) {
  'use strict';

  var COMMUNITY_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ec4899',
    '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'
  ];

  function createSvgEl(tag, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        el.setAttribute(k, String(attrs[k]));
      });
    }
    return el;
  }

  function renderGraphSvg(container, data, onNodeClick) {
    container.innerHTML = '';
    var nodes = Array.isArray(data && data.nodes) ? data.nodes : [];
    var edges = Array.isArray(data && data.edges) ? data.edges : [];

    if (nodes.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No graph nodes available for this view.';
      container.appendChild(empty);
      return;
    }

    var width = container.clientWidth || 720;
    var height = container.clientHeight || 480;
    var svg = createSvgEl('svg', {
      width: '100%',
      height: '100%',
      viewBox: '0 0 ' + width + ' ' + height,
      style: 'cursor: grab; display: block;'
    });

    var defs = createSvgEl('defs');
    var marker = createSvgEl('marker', {
      id: 'xray-arrow',
      viewBox: '0 0 10 10',
      refX: '9',
      refY: '5',
      markerWidth: '6',
      markerHeight: '6',
      orient: 'auto-start-reverse'
    });
    marker.appendChild(createSvgEl('path', { d: 'M 0 1 L 10 5 L 0 9 z', fill: '#64748b' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    var viewport = createSvgEl('g');
    svg.appendChild(viewport);

    // Deterministic radial-grid hybrid layout
    var cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    var spacingX = 190;
    var spacingY = 84;
    var pos = {};
    nodes.forEach(function (n, idx) {
      var col = idx % cols;
      var row = Math.floor(idx / cols);
      pos[n.id] = {
        x: 90 + col * spacingX,
        y: 60 + row * spacingY
      };
    });

    edges.forEach(function (e) {
      var a = pos[e.source];
      var b = pos[e.target];
      if (!a || !b) return;
      var line = createSvgEl('line', {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: e.type === 'calls' ? '#60a5fa' : '#475569',
        'stroke-width': '1.4',
        'stroke-opacity': '0.65',
        'marker-end': 'url(#xray-arrow)'
      });
      viewport.appendChild(line);
    });

    nodes.forEach(function (n) {
      var p = pos[n.id];
      var g = createSvgEl('g', {
        transform: 'translate(' + p.x + ',' + p.y + ')',
        style: 'cursor: pointer;'
      });
      var color = COMMUNITY_COLORS[(n.community || 0) % COMMUNITY_COLORS.length];
      var label = String(n.label || n.id);
      var shortLabel = label.length > 22 ? label.slice(0, 19) + '...' : label;
      var boxW = Math.max(96, shortLabel.length * 7 + 18);

      var rect = createSvgEl('rect', {
        x: -boxW / 2,
        y: -16,
        width: boxW,
        height: 32,
        rx: 6,
        fill: '#1e293b',
        stroke: color,
        'stroke-width': '1.8'
      });
      var text = createSvgEl('text', {
        x: 0,
        y: 4,
        'text-anchor': 'middle',
        fill: '#e2e8f0',
        'font-size': '11',
        'font-family': 'ui-monospace, monospace'
      });
      text.textContent = shortLabel;

      g.appendChild(rect);
      g.appendChild(text);
      g.addEventListener('click', function () {
        if (typeof onNodeClick === 'function') onNodeClick(n);
      });
      viewport.appendChild(g);
    });

    // Pan & Zoom state
    var state = { x: 0, y: 0, scale: 1, dragging: false, lastX: 0, lastY: 0 };
    function applyTransform() {
      viewport.setAttribute(
        'transform',
        'translate(' + state.x + ',' + state.y + ') scale(' + state.scale + ')'
      );
    }

    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var factor = ev.deltaY < 0 ? 1.12 : 0.89;
      state.scale = Math.min(4, Math.max(0.2, state.scale * factor));
      applyTransform();
    }, { passive: false });

    svg.addEventListener('mousedown', function (ev) {
      state.dragging = true;
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
      svg.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', function (ev) {
      if (!state.dragging) return;
      state.x += ev.clientX - state.lastX;
      state.y += ev.clientY - state.lastY;
      state.lastX = ev.clientX;
      state.lastY = ev.clientY;
      applyTransform();
    });

    window.addEventListener('mouseup', function () {
      if (!state.dragging) return;
      state.dragging = false;
      svg.style.cursor = 'grab';
    });

    container.appendChild(svg);
  }

  global.XrayGraphSvg = { renderGraphSvg: renderGraphSvg };
})(window);
