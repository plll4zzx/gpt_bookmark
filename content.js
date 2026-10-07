(() => {
  "use strict";

  const HOST_ID = "chatgpt-message-bookmarks";
  // The desktop UI can render bubbles without either message-role attribute.
  const USER_SELECTOR = '[data-message-role="user"], [data-message-author-role="user"], [data-user-message-bubble]';
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.dataset.version = chrome.runtime.getManifest().version;
  // A shadow root keeps ChatGPT's styles and this extension's styles separate.
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; color-scheme: light; --bg: #ffffffed; --fg: #344054;
      --muted: #778397; --line: #dfe5ed; --accent: #087f70; --hover: #e5f5ef;
      --rail-top: clamp(12px, 10vh, 80px);
      position: fixed; right: 16px; top: var(--rail-top); transform: translateY(0);
      z-index: 2147483000; font: 12px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--fg); }
    :host([hidden]) { display: none !important; }
    :host([data-dark]) { color-scheme: dark; --bg: #23262cef; --fg: #e3e8ef;
      --muted: #99a5b7; --line: #424955; --accent: #65d8b7; --hover: #28463f; }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; cursor: pointer; border: 0; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .rail { width: 48px; padding: 7px 5px; border: 1px solid var(--line);
      border-radius: 24px; background: var(--bg); box-shadow: 0 4px 22px #00000012;
      backdrop-filter: blur(12px); display: flex; align-items: center; flex-direction: column;
      max-height:calc(100vh - 16px); overflow-y:auto; scrollbar-width:none; }
    .toggle { width: 32px; height: 32px; border-radius: 50%; display: grid;
      place-items: center; padding: 0; background: transparent; flex: none; }
    .toggle:hover { background: var(--hover); }
    svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; }
    .count { font-size: 10px; color: var(--muted); padding: 2px 0 7px; white-space: nowrap;
      font-variant-numeric: tabular-nums; }
    .dots { width: 36px; overflow-y: auto; overflow-x: hidden; max-height: min(54vh, 520px);
      padding: 3px 4px; scrollbar-width: thin; scrollbar-color: var(--line) transparent;
      overscroll-behavior: contain; overflow-anchor: none; position: relative; }
    .dots:empty { height: 0; }
    .history { width:32px; height:28px; border-radius:8px; background:transparent; font-size:16px; margin-top:4px; }
    .history:hover { background:var(--hover); color:var(--accent); }
    .history-status { position:fixed; right:60px; bottom:0; width:240px; padding:12px;
      border:1px solid var(--line); background:var(--bg); border-radius:12px; box-shadow:0 4px 18px #0002; }
    .history-status[hidden] { display:none; }
    .dot[data-unmounted]::before { opacity:.55; }
    .dots::before { content: ""; position: absolute; width: 1px; background: var(--line);
      top: 14px; bottom: 14px; left: 17px; pointer-events: none; }
    .dot { display: grid; place-items: center; width: 26px; height: 28px;
      padding: 0; background: transparent; position: relative; border-radius: 8px; }
    .dot::before { content: ""; width: 7px; height: 7px; border-radius: 50%;
      background: var(--muted); box-shadow: 0 0 0 4px var(--bg);
      transition: transform .15s ease, background .15s ease; }
    .dot:hover::before, .dot:focus-visible::before { background: var(--accent); transform: scale(1.4); }
    .dot[aria-current="true"]::before { background: var(--accent); transform: scale(1.3);
      box-shadow: 0 0 0 4px var(--hover); }
    .dot[data-saved]::after { content: ""; position: absolute; width: 4px; height: 4px;
      background: #d49c36; border-radius: 50%; right: 1px; top: 3px; }
    .rail[data-collapsed] .dots, .rail[data-collapsed] .count, .rail[data-collapsed] .history { display: none; }
    .tooltip { position: fixed; right: 60px; width: min(340px, calc(100vw - 100px));
      padding: 15px 17px; border: 1px solid var(--line); border-radius: 14px;
      background: var(--bg); box-shadow: 0 8px 32px #00000024; pointer-events: none;
      overflow: hidden; }
    .tooltip[hidden] { display: none; }
    .tooltip-heading { font-size: 11px; color: var(--accent); font-weight: 600;
      margin-bottom: 7px; letter-spacing: .04em; }
    .tooltip-text { font-size: 13px; line-height: 1.65; white-space: pre-wrap;
      overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 10;
      -webkit-box-orient: vertical; overflow: hidden; max-height: min(220px, 45vh); }
    .tooltip-footer { margin-top: 10px; font-size: 10px; color: var(--muted); }
    @media (max-width: 640px) { :host { right: 8px; } .rail { width: 40px; padding: 5px 1px; }
      .tooltip { right: 50px; } }
    @media (max-height: 420px) { .dots { max-height: 35vh; } }
    @media (prefers-reduced-motion: reduce) { .dot::before { transition: none; } }
  `;
  shadow.append(style);

  const rail = document.createElement("nav");
  rail.className = "rail";
  rail.setAttribute("aria-label", "你的消息书签");
  const toggle = document.createElement("button");
  toggle.className = "toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "折叠消息书签");
  toggle.setAttribute("aria-expanded", "true");
  toggle.title = "折叠消息书签";
  // Static icon markup only; message content is always assigned through textContent.
  toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z"/></svg>';
  const count = document.createElement("div");
  count.className = "count";
  const dots = document.createElement("div");
  dots.className = "dots";
  dots.id = "message-bookmark-dots";
  toggle.setAttribute("aria-controls", dots.id);
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  tooltip.id = "message-bookmark-preview";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  const tooltipHeading = document.createElement("div");
  tooltipHeading.className = "tooltip-heading";
  const tooltipText = document.createElement("div");
  tooltipText.className = "tooltip-text";
  const tooltipFooter = document.createElement("div");
  tooltipFooter.className = "tooltip-footer";
  tooltipFooter.textContent = "点击定位 · 右键收藏 · ↑ ↓ 切换";
  tooltip.append(tooltipHeading, tooltipText, tooltipFooter);
  rail.append(toggle, count, dots);
  const historyButton = document.createElement("button");
  historyButton.className = "history";
  historyButton.type = "button";
  historyButton.textContent = "⇡";
  historyButton.title = "加载历史消息（滚动检查，可随时停止）";
  historyButton.setAttribute("aria-label", "加载历史消息");
  const historyStatus = document.createElement("div");
  historyStatus.className = "history-status";
  historyStatus.setAttribute("role", "status");
  historyStatus.hidden = true;
  rail.append(historyButton);
  shadow.append(rail, tooltip, historyStatus);
  document.documentElement.append(host);

  let entries = [];
  let activeIndex = -1;
  let previewEntry = null;
  let scanTimer = 0;
  let frame = 0;
  let lastURL = location.href;
  let extras;
  let outline;
  let positions;
  let reading;
  let outlineTimer = 0;
  let renderedEntries = [];
  let conversationPath = location.pathname;
  let retiredElements = new WeakMap();
  let scanRevision = 0;
  let loader = null;
  let statusTimer = 0;
  let pendingJump = null;
  let preservedRailScroll = null;
  let readingDirection = "down";
  let scrollSample = { container: null, top: 0 };
  const mediaDark = matchMedia("(prefers-color-scheme: dark)");

  function updateTheme() {
    const roots = [document.documentElement, document.body].filter(Boolean);
    const dark = roots.some(root => root.classList.contains("dark") || root.dataset.theme === "dark");
    const light = roots.some(root => root.classList.contains("light") || root.dataset.theme === "light");
    host.toggleAttribute("data-dark", dark || (!light && mediaDark.matches));
  }

  function readMessage(element) {
    // These containers avoid including message action buttons in the preview.
    const content = element.querySelector("[data-user-message-copy], [data-user-message-bubble], .whitespace-pre-wrap, [data-message-content], .markdown") || element;
    const text = content.innerText.trim();
    const attachments = Array.from(element.querySelectorAll("img[alt]")).map(img => img.alt.trim()).filter(Boolean);
    return text || (attachments.length ? `[图片 / 附件] ${attachments.join("、")}` : "[图片、附件或非文本消息]");
  }

  function getScrollContainer(element) {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
        return parent;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollBounds(container) {
    if (container === document.scrollingElement || container === document.documentElement) {
      return { top: 0, bottom: innerHeight };
    }
    const rect = container.getBoundingClientRect();
    return { top: Math.max(0, rect.top + container.clientTop), bottom: Math.min(innerHeight, rect.bottom) };
  }

  function hidePreview() {
    if (previewEntry) previewEntry.button.removeAttribute("aria-describedby");
    previewEntry = null;
    tooltip.hidden = true;
  }

  function showPreview(entry) {
    if (rail.hasAttribute("data-collapsed")) return;
    if (previewEntry && previewEntry !== entry) previewEntry.button.removeAttribute("aria-describedby");
    previewEntry = entry;
    entry.button.setAttribute("aria-describedby", tooltip.id);
    tooltipHeading.textContent = `你的消息 ${entries.indexOf(entry) + 1} / ${entries.length}`;
    tooltipText.textContent = entry.text;
    tooltipFooter.textContent = renderedEntries.includes(entry) ? "点击定位 · 右键收藏 · ↑ ↓ 切换" : "页面暂未显示此消息 · 点击尝试恢复位置";
    tooltip.hidden = false;
    const buttonRect = entry.button.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const desiredTop = buttonRect.top + buttonRect.height / 2 - tooltip.offsetHeight / 2;
    const viewportTop = Math.max(8, Math.min(desiredTop, innerHeight - tooltip.offsetHeight - 8));
    // The transformed host is the fixed positioning containing block.
    tooltip.style.top = `${viewportTop - hostRect.top}px`;
    positions?.fitFloating(tooltip, rail, viewportTop);
  }

  function jumpTo(entry) {
    reading?.release();
    if (loader) loader.cancelled = true;
    if (!entry.element.isConnected || !renderedEntries.includes(entry)) {
      const container = renderedEntries[0] && getScrollContainer(renderedEntries[0].element);
      if (container && Number.isFinite(entry.position)) {
        pendingJump = { entry, expires: Date.now() + 4000 };
        container.scrollTo({ top: Math.max(0, entry.position - 96), behavior: "instant" });
        announce("正在恢复这条消息的位置…");
        scheduleScan();
        setTimeout(() => {
          if (pendingJump?.entry === entry) { pendingJump = null; announce("页面尚未恢复这条消息，请点击 ⇡ 加载历史后重试。"); }
        }, 4100);
      } else announce("这条消息暂未显示，请点击 ⇡ 加载历史后重试。");
      return;
    }
    navigateToElement(entry.element);
    hidePreview();
    schedulePosition();
  }

  function createEntry(element) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dot";
    const entry = { element, button, text: "", key: "", position: null };
    button.addEventListener("pointerenter", () => showPreview(entry));
    button.addEventListener("pointerleave", hidePreview);
    button.addEventListener("focus", () => showPreview(entry));
    button.addEventListener("blur", hidePreview);
    button.addEventListener("click", () => jumpTo(entry));
    button.addEventListener("contextmenu", event => {
      event.preventDefault(); extras?.toggleFavorite(entry); hidePreview();
    });
    button.addEventListener("keydown", event => {
      const index = entries.indexOf(entry);
      let next;
      if (event.key === "ArrowDown") next = Math.min(entries.length - 1, index + 1);
      if (event.key === "ArrowUp") next = Math.max(0, index - 1);
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = entries.length - 1;
      if (next !== undefined) { event.preventDefault(); entries[next].button.focus(); }
      if (event.key === "Escape") hidePreview();
      if (event.key.toLowerCase() === "s") { event.preventDefault(); extras?.toggleFavorite(entry); }
    });
    return entry;
  }

  function navigateToElement(element) {
    reading?.release();
    if (!element?.isConnected) return;
    // Native navigation reveals content-visibility subtrees and scrolls every
    // enclosing viewport. Arithmetic against a skipped subtree is not reliable.
    element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
    const container = getScrollContainer(element);
    const bounds = scrollBounds(container);
    const offset = Math.min(96, (bounds.bottom - bounds.top) * .2);
    container.scrollBy({ top: element.getBoundingClientRect().top - bounds.top - offset, behavior: 'instant' });
    schedulePosition();
  }

  function updatePosition(layout = false) {
    frame = 0;
    if (positions) {
      const base = host.getBoundingClientRect();
      const point = positions.resolve('rail', { x: base.left, y: base.top }, rail.offsetWidth, rail.offsetHeight);
      rail.style.transform = `translate(${point.x - base.left}px, ${point.y - base.top}px)`;
      placeTools();
    }
    outline?.updatePosition(layout === true);
    if (host.hidden || !renderedEntries.length) return;
    const container = getScrollContainer(renderedEntries[0].element);
    const bounds = scrollBounds(container);
    const anchor = bounds.top + Math.min(120, (bounds.bottom - bounds.top) * 0.25);
    let current = renderedEntries[0];
    for (const entry of renderedEntries) {
      const top = entry.element.getBoundingClientRect().top;
      entry.position = container.scrollTop + top - bounds.top;
      if (top <= anchor) current = entry;
    }
    // A short final answer may leave insufficient space to align the last user
    // message with the anchor. At the scroll end, mark that visible last message.
    const maxScroll = container.scrollHeight - container.clientHeight;
    if (maxScroll > 1 && container.scrollTop >= maxScroll - 2
        && renderedEntries.at(-1).element.getBoundingClientRect().top < bounds.bottom) current = renderedEntries.at(-1);
    const index = entries.indexOf(current);
    if (activeIndex !== index) {
      entries[activeIndex]?.button.removeAttribute("aria-current");
      activeIndex = index;
      const button = entries[index].button;
      button.setAttribute("aria-current", "true");
      count.textContent = `${index + 1}/${entries.length}`;
      count.setAttribute("aria-label", `当前第 ${index + 1} 条，共 ${entries.length} 条消息`);
      // Reading the conversation only updates the highlight. Never recenter the
      // bookmark rail under the user's mouse; keyboard focus scrolls it natively.
    }
    if (previewEntry) showPreview(previewEntry);
  }

  function schedulePosition() {
    if (!frame) frame = requestAnimationFrame(() => updatePosition());
  }

  function placeTools() {
    for (const element of shadow.querySelectorAll('.panel, .toast, .history-status')) {
      const top = element.matches('.panel') ? (innerHeight - element.offsetHeight) / 2
        : rail.getBoundingClientRect().bottom - element.offsetHeight;
      positions?.fitFloating(element, rail, top);
    }
  }

  function findUserMessages() {
    // Search explicit message markers across the document. A stale or hidden
    // transcript container must not mask a different, visible desktop transcript.
    const visible = Array.from(document.querySelectorAll(USER_SELECTOR)).filter(element =>
      !element.closest('[hidden], [aria-hidden="true"], [inert]')
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    const candidates = new Set(visible);
    return visible.filter(element => {
      // Deduplicate only against visible ancestors. A display:contents role
      // wrapper has no layout box, but its bubble is still a usable scroll target.
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (candidates.has(parent)) return false;
      }
      return true;
    });
  }

  function reconcile() {
    scanTimer = 0;
    if (!host.isConnected) document.documentElement.append(host);
    updateTheme();
    if (conversationPath !== location.pathname) {
      const continuingNewChat = conversationPath === "/" && location.pathname.includes("/c/");
      conversationPath = location.pathname;
      if (!continuingNewChat) {
        reading?.release();
        // The router can change the URL before replacing the old transcript.
        // Don't index those old DOM nodes into the newly opened conversation.
        retiredElements = new WeakMap(entries.map(entry => [entry.element, entry.key]));
        entries = [];
        renderedEntries = [];
        activeIndex = -1;
        dots.replaceChildren();
        dots.style.removeProperty("height");
      }
      pendingJump = null;
      if (loader) loader.cancelled = true;
      hidePreview();
    }
    const elements = findUserMessages();
    const previousEntries = entries;
    const previous = new Map(entries.map(entry => [entry.key, entry]));
    const occurrences = new Map();
    renderedEntries = elements.map(element => {
      const text = readMessage(element);
      const id = element.dataset.messageId || element.id
        || element.closest("[data-message-id]")?.getAttribute("data-message-id")
        || element.closest("[data-chatgpt-search-message-ids]")?.getAttribute("data-chatgpt-search-message-ids")
        || element.closest("[data-turn-id]")?.getAttribute("data-turn-id") || element.closest("article[id]")?.id;
      const base = id ? `id:${id}` : `text:${text}`;
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      const key = `${base}:${occurrence}`;
      if (retiredElements.get(element) === key) return null;
      const entry = previous.get(key) || (!id && entries.find(item => item.element === element)) || createEntry(element);
      entry.element = element; entry.text = text; entry.key = key; entry.messageId = id || "";
      return entry;
    }).filter(Boolean);
    // Preserve messages temporarily unmounted by the site's virtualized list.
    // Nodes that remain in the document but lose their user marker/visibility
    // are excluded (for example a hidden message branch).
    entries = entries.filter(entry => !entry.element.isConnected || renderedEntries.includes(entry)
      || renderedEntries.some(item => item.element === entry.element && item.key !== entry.key));
    const oldOrder = new Set(entries);
    const hasOverlap = renderedEntries.some(entry => oldOrder.has(entry));
    let cursor = null;
    for (let i = 0; i < renderedEntries.length; i++) {
      const entry = renderedEntries[i];
      if (!entries.includes(entry)) {
        const next = renderedEntries.slice(i + 1).find(item => oldOrder.has(item));
        const at = next ? entries.indexOf(next) : cursor ? entries.indexOf(cursor) + 1
          : !hasOverlap && readingDirection === "up" ? 0 : entries.length;
        entries.splice(at, 0, entry);
      }
      cursor = entry;
    }
    const changed = entries.length !== previousEntries.length || entries.some((entry, i) => entry !== previousEntries[i]);
    if (changed) scanRevision++;
    const anchorButton = Array.from(dots.children).find(button => button.offsetTop + button.offsetHeight > dots.scrollTop);
    const anchorOffset = anchorButton ? anchorButton.offsetTop - dots.scrollTop : 0;
    const focused = shadow.activeElement;
    // Hold the viewport only while the user is interacting with the dots.
    // Otherwise let short conversations use their natural, compact height.
    if (changed && dots.clientHeight > 0 && (dots.matches(":hover") || dots.contains(focused))) {
      dots.style.height = `${dots.clientHeight}px`;
    }
    const currentEntry = previousEntries[activeIndex];
    const keep = new Set(entries.map(entry => entry.button));
    for (const button of Array.from(dots.children)) if (!keep.has(button)) button.remove();
    for (const [i, entry] of entries.entries()) {
      entry.button.setAttribute("aria-label", `第 ${i + 1} 条消息：${entry.text.slice(0, 180)}`);
      entry.button.toggleAttribute("data-unmounted", !renderedEntries.includes(entry));
      if (dots.children[i] !== entry.button) dots.insertBefore(entry.button, dots.children[i] || null);
    }
    if (anchorButton?.isConnected && dots.clientHeight > 0) {
      const desiredScroll = Math.max(0, Math.min(anchorButton.offsetTop - anchorOffset, dots.scrollHeight - dots.clientHeight));
      if (dots.scrollTop !== desiredScroll) preservedRailScroll = desiredScroll;
      dots.scrollTop = desiredScroll;
    }
    if (focused && shadow.activeElement !== focused && keep.has(focused)) focused.focus({ preventScroll: true });
    activeIndex = entries.indexOf(currentEntry);
    if (entries.length && activeIndex >= 0) count.textContent = `${activeIndex + 1}/${entries.length}`;
    count.title = `本次会话已索引 ${entries.length} 条提问；点击 ⇡ 检查更早的历史消息`;
    count.setAttribute("aria-label", `当前第 ${Math.max(0, activeIndex + 1)} 条，已索引 ${entries.length} 条消息`);
    if (previewEntry && !entries.includes(previewEntry)) hidePreview();
    if (!entries.length) { count.textContent = "0/0"; count.setAttribute("aria-label", "当前没有用户消息"); hidePreview(); }
    extras?.refresh();
    outline?.refresh();
    if (pendingJump && renderedEntries.includes(pendingJump.entry) && Date.now() < pendingJump.expires) {
      const target = pendingJump.entry; pendingJump = null; jumpTo(target);
    }
    schedulePosition();
  }

  function announce(message, persistent = false) {
    clearTimeout(statusTimer);
    historyStatus.textContent = message;
    historyStatus.hidden = false;
    if (!persistent) statusTimer = setTimeout(() => { historyStatus.hidden = true; }, 5000);
  }

  async function loadHistory() {
    reading?.release();
    if (loader) { loader.cancelled = true; return; }
    const first = renderedEntries[0];
    if (!first) { announce("请等待对话消息显示后再加载历史。"); return; }
    let container = getScrollContainer(first.element);
    const bounds = scrollBounds(container);
    const saved = renderedEntries.find(entry => entry.element.getBoundingClientRect().bottom > bounds.top) || first;
    const originalOffset = saved.element.getBoundingClientRect().top - bounds.top;
    const originalTop = container.scrollTop;
    const run = { cancelled: false, path: location.pathname };
    loader = run;
    historyButton.textContent = "■";
    historyButton.setAttribute("aria-label", "停止加载历史消息");
    historyButton.title = "停止加载；手动滚动也会停止";
    hidePreview();
    let quietSince = Date.now();
    const started = Date.now();
    let signature = "";
    try {
      while (!run.cancelled && location.pathname === run.path && Date.now() - started < 90000) {
        if (!container.isConnected) {
          const live = renderedEntries.find(entry => entry.element.isConnected);
          if (!live) { run.cancelled = true; break; }
          container = getScrollContainer(live.element);
        }
        readingDirection = "up";
        // Walk upwards rather than teleporting past virtualized middle batches.
        const step = Math.max(240, container.clientHeight * .8);
        container.scrollTo({ top: Math.max(0, container.scrollTop - step), behavior: "instant" });
        await new Promise(resolve => setTimeout(resolve, 450));
        if (run.cancelled || location.pathname !== run.path) break;
        reconcile();
        const current = `${scanRevision}:${container.scrollHeight}:${renderedEntries[0]?.key}`;
        if (current !== signature || container.scrollTop > 2) { signature = current; quietSince = Date.now(); }
        announce(`正在加载历史 · 已索引 ${entries.length} 条提问。手动滚动或点击 ■ 可停止。`, true);
        if (container.scrollTop <= 2 && Date.now() - quietSince >= 3600) break;
      }
      if (!run.cancelled && location.pathname === run.path) {
        // Restore the reader's anchor, accounting for prepended messages.
        const target = saved.element.isConnected ? container.scrollTop + saved.element.getBoundingClientRect().top
          - scrollBounds(container).top - originalOffset : saved.position ?? originalTop;
        container.scrollTo({ top: target, behavior: "instant" });
        announce(`历史检查已结束，已索引 ${entries.length} 条提问。若网页仍在加载，可再次点击 ⇡。`);
      } else announce("已停止加载，保留已发现的书签。");
    } catch {
      announce("历史加载已停止，请等待页面稳定后重试。");
    } finally {
      loader = null;
      historyButton.textContent = "⇡";
      historyButton.setAttribute("aria-label", "加载历史消息");
      historyButton.title = "加载历史消息（滚动检查，可随时停止）";
      scheduleScan();
    }
  }

  function scheduleScan() {
    // Throttle rather than debounce so a streaming answer cannot postpone updates forever.
    if (!scanTimer) scanTimer = setTimeout(reconcile, 180);
  }

  toggle.addEventListener("click", () => {
    const collapsed = rail.toggleAttribute("data-collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    const label = collapsed ? "展开消息书签" : "折叠消息书签";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    hidePreview();
    schedulePosition();
  });
  dots.addEventListener("scroll", () => {
    if (preservedRailScroll !== null && Math.abs(dots.scrollTop - preservedRailScroll) < 1) {
      preservedRailScroll = null;
      if (previewEntry) showPreview(previewEntry);
    } else { preservedRailScroll = null; hidePreview(); }
  }, { passive: true });
  const releaseDotHeight = () => {
    if (!dots.matches(":hover") && !dots.contains(shadow.activeElement)) dots.style.removeProperty("height");
  };
  dots.addEventListener("pointerleave", releaseDotHeight);
  dots.addEventListener("focusout", () => queueMicrotask(releaseDotHeight));
  historyButton.addEventListener("click", loadHistory);
  const stopLoading = event => {
    if (loader && !event.composedPath().includes(host)) loader.cancelled = true;
  };
  document.addEventListener("wheel", stopLoading, { capture: true, passive: true });
  document.addEventListener("touchmove", stopLoading, { capture: true, passive: true });
  document.addEventListener("pointerdown", stopLoading, { capture: true, passive: true });
  document.addEventListener("keydown", event => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Escape", " "].includes(event.key)) stopLoading(event);
  }, true);
  document.addEventListener("scroll", event => {
    if (event.composedPath().includes(host)) return;
    const container = renderedEntries[0] && getScrollContainer(renderedEntries[0].element);
    if (container) {
      if (scrollSample.container === container && scrollSample.top !== container.scrollTop) readingDirection = container.scrollTop < scrollSample.top ? "up" : "down";
      scrollSample = { container, top: container.scrollTop };
    }
    schedulePosition();
  }, { capture: true, passive: true });
  window.addEventListener("resize", () => updatePosition(true), { passive: true });
  mediaDark.addEventListener("change", updateTheme);
  const ASSISTANT_CONTENT = '[data-message-role="assistant"], [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"], .markdown, [data-assistant-markdown]';
  const OUTLINE_STRUCTURE = `${ASSISTANT_CONTENT}, h1,h2,h3,h4,h5,h6,[role="heading"]`;
  const containsMatch = (node, selector) => node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector));
  const observer = new MutationObserver(records => {
    reading?.maintain(records);
    let scan = false, outlineDirty = false;
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (!target || target === host || host.contains(target)) continue;
      if (target.closest('textarea,input,[contenteditable="true"]')) continue;
      if (record.type === 'attributes' && ['data-is-streaming', 'data-streaming', 'data-stop-label', 'aria-label'].includes(record.attributeName)) continue;
      if (record.type === 'attributes' && !['class', 'style'].includes(record.attributeName)) { scan = true; continue; }
      if (target.closest(USER_SELECTOR)) { scan = true; continue; }
      const nodes = [...record.addedNodes, ...record.removedNodes];
      if (nodes.some(node => containsMatch(node, USER_SELECTOR))) { scan = true; continue; }
      if (target.closest(ASSISTANT_CONTENT)) {
        if (target.closest('h1,h2,h3,h4,h5,h6,[role="heading"]')
          || (record.type === 'attributes' && target.matches(ASSISTANT_CONTENT))
          || nodes.some(node => containsMatch(node, OUTLINE_STRUCTURE))) outlineDirty = true;
        // Plain streamed paragraphs do not change the message index or headings.
        continue;
      }
      if (record.type !== 'characterData') scan = true;
    }
    if (scan) scheduleScan();
    else if (outlineDirty && !outlineTimer) outlineTimer = setTimeout(() => {
      outlineTimer = 0; outline?.refresh();
    }, 250);
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-level", "role", "inert", "data-message-role", "data-message-author-role", "data-user-message-bubble", "data-chatgpt-search-message-ids", "data-theme", "data-is-streaming", "data-streaming", "data-stop-label", "aria-label"]
  });
  // ChatGPT uses client-side navigation; DOM observation handles most transitions.
  // URL checking also handles history changes that do not immediately mutate the DOM.
  setInterval(() => {
    if (document.hidden) return;
    if (lastURL !== location.href || !host.isConnected) {
      lastURL = location.href;
      hidePreview();
      scheduleScan();
    }
  }, 800);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleScan(); });
  reading = globalThis.ChatGPTReadingPosition({
    host, getScrollContainer, scrollBounds,
    getContainer: () => {
      const element = renderedEntries.find(entry => entry.element.isConnected && entry.element.getClientRects().length
        && !entry.element.closest('[hidden],[aria-hidden="true"],[inert]'))?.element || findUserMessages()[0];
      return element ? getScrollContainer(element) : null;
    }
  });
  positions = globalThis.ChatGPTBookmarkPositions?.({
    host, shadow, onChange: () => updatePosition(true),
    onDragStart: () => { hidePreview(); if (loader) loader.cancelled = true; }
  });
  positions?.attach('rail', rail, '右侧消息书签');
  extras = globalThis.ChatGPTBookmarkExtras?.({
    host, shadow, rail, getEntries: () => entries,
    getActive: () => entries[activeIndex], jumpTo, hidePreview, beforeSend: () => reading.beforeSend()
  });
  outline = globalThis.ChatGPTAnswerOutline?.({
    host, shadow, positions, getScrollContainer, scrollBounds, jumpToHeading: target => navigateToElement(target()),
    onNavigate: () => { if (loader) loader.cancelled = true; pendingJump = null; hidePreview(); }
  });
  const floatingObserver = new MutationObserver(placeTools);
  floatingObserver.observe(shadow, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  const widgetResize = new ResizeObserver(schedulePosition);
  for (const element of [rail, ...shadow.querySelectorAll('.panel, .toast, .history-status')]) widgetResize.observe(element);
  reconcile();
})();
