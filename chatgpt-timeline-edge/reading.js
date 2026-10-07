(() => {
  'use strict';
  globalThis.ChatGPTReadingPosition = ({ host, getContainer, getScrollContainer, scrollBounds }) => {
    const EDITOR = 'textarea, [contenteditable="true"], input';
    const COMPOSER = '#prompt-textarea, #mobile-composer-prompt, [data-mobile-composer-prompt], [data-composer-editor-host] [contenteditable="true"]';
    const SEND = '[data-testid="send-button"], [data-composer-submit], [data-send-button], button[aria-label="发送消息"], button[aria-label="Send prompt"], button[aria-label="Send message"]';
    const ANSWER = '[data-message-role], [data-message-author-role], [data-chatgpt-search-unit-key], article, .markdown';
    let pinned = null;
    let draft = null;
    let frame = 0;
    function release() { pinned = null; draft = null; }
    const USER = '[data-user-message-bubble], [data-message-role="user"], [data-message-author-role="user"]';
    function lastMessage() {
      const elements = Array.from(document.querySelectorAll(USER)).filter(el => el.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"]'));
      const last = elements.at(-1);
      return { element: last, count: elements.length, text: last?.textContent?.trim() || '' };
    }
    function capture() {
      const container = getContainer();
      if (!container) return null;
      const bounds = scrollBounds(container), rect = container.getBoundingClientRect();
      const x = Math.max(8, Math.min(innerWidth - 8, rect.left + rect.width / 2));
      const at = document.elementFromPoint(x, bounds.top + Math.min(120, (bounds.bottom - bounds.top) / 4));
      const anchor = at?.closest('h1,h2,h3,h4,h5,h6,p,li,[data-user-message-bubble],[data-message-role],[data-message-author-role]');
      const usable = anchor && anchor.getClientRects().length > 0 && container.contains(anchor)
        && !host.contains(anchor) && !anchor.closest(EDITOR);
      return { path: location.pathname, container, top: container.scrollTop,
        atBottom: container.scrollHeight - container.clientHeight - container.scrollTop <= 80,
        anchor: usable ? { target: () => anchor, text: anchor.textContent, owner: anchor.closest(ANSWER) } : null,
        offset: usable ? anchor.getBoundingClientRect().top - bounds.top : 0 };
    }
    function rememberDraft(editor) {
      if (!editor.matches(COMPOSER)) return;
      if (draft?.snapshot.path === location.pathname) return;
      const snapshot = capture();
      if (snapshot) draft = { snapshot, editor, last: lastMessage(), text: editor.value || editor.textContent || '' };
    }
    function schedule() {
      if (pinned && !frame) frame = requestAnimationFrame(() => { frame = 0; restore(); });
    }
    function restore() {
      if (!pinned) return;
      if (pinned.path !== location.pathname) {
        if (pinned.path === '/' && location.pathname.includes('/c/')) pinned.path = location.pathname;
        else { release(); return; }
      }
      if (!pinned.container.isConnected || !pinned.container.getClientRects().length) {
        const replacement = getContainer();
        if (!replacement?.isConnected) return;
        pinned.container = replacement;
        pinned.anchor = null;
      }
      const element = pinned.anchor?.target();
      // Virtual lists may recycle a still-connected node into another turn.
      // Never follow that node, or change scroll containers, during restoration.
      if (element?.isConnected && pinned.container.contains(element) && element.getClientRects().length
        && element.textContent === pinned.anchor.text && element.closest(ANSWER) === pinned.anchor.owner) {
        const bounds = scrollBounds(pinned.container);
        pinned.top = pinned.container.scrollTop + element.getBoundingClientRect().top - bounds.top - pinned.offset;
      } else if (pinned.anchor) {
        pinned.anchor = null;
      }
      const container = pinned.container;
      if (!container?.isConnected) { release(); return; }
      const top = Math.max(0, Math.min(pinned.top, container.scrollHeight - container.clientHeight));
      // Instant corrections avoid competing smooth animations during streaming.
      if (Math.abs(container.scrollTop - top) > 1) container.scrollTo({ top, behavior: 'instant' });
    }
    function beforeSend() {
      if (pinned) { restore(); return; }
      const current = capture();
      const saved = draft?.snapshot.path === location.pathname ? draft.snapshot : null;
      // Focusing the composer can move the conversation before a send event.
      // Preserve the pre-focus position when that focus jump reached the bottom.
      const snapshot = current?.atBottom && saved && !saved.atBottom ? saved : current;
      if (!snapshot || snapshot.atBottom) return;
      pinned = { ...snapshot };
      restore();
      schedule();
    }
    function sendButton(event) {
      const button = event.target.closest?.(SEND);
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return null;
      const label = button.getAttribute('aria-label') || '';
      if (button.matches('[data-testid="stop-button"]') || /stop|停止/i.test(label)
        || (button.dataset.stopLabel && label === button.dataset.stopLabel)) return null;
      return button;
    }
    // Capture before the app moves focus or starts its submit/auto-follow handlers.
    window.addEventListener('pointerdown', event => {
      if (event.composedPath().includes(host)) return;
      if (sendButton(event)) beforeSend();
      else if (event.target.closest?.(EDITOR)) rememberDraft(event.target.closest(EDITOR));
      else if (!draft?.editor?.closest('form')?.contains(event.target)) release();
    }, true);
    window.addEventListener('focus', event => {
      const editor = event.target.closest?.(EDITOR);
      if (editor && !event.composedPath().includes(host)) rememberDraft(editor);
    }, true);
    window.addEventListener('input', event => {
      const editor = event.target.closest?.(EDITOR);
      if (!editor || event.composedPath().includes(host)) return;
      rememberDraft(editor);
      const text = editor.value || editor.textContent || '';
      if (draft && text.trim()) draft.text = text;
    }, true);
    window.addEventListener('click', event => { if (sendButton(event)) beforeSend(); }, true);
    window.addEventListener('submit', event => {
      if (event.target.querySelector?.('#prompt-textarea, #mobile-composer-prompt, [data-mobile-composer-prompt], [contenteditable="true"]')) beforeSend();
    }, true);
    const manualScroll = event => {
      if (!event.composedPath().includes(host) && !event.target.closest?.(EDITOR)) release();
    };
    window.addEventListener('wheel', manualScroll, { capture: true, passive: true });
    window.addEventListener('touchmove', manualScroll, { capture: true, passive: true });
    window.addEventListener('keydown', event => {
      if (event.composedPath().includes(host) && ['PageUp', 'PageDown'].includes(event.key)) { release(); return; }
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) manualScroll(event);
    }, true);
    document.addEventListener('scroll', event => {
      if (!pinned || event.composedPath().includes(host)) return;
      if (event.target === pinned.container || event.target === document) { restore(); schedule(); }
    }, { capture: true, passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    // The mutation callback runs after the app's current rendering task, before
    // painting. Correct its same-task auto-scroll there, not one frame later.
    const maintain = records => {
      if (!pinned && draft?.text.trim() && draft.snapshot.path === location.pathname
        && records?.some(record => Array.from(record.addedNodes).some(node => node.nodeType === 1 && (node.matches(USER) || node.querySelector(USER))))) {
        const latest = lastMessage();
        // Fallback for composer variants without known send-button attributes.
        // Historical prepends keep the same last message, so they do not submit.
        const changed = latest.element !== draft.last.element && (latest.text !== draft.last.text || latest.count > draft.last.count);
        if (changed && latest.text.includes(draft.text.trim()) && !draft.snapshot.atBottom) pinned = { ...draft.snapshot };
      }
      restore(); schedule();
    };
    return { beforeSend, schedule, maintain, release };
  };
})();
