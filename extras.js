(() => {
  "use strict";
  globalThis.ChatGPTBookmarkExtras = ({ host, shadow, rail, getEntries, getActive, jumpTo, hidePreview, beforeSend }) => {
    const STORAGE_KEY = "chatgptTimelineData";
    const COMPOSER = '#mobile-composer-prompt, [data-mobile-composer-prompt], #prompt-textarea, [data-composer-editor-host] [contenteditable="true"]';
    let data = { prompts: [], favorites: [], settings: { enterNewline: true, formulaCopy: true } };
    let loaded = false;
    let activeTab = "prompts";
    let editingId = null;
    let search = "";
    let toastTimer;
    let formula = null;
    let formulaTimer;
    let pendingFavorite = null;

    const css = document.createElement("style");
    css.textContent = `
      .tools { display:flex; flex-direction:column; gap:3px; border-top:1px solid var(--line); margin-top:6px; padding-top:6px; }
      .rail[data-collapsed] .tools { display:none; }
      .tool { width:30px; height:30px; display:grid; place-items:center; border-radius:50%; background:transparent; font-size:17px; }
      .tool:hover, .tool[aria-expanded="true"] { background:var(--hover); color:var(--accent); }
      .panel { position:fixed; right:60px; top:calc(50vh - var(--rail-top)); transform:translateY(-50%); width:min(370px,calc(100vw - 80px));
        max-height: min(660px, calc(100vh - 32px)); border:1px solid var(--line); border-radius:18px;
        background:var(--bg); box-shadow:0 10px 40px #00000026; padding:18px; overflow-y:auto; overscroll-behavior:contain; }
      .panel[hidden], .toast[hidden], .formula-copy[hidden] { display:none; }
      .panel header { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
      .panel h2 { margin:0; font-size:16px; font-weight:650; }
      .panel .close { background:transparent; color:var(--muted); font-size:20px; border-radius:8px; width:28px; height:28px; }
      .panel label { display:block; margin:10px 0 5px; font-size:12px; }
      .panel input[type="text"], .panel textarea { box-sizing:border-box; width:100%; padding:9px 11px;
        background:transparent; color:var(--fg); border:1px solid var(--line); border-radius:9px;
        font:12px/1.6 system-ui,sans-serif; }
      .panel input:focus, .panel textarea:focus { outline:2px solid var(--accent); outline-offset:1px; }
      .panel textarea { min-height:112px; resize:vertical; }
      .panel .primary { background:var(--accent); color:var(--bg); padding:8px 13px; border-radius:8px; font-weight:600; }
      .panel .secondary { background:var(--hover); padding:7px 10px; border-radius:8px; }
      .panel .row { display:flex; gap:6px; align-items:center; margin-top:9px; flex-wrap:wrap; }
      .panel .hint { color:var(--muted); line-height:1.7; font-size:11px; }
      .panel .card { border:1px solid var(--line); border-radius:11px; padding:12px; margin-top:10px; }
      .panel .card-title { font-size:13px; font-weight:600; overflow-wrap:anywhere; }
      .panel .snippet { white-space:pre-wrap; overflow-wrap:anywhere; color:var(--muted); margin-top:6px;
        font-size:12px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
      .panel .danger { background:transparent; color:var(--muted); padding:7px; margin-left:auto; border-radius:7px; }
      .panel .check-label { display:flex; gap:10px; align-items:flex-start; margin:18px 0 5px; }
      .panel input[type="checkbox"] { accent-color:var(--accent); margin-top:3px; }
      .panel .empty { color:var(--muted); padding:20px 0; line-height:1.8; }
      .toast { position:fixed; right:60px; bottom:0; border:1px solid var(--line); padding:10px 14px;
        background:var(--bg); border-radius:10px; box-shadow:0 4px 20px #0002; width:max-content;
        max-width:min(330px,calc(100vw - 90px)); font-size:12px; z-index:2; }
      .formula-copy { position:fixed; padding:7px 11px; border-radius:8px; background:var(--accent);
        color:var(--bg); box-shadow:0 3px 14px #0003; white-space:nowrap; font-size:11px; }
      @media(max-width:640px) { .panel { right:48px; } }
    `;
    shadow.append(css);
    const tools = document.createElement("div");
    tools.className = "tools";
    rail.append(tools);
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "时间轴工具");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.hidden = true;
    const formulaButton = document.createElement("button");
    formulaButton.type = "button";
    formulaButton.className = "formula-copy";
    formulaButton.textContent = "复制 LaTeX";
    formulaButton.hidden = true;
    shadow.append(panel, toast, formulaButton);
    const toolButtons = new Map();

    function node(tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }

    function button(text, className, action) {
      const element = node("button", className, text);
      element.type = "button";
      element.addEventListener("click", action);
      return element;
    }

    function notify(message) {
      toast.textContent = message;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
    }

    function ready() {
      if (!loaded) { notify("本地数据正在读取，请稍候"); return false; }
      return true;
    }

    async function save() {
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: data });
        return true;
      } catch {
        notify("保存失败：请重新加载扩展或检查本地存储空间");
        return false;
      }
    }

    async function copy(text) {
      try { await navigator.clipboard.writeText(text); notify("已复制到剪贴板"); }
      catch { notify("复制失败，请确认允许访问剪贴板后重试"); }
    }

    function closePanel() {
      panel.hidden = true;
      for (const element of toolButtons.values()) element.setAttribute("aria-expanded", "false");
    }

    function openPanel(tab) {
      if (!ready()) return;
      hidePreview();
      if (!panel.hidden && activeTab === tab) { closePanel(); return; }
      activeTab = tab;
      editingId = null;
      search = "";
      panel.hidden = false;
      renderPanel();
      for (const [name, element] of toolButtons) element.setAttribute("aria-expanded", String(name === tab));
      panel.querySelector("input, button")?.focus();
    }

    for (const [tab, icon, label] of [["prompts", "≡", "提示词库"], ["favorites", "☆", "收藏消息"], ["settings", "⚙", "功能设置"]]) {
      const element = button(icon, "tool", () => openPanel(tab));
      element.setAttribute("aria-label", label);
      element.setAttribute("aria-expanded", "false");
      element.title = label;
      tools.append(element);
      toolButtons.set(tab, element);
    }
    panel.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.stopPropagation(); closePanel(); toolButtons.get(activeTab)?.focus(); }
    });
    document.addEventListener("pointerdown", event => { if (!event.composedPath().includes(host)) closePanel(); });
    rail.querySelector(".toggle").addEventListener("click", closePanel);

    function getComposer() {
      return Array.from(document.querySelectorAll(COMPOSER)).find(element =>
        element.getClientRects().length && !element.disabled && !element.readOnly
        && (element.tagName === "TEXTAREA" || element.isContentEditable));
    }

    function insertText(editor, text, append = false) {
      editor.focus();
      if (editor instanceof HTMLTextAreaElement) {
        const start = append ? editor.value.length : editor.selectionStart;
        const end = append ? editor.value.length : editor.selectionEnd;
        const value = editor.value.slice(0, start) + text + editor.value.slice(end);
        // The native setter plus input event supports controlled framework inputs.
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(editor, value);
        editor.setSelectionRange(start + text.length, start + text.length);
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        return true;
      }
      if (append) {
        const range = document.createRange();
        range.selectNodeContents(editor); range.collapse(false);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      }
      // Native editing preserves undo and notifies ProseMirror / Lexical via input.
      return document.execCommand(text === "\n" ? "insertLineBreak" : "insertText", false, text);
    }

    function usePrompt(prompt) {
      const editor = getComposer();
      if (!editor) { notify("未找到可用输入框，请先打开一个 ChatGPT 对话"); return; }
      const existing = editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText;
      if (insertText(editor, (existing.trim() ? "\n\n" : "") + prompt.text, true)) {
        closePanel(); notify("已插入输入框，检查后再发送");
      } else notify("插入失败，可先复制提示词再粘贴");
    }

    document.addEventListener("keydown", event => {
      if (!loaded || event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      const editor = getComposer();
      if (!editor || !(event.target === editor || editor.contains(event.target))) return;
      if (!data.settings.enterNewline) {
        if (!event.shiftKey && !event.altKey) beforeSend?.();
        return;
      }
      // Ctrl/Command+Enter uses the page's existing send button. Never send while composing Chinese text.
      if (event.ctrlKey || event.metaKey) {
        if (event.shiftKey || event.altKey) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const scope = editor.closest("form") || document;
        const send = scope.querySelector('[data-testid="send-button"], [data-composer-submit], [data-send-button], button[aria-label="发送消息"], button[aria-label="Send prompt"], button[aria-label="Send message"]');
        const isStop = send?.dataset.stopLabel && send.getAttribute("aria-label") === send.dataset.stopLabel;
        if (send && !send.disabled && send.getAttribute("aria-disabled") !== "true" && !isStop) { beforeSend?.(); send.click(); }
        else notify("当前无法发送，请使用 ChatGPT 的发送按钮");
        return;
      }
      if (event.altKey) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!insertText(editor, "\n")) notify("换行失败，可在功能设置中关闭 Enter 换行");
    }, true);

    function messageId(entry) {
      return entry.messageId || entry.element.dataset.messageId || entry.element.id || entry.element.closest("[data-message-id], [data-turn-id], article[id]")?.getAttribute("data-message-id")
        || entry.element.closest("[data-turn-id]")?.getAttribute("data-turn-id") || entry.element.closest("article[id]")?.id
        || entry.element.closest("[data-chatgpt-search-message-ids]")?.getAttribute("data-chatgpt-search-message-ids") || "";
    }

    function chatURL() { return `${location.origin}${location.pathname}`; }

    function matchesFavorite(saved, entry) {
      if (saved.url !== chatURL()) return false;
      const id = messageId(entry);
      return saved.messageId && id ? saved.messageId === id : saved.text === entry.text;
    }

    async function toggleFavorite(entry) {
      if (!entry || !ready()) { if (!entry) notify("当前没有可收藏的消息"); return; }
      const index = data.favorites.findIndex(saved => matchesFavorite(saved, entry));
      if (index >= 0) data.favorites.splice(index, 1);
      else data.favorites.unshift({
        id: crypto.randomUUID(), messageId: messageId(entry), text: entry.text,
        url: chatURL(), title: document.title.replace(/\s*[-|]\s*ChatGPT$/, ""),
        index: getEntries().indexOf(entry), createdAt: Date.now()
      });
      refresh();
      if (!panel.hidden && activeTab === "favorites") renderPanel();
      if (await save()) notify(index >= 0 ? "已取消收藏" : "已收藏到本机");
    }

    function visitFavorite(saved) {
      if (saved.url === chatURL()) {
        const entry = getEntries().find(item => matchesFavorite(saved, item));
        if (entry) { jumpTo(entry); closePanel(); return; }
        notify("这条消息尚未加载，或已被编辑 / 删除"); return;
      }
      try {
        const url = new URL(saved.url);
        if (url.protocol !== "https:" || !["chatgpt.com", "chat.openai.com"].includes(url.hostname)) throw new Error();
        url.hash = `timeline-bookmark=${encodeURIComponent(saved.id)}`;
        window.open(url.href, "_blank", "noopener,noreferrer");
      } catch { notify("无法打开这条收藏的会话链接"); }
    }

    function refresh() {
      for (const entry of getEntries()) entry.button.toggleAttribute("data-saved", data.favorites.some(saved => matchesFavorite(saved, entry)));
      const match = location.hash.match(/^#timeline-bookmark=(.+)$/);
      if (match && loaded && pendingFavorite !== match[1]) {
        const saved = data.favorites.find(item => encodeURIComponent(item.id) === match[1]);
        const entry = saved && getEntries().find(item => matchesFavorite(saved, item));
        if (entry) { pendingFavorite = match[1]; setTimeout(() => jumpTo(entry), 150); }
      }
    }

    function renderPanel() {
      panel.replaceChildren();
      const header = node("header");
      header.append(node("h2", "", { prompts: "提示词库", favorites: "收藏消息", settings: "功能设置" }[activeTab]));
      const close = button("×", "close", closePanel); close.setAttribute("aria-label", "关闭工具面板");
      header.append(close); panel.append(header);
      if (activeTab === "settings") { renderSettings(); return; }
      if (activeTab === "prompts" && editingId !== null) { renderEditor(); return; }
      const filter = node("input"); filter.type = "text"; filter.placeholder = activeTab === "prompts" ? "搜索提示词" : "搜索收藏消息";
      filter.setAttribute("aria-label", filter.placeholder); filter.value = search;
      const list = node("div");
      filter.addEventListener("input", () => { search = filter.value; renderList(list); });
      panel.append(filter);
      const row = node("div", "row");
      if (activeTab === "prompts") {
        row.append(button("＋ 新建提示词", "primary", () => { editingId = "new"; renderPanel(); }));
        panel.append(row, node("p", "hint", "使用提示词会追加到当前草稿，不会自动发送。"));
      } else {
        row.append(button("收藏当前消息", "primary", () => toggleFavorite(getActive())));
        panel.append(row, node("p", "hint", "右键圆点或聚焦后按 S 可收藏 / 取消。收藏保存在本机，可跨会话查找。临时会话可能无法重新打开。"));
      }
      panel.append(list); renderList(list);
    }

    function renderList(list) {
      list.replaceChildren();
      const items = (activeTab === "prompts" ? data.prompts : data.favorites)
        .filter(item => `${item.title}\n${item.text}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
      if (!items.length) { list.append(node("div", "empty", search ? "没有匹配的内容。" : activeTab === "prompts" ? "把常用指令存下来，下次一键插入。" : "还没有收藏。在右侧圆点上点击鼠标右键，即可保存重要消息。")); return; }
      for (const item of items) {
        const card = node("div", "card");
        card.append(node("div", "card-title", item.title || "ChatGPT 对话"), node("div", "snippet", item.text));
        const row = node("div", "row");
        if (activeTab === "prompts") {
          row.append(button("使用", "primary", () => usePrompt(item)), button("编辑", "secondary", () => { editingId = item.id; renderPanel(); }));
        } else row.append(button("定位", "primary", () => visitFavorite(item)));
        row.append(button("复制", "secondary", () => copy(item.text)));
        const tab = activeTab;
        row.append(button("删除", "danger", async () => {
          if (tab === "prompts") data.prompts = data.prompts.filter(p => p.id !== item.id);
          else data.favorites = data.favorites.filter(p => p.id !== item.id);
          refresh(); renderPanel(); await save();
        }));
        card.append(row); list.append(card);
      }
    }

    function renderEditor() {
      const existing = data.prompts.find(item => item.id === editingId);
      const titleLabel = node("label", "", "名称"); titleLabel.htmlFor = "timeline-prompt-title";
      const title = node("input"); title.type = "text"; title.id = titleLabel.htmlFor; title.maxLength = 100; title.value = existing?.title || "";
      const textLabel = node("label", "", "提示词内容"); textLabel.htmlFor = "timeline-prompt-text";
      const text = node("textarea"); text.id = textLabel.htmlFor; text.value = existing?.text || "";
      const row = node("div", "row");
      row.append(button("保存提示词", "primary", async () => {
        if (!title.value.trim() || !text.value.trim()) { notify("请填写名称和提示词内容"); return; }
        const prompt = { id: existing?.id || crypto.randomUUID(), title: title.value.trim(), text: text.value };
        if (existing) data.prompts = data.prompts.map(item => item.id === existing.id ? prompt : item);
        else data.prompts.unshift(prompt);
        if (await save()) { editingId = null; renderPanel(); notify("提示词已保存"); }
      }), button("取消", "secondary", () => { editingId = null; renderPanel(); }));
      panel.append(titleLabel, title, textLabel, text, row);
      title.focus();
    }

    function renderSettings() {
      panel.append(node("p", "hint", `当前页面扩展版本：${host.dataset.version || '未知'}`));
      for (const [key, label, hint] of [
        ["enterNewline", "Enter 换行", "开启后 Enter / Shift+Enter 换行，Ctrl+Enter（Mac 为 ⌘+Enter）发送。中文输入法选词不受影响。"],
        ["formulaCopy", "LaTeX 公式复制", "悬停公式后点击“复制 LaTeX”。支持含 TeX 源码的 KaTeX、MathJax 和 MathML；图片公式无法提取源码。"]
      ]) {
        const wrapper = node("label", "check-label");
        const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.checked = data.settings[key];
        checkbox.addEventListener("change", async () => {
          data.settings[key] = checkbox.checked;
          if (!checkbox.checked && key === "formulaCopy") hideFormula();
          await save();
        });
        wrapper.append(checkbox, node("span", "", label));
        panel.append(wrapper, node("p", "hint", hint));
      }
      panel.append(node("p", "hint", "提示词、收藏和设置仅保存在此浏览器的扩展本地存储中，不会上传。卸载扩展会删除这些数据。"));
    }

    function texSource(target) {
      const root = target.closest?.('.katex, mjx-container, math, [data-latex], [data-tex], .MathJax, .MathJax_Display');
      if (!root) return null;
      const annotation = root.querySelector('annotation[encoding="application/x-tex"]');
      const math = root.matches("math") ? root : root.querySelector("math");
      const script = root.nextElementSibling;
      const tex = annotation?.textContent || root.getAttribute("data-latex") || root.getAttribute("data-tex")
        || math?.getAttribute("alttext") || (script?.matches('script[type^="math/tex"]') ? script.textContent : "");
      return tex?.trim() ? { root, tex: tex.trim() } : null;
    }

    function hideFormula() { formula = null; formulaButton.hidden = true; clearTimeout(formulaTimer); }

    document.addEventListener("pointerover", event => {
      if (!loaded || !data.settings.formulaCopy || event.composedPath().includes(host)) return;
      const found = texSource(event.target);
      if (!found) { clearTimeout(formulaTimer); formulaTimer = setTimeout(hideFormula, 400); return; }
      clearTimeout(formulaTimer); formula = found;
      const rect = found.root.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      formulaButton.hidden = false;
      formulaButton.style.left = `${Math.max(8, Math.min(rect.right - formulaButton.offsetWidth, innerWidth - formulaButton.offsetWidth - 8)) - hostRect.left}px`;
      formulaButton.style.top = `${Math.max(8, Math.min(rect.top - formulaButton.offsetHeight - 5, innerHeight - formulaButton.offsetHeight - 8)) - hostRect.top}px`;
    }, { passive: true });
    formulaButton.addEventListener("pointerenter", () => clearTimeout(formulaTimer));
    formulaButton.addEventListener("pointerleave", () => { formulaTimer = setTimeout(hideFormula, 400); });
    formulaButton.addEventListener("click", () => { if (formula) copy(formula.tex); });
    document.addEventListener("scroll", hideFormula, { capture: true, passive: true });
    window.addEventListener("resize", hideFormula, { passive: true });
    document.addEventListener("keydown", event => { if (event.key === "Escape") hideFormula(); });

    function applyData(stored) {
      if (!stored || typeof stored !== "object") return;
      data.prompts = Array.isArray(stored.prompts) ? stored.prompts.filter(item => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.text === "string") : [];
      data.favorites = Array.isArray(stored.favorites) ? stored.favorites.filter(item => item && typeof item.id === "string" && typeof item.text === "string" && typeof item.url === "string") : [];
      for (const key of ["enterNewline", "formulaCopy"]) if (typeof stored.settings?.[key] === "boolean") data.settings[key] = stored.settings[key];
    }
    (async () => {
      try {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        applyData(stored[STORAGE_KEY]);
        loaded = true; refresh();
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== "local" || !changes[STORAGE_KEY]) return;
          applyData(changes[STORAGE_KEY].newValue); refresh();
          // Don't destroy an unsaved prompt draft when another tab updates its settings.
          if (!panel.hidden && editingId === null && !panel.contains(shadow.activeElement)) renderPanel();
        });
      } catch { notify("本地存储未就绪，请在 Edge 中加载此扩展后刷新 ChatGPT"); }
    })();

    return { refresh, toggleFavorite };
  };
})();
