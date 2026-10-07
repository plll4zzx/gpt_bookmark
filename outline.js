(() => {
  "use strict";

  globalThis.ChatGPTAnswerOutline = ({ host, shadow, positions, getScrollContainer, scrollBounds, onNavigate, jumpToHeading }) => {
    const ASSISTANT = '[data-message-role="assistant"], [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"]';
    const USER = '[data-message-role="user"], [data-message-author-role="user"], [data-user-message-bubble]';
    const MARKDOWN = '[data-assistant-markdown], .markdown';
    const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"][aria-level]';
    let answers = [];
    let current = null;
    let items = [];
    let selected = null;
    let collapsed = false;
    let compactExpanded = false;
    let lastCompact = null;
    let observedContent = null;
    let observedContainer = null;
    let layoutFrame = 0;
    let route = location.pathname;
    let retired = new WeakSet();
    let layoutDirty = true;

    const style = document.createElement('style');
    style.textContent = `
      .answer-outline { position:fixed; width:232px; border:1px solid var(--line); border-radius:14px;
        background:var(--bg); color:var(--fg); box-shadow:0 4px 20px #0000000b; padding:10px;
        display:flex; flex-direction:column; overflow:hidden; backdrop-filter:blur(12px); }
      .answer-outline[hidden] { display:none; }
      .outline-toggle { display:flex; align-items:center; justify-content:space-between; gap:8px;
        width:100%; padding:5px 6px; border-radius:7px; background:transparent; text-align:left;
        font-size:12px; font-weight:600; flex-shrink:0; }
      .outline-toggle:hover { color:var(--accent); background:var(--hover); }
      .outline-meta { color:var(--muted); font-size:10px; font-weight:400; white-space:nowrap; }
      .outline-list { padding:4px 0 0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin;
        scrollbar-color:var(--line) transparent; overflow-anchor:none; min-height:0; }
      .outline-item { display:block; width:100%; padding:8px 8px 8px calc(9px + var(--depth,0) * 12px);
        background:transparent; border-left:2px solid transparent; border-radius:0 7px 7px 0;
        text-align:left; font-size:12px; line-height:1.6; color:var(--muted); overflow-wrap:anywhere; }
      .outline-item span { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
      .outline-item:hover { background:var(--hover); color:var(--fg); }
      .outline-item[aria-current="location"] { border-left-color:var(--accent); color:var(--accent); background:var(--hover); }
      .outline-empty { margin:8px 6px; color:var(--muted); font-size:11px; line-height:1.6; }
      .answer-outline[data-collapsed] .outline-list, .answer-outline[data-collapsed] .outline-empty { display:none; }
      .answer-outline[data-compact][data-collapsed] { padding:5px; width:46px !important; }
      .answer-outline[data-compact][data-collapsed] .outline-meta { display:none; }
      .answer-outline[data-compact][data-collapsed] .outline-toggle { padding:5px 2px; justify-content:center; }
    `;
    const nav = document.createElement('nav');
    nav.className = 'answer-outline';
    nav.setAttribute('aria-label', '当前回答目录');
    nav.hidden = true;
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'outline-toggle';
    toggle.setAttribute('aria-controls', 'answer-outline-list');
    const title = document.createElement('span'); title.textContent = '当前回答目录';
    const meta = document.createElement('span'); meta.className = 'outline-meta';
    toggle.append(title, meta);
    const list = document.createElement('div'); list.className = 'outline-list'; list.id = 'answer-outline-list';
    const empty = document.createElement('p'); empty.className = 'outline-empty'; empty.textContent = '这条回答暂无章节标题';
    nav.append(toggle, list, empty);
    shadow.append(style, nav);
    positions?.attach('outline', nav, '左侧回答目录');

    function visible(element) {
      return element.isConnected && !element.closest('[hidden], [aria-hidden="true"], [inert]')
        && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    }

    function headingList(root) {
      return Array.from(root.querySelectorAll(HEADING)).filter(element => visible(element)
        && !element.closest(`${USER}, pre, code, blockquote, table, [data-message-attribution], .sr-only`)
        && element.innerText.trim());
    }

    function answerRect(answer) {
      if (answer.getClientRects().length) return answer.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(answer);
      return range.getBoundingClientRect();
    }

    function headingLevels(headings) {
      const records = headings.map(element => {
        const text = element.innerText.trim();
        const rawLevel = Number(element.getAttribute('aria-level') || element.tagName.slice(1));
        const label = text.match(/^(\d+(?:[.．]\d+)+)(?:[.．、)）]\s*|\s+)(?=\S)/)
          || text.match(/^(\d+)(?:[.．、)）](?!\d)\s*|\s+)(?=\S)/);
        return { rawLevel, level: rawLevel, path: label?.[1].split(/[.．]/).map(Number) };
      });
      // ChatGPT can mix h1–h6 within one numbered list of peer sections.
      // Only reconcile consecutive numbered siblings inside the same section;
      // unnumbered parent headings and restarted numbering delimit new groups.
      let group = null;
      function finish() {
        if (!group) return;
        const base = Math.min(...group.roots.map(record => record.rawLevel));
        if (group.roots.length > 1) {
          for (const record of group.roots) record.level = base;
          for (const child of group.children) child.record.level = base + child.depth;
        } else {
          for (const child of group.children) if (child.explicit) child.record.level = base + child.depth;
        }
        group = null;
      }
      for (const record of records) {
        if (record.path?.length === 1) {
          const previous = group?.roots.at(-1);
          if (!previous || record.path[0] !== previous.path[0] + 1) {
            finish(); group = { roots: [], children: [] };
          }
          group.roots.push(record);
        } else if (record.path && group && record.path[0] === group.roots.at(-1).path[0]) {
          group.children.push({ record, depth: record.path.length - 1, explicit: true });
        } else if (!record.path && group && record.rawLevel > group.roots.at(-1).rawLevel) {
          group.children.push({ record, depth: record.rawLevel - group.roots.at(-1).rawLevel });
        } else finish();
      }
      finish();
      return records.map(record => record.level);
    }

    function render(answer) {
      const previous = new Map(items.map(item => [item.element, item]));
      const headings = headingList(answer);
      const levels = headingLevels(headings);
      const minLevel = Math.min(6, ...levels);
      items = headings.map((element, index) => {
        let item = previous.get(element);
        if (!item) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'outline-item';
          const label = document.createElement('span'); button.append(label);
          item = { element, button, label };
          button.addEventListener('click', () => {
            if (!item.element.isConnected) { refresh(); return; }
            onNavigate();
            jumpToHeading(() => item.element);
            updatePosition();
          });
          button.addEventListener('keydown', event => {
            const at = items.indexOf(item);
            const next = event.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1)
              : event.key === 'ArrowUp' ? Math.max(0, at - 1)
              : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
            if (next >= 0) { event.preventDefault(); items[next].button.focus(); }
          });
        }
        const text = element.innerText.trim();
        if (item.label.textContent !== text) { item.label.textContent = text; item.button.title = text; }
        const level = levels[index];
        const depth = String(Math.max(0, Math.min(4, level - minLevel)));
        if (item.button.style.getPropertyValue('--depth') !== depth) item.button.style.setProperty('--depth', depth);
        return item;
      });
      const keep = new Set(items.map(item => item.button));
      for (const button of Array.from(list.children)) if (!keep.has(button)) button.remove();
      for (const [i, item] of items.entries()) if (list.children[i] !== item.button) list.insertBefore(item.button, list.children[i] || null);
      empty.hidden = items.length > 0;
      const count = `${items.length} 节`;
      if (meta.textContent !== count) meta.textContent = count;
      layoutDirty = true;
    }

    function place(answer) {
      const container = getScrollContainer(answer);
      const bounds = scrollBounds(container);
      const body = answer.matches(MARKDOWN) ? answer : answer.querySelector(MARKDOWN) || answer;
      const contentLeft = items[0]?.element.getBoundingClientRect().left ?? body.getBoundingClientRect().left;
      const main = answer.closest('main, [role="main"]');
      let boundary = Math.max(0, main?.getBoundingClientRect().left || container.getBoundingClientRect().left || 0);
      for (const sidebar of document.querySelectorAll('aside, nav, [data-testid*="sidebar"], #stage-slideover-sidebar, [aria-label="侧边栏"], [aria-label="Chat history"]')) {
        if (!visible(sidebar) || sidebar.contains(answer)) continue;
        const rect = sidebar.getBoundingClientRect();
        if (rect.left < innerWidth * .25 && rect.right <= contentLeft && rect.height > innerHeight * .35) boundary = Math.max(boundary, rect.right);
      }
      const available = contentLeft - boundary - 32;
      const compact = available < 160;
      if (compact !== lastCompact) { compactExpanded = false; lastCompact = compact; }
      const isCollapsed = compact ? !compactExpanded : collapsed;
      const width = compact ? Math.min(260, innerWidth - 80) : Math.min(248, available);
      const left = compact ? Math.max(8, Math.min(boundary + 8, innerWidth - width - 64)) : contentLeft - width - 20;
      const top = Math.min(Math.max(80, bounds.top + 32), Math.max(8, innerHeight - 160));
      const hostRect = host.getBoundingClientRect();
      nav.style.width = `${width}px`;
      nav.style.maxHeight = `${Math.max(100, Math.min(560, innerHeight - top - 100))}px`;
      nav.toggleAttribute('data-compact', compact);
      nav.toggleAttribute('data-collapsed', isCollapsed);
      title.textContent = compact && isCollapsed ? '目录' : '当前回答目录';
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.setAttribute('aria-label', isCollapsed ? '展开当前回答目录' : '折叠当前回答目录');
      const point = positions?.resolve('outline', { x: left, y: top }, nav.offsetWidth, nav.offsetHeight) || { x: left, y: top };
      nav.style.left = `${point.x - hostRect.left}px`;
      nav.style.top = `${point.y - hostRect.top}px`;
      if (observedContent !== body || observedContainer !== container) {
        resizeObserver.disconnect(); resizeObserver.observe(body); resizeObserver.observe(container);
        observedContent = body; observedContainer = container;
      }
    }

    function updatePosition(reposition = false) {
      const live = answers.filter(answer => answer.isConnected);
      if (!live.length || innerHeight < 220) { nav.hidden = true; current = null; return; }
      const bounds = scrollBounds(getScrollContainer(live[0]));
      const anchor = bounds.top + Math.min(120, (bounds.bottom - bounds.top) * .25);
      let answer = live[0];
      for (const candidate of live) {
        if (answerRect(candidate).top <= anchor) answer = candidate;
        else break;
      }
      if (current !== answer) {
        current = answer; selected = null; list.scrollTop = 0; render(answer);
      }
      nav.hidden = false;
      if (layoutDirty || reposition) { layoutDirty = false; place(answer); }
      let active = null;
      for (const item of items) {
        if (item.element.getBoundingClientRect().top <= anchor + 2) active = item;
        else break;
      }
      if (selected !== active) {
        selected?.button.removeAttribute('aria-current');
        selected = active; selected?.button.setAttribute('aria-current', 'location');
      }
    }

    function refresh() {
      if (route !== location.pathname) {
        const continuingNewChat = route === '/' && location.pathname.includes('/c/');
        route = location.pathname;
        if (!continuingNewChat) {
          retired = new WeakSet(answers);
          current = null; selected = null; answers = []; list.replaceChildren(); items = [];
        }
      }
      const roots = new Set();
      for (const element of document.querySelectorAll(`${ASSISTANT}, ${MARKDOWN}`)) {
        if (element.closest(`${USER}, aside, nav, [role="dialog"], [contenteditable="true"]`) || !visible(element)) continue;
        if (!element.matches(ASSISTANT) && !element.closest(`main, [role="main"], [data-conversation-transcript], ${ASSISTANT}`)) continue;
        const root = element.closest(ASSISTANT) || element;
        if (!retired.has(root)) roots.add(root);
      }
      answers = Array.from(roots).filter(element => !Array.from(roots).some(parent => parent !== element && parent.contains(element)))
        .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
      if (current && answers.includes(current)) render(current);
      updatePosition();
    }

    const resizeObserver = new ResizeObserver(() => {
      layoutDirty = true;
      if (!layoutFrame) layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; updatePosition(); });
    });
    toggle.addEventListener('click', () => {
      layoutDirty = true;
      const expand = nav.hasAttribute('data-collapsed');
      if (nav.hasAttribute('data-compact')) compactExpanded = expand;
      else collapsed = !expand;
      updatePosition();
    });
    return { refresh, updatePosition };
  };
})();
