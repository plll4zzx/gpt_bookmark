const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');

let browser;
let profile;
const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
const desktopFixture = fs.readFileSync(path.join(__dirname, 'desktop-bubbles.html'), 'utf8');
const outlineFixture = fs.readFileSync(path.join(__dirname, 'outline.html'), 'utf8');
const streamingFixture = outlineFixture.replace('</html>', `<style>
form{position:fixed;bottom:12px;left:40%;display:flex;gap:8px;background:white;padding:10px;z-index:5}
textarea{width:350px;height:50px}form button{padding:12px}
</style><form><textarea id="prompt-textarea"></textarea><button data-testid="send-button" type="submit">发送消息</button></form>
<script>
let streamTimer;
window.stopStream = () => { clearInterval(streamTimer); document.querySelector('#answer-empty').removeAttribute('data-is-streaming'); };
window.startStream = (follow = true) => {
  stopStream(); document.body.dataset.ticks = '0';
  document.querySelector('#answer-empty').setAttribute('data-is-streaming','true');
  streamTimer = setInterval(() => {
    const p = document.querySelector('#answer-empty p');
    p.textContent += '继续生成一段回答，测试阅读位置和自动滚动之间的冲突。';
    document.body.dataset.ticks = String(Number(document.body.dataset.ticks) + 1);
    if (follow) document.querySelector('main').scrollTo({top:999999,behavior:'instant'});
  }, 20);
};
document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault(); document.body.dataset.sent = String(Number(document.body.dataset.sent || 0) + 1);
  const message = document.createElement('div'); message.setAttribute('data-user-message-bubble',''); message.textContent = '新发送的提问';
  document.querySelector('[data-conversation-transcript]').append(message);
  document.querySelector('main').scrollTo({top:999999,behavior:'instant'}); startStream();
});
document.querySelector('textarea').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.querySelector('form').requestSubmit(); }
});
</script></html>`);
const script = path.join(__dirname, '..', 'content.js');
const host = '#chatgpt-message-bookmarks';
before(async () => {
  fs.mkdirSync(path.join(__dirname, '..', 'test-results'), { recursive: true });
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-bookmark-edge-test-'));
  const extension = path.resolve(__dirname, '..');
  browser = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: true, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
});
after(async () => {
  await browser?.close();
  if (profile && path.dirname(fs.realpathSync(profile)) === fs.realpathSync(os.tmpdir())
    && path.basename(profile).startsWith('gpt-bookmark-edge-test-')) fs.rmSync(profile, {recursive:true});
});

async function setup(t, html = fixture) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://chatgpt.com/c/local-fixture');
  await page.locator(host).waitFor();
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  return page;
}

async function countIs(page, count) {
  await page.waitForFunction(({ host, count }) => document.querySelector(host).shadowRoot.querySelectorAll('.dot').length === count, { host, count });
}

test('native bookmark jumps work during text updates without installing a continuing scroll lock', async t => {
  const page = await setup(t, streamingFixture);
  await page.setViewportSize({ width:1920, height:1000 });
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.evaluate(() => startStream(false));
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 5);
  await page.locator(`${host} .dot`).first().click();
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 30);
  const userTop = await page.locator('[data-message-role="user"]').first().evaluate(el => el.getBoundingClientRect().top);
  assert.ok(userTop >= 64 && userTop <= 161, `auto-follow displaced user to ${userTop}`);
  await page.locator(`${host} .outline-item`).nth(2).click();
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 60);
  const headingTop = await page.locator('#section-two').evaluate(el => el.getBoundingClientRect().top);
  assert.ok(Math.abs(headingTop - 160) < 3, `auto-follow displaced heading to ${headingTop}`);
  await page.locator('main').evaluate(el => { el.scrollTop = 300; });
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 75);
  assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - 300) < 3);
  await page.evaluate(() => stopStream());
  const before = await page.locator('main').evaluate(el => el.scrollTop);
  await page.mouse.move(1200, 450); await page.mouse.wheel(0, 300);
  await page.waitForFunction(before => document.querySelector('main').scrollTop > before + 100, before);
  await page.evaluate(() => history.pushState({}, '', '/c/new-stream-chat'));
  await page.locator('main').evaluate(el => el.scrollTo({top:0,behavior:'instant'}));
  await page.waitForFunction(() => document.querySelector('main').scrollTop === 0);
});

test('sending away from the bottom preserves reading position; sending at the bottom keeps normal following', async t => {
  const page = await setup(t, streamingFixture);
  await page.setViewportSize({ width:1920, height:1000 });
  const editor = page.locator('textarea');
  await editor.fill('从阅读位置发送');
  await page.locator('main').evaluate(el => { el.scrollTop = 350; });
  await page.getByRole('button', { name:'发送消息', exact:true }).click();
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 30);
  assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - 350) < 3);
  assert.equal(await page.locator('body').getAttribute('data-sent'), '1');
  await page.evaluate(() => stopStream());
  // A prior send-position guard must not override a subsequent bookmark click.
  await page.locator(`${host} .dot`).first().click();
  assert.equal(await page.locator('main').evaluate(el => el.scrollTop), 0);
  await page.locator(`${host} .outline-item`).nth(2).click();
  assert.ok(Math.abs((await page.locator('#section-two').boundingBox()).y - 160) < 3);
  await page.mouse.move(1200, 450); await page.mouse.wheel(0, 1);
  await page.locator('main').evaluate(el => el.scrollTo({top:999999,behavior:'instant'}));
  await editor.fill('在底部发送');
  await page.getByRole('button', { name:'发送消息', exact:true }).click();
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 25);
  assert.ok(await page.locator('main').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop < 3));
  await page.evaluate(() => stopStream());
});

test('sending restores the position from before composer focus auto-scrolled the conversation', async t => {
  const page = await setup(t, streamingFixture);
  await page.setViewportSize({width:1920,height:1000});
  await page.locator('main').evaluate(el => { el.scrollTop = 350; });
  await page.evaluate(() => document.querySelector('textarea').addEventListener('focus', () => {
    document.querySelector('main').scrollTo({top:999999,behavior:'instant'});
  }));
  await page.locator('textarea').fill('焦点变化之前的阅读位置');
  assert.ok(await page.locator('main').evaluate(el => el.scrollTop > 1000));
  await page.getByRole('button', {name:'发送消息',exact:true}).click();
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 25);
  assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - 350) < 3);
  await page.evaluate(() => stopStream());
});

test('send protection survives replacement of the conversation scroll container', async t => {
  const page = await setup(t, streamingFixture);
  await page.setViewportSize({width:1920,height:1000});
  await page.locator('textarea').fill('替换滚动容器');
  await page.locator('main').evaluate(el => { el.scrollTop = 450; });
  await page.evaluate(() => document.querySelector('form').addEventListener('submit', () => {
    const old = document.querySelector('main'); old.replaceWith(old.cloneNode(true));
    document.querySelector('main').scrollTo({top:999999,behavior:'instant'});
  }));
  await page.getByRole('button', {name:'发送消息',exact:true}).click();
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 25);
  assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - 450) < 3);
  await page.evaluate(() => stopStream());
  await page.locator(`${host} .dot`).first().click();
  assert.ok(await page.locator('main').evaluate(el => el.scrollTop < 5));
});

test('new user-turn detection covers composer buttons without known attributes or form submission', async t => {
  const page = await setup(t, streamingFixture);
  await page.setViewportSize({width:1920,height:1000});
  await page.locator('main').evaluate(el => { el.scrollTop = 500; });
  await page.locator('textarea').fill('这条消息使用新版按钮');
  await page.evaluate(() => {
    const button = document.querySelector('form button'); button.removeAttribute('data-testid'); button.type = 'button';
    button.addEventListener('click', () => {
      const el = document.createElement('div'); el.setAttribute('data-user-message-bubble','');
      el.textContent = document.querySelector('textarea').value;
      document.querySelector('[data-conversation-transcript]').append(el);
      document.querySelector('textarea').value = '';
      document.querySelector('main').scrollTo({top:999999,behavior:'instant'}); startStream();
    });
  });
  await page.getByRole('button', {name:'发送消息',exact:true}).click();
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 25);
  assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - 500) < 3);
  await page.evaluate(() => stopStream());
});

test('Ctrl+Enter and native Enter submission preserve reading, while newline and IME do not submit', async t => {
  const page = await setup(t, streamingFixture);
  await page.setViewportSize({ width:1920, height:1000 });
  const editor = page.locator('textarea');
  await editor.fill('键盘发送');
  await page.locator('main').evaluate(el => { el.scrollTop = 400; });
  await editor.press('Enter');
  assert.equal(await page.locator('body').getAttribute('data-sent'), null);
  await editor.dispatchEvent('keydown', {key:'Enter',isComposing:true});
  assert.equal(await page.locator('body').getAttribute('data-sent'), null);
  await editor.press('Control+Enter');
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 25);
  assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - 400) < 3);
  await page.evaluate(() => stopStream());
  await page.getByRole('button', {name:'功能设置',exact:true}).click();
  // Use the visible settings label from the extension rather than touching its storage.
  const checkbox = page.locator(`${host} .panel input[type="checkbox"]`).first();
  await checkbox.uncheck();
  await page.getByRole('button', {name:'关闭工具面板'}).click();
  try {
    await page.mouse.move(1200, 450); await page.mouse.wheel(0, 1);
    await page.locator('main').evaluate(el => { el.scrollTop = 450; });
    await editor.press('Enter');
    await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 25 && document.body.dataset.sent === '2');
    assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - 450) < 3);
  } finally {
    await page.evaluate(() => stopStream());
    await page.getByRole('button', {name:'功能设置',exact:true}).click(); await checkbox.check();
  }
});

test('plain streamed text does not rebuild message buttons or the unchanged answer outline', async t => {
  const page = await setup(t, streamingFixture);
  await page.setViewportSize({width:1920,height:1000});
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.bookmarkWrites = 0;
    const root = document.querySelector('#chatgpt-message-bookmarks').shadowRoot;
    new MutationObserver(records => { window.bookmarkWrites += records.filter(record =>
      record.target.matches?.('.dot,.outline-item span') || record.target.parentElement?.matches('.outline-item span')).length;
    }).observe(root, {subtree:true,attributes:true,childList:true,characterData:true});
    startStream(false);
  });
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 40);
  assert.equal(await page.evaluate(() => window.bookmarkWrites), 0);
  await page.evaluate(() => stopStream());
});

test('bookmark navigation does not chase a heading node recycled to the bottom of the conversation', async t => {
  const page = await setup(t, outlineFixture);
  await page.setViewportSize({width:1920,height:1000});
  await page.locator(`${host} .outline-item`).nth(1).click();
  const destination = await page.locator('main').evaluate(el => el.scrollTop);
  await page.evaluate(() => {
    const old = document.querySelector('#section-child');
    const replacement = old.cloneNode(true);
    old.replaceWith(replacement);
    old.removeAttribute('id'); old.textContent = '网页复用的底部标题';
    document.querySelector('#answer-empty').append(old);
  });
  await page.waitForTimeout(400);
  assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - destination) < 3);
  assert.ok(Math.abs((await page.locator('#section-child').boundingBox()).y - 160) < 3);
  await page.locator(`${host} .dot`).nth(1).click();
  const message = await page.locator('[data-user-message-bubble]').nth(1).boundingBox();
  assert.ok(Math.abs(message.y - 160) < 3);
});

test('native navigation does not chase recycled nodes even when streaming markers remain', async t => {
  const page = await setup(t, streamingFixture);
  await page.setViewportSize({width:1920,height:1000});
  await page.evaluate(() => startStream(false));
  await page.locator(`${host} .dot`).first().click();
  await page.locator(`${host} .outline-item`).nth(1).click();
  const destination = await page.locator('main').evaluate(el => el.scrollTop);
  await page.evaluate(() => {
    const old = document.querySelector('#section-child');
    old.replaceWith(old.cloneNode(true)); old.removeAttribute('id'); old.textContent = '复用后不属于原章节的节点';
    document.querySelector('#answer-empty').append(old);
  });
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 25);
  assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - destination) < 3);
  await page.locator(`${host} .dot`).nth(1).click();
  const secondDestination = await page.locator('main').evaluate(el => el.scrollTop);
  await page.evaluate(() => {
    const old = document.querySelectorAll('[data-user-message-bubble]')[1];
    old.replaceWith(old.cloneNode(true)); old.removeAttribute('data-user-message-bubble'); old.textContent = '已复用的原提问节点';
    document.querySelector('#answer-empty').append(old);
  });
  await page.waitForFunction(() => Number(document.body.dataset.ticks) >= 50);
  assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - secondDestination) < 3);
  await page.evaluate(() => stopStream());
  await page.locator('main').evaluate(el => { el.scrollTop = 300; });
  await page.waitForTimeout(150);
  assert.ok(Math.abs(await page.locator('main').evaluate(el => el.scrollTop) - 300) < 3);
});

test('answer outline lists nested headings, navigates in the conversation and follows the active answer', async t => {
  const page = await setup(t, outlineFixture);
  await page.setViewportSize({ width: 1920, height: 1000 });
  const nav = page.locator(`${host} .answer-outline`);
  const headings = nav.locator('.outline-item');
  await nav.locator('.outline-list').waitFor({ state: 'visible' });
  assert.deepEqual(await headings.allTextContents(), ['一、遗传算法如何优化 prompt', '1.1 候选提示词的生成与选择', '二、如何评估优化结果']);
  assert.equal(await headings.nth(1).evaluate(el => el.style.getPropertyValue('--depth')), '1');
  const rect = await nav.boundingBox();
  const sidebar = await page.locator('aside').boundingBox();
  const content = await page.locator('#section-one').boundingBox();
  assert.ok(rect.x >= sidebar.x + sidebar.width + 8 && rect.x + rect.width < content.x);
  await headings.nth(1).click();
  await page.waitForFunction(() => document.querySelector('#section-child').getBoundingClientRect().top < 180);
  assert.equal(await headings.nth(1).getAttribute('aria-current'), 'location');
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await headings.nth(1).press('ArrowDown');
  assert.equal(await headings.nth(2).evaluate(el => el === el.getRootNode().activeElement), true);
  await headings.nth(2).evaluate(el => el.blur());
  await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'answer-outline.png') });
  await page.mouse.move(1200, 400); await page.mouse.wheel(0, 1);
  await page.locator('#section-other').evaluate(el => el.scrollIntoView());
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.outline-item')?.textContent === '新任务的评估方案');
  assert.deepEqual(await headings.allTextContents(), ['新任务的评估方案', '错误分析与复现']);
  await page.locator('#answer-empty').evaluate(el => el.scrollIntoView());
  await nav.locator('.outline-empty').waitFor({ state: 'visible' });
  assert.equal(await headings.count(), 0);
});

test('native navigation reveals targets inside multiple nested scrolling viewports', async t => {
  const page = await setup(t, `<style>
    body{margin:0}main{height:100vh;overflow:auto;padding:30px 200px;box-sizing:border-box}
    #inner{height:320px;overflow:auto;border:1px solid gray}.space{height:1300px}
    [data-user-message-bubble]{height:60px}h2{margin:0;height:60px}
    </style><main><div data-user-message-bubble>首条提问</div>
    <div data-message-role="assistant"><h2>首条回答</h2><div class="space"></div>
    <div id="inner"><div class="space"></div><div id="nested-user" data-user-message-bubble>嵌套滚动区内的提问</div>
    <h2 id="nested-heading">嵌套滚动区内的章节</h2><div class="space"></div></div>
    <div class="space"></div></div></main>`);
  // Reproduce the old algorithm: moving only the nearest scroll container
  // leaves that entire container below the outer viewport.
  await page.evaluate(() => {
    const inner = document.querySelector('#inner'), target = document.querySelector('#nested-user');
    const rect = inner.getBoundingClientRect();
    const top = Math.max(0, rect.top + inner.clientTop), bottom = Math.min(innerHeight, rect.bottom);
    inner.scrollTo({top: inner.scrollTop + target.getBoundingClientRect().top - top - Math.min(96, (bottom - top) * .2), behavior:'instant'});
  });
  assert.equal(await page.locator('main').evaluate(el => el.scrollTop), 0);
  assert.ok((await page.locator('#nested-user').boundingBox()).y > 800);
  await page.locator(`${host} .dot`).nth(1).click();
  const user = await page.locator('#nested-user').boundingBox();
  assert.ok(user.y >= 0 && user.y + user.height <= 800, `nested user not visible: ${user.y}`);
  assert.ok(await page.locator('main').evaluate(el => el.scrollTop > 800));
  assert.ok(await page.locator('#inner').evaluate(el => el.scrollTop > 800));
  await page.locator(`${host} .outline-item`).nth(0).click();
  await page.locator(`${host} .outline-item`).nth(1).click();
  const heading = await page.locator('#nested-heading').boundingBox();
  assert.ok(heading.y >= 0 && heading.y + heading.height <= 800, `nested heading not visible: ${heading.y}`);
});

test('outline automatically collapses when space shrinks and restores when widened', async t => {
  const page = await setup(t, outlineFixture);
  const nav = page.locator(`${host} .answer-outline`);
  const toggle = nav.locator('.outline-toggle');
  await page.setViewportSize({ width: 1920, height: 1000 });
  await nav.locator('.outline-list').waitFor({ state: 'visible' });
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.answer-outline').hasAttribute('data-collapsed'));
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.ok((await nav.boundingBox()).width <= 50);
  await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'answer-outline-collapsed.png') });
  await toggle.click();
  await nav.locator('.outline-item').first().waitFor({ state: 'visible' });
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.waitForFunction(() => !document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.answer-outline').hasAttribute('data-compact'));
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  await page.setViewportSize({ width: 390, height: 640 });
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.answer-outline').hasAttribute('data-collapsed'));
  await toggle.click();
  const small = await nav.boundingBox();
  assert.ok(small.x >= 0 && small.x + small.width <= 390 && small.y + small.height <= 640);
  await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'answer-outline-narrow.png') });
  await toggle.click();
  await page.setViewportSize({ width: 1920, height: 1000 });
  await nav.locator('.outline-list').waitFor({ state: 'visible' });
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
});

test('outline aligns numbered peer sections despite mixed HTML heading levels, including streamed siblings', async t => {
  const html = outlineFixture.replace(/<div data-message-role="assistant" id="answer-one">[\s\S]*?<\/div><\/div>/,
    '<div data-message-role="assistant" id="answer-one"><div class="markdown">' +
    '<section><h3 id="peer-one">1. 论文真正攻击的不是 memory</h3><p>第一节正文。</p></section>' +
    '<section><h3>2. PoS 可以理解成 agent memory 上面的 belief 层</h3></section>' +
    '<section><h2 id="peer-three">3. 所以我会把整个 Agent Memory 架构画成这样</h2></section>' +
    '<section><h1>4. 它其实提示了 Agent Memory 里的一个重要问题</h1></section></div></div>');
  const page = await setup(t, html);
  await page.setViewportSize({ width: 1920, height: 1000 });
  const items = page.locator(`${host} .outline-item`);
  await items.first().waitFor({ state: 'visible' });
  const leftEdges = await items.locator('span').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().left));
  assert.equal(leftEdges.length, 4);
  assert.ok(leftEdges.every(left => Math.abs(left - leftEdges[0]) < 1));
  await items.nth(2).click();
  assert.ok((await page.locator('#peer-three').boundingBox()).y < 180);
  assert.equal(await items.nth(2).getAttribute('aria-current'), 'location');
  await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'outline-peer-headings.png') });
  await page.mouse.move(1200, 400); await page.mouse.wheel(0, 1);
  await page.evaluate(() => {
    const body = document.querySelector('#answer-one .markdown');
    body.innerHTML = '<section><h4>1. 第一节</h4></section><section><h4>2. 第二节</h4></section>';
    document.querySelector('main').scrollTop = 0;
  });
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelectorAll('.outline-item').length === 2);
  await page.evaluate(() => document.querySelector('#answer-one .markdown').insertAdjacentHTML('beforeend', '<section><h2>3. 流式新增章节</h2></section>'));
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelectorAll('.outline-item').length === 3);
  assert.deepEqual(await items.evaluateAll(elements => elements.map(el => el.style.getPropertyValue('--depth'))), ['0', '0', '0']);
});

test('outline preserves numbered children, section scopes and unnumbered heading hierarchy', async t => {
  const html = `<style>main{padding:100px 350px}section{min-height:200px}</style><main>
    <div data-user-message-bubble>验证目录层级</div><div data-message-role="assistant" class="markdown">
    <h1>第一组</h1><h4>1. 同级章节</h4><h4>1.1 子章节</h4><h4>1.1.1 孙章节</h4><h2>2. 同级章节</h2>
    <h1>第二组</h1><h3>1. 另一组的章节</h3><h4>子标题</h4><h3>2. 另一组的章节</h3>
    <h1>无编号部分</h1><h2>普通章节</h2><h3>普通子章节</h3><div style="height:1200px"></div></div></main>`;
  const page = await setup(t, html);
  const items = page.locator(`${host} .outline-item`);
  await items.first().waitFor({ state: 'visible' });
  assert.deepEqual(await items.evaluateAll(elements => elements.map(el => Number(el.style.getPropertyValue('--depth')))),
    [0, 1, 2, 3, 1, 0, 2, 3, 2, 0, 1, 2]);
});

test('outline updates streaming headings and clears the old answer during delayed route replacement', async t => {
  const page = await setup(t, outlineFixture);
  await page.setViewportSize({ width: 1920, height: 1000 });
  const nav = page.locator(`${host} .answer-outline`);
  await nav.locator('.outline-item').first().waitFor({ state: 'visible' });
  await nav.locator('.outline-item').first().evaluate(el => el.dataset.retained = 'yes');
  await page.evaluate(() => {
    document.querySelector('#section-one').textContent = '流式更新后的标题';
    const section = document.createElement('section');
    section.innerHTML = '<h2>新增章节</h2><p>继续生成回答。</p>';
    document.querySelector('#answer-one .markdown').append(section);
  });
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelectorAll('.outline-item').length === 4);
  assert.equal(await nav.locator('.outline-item').first().getAttribute('data-retained'), 'yes');
  assert.equal(await nav.locator('.outline-item').first().innerText(), '流式更新后的标题');
  await page.evaluate(() => history.pushState({}, '', '/c/next-outline'));
  await nav.waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    document.querySelector('[data-conversation-transcript]').innerHTML = '<div data-user-message-bubble>新的提问</div><div class="markdown"><h2>新的回答</h2><p>新会话内容</p></div>';
    document.querySelector('main').scrollTop = 0;
  });
  await nav.waitFor({ state: 'visible' });
  assert.deepEqual(await nav.locator('.outline-item').allTextContents(), ['新的回答']);
});

test('desktop bubble markers from the reported layout produce previews and scroll targets', async t => {
  const page = await setup(t, desktopFixture);
  assert.equal(await page.locator(`${host} .dot`).count(), 2);
  await page.locator(`${host} .dot`).first().hover();
  assert.equal(await page.locator(`${host} .tooltip-text`).innerText(), '第一条测试提问：请解释消息导航。');
  await page.locator(`${host} .dot`).nth(1).click();
  await page.waitForFunction(() => document.querySelector('main').scrollTop > 300);
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelectorAll('.dot')[1].getAttribute('aria-current') === 'true');
  await page.locator(`${host} .dot`).first().click({ button: 'right' });
  await page.getByRole('button', { name: '收藏消息', exact: true }).click();
  await page.locator(`${host} .card`).waitFor();
  await page.reload();
  await page.waitForSelector(`${host} .dot[data-saved]`);
  await page.getByRole('button', { name: '收藏消息', exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
});

test('bubble markers are deduplicated with roles and survive hidden or boxless wrappers', async t => {
  const page = await setup(t, `<style>.contents{display:contents}</style>
    <div hidden data-conversation-transcript><div data-message-role="user">隐藏的副本</div></div>
    <main>
      <div data-message-author-role="user"><div data-user-message-bubble="true">同一条消息双重标记</div></div>
      <div class="contents" data-message-role="user"><div data-user-message-bubble="true">无布局框的外层</div></div>
      <div hidden><div data-user-message-bubble="true">隐藏气泡</div></div>
      <div aria-hidden="true"><div data-user-message-bubble="true">隐藏分支</div></div>
      <div id="late-bubble">延迟设置属性的消息</div>
    </main>`);
  await countIs(page, 2);
  await page.evaluate(() => document.querySelector('#late-bubble').setAttribute('data-user-message-bubble', 'true'));
  await countIs(page, 3);
  await page.evaluate(() => document.querySelector('#late-bubble').removeAttribute('data-user-message-bubble'));
  await countIs(page, 2);
});

test('current transcript: user-only dots, safe preview, nested scroll and active position', async t => {
  const page = await setup(t);
  await countIs(page, 4);
  await page.locator(`${host} .dot`).nth(1).hover();
  assert.equal(await page.locator(`${host} .tooltip-text`).innerText(), '如果 ChatGPT 更新了页面结构，怎么让它继续正常工作？');
  assert.ok(!await page.locator(`${host} .tooltip-text`).innerText().then(s => s.includes('复制消息')));
  await page.locator(`${host} .dot`).nth(2).click();
  await page.waitForFunction(() => {
    const main = document.querySelector('main');
    const rect = document.querySelector('#turn-3').getBoundingClientRect();
    return main.scrollTop > 200 && rect.top >= 64 && rect.top < 190;
  });
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelectorAll('.dot')[2].getAttribute('aria-current') === 'true');
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.mouse.move(600, 100);
  await page.locator(`${host} .dot`).nth(2).hover();
  await fs.promises.mkdir(path.join(__dirname, '..', 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'timeline-light.png') });
});

test('legacy DOM, duplicate nested role attributes, attachments and document scrolling', async t => {
  const page = await setup(t, `<style>article{margin:80px 0;min-height:400px}</style><main>
    <article><div data-message-author-role="user"><div class="whitespace-pre-wrap">旧版第一条</div></div></article>
    <article data-message-role="user"><div data-message-author-role="user"><div class="whitespace-pre-wrap">双重标记</div></div></article>
    <article data-message-author-role="assistant">回答</article>
    <article data-message-author-role="user"><img alt="上传的设计图"></article>
    <article hidden data-message-author-role="user">隐藏消息</article><div style="height:900px"></div></main>`);
  await countIs(page, 3);
  await page.locator(`${host} .dot`).nth(2).hover();
  assert.match(await page.locator(`${host} .tooltip-text`).innerText(), /上传的设计图/);
  await page.locator(`${host} .dot`).nth(1).click();
  await page.waitForFunction(() => window.scrollY > 200);
});

test('new messages, text edits, streaming updates and route replacement', async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    const li = document.createElement('li');
    li.dataset.messageRole = 'user';
    li.textContent = '新消息';
    document.querySelector('ol').append(li);
    document.querySelector('[data-user-message-copy]').textContent = '修改后的消息';
  });
  await countIs(page, 5);
  await page.locator(`${host} .dot`).first().hover();
  assert.equal(await page.locator(`${host} .tooltip-text`).innerText(), '修改后的消息');
  await page.evaluate(() => {
    const answer = document.querySelector('[data-message-role="assistant"]');
    let count = 0;
    const timer = setInterval(() => { answer.textContent += ' 流式'; if (++count === 20) clearInterval(timer); }, 20);
    const li = document.createElement('li'); li.dataset.messageRole = 'user'; li.textContent = '流式期间的消息';
    document.querySelector('ol').append(li);
  });
  await countIs(page, 6);
  await page.evaluate(() => {
    history.pushState({}, '', '/c/another-chat');
    document.querySelector('ol').innerHTML = '<li data-message-role="user">新会话唯一消息</li>';
  });
  await countIs(page, 1);
  assert.match(await page.locator(`${host} .dot`).getAttribute('aria-label'), /新会话唯一消息/);
  await page.evaluate(() => { history.pushState({}, '', '/c/empty-chat'); document.querySelector('ol').replaceChildren(); });
  await countIs(page, 0);
  assert.equal(await page.locator(`${host} .count`).innerText(), '0/0');
});

test('theme, collapse, keyboard preview and literal HTML handling', async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    document.documentElement.className = 'dark';
    document.querySelector('[data-user-message-copy]').textContent = '<img src=x onerror="window.hacked=true">';
  });
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').hasAttribute('data-dark'));
  await page.locator(`${host} .dot`).first().focus();
  assert.equal(await page.locator(`${host} .tooltip-text img`).count(), 0);
  assert.match(await page.locator(`${host} .tooltip-text`).innerText(), /<img/);
  assert.equal(await page.evaluate(() => window.hacked), undefined);
  await page.locator(`${host} .dot`).first().press('ArrowDown');
  assert.match(await page.locator(`${host} .tooltip-heading`).innerText(), /2 \/ 4/);
  await page.locator(`${host} .dot`).nth(1).press('Escape');
  assert.equal(await page.locator(`${host} .tooltip`).isVisible(), false);
  await page.locator(`${host} .toggle`).click();
  assert.equal(await page.locator(`${host} .dots`).isVisible(), false);
  await page.locator(`${host} .toggle`).click();
  assert.equal(await page.locator(`${host} .dots`).isVisible(), true);
  await page.locator(`${host} .dot`).nth(1).hover();
  await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'timeline-dark.png') });
});

test('long conversations and narrow screens keep all bookmarks reachable', async t => {
  const page = await setup(t);
  await page.setViewportSize({ width: 390, height: 640 });
  await page.evaluate(() => {
    history.pushState({}, '', '/c/long-conversation');
    const transcript = document.querySelector('ol');
    transcript.replaceChildren();
    for (let i = 0; i < 100; i++) {
      const li = document.createElement('li'); li.dataset.messageRole = 'user'; li.textContent = `消息 ${i + 1}`;
      li.style.minHeight = '100px'; transcript.append(li);
    }
  });
  await countIs(page, 100);
  await page.locator(`${host} .dot`).first().focus();
  await page.locator(`${host} .dot`).first().press('End');
  await page.locator(`${host} .dot`).last().press('Enter');
  await page.waitForFunction(() => document.querySelector('main').scrollTop > 9000);
  await page.locator(`${host} .dot`).last().hover();
  const rect = await page.locator(`${host} .tooltip`).boundingBox();
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 390 && rect.y + rect.height <= 640);
});

test('manifest has narrow scope; reinjection does not duplicate the rail', async t => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://chatgpt.com/*', 'https://chat.openai.com/*']);
  assert.deepEqual(manifest.permissions, ['storage', 'clipboardWrite']);
  const page = await setup(t);
  await page.addScriptTag({ path: script });
  assert.equal(await page.locator(host).count(), 1);
  await page.evaluate(() => document.querySelector('#chatgpt-message-bookmarks').remove());
  await page.waitForSelector(host);
  await countIs(page, 4);
});

test('prompt library: create, persist, append to draft without sending, edit, search and delete', async t => {
  const page = await setup(t);
  await page.getByRole('button', { name: '提示词库', exact: true }).click();
  await page.getByRole('button', { name: '＋ 新建提示词' }).click();
  await page.getByLabel('名称', { exact: true }).fill('测试代码审查');
  await page.getByLabel('提示词内容', { exact: true }).fill('检查下面代码中的边界情况。\n给出修改建议。');
  await page.getByRole('button', { name: '保存提示词', exact: true }).click();
  await page.locator(`${host} .card`).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '提示词库', exact: true }).click();
  assert.match(await page.locator(`${host} .card`).innerText(), /测试代码审查/);
  // Fill without clicking outside the panel so it remains open.
  await page.locator('#mobile-composer-prompt').fill('现有草稿');
  await page.getByRole('button', { name: '使用', exact: true }).click();
  assert.equal(await page.locator('#mobile-composer-prompt').inputValue(), '现有草稿\n\n检查下面代码中的边界情况。\n给出修改建议。');
  assert.equal(await page.locator('body').getAttribute('data-sent'), null);
  assert.equal(await page.locator('#mobile-composer-prompt').getAttribute('data-last-input'), await page.locator('#mobile-composer-prompt').inputValue());
  await page.getByRole('button', { name: '提示词库', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('已编辑的模板');
  await page.getByRole('button', { name: '保存提示词', exact: true }).click();
  await page.locator(`${host} .card-title`).filter({ hasText: '已编辑的模板' }).waitFor();
  await page.getByLabel('搜索提示词', { exact: true }).fill('不存在的词');
  assert.equal(await page.locator(`${host} .card`).count(), 0);
  await page.getByLabel('搜索提示词', { exact: true }).fill('');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  assert.equal(await page.locator(`${host} .card`).count(), 0);
});

test('favorites persist, mark the timeline, navigate and remove', async t => {
  const page = await setup(t);
  await page.locator(`${host} .dot`).nth(2).click({ button: 'right' });
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelectorAll('.dot')[2].hasAttribute('data-saved'));
  await page.getByRole('button', { name: '收藏消息', exact: true }).click();
  await page.locator(`${host} .card`).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '收藏消息', exact: true }).click();
  assert.match(await page.locator(`${host} .card`).innerText(), /长对话也能用吗/);
  await page.getByRole('button', { name: '定位', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('main').scrollTop > 200);
  await page.getByRole('button', { name: '收藏消息', exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  assert.equal(await page.locator(`${host} .dot[data-saved]`).count(), 0);
});

test('Enter newline, Ctrl+Enter send, composition safety, contenteditable and settings persistence', async t => {
  const page = await setup(t);
  // Opening settings ensures asynchronous extension storage has initialized.
  await page.getByRole('button', { name: '功能设置', exact: true }).click();
  await page.getByRole('button', { name: '关闭工具面板' }).click();
  const editor = page.locator('#mobile-composer-prompt');
  await editor.fill('第一行');
  await editor.press('End');
  await editor.press('Enter');
  await editor.pressSequentially('next');
  assert.equal(await editor.inputValue(), '第一行\nnext');
  assert.equal(await page.locator('body').getAttribute('data-sent'), null);
  await editor.press('Control+Enter');
  assert.equal(await page.locator('body').getAttribute('data-sent'), '1');
  const allowed = await editor.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
  assert.equal(allowed, true);
  await page.evaluate(() => {
    document.querySelector('textarea').remove();
    const div = document.createElement('div'); div.id = 'prompt-textarea'; div.contentEditable = 'true';
    div.textContent = 'editable'; document.querySelector('form').prepend(div);
  });
  await page.locator('#prompt-textarea').focus();
  await page.locator('#prompt-textarea').press('End');
  await page.locator('#prompt-textarea').press('Enter');
  await page.locator('#prompt-textarea').pressSequentially('next');
  assert.match(await page.locator('#prompt-textarea').innerText(), /editable\nnext/);
  await page.getByRole('button', { name: '功能设置', exact: true }).click();
  await page.getByLabel('Enter 换行', { exact: true }).uncheck();
  await page.reload();
  await page.getByRole('button', { name: '功能设置', exact: true }).click();
  assert.equal(await page.getByLabel('Enter 换行', { exact: true }).isChecked(), false);
  await page.getByRole('button', { name: '关闭工具面板' }).click();
  await page.locator('#mobile-composer-prompt').fill('默认发送');
  await page.locator('#mobile-composer-prompt').press('Enter');
  assert.equal(await page.locator('body').getAttribute('data-sent'), '1');
});

test('formula button copies actual TeX source and can be disabled', async t => {
  const page = await setup(t);
  await browser.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://chatgpt.com' });
  await page.getByRole('button', { name: '功能设置', exact: true }).click();
  await page.getByRole('button', { name: '关闭工具面板' }).click();
  await page.locator('.katex-html').hover();
  await page.getByRole('button', { name: '复制 LaTeX', exact: true }).click();
  await page.waitForFunction(async () => await navigator.clipboard.readText() === 'E = mc^2');
  await page.getByRole('button', { name: '功能设置', exact: true }).click();
  await page.getByLabel('LaTeX 公式复制', { exact: true }).uncheck();
  await page.getByRole('button', { name: '关闭工具面板' }).click();
  await page.locator('.katex-html').hover();
  assert.equal(await page.getByRole('button', { name: '复制 LaTeX', exact: true }).isVisible(), false);
});

test('current composer send control never clicks the stop-generating action', async t => {
  const page = await setup(t);
  await page.getByRole('button', { name: '功能设置', exact: true }).click();
  await page.getByLabel('Enter 换行', { exact: true }).check();
  await page.getByRole('button', { name: '关闭工具面板' }).click();
  await page.locator('[data-testid="send-button"]').evaluate(el => {
    el.removeAttribute('data-testid'); el.setAttribute('data-composer-submit', '');
    el.dataset.stopLabel = '停止生成'; el.setAttribute('aria-label', '停止生成');
  });
  await page.locator('#mobile-composer-prompt').fill('等待回复');
  await page.locator('#mobile-composer-prompt').press('Control+Enter');
  assert.equal(await page.locator('body').getAttribute('data-sent'), null);
  await page.locator('[data-composer-submit]').evaluate(el => el.setAttribute('aria-label', '发送消息'));
  await page.locator('#mobile-composer-prompt').press('Control+Enter');
  assert.equal(await page.locator('body').getAttribute('data-sent'), '1');
});

test('prepending history and rerendering messages preserve bookmark nodes and rail viewport', async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    history.pushState({}, '', '/c/prepend-history');
    const ol = document.querySelector('ol'); ol.replaceChildren();
    for (let i = 10; i < 70; i++) {
      const li = document.createElement('li'); li.id = `stable-${i}`; li.dataset.messageRole = 'user';
      li.textContent = `提问 ${i}`; li.style.minHeight = '100px'; ol.append(li);
    }
  });
  await countIs(page, 60);
  const before = await page.evaluate(() => {
    const root = document.querySelector('#chatgpt-message-bookmarks').shadowRoot;
    const dots = root.querySelector('.dots'); dots.scrollTop = 560;
    window.retainedButton = dots.children[22];
    return { top: window.retainedButton.getBoundingClientRect().top, railTop: root.querySelector('.rail').getBoundingClientRect().top };
  });
  await page.evaluate(() => {
    const ol = document.querySelector('ol');
    ol.replaceChildren(...Array.from(ol.children).map(li => li.cloneNode(true)));
    for (let i = 9; i >= 0; i--) {
      const li = document.createElement('li'); li.id = `stable-${i}`; li.dataset.messageRole = 'user';
      li.textContent = `更早提问 ${i}`; li.style.minHeight = '100px'; ol.prepend(li);
    }
  });
  await countIs(page, 70);
  const after = await page.evaluate(() => ({ connected: window.retainedButton.isConnected,
    top: window.retainedButton.getBoundingClientRect().top,
    railTop: document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.rail').getBoundingClientRect().top }));
  assert.equal(after.connected, true);
  assert.ok(Math.abs(after.top - before.top) < 1);
  assert.ok(Math.abs(after.railTop - before.railTop) < 1);
  const railScroll = await page.locator(`${host} .dots`).evaluate(el => el.scrollTop);
  await page.locator('main').evaluate(el => { el.scrollTop = 5000; });
  await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.count').textContent !== '1/70');
  assert.equal(await page.locator(`${host} .dots`).evaluate(el => el.scrollTop), railScroll);
});

test('temporarily unmounted and recycled messages keep previews and reset on conversation change', async t => {
  const page = await setup(t);
  await countIs(page, 4);
  await page.evaluate(() => { document.querySelector('#turn-1').remove(); document.querySelector('#turn-2').remove(); });
  await page.waitForSelector(`${host} .dot[data-unmounted]`);
  assert.equal(await page.locator(`${host} .dot`).count(), 4);
  await page.locator(`${host} .dot`).first().hover();
  assert.match(await page.locator(`${host} .tooltip-text`).innerText(), /我想做一个 ChatGPT 消息书签/);
  await page.evaluate(() => {
    const li = document.querySelector('#turn-3'); li.id = 'turn-5'; li.querySelector('[data-user-message-copy]').textContent = '复用节点显示另一条消息';
  });
  await countIs(page, 5);
  await page.evaluate(() => {
    history.pushState({}, '', '/c/other-conversation');
    document.querySelector('ol').innerHTML = '<li id="other-1" data-message-role="user">另一段对话</li>';
  });
  await countIs(page, 1);
  assert.match(await page.locator(`${host} .dot`).getAttribute('aria-label'), /另一段对话/);
});

async function prepareLazyHistory(page) {
  await page.evaluate(() => {
    const ol = document.querySelector('ol'); ol.replaceChildren();
    const make = i => {
      const li = document.createElement('li'); li.id = `lazy-${i}`; li.dataset.messageRole = 'user';
      li.textContent = `历史提问 ${i}`; li.style.minHeight = '180px'; return li;
    };
    for (let i = 10; i < 20; i++) ol.append(make(i));
    const main = document.querySelector('main'); main.scrollTop = main.scrollHeight;
    let first = 10, busy = false;
    main.addEventListener('scroll', () => {
      if (main.scrollTop > 10 || !first || busy) return;
      busy = true;
      setTimeout(() => {
        const height = main.scrollHeight;
        for (let n = 0; n < 5; n++) ol.prepend(make(--first));
        main.scrollTop += main.scrollHeight - height;
        busy = false;
      }, 600);
    });
  });
}

test('history loader discovers earlier batches and restores the reading anchor', async t => {
  const page = await setup(t);
  // Use a new conversation so the fixture messages are not part of the session cache.
  await page.evaluate(() => history.pushState({}, '', '/c/lazy-history'));
  await prepareLazyHistory(page);
  await countIs(page, 10);
  const before = await page.locator('#lazy-19').boundingBox();
  await page.getByRole('button', { name: '加载历史消息', exact: true }).click();
  await countIs(page, 20);
  await page.getByRole('button', { name: '加载历史消息', exact: true }).waitFor({ timeout: 20000 });
  const after = await page.locator('#lazy-19').boundingBox();
  assert.ok(Math.abs(after.y - before.y) < 2, `reading anchor shifted by ${after.y - before.y}`);
  assert.match(await page.locator(`${host} .history-status`).innerText(), /已索引 20 条/);
});

test('manual scrolling cancels history loading without restoring over the user', async t => {
  const page = await setup(t);
  await page.evaluate(() => history.pushState({}, '', '/c/cancel-history'));
  await prepareLazyHistory(page);
  await countIs(page, 10);
  await page.getByRole('button', { name: '加载历史消息', exact: true }).click();
  await page.getByRole('button', { name: '停止加载历史消息', exact: true }).waitFor();
  await page.locator('main').evaluate(el => {
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })); el.scrollTop = 700;
  });
  await page.getByRole('button', { name: '加载历史消息', exact: true }).waitFor();
  assert.equal(await page.locator('main').evaluate(el => el.scrollTop), 700);
  assert.match(await page.locator(`${host} .history-status`).innerText(), /已停止加载/);
});

test('a delayed route transition cannot carry old cached messages into a different conversation', async t => {
  const page = await setup(t);
  await countIs(page, 4);
  await page.evaluate(() => history.pushState({}, '', '/c/delayed-new-chat'));
  await countIs(page, 0);
  await page.evaluate(() => {
    document.querySelector('ol').innerHTML = '<li id="new-route-message" data-message-role="user">新会话中的提问</li>';
  });
  await countIs(page, 1);
  assert.match(await page.locator(`${host} .dot`).getAttribute('aria-label'), /新会话中的提问/);
});

test('prepending a small history batch keeps the original dot under the pointer', async t => {
  const page = await setup(t);
  await countIs(page, 4);
  const before = await page.locator(`${host} .dot`).first().boundingBox();
  await page.locator(`${host} .dot`).first().hover();
  await page.evaluate(() => {
    const li = document.createElement('li'); li.id = 'earlier-message'; li.dataset.messageRole = 'user';
    li.textContent = '更早的消息'; document.querySelector('ol').prepend(li);
  });
  await countIs(page, 5);
  const after = await page.locator(`${host} .dot`).nth(1).boundingBox();
  assert.ok(Math.abs(after.y - before.y) < 1, `dot shifted by ${after.y - before.y}`);
  assert.equal(await page.locator(`${host} .tooltip`).isVisible(), true);
  await page.mouse.move(500, 80);
  const layout = await page.locator(`${host} .dots`).evaluate(el => ({ height: el.clientHeight, scrollHeight: el.scrollHeight, inlineHeight: el.style.height }));
  assert.equal(layout.inlineHeight, '');
  assert.equal(layout.height, 5 * 28 + 6);
  assert.equal(layout.scrollHeight, layout.height);
});

test('short timelines have no empty track and tool panels stay within the viewport', async t => {
  const page = await setup(t, desktopFixture);
  await countIs(page, 2);
  const dots = await page.locator(`${host} .dots`).boundingBox();
  assert.equal(dots.height, 2 * 28 + 6);
  const rail = await page.locator(`${host} .rail`).boundingBox();
  assert.ok(rail.height < 300);
  await page.getByRole('button', { name: '功能设置', exact: true }).click();
  const panel = await page.locator(`${host} .panel`).boundingBox();
  assert.ok(panel.y >= 0 && panel.y + panel.height <= 800);
  await page.getByRole('button', { name: '关闭工具面板' }).click();
  await page.locator(`${host} .dot`).first().hover();
  await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'timeline-compact.png') });
});

test('both bookmark bars drag independently, persist across tabs and reload, and reset to default', async t => {
  const page = await setup(t, outlineFixture);
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.locator(`${host}[data-positions-ready]`).waitFor();
  const rail = page.locator(`${host} .rail`), outline = page.locator(`${host} .answer-outline`);
  const leftHandle = page.locator(`${host} [data-position-handle="outline"]`);
  const rightHandle = page.locator(`${host} [data-position-handle="rail"]`);
  await outline.locator('.outline-list').waitFor({ state: 'visible' });
  const initialLeft = await outline.boundingBox(), initialRight = await rail.boundingBox();
  async function drag(handle, dx, dy) {
    const rect = await handle.boundingBox();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
  }
  try {
    await drag(leftHandle, -100, 160);
    await drag(rightHandle, -1200, 210);
    await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.rail').getBoundingClientRect().left < 1000);
    const movedLeft = await outline.boundingBox(), movedRight = await rail.boundingBox();
    assert.ok(Math.abs(movedLeft.x - initialLeft.x + 100) < 2 && Math.abs(movedLeft.y - initialLeft.y - 160) < 2);
    assert.ok(Math.abs(movedRight.x - initialRight.x + 1200) < 2 && Math.abs(movedRight.y - initialRight.y - 210) < 2);
    assert.equal(await outline.locator('.outline-toggle').getAttribute('aria-expanded'), 'true');
    const second = await setup(t, outlineFixture);
    await second.setViewportSize({ width: 1920, height: 1000 });
    await second.locator(`${host}[data-positions-ready]`).waitFor();
    await second.waitForFunction(() => Math.abs(document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.rail').getBoundingClientRect().left - 656) < 2);
    const secondLeft = await second.locator(`${host} .answer-outline`).boundingBox();
    assert.ok(Math.abs(secondLeft.x - movedLeft.x) < 2 && Math.abs(secondLeft.y - movedLeft.y) < 2);
    await page.reload();
    await page.locator(`${host}[data-positions-ready]`).waitFor();
    await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.rail').getBoundingClientRect().left < 1000);
    assert.ok(Math.abs((await rail.boundingBox()).y - movedRight.y) < 2);
    assert.ok(Math.abs((await outline.boundingBox()).x - movedLeft.x) < 2);
    // Navigation and scrolling do not replace the saved position.
    await outline.locator('.outline-item').nth(1).click();
    assert.ok(Math.abs((await outline.boundingBox()).y - movedLeft.y) < 2);
    await page.evaluate(() => history.pushState({}, '', '/c/drag-other-conversation'));
    await page.locator(`${host} .answer-outline`).waitFor({ state: 'hidden' });
    await page.reload();
    await page.locator(`${host}[data-positions-ready]`).waitFor();
    await outline.waitFor({ state: 'visible' });
    assert.ok(Math.abs((await outline.boundingBox()).y - movedLeft.y) < 2);
    await page.locator(`${host} .dot`).first().hover();
    const preview = await page.locator(`${host} .tooltip`).boundingBox();
    assert.ok(preview.x >= 0 && preview.x + preview.width < movedRight.x);
    await page.getByRole('button', { name: '功能设置', exact: true }).click();
    const panel = await page.locator(`${host} .panel`).boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width < movedRight.x && panel.y >= 0 && panel.y + panel.height <= 1000);
    await page.getByRole('button', { name: '关闭工具面板' }).click();
    await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'dragged-bookmarks.png') });
    await page.setViewportSize({ width: 390, height: 640 });
    await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.answer-outline').hasAttribute('data-collapsed'));
    for (const widget of [rail, outline]) {
      const rect = await widget.boundingBox();
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 390 && rect.y + rect.height <= 640);
    }
    await page.setViewportSize({ width: 1920, height: 1000 });
    await outline.locator('.outline-list').waitFor({ state: 'visible' });
    assert.ok(Math.abs((await rail.boundingBox()).x - movedRight.x) < 2);
    assert.ok(Math.abs((await outline.boundingBox()).x - movedLeft.x) < 2);
    await leftHandle.dblclick();
    await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.answer-outline').getBoundingClientRect().top < 120);
    assert.ok(Math.abs((await outline.boundingBox()).x - initialLeft.x) < 2);
  } finally {
    await rightHandle.press('Home');
    if (await leftHandle.isVisible()) await leftHandle.press('Home');
  }
});

test('drag cancellation restores the starting position and keyboard movement can be reset', async t => {
  const page = await setup(t);
  await page.locator(`${host}[data-positions-ready]`).waitFor();
  const handle = page.locator(`${host} [data-position-handle="rail"]`);
  const rail = page.locator(`${host} .rail`);
  await handle.press('Home');
  const initial = await rail.boundingBox(), grip = await handle.boundingBox();
  await page.mouse.move(grip.x + 10, grip.y + 8); await page.mouse.down();
  await page.mouse.move(grip.x - 200, grip.y + 180, { steps: 8 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('[data-dragging]'));
  assert.ok(Math.abs((await rail.boundingBox()).x - initial.x) < 2);
  try {
    await handle.press('ArrowLeft'); await handle.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('#chatgpt-message-bookmarks').shadowRoot.querySelector('.rail').getBoundingClientRect().top > 85);
    const moved = await rail.boundingBox();
    assert.ok(Math.abs(moved.x - initial.x + 10) < 2 && Math.abs(moved.y - initial.y - 10) < 2);
    // At the left edge the preview and tools must switch to the right side.
    const rect = await handle.boundingBox();
    await page.mouse.move(rect.x + 10, rect.y + 8); await page.mouse.down();
    await page.mouse.move(10, 250, { steps: 10 }); await page.mouse.up();
    await page.locator(`${host} .dot`).first().hover();
    const preview = await page.locator(`${host} .tooltip`).boundingBox();
    assert.ok(preview.x > (await rail.boundingBox()).x);
    await page.getByRole('button', { name: '功能设置', exact: true }).click();
    const panel = await page.locator(`${host} .panel`).boundingBox();
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 1280 && panel.y >= 0 && panel.y + panel.height <= 800);
  } finally { await handle.press('Home'); }
});
