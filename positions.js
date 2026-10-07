(() => {
  "use strict";
  globalThis.ChatGPTBookmarkPositions = ({ host, shadow, onChange, onDragStart }) => {
    const keys = { rail: 'chatgptBookmarkPositionRail', outline: 'chatgptBookmarkPositionOutline' };
    const positions = new Map();
    const revisions = new Map();
    let drag = null;
    const css = document.createElement('style');
    css.textContent = `
      .drag-handle { display:block; flex:none; align-self:center; height:18px; min-height:18px;
        width:28px; padding:0; border-radius:6px; background:transparent; color:var(--muted);
        font:16px/18px system-ui,sans-serif; cursor:grab; touch-action:none; user-select:none; }
      .answer-outline .drag-handle { width:100%; }
      .drag-handle:hover, .drag-handle[data-dragging] { background:var(--hover); color:var(--accent); }
      .drag-handle[data-dragging] { cursor:grabbing; }
    `;
    shadow.append(css);
    const valid = value => value && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null;
    function change(id, position) {
      positions.set(id, position);
      revisions.set(id, (revisions.get(id) || 0) + 1);
      onChange();
    }
    async function save(id) {
      try {
        await chrome.storage.local.set({ [keys[id]]: positions.get(id) || null });
      } catch {
        const handle = shadow.querySelector(`[data-position-handle="${id}"]`);
        if (handle) handle.title = '位置暂未保存，请重新加载扩展并刷新页面后重试';
      }
    }
    function resolve(id, fallback, width, height) {
      const preferred = positions.get(id) || fallback;
      return {
        x: Math.max(8, Math.min(preferred.x, innerWidth - width - 8)),
        y: Math.max(8, Math.min(preferred.y, innerHeight - height - 8))
      };
    }
    function attach(id, element, label) {
      const handle = document.createElement('button');
      handle.type = 'button'; handle.className = 'drag-handle'; handle.textContent = '⠿';
      handle.dataset.positionHandle = id;
      handle.setAttribute('aria-label', `拖动${label}`);
      handle.title = '拖动调整位置并自动保存 · 双击恢复默认 · 方向键移动，Home 复位';
      element.prepend(handle);
      function finish(commit) {
        if (!drag || drag.id !== id) return;
        const previous = drag.previous;
        const moved = drag.moved;
        const pointerId = drag.pointerId;
        drag = null;
        handle.removeAttribute('data-dragging');
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        if (!commit) change(id, previous);
        else if (moved) void save(id);
      }
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || drag) return;
        event.preventDefault();
        onDragStart();
        handle.focus({ preventScroll: true });
        const rect = element.getBoundingClientRect();
        drag = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          left: rect.left, top: rect.top, previous: positions.get(id) || null, moved: false };
        handle.setPointerCapture(event.pointerId);
        handle.setAttribute('data-dragging', '');
      });
      handle.addEventListener('pointermove', event => {
        if (!drag || drag.id !== id || event.pointerId !== drag.pointerId) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        drag.moved = true;
        const rect = element.getBoundingClientRect();
        // Store the released position, not an off-screen pointer coordinate.
        const next = { x: Math.max(8, Math.min(drag.left + dx, innerWidth - rect.width - 8)),
          y: Math.max(8, Math.min(drag.top + dy, innerHeight - rect.height - 8)) };
        change(id, next);
      });
      handle.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId) finish(true); });
      handle.addEventListener('pointercancel', () => finish(false));
      handle.addEventListener('lostpointercapture', () => finish(false));
      handle.addEventListener('dblclick', () => { change(id, null); void save(id); });
      handle.addEventListener('keydown', event => {
        if (event.key === 'Escape' && drag?.id === id) { event.preventDefault(); finish(false); return; }
        if (drag) return;
        if (event.key === 'Home') { event.preventDefault(); change(id, null); void save(id); return; }
        const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!delta) return;
        event.preventDefault(); onDragStart();
        const rect = element.getBoundingClientRect(), step = event.shiftKey ? 1 : 10;
        const next = { x: rect.left + delta[0] * step, y: rect.top + delta[1] * step };
        change(id, { x: Math.max(8, Math.min(next.x, innerWidth - rect.width - 8)),
          y: Math.max(8, Math.min(next.y, innerHeight - rect.height - 8)) });
        void save(id);
      });
      window.addEventListener('blur', () => finish(false));
    }
    function fitFloating(element, anchor, top) {
      if (element.hidden) return;
      const rect = anchor.getBoundingClientRect(), base = host.getBoundingClientRect();
      const width = element.offsetWidth, height = element.offsetHeight;
      const preferred = rect.left - width - 12;
      const left = Math.max(8, Math.min(preferred >= 8 ? preferred : rect.right + 12, innerWidth - width - 8));
      element.style.right = 'auto'; element.style.bottom = 'auto'; element.style.transform = 'none';
      element.style.left = `${left - base.left}px`;
      element.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8)) - base.top}px`;
    }
    (async () => {
      try {
        // Register first so a simultaneous change in another tab cannot be overwritten by startup data.
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local') return;
          for (const [id, key] of Object.entries(keys)) {
            if (changes[key] && drag?.id !== id) change(id, valid(changes[key].newValue));
          }
        });
        const stored = await chrome.storage.local.get(Object.values(keys));
        for (const [id, key] of Object.entries(keys)) if (!revisions.has(id)) positions.set(id, valid(stored[key]));
        host.setAttribute('data-positions-ready', '');
        onChange();
      } catch { host.setAttribute('data-positions-ready', ''); }
    })();
    return { attach, resolve, fitFloating };
  };
})();
