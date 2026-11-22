(function () {
  'use strict';

  var ROW_HEIGHT = 24;
  var state = {
    root: '',
    contexts: [],
    treeNodes: [], // flattened visible nodes: { path, name, type, depth, expanded, loaded }
    childrenByDir: {},
    activeFile: null,
    fileLines: [],
    fileTotalLines: 0,
    fileOffset: 1,
    fileHasMore: false,
    fileSymbols: [],
    lastDiagram: null
  };

  var $ = function (id) { return document.getElementById(id); };

  function apiGet(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.error || ('HTTP ' + res.status));
        });
      }
      return res.json();
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildVisibleTree(dirPath, depth, out) {
    var list = state.childrenByDir[dirPath] || [];
    list.forEach(function (entry) {
      var expanded = Boolean(entry.expanded);
      out.push({
        path: entry.path,
        name: entry.name,
        type: entry.type,
        depth: depth,
        expanded: expanded
      });
      if (entry.type === 'directory' && expanded) {
        buildVisibleTree(entry.path, depth + 1, out);
      }
    });
  }

  function renderVirtualTree() {
    var viewport = $('tree-viewport');
    var spacer = $('tree-spacer');
    var rowsEl = $('tree-rows');
    var nodes = state.treeNodes;
    $('tree-count').textContent = String(nodes.length);

    var totalHeight = nodes.length * ROW_HEIGHT;
    spacer.style.height = totalHeight + 'px';

    var scrollTop = viewport.scrollTop;
    var viewHeight = viewport.clientHeight || 400;
    var start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
    var end = Math.min(nodes.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + 5);

    rowsEl.style.transform = 'translateY(' + (start * ROW_HEIGHT) + 'px)';
    rowsEl.innerHTML = '';

    for (var i = start; i < end; i++) {
      (function (node) {
        var row = document.createElement('div');
        row.className = 'tree-row' + (state.activeFile === node.path ? ' active' : '');
        row.style.paddingLeft = (8 + node.depth * 14) + 'px';

        var icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = node.type === 'directory' ? (node.expanded ? '▾' : '▸') : '•';

        var label = document.createElement('span');
        label.textContent = node.name;

        row.appendChild(icon);
        row.appendChild(label);
        row.addEventListener('click', function () {
          if (node.type === 'directory') {
            toggleDir(node.path);
          } else {
            openFile(node.path, 1);
          }
        });
        rowsEl.appendChild(row);
      })(nodes[i]);
    }
  }

  function refreshFlatTree() {
    var out = [];
    buildVisibleTree('.', 0, out);
    state.treeNodes = out;
    renderVirtualTree();
  }

  function loadDir(dirPath) {
    var q = new URLSearchParams({ root: state.root, path: dirPath, depth: '1', limit: '1000' });
    return apiGet('/api/tree?' + q.toString()).then(function (data) {
      state.childrenByDir[dirPath] = (data.entries || []).map(function (e) {
        return { path: e.path, name: e.name, type: e.type, expanded: false };
      });
      refreshFlatTree();
    });
  }

  function toggleDir(dirPath) {
    var found = null;
    Object.keys(state.childrenByDir).forEach(function (k) {
      state.childrenByDir[k].forEach(function (entry) {
        if (entry.path === dirPath) found = entry;
      });
    });
    if (!found) return;
    found.expanded = !found.expanded;
    if (found.expanded && !state.childrenByDir[dirPath]) {
      loadDir(dirPath);
    } else {
      refreshFlatTree();
    }
  }

  function renderCodeLines(highlightLine) {
    var container = $('code-container');
    var symsByLine = {};
    state.fileSymbols.forEach(function (s) {
      if (!symsByLine[s.line]) symsByLine[s.line] = [];
      symsByLine[s.line].push(s);
    });

    var html = state.fileLines.map(function (item) {
      var lineSyms = symsByLine[item.line] || [];
      var escaped = escapeHtml(item.text);
      lineSyms.forEach(function (s) {
        var nameEsc = escapeHtml(s.name);
        if (s.name && escaped.indexOf(nameEsc) !== -1) {
          escaped = escaped.replace(
            nameEsc,
            '<span class="sym-token" data-sym="' + escapeHtml(s.name) + '" data-kind="' + escapeHtml(s.kind) + '" data-line="' + s.line + '">' + nameEsc + '</span>'
          );
        }
      });
      var cls = 'code-line' + (highlightLine === item.line ? ' highlight' : '');
      return '<div class="' + cls + '" id="L' + item.line + '"><span class="line-num">' + item.line + '</span><span class="line-text">' + escaped + '</span></div>';
    }).join('');

    container.innerHTML = html;
    $('code-empty').classList.add('hidden');
    container.classList.remove('hidden');
    $('code-pagination').classList.toggle('hidden', !state.fileHasMore);

    if (highlightLine) {
      var target = $('L' + highlightLine);
      if (target) target.scrollIntoView({ block: 'center' });
    }
  }

  function openFile(relPath, targetLine, append) {
    state.activeFile = relPath;
    $('active-file-path').textContent = relPath;
    renderVirtualTree();

    var offset = append ? state.fileOffset : 1;
    var qFile = new URLSearchParams({ root: state.root, path: relPath, offset: String(offset), limit: '500' });
    var qSym = new URLSearchParams({ root: state.root, path: relPath });

    Promise.all([
      apiGet('/api/file?' + qFile.toString()),
      append ? Promise.resolve({ symbols: state.fileSymbols }) : apiGet('/api/symbols?' + qSym.toString())
    ]).then(function (results) {
      var fileData = results[0];
      var symData = results[1];
      state.fileLines = append ? state.fileLines.concat(fileData.lines || []) : (fileData.lines || []);
      state.fileTotalLines = fileData.totalLines || 0;
      state.fileHasMore = Boolean(fileData.hasMore);
      state.fileOffset = offset + (fileData.lines ? fileData.lines.length : 0);
      state.fileSymbols = symData.symbols || [];
      renderCodeLines(targetLine);
      renderMarkdownPreview();
      loadBlame(relPath);
    }).catch(function (err) {
      $('code-empty').textContent = 'Error loading file: ' + err.message;
      $('code-empty').classList.remove('hidden');
      $('code-container').classList.add('hidden');
    });
  }

  function renderMarkdownPreview() {
    var el = $('preview-content');
    if (!state.activeFile || !/\.md$/i.test(state.activeFile)) {
      el.className = 'markdown-body empty-state';
      el.textContent = 'Select a Markdown (.md) file to preview.';
      return;
    }
    var raw = state.fileLines.map(function (l) { return l.text; }).join('\n');
    el.className = 'markdown-body';
    el.innerHTML = simpleMarkdown(raw);
  }

  function simpleMarkdown(md) {
    var html = escapeHtml(md)
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n\n+/g, '</p><p>');
    return '<p>' + html + '</p>';
  }

  function loadBlame(relPath) {
    var el = $('blame-content');
    var q = new URLSearchParams({ root: state.root, path: relPath });
    apiGet('/api/blame?' + q.toString()).then(function (data) {
      var rows = data.blame || [];
      if (rows.length === 0) {
        el.className = 'empty-state';
        el.textContent = 'No git blame data for this file.';
        return;
      }
      el.className = '';
      var table = '<table class="blame-table">' + rows.map(function (b) {
        var lineObj = state.fileLines.find(function (l) { return l.line === b.line; });
        var text = lineObj ? escapeHtml(lineObj.text) : '';
        return '<tr><td class="blame-meta">' + escapeHtml(b.sha.slice(0, 7)) + ' ' + escapeHtml(b.author) + '</td><td class="line-num">' + b.line + '</td><td class="line-text">' + text + '</td></tr>';
      }).join('') + '</table>';
      el.innerHTML = table;
    }).catch(function () {
      el.className = 'empty-state';
      el.textContent = 'Blame unavailable.';
    });
  }

  function inspectSymbol(symbolName) {
    var body = $('explore-body');
    body.innerHTML = '<div class="empty-state">Loading impact for ' + escapeHtml(symbolName) + '...</div>';
    var cross = $('cross-context-toggle').checked;
    var q = new URLSearchParams({
      root: state.root,
      symbol: symbolName,
      depth: '3',
      crossContext: String(cross)
    });
    apiGet('/api/impact?' + q.toString()).then(function (data) {
      var callers = data.nodes || [];
      var html = '<div class="explore-card"><div class="explore-card-title">' + escapeHtml(symbolName) + '</div><div class="muted">' + callers.length + ' caller(s)</div></div>';
      callers.forEach(function (c) {
        var name = c.name || c.id;
        var file = c.file || '';
        var line = typeof c.line === 'number' ? c.line + 1 : 1;
        html += '<div class="caller-row" data-file="' + escapeHtml(file) + '" data-line="' + line + '">' + escapeHtml(name) + ' <span class="muted">' + escapeHtml(file) + ':' + line + '</span></div>';
      });
      if (cross && Array.isArray(data.crossContextResults) && data.crossContextResults.length > 0) {
        html += '<div class="explore-card"><div class="explore-card-title">Cross-Context Callers</div>';
        data.crossContextResults.forEach(function (cr) {
          html += '<div class="muted">' + escapeHtml(cr.root) + ' (' + cr.nodes.length + ')</div>';
        });
        html += '</div>';
      }
      body.innerHTML = html;
      Array.prototype.forEach.call(body.querySelectorAll('.caller-row'), function (row) {
        row.addEventListener('click', function () {
          var f = row.getAttribute('data-file');
          var ln = Number(row.getAttribute('data-line') || '1');
          if (f) openFile(f, ln);
        });
      });
    }).catch(function (err) {
      body.innerHTML = '<div class="empty-state">Error: ' + escapeHtml(err.message) + '</div>';
    });
  }

  function loadHistory() {
    var el = $('history-content');
    var q = new URLSearchParams({ root: state.root, perPage: '25' });
    Promise.all([
      apiGet('/api/commits?' + q.toString()),
      apiGet('/api/diff?' + new URLSearchParams({ root: state.root }).toString())
    ]).then(function (results) {
      var commits = results[0].commits || [];
      var diffFiles = results[1].files || [];
      var html = '<div><strong>Recent Commits</strong></div>';
      commits.forEach(function (c) {
        html += '<div class="commit-item"><strong>' + escapeHtml(c.shortSha) + '</strong> ' + escapeHtml(c.subject) + ' <span class="muted">— ' + escapeHtml(c.authorName) + '</span></div>';
      });
      html += '<div><strong>Working Tree Diff</strong></div>';
      if (diffFiles.length === 0) {
        html += '<div class="muted">Clean working tree.</div>';
      } else {
        diffFiles.forEach(function (f) {
          html += '<div class="diff-block"><strong>' + escapeHtml(f.status) + ' ' + escapeHtml(f.path) + '</strong>\n' + escapeHtml(f.patch || '') + '</div>';
        });
      }
      el.innerHTML = html;
    });
  }

  function loadHandbook(slug) {
    var q = new URLSearchParams({ root: state.root, slug: slug || 'README' });
    apiGet('/api/handbook?' + q.toString()).then(function (data) {
      var select = $('handbook-select');
      select.innerHTML = (data.pages || []).map(function (p) {
        return '<option value="' + escapeHtml(p.slug) + '"' + (p.slug === data.slug ? ' selected' : '') + '>' + escapeHtml(p.subsystem || p.slug) + '</option>';
      }).join('');
      var el = $('handbook-content');
      if (!data.content) {
        el.className = 'markdown-body empty-state';
        el.innerHTML = 'No handbook pages found. Run <code>xray handbook</code> to generate.';
        return;
      }
      el.className = 'markdown-body';
      el.innerHTML = simpleMarkdown(data.content);
    });
  }

  function loadDiagram() {
    var view = $('diagram-view-select').value;
    var anchor = $('diagram-anchor-input').value.trim();
    var q = new URLSearchParams({ root: state.root, view: view });
    if (anchor) q.set('anchor', anchor);
    apiGet('/api/diagram?' + q.toString()).then(function (data) {
      state.lastDiagram = data;
      $('diagram-mermaid-src').textContent = data.mermaid || '';
      window.XrayGraphSvg.renderGraphSvg($('diagram-svg-wrap'), data, function (node) {
        if (node.file) openFile(node.file, node.line || 1);
        else if (node.label) inspectSymbol(node.label);
      });
    });
  }

  function init() {
    apiGet('/api/contexts').then(function (data) {
      state.contexts = data.roots || [];
      state.root = data.serverRoot;
      var select = $('context-select');
      select.innerHTML = state.contexts.map(function (r) {
        return '<option value="' + escapeHtml(r.path) + '"' + (r.path === state.root ? ' selected' : '') + '>' + escapeHtml(r.name) + '</option>';
      }).join('');
      select.addEventListener('change', function () {
        state.root = select.value;
        state.childrenByDir = {};
        loadDir('.');
      });
      loadDir('.');
    });

    $('tree-viewport').addEventListener('scroll', renderVirtualTree);
    $('load-more-btn').addEventListener('click', function () {
      if (state.activeFile) openFile(state.activeFile, undefined, true);
    });

    // Tab switching
    Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-tab');
        Array.prototype.forEach.call(document.querySelectorAll('.tab-btn'), function (b) { b.classList.remove('active'); });
        Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        $('tab-' + tab).classList.add('active');
        if (tab === 'history') loadHistory();
        if (tab === 'handbook') loadHandbook('README');
        if (tab === 'diagram' && !state.lastDiagram) loadDiagram();
      });
    });

    // Symbol click + hover popover in code view
    $('code-container').addEventListener('click', function (ev) {
      var tok = ev.target.closest('.sym-token');
      if (tok) inspectSymbol(tok.getAttribute('data-sym'));
    });

    $('code-container').addEventListener('mouseover', function (ev) {
      var tok = ev.target.closest('.sym-token');
      var pop = $('hover-popover');
      if (!tok) {
        pop.classList.add('hidden');
        return;
      }
      pop.innerHTML = '<strong>' + escapeHtml(tok.getAttribute('data-sym')) + '</strong> <span class="muted">' + escapeHtml(tok.getAttribute('data-kind')) + ' · L' + escapeHtml(tok.getAttribute('data-line')) + '</span>';
      pop.style.left = (ev.clientX + 12) + 'px';
      pop.style.top = (ev.clientY + 12) + 'px';
      pop.classList.remove('hidden');
    });

    $('code-container').addEventListener('mouseleave', function () {
      $('hover-popover').classList.add('hidden');
    });

    // Search
    $('search-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var qVal = $('search-input').value.trim();
      if (!qVal) return;
      var params = new URLSearchParams({
        root: state.root,
        q: qVal,
        regex: String($('regex-toggle').checked),
        case: String($('case-toggle').checked),
        filter: $('filter-input').value.trim()
      });
      apiGet('/api/search?' + params.toString()).then(function (data) {
        $('search-summary').textContent = data.total + ' match(es) across ' + data.candidateFiles + ' file(s)';
        var list = $('search-results-list');
        list.innerHTML = (data.matches || []).map(function (m) {
          return '<div class="search-result-item" data-file="' + escapeHtml(m.relPath) + '" data-line="' + m.line + '"><span class="search-result-file">' + escapeHtml(m.relPath) + ':' + m.line + '</span><span>' + escapeHtml(m.content) + '</span></div>';
        }).join('');
        Array.prototype.forEach.call(list.querySelectorAll('.search-result-item'), function (item) {
          item.addEventListener('click', function () {
            openFile(item.getAttribute('data-file'), Number(item.getAttribute('data-line')));
          });
        });
        $('search-results-banner').classList.remove('hidden');
      });
    });

    $('close-search-btn').addEventListener('click', function () {
      $('search-results-banner').classList.add('hidden');
    });

    $('help-btn').addEventListener('click', function () { $('dsl-modal').classList.remove('hidden'); });
    $('close-modal-btn').addEventListener('click', function () { $('dsl-modal').classList.add('hidden'); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === '?' && document.activeElement.tagName !== 'INPUT') {
        $('dsl-modal').classList.toggle('hidden');
      } else if (ev.key === '/' && document.activeElement.tagName !== 'INPUT') {
        ev.preventDefault();
        $('search-input').focus();
      } else if (ev.key === 'Escape') {
        $('dsl-modal').classList.add('hidden');
      }
    });

    $('refresh-history-btn').addEventListener('click', loadHistory);
    $('handbook-select').addEventListener('change', function () { loadHandbook($('handbook-select').value); });
    $('diagram-load-btn').addEventListener('click', loadDiagram);
    $('diagram-mermaid-toggle').addEventListener('change', function () {
      var showRaw = $('diagram-mermaid-toggle').checked;
      $('diagram-mermaid-src').classList.toggle('hidden', !showRaw);
      $('diagram-svg-wrap').classList.toggle('hidden', showRaw);
    });
    $('diagram-copy-btn').addEventListener('click', function () {
      if (state.lastDiagram && navigator.clipboard) {
        navigator.clipboard.writeText(state.lastDiagram.mermaid || '');
      }
    });
    $('diagram-download-btn').addEventListener('click', function () {
      if (!state.lastDiagram) return;
      var blob = new Blob([state.lastDiagram.mermaid || ''], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'diagram-' + ($('diagram-view-select').value || 'architecture') + '.mmd';
      a.click();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
