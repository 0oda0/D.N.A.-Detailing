'use strict';
// Скриншоты всех экранов для презентации public/showcase/ (под бренд текущей базы).
// Нужен Playwright: npm i -D playwright && npx playwright install chromium
// Запуск при работающем сервере с демо-данными: node scripts/showcase-shots.cjs
const path = require('node:path');
const fs = require('node:fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'public', 'showcase', 'img');
const ADMIN = { phone: process.env.ADMIN_PHONE || '+79990000000', password: process.env.ADMIN_PASSWORD || 'admin12345' };
fs.mkdirSync(OUT, { recursive: true });

const day = (o) => new Date(Date.now() + o * 864e5).toISOString().slice(0, 10);
const nice = '.reveal{opacity:1!important;transform:none!important} .call-bubble{display:none!important} #toast{display:none!important}';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const p = await ctx.newPage();
  const go = async (hash, wait = 700) => { await p.goto(BASE + '/' + hash); await p.waitForTimeout(wait); await p.addStyleTag({ content: nice }); };
  const shot = async (name, opts = {}) => { await p.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 78, ...opts }); console.log('  ' + name); };
  const login = async (phone, password) => {
    await go('#/login'); await p.fill('[name=phone]', phone); await p.fill('[name=password]', password); await p.click('form .btn'); await p.waitForTimeout(700);
  };

  // демо-фото для галереи: честные заглушки «до/после»
  const ph = await ctx.newPage();
  const mk = async (label, bg) => { await ph.setContent(`<div style="width:800px;height:600px;display:grid;place-items:center;background:${bg};font:700 56px sans-serif;color:#fff">${label}</div>`); return ph.screenshot({ type: 'jpeg', quality: 80 }); };
  const imgs = [await mk('ФОТО «ДО»', 'linear-gradient(135deg,#6b5b4b,#3a332c)'), await mk('ФОТО «ПОСЛЕ»', 'linear-gradient(135deg,#2f8cff,#0d2f6b)')];
  await ph.close();

  console.log('Клиент:');
  await go('#/'); await shot('home');
  await p.evaluate(() => document.getElementById('calc').scrollIntoView());
  await p.selectOption('#calc-body', 'suv'); await p.click('#calc-list input >> nth=3'); await p.click('#calc-list input >> nth=6'); await p.waitForTimeout(200);
  await shot('calc', { clip: await p.locator('#calc').boundingBox() });
  await p.evaluate(() => document.getElementById('contacts').scrollIntoView()); await p.evaluate(() => scrollBy(0, -120)); await shot('home-bottom');

  await go('#/book?s=4'); await p.fill('#b-make', 'BMW'); await p.dispatchEvent('#b-make', 'change');
  await p.fill('#b-model', 'X5'); await p.dispatchEvent('#b-model', 'input'); await p.dispatchEvent('#b-model', 'change'); await p.selectOption('#b-body', 'suv');
  await p.locator('#b-plate').pressSequentially('k456mh750');
  await p.fill('#b-date', day(2)); await p.dispatchEvent('#b-date', 'change'); await p.waitForTimeout(500); await p.click('#b-slots .slot >> nth=2');
  await shot('book', { fullPage: true });
  await p.evaluate(() => document.getElementById('b-gname').scrollIntoView()); await p.fill('#b-gname', 'Ольга'); await p.locator('#b-gphone').pressSequentially('89161234567'); await p.check('#b-consent');
  await p.fill('#b-promo', 'avito10'); await p.click('#b-promo-btn'); await p.waitForTimeout(400); await shot('book-guest');
  await p.click('#b-submit'); await p.waitForTimeout(900); await shot('guest-order');

  await go('#/book?s=3'); await p.fill('#b-address', 'ул. Садовая, 12, кв. 5'); await p.dispatchEvent('#b-address', 'input'); await p.waitForTimeout(300); await shot('book-onsite');

  await login('+79990000202', 'client123');
  await go('#/profile'); await shot('profile');
  await go('#/my'); await shot('my');

  console.log('Мастер:');
  await go('#/'); await p.evaluate(() => fetch('/api/logout', { method: 'POST' })); await login('+79990000101', 'master123');
  await go('#/staff'); await shot('staff');

  console.log('Админ:');
  await p.evaluate(() => fetch('/api/logout', { method: 'POST' })); await login(ADMIN.phone, ADMIN.password);
  const up = async (buf) => p.evaluate(async (b64) => { const r = await fetch('/api/admin/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }); return (await r.json()).url; }, buf.toString('base64'));
  const works = await p.evaluate(() => fetch('/api/works').then((r) => r.json()));
  if (!works.length) for (const title of ['Toyota Camry — полировка и керамика', 'BMW X5 — химчистка салона']) {
    const [b, a] = [await up(imgs[0]), await up(imgs[1])];
    await p.evaluate((x) => fetch('/api/admin/works', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(x) }), { title, before_img: b, after_img: a });
  }
  const tabs = ['orders', 'create', 'reports', 'leads', 'repeats', 'expenses', 'promos', 'reviews', 'works', 'services', 'pricing', 'users', 'workers', 'audit', 'settings'];
  for (const t of tabs) {
    await go('#/admin?tab=' + t, 900);
    if (t === 'orders') { await p.fill('#o-from', day(-2)); await p.dispatchEvent('#o-from', 'change'); await p.fill('#o-to', day(4)); await p.dispatchEvent('#o-to', 'change'); await p.waitForTimeout(600); }
    if (t === 'reports') { await shot('admin-reports-full', { fullPage: true }); }
    await shot('admin-' + t);
  }
  await go('#/'); await p.evaluate(() => document.getElementById('works-sec')?.scrollIntoView()); await p.evaluate(() => scrollBy(0, -90)); await shot('home-works');

  console.log('Тёмная тема и телефон:');
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  const d = await dctx.newPage(); await d.goto(BASE + '/#/'); await d.waitForTimeout(700); await d.addStyleTag({ content: nice });
  await d.screenshot({ path: path.join(OUT, 'home-dark.jpg'), type: 'jpeg', quality: 78 });
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', isMobile: true });
  const m = await mctx.newPage();
  for (const [hash, name] of [['#/', 'mobile-home'], ['#/book?s=2', 'mobile-book']]) {
    await m.goto(BASE + '/' + hash); await m.waitForTimeout(800); await m.addStyleTag({ content: nice });
    await m.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 70 });
  }
  await browser.close();
  console.log('Готово:', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
