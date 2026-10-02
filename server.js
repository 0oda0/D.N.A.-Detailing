'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PHONE = process.env.ADMIN_PHONE || '+79686107799';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin12345';
const WORKER_CODE = process.env.WORKER_CODE || 'dna-staff';
const SESSION_DAYS = 30;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'dna.sqlite'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  pass TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','worker','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration INTEGER NOT NULL CHECK (duration > 0),
  price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  car TEXT NOT NULL,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  total_price INTEGER NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','in_progress','done','cancelled')),
  worker_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS orders_date ON orders(date);
CREATE TABLE IF NOT EXISTS order_services (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  duration INTEGER NOT NULL,
  price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// ---------- helpers ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length >= 10 && d.length <= 15 ? '+' + d : null;
}
function str(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  open_min: '540', // 09:00
  close_min: '1260', // 21:00
  step_min: '30',
  capacity: '2', // сколько машин одновременно (боксы/мастера)
  days_off: '', // дни недели через запятую: 0=вс … 6=сб
  booking_days: '60',
  address: 'Уточняйте адрес по телефону',
  phone: '+7 (968) 610 77 99',
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);
}
function getSettings() {
  const s = {};
  for (const r of db.prepare('SELECT key,value FROM settings').all()) s[r.key] = r.value;
  return {
    open_min: +s.open_min, close_min: +s.close_min, step_min: +s.step_min,
    capacity: +s.capacity, booking_days: +s.booking_days,
    days_off: s.days_off ? s.days_off.split(',').map(Number) : [],
    address: s.address, phone: s.phone,
  };
}

// ---------- seed ----------
if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
  db.prepare("INSERT INTO users(name,phone,pass,role) VALUES(?,?,?,'admin')")
    .run('Администратор', normPhone(ADMIN_PHONE), hashPassword(ADMIN_PASSWORD));
  console.log(`Создан админ: ${normPhone(ADMIN_PHONE)} / ${ADMIN_PASSWORD} — смените пароль!`);
}
if (!db.prepare('SELECT 1 FROM services').get()) {
  const seed = [
    ['Бронирование авто плёнкой (зоны риска)', 'Защита кузова от сколов и царапин', 480, 45000],
    ['Химчистка салона', 'Глубокая очистка и свежесть', 240, 12000],
    ['Химчистка мебели', 'Диваны, кресла, матрасы — выезд к клиенту', 120, 5000],
    ['Полировка кузова', 'Идеальный блеск и гладкость', 360, 20000],
    ['Полировка оптики', 'Восстановление прозрачности фар', 60, 3000],
    ['Шумо-виброизоляция авто', 'Тишина и комфорт в салоне', 480, 35000],
    ['Нанесение керамики', 'Защита от воды, грязи и УФ-лучей', 300, 25000],
    ['Антидождь', 'Гидрофобное покрытие стёкол', 30, 1500],
    ['Детейлинг дисков и тормозных систем', 'Чистота и безопасность', 120, 6000],
  ];
  const ins = db.prepare('INSERT INTO services(name,description,duration,price,sort) VALUES(?,?,?,?,?)');
  seed.forEach((s, i) => ins.run(...s, i));
}

// ---------- availability ----------
const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: process.env.TZ || 'Europe/Moscow' });
const nowMin = () => {
  const t = new Date().toLocaleTimeString('sv-SE', { timeZone: process.env.TZ || 'Europe/Moscow' });
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const dt = new Date(d + 'T00:00:00Z');
  return !isNaN(dt) && dt.toISOString().slice(0, 10) === d;
}
// Свободно ли окно [start, end) с учётом вместимости. excludeId — для переноса заказа.
function isFree(date, start, end, cap, excludeId = 0) {
  const busy = db.prepare(
    "SELECT start_min, end_min FROM orders WHERE date=? AND status!='cancelled' AND id!=? AND start_min<? AND end_min>?"
  ).all(date, excludeId, end, start);
  if (busy.length < cap) return true;
  // пиковая загрузка достигается в начале окна или в момент начала одного из заказов
  const points = [start, ...busy.map((b) => b.start_min).filter((p) => p > start)];
  return points.every((p) => busy.filter((b) => b.start_min <= p && b.end_min > p).length < cap);
}
function freeSlots(date, duration) {
  const s = getSettings();
  if (!validDate(date)) throw new HttpError(400, 'Некорректная дата');
  const today = todayStr();
  if (date < today) return [];
  const maxDate = new Date(Date.now() + s.booking_days * 864e5).toISOString().slice(0, 10);
  if (date > maxDate) return [];
  if (s.days_off.includes(new Date(date + 'T00:00:00Z').getUTCDay())) return [];
  const minStart = date === today ? nowMin() + 60 : 0; // минимум за час
  const res = [];
  for (let t = s.open_min; t + duration <= s.close_min; t += s.step_min) {
    if (t >= minStart && isFree(date, t, t + duration, s.capacity)) res.push(t);
  }
  return res;
}
function pickServices(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'Выберите хотя бы одну услугу');
  const uniq = [...new Set(ids.map(Number))];
  const rows = uniq.map((id) => db.prepare('SELECT * FROM services WHERE id=? AND active=1').get(id));
  if (rows.some((r) => !r)) throw new HttpError(400, 'Услуга недоступна');
  return rows;
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
app.use((req, _res, next) => {
  const tok = parseCookies(req.headers.cookie).sid;
  if (tok) {
    req.user = db.prepare(
      'SELECT u.id,u.name,u.phone,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?'
    ).get(tok, Date.now());
  }
  next();
});
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(token, userId, Date.now() + SESSION_DAYS * 864e5);
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
}
const need = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Войдите в аккаунт'));
  if (roles.length && !roles.includes(req.user.role)) return next(new HttpError(403, 'Нет доступа'));
  next();
};
const h = (fn) => (req, res, next) => { try { res.json(fn(req, res) ?? { ok: true }); } catch (e) { next(e); } };

// простая защита от перебора паролей
const attempts = new Map();
function throttle(req) {
  const key = req.ip;
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
  if (a.length >= 20) throw new HttpError(429, 'Слишком много попыток, попробуйте позже');
  a.push(now);
  attempts.set(key, a);
}

// --- auth ---
app.post('/api/register', h((req, res) => {
  throttle(req);
  const name = str(req.body.name, 80);
  const phone = normPhone(req.body.phone);
  const password = String(req.body.password || '');
  if (!name) throw new HttpError(400, 'Укажите имя');
  if (!phone) throw new HttpError(400, 'Некорректный телефон');
  if (password.length < 6) throw new HttpError(400, 'Пароль — минимум 6 символов');
  let role = 'client';
  if (req.body.worker_code) {
    if (req.body.worker_code !== WORKER_CODE) throw new HttpError(400, 'Неверный код сотрудника');
    role = 'worker';
  }
  if (db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone)) throw new HttpError(400, 'Этот телефон уже зарегистрирован');
  const { lastInsertRowid } = db.prepare('INSERT INTO users(name,phone,pass,role) VALUES(?,?,?,?)').run(name, phone, hashPassword(password), role);
  // привязываем заказы, созданные админом на этот телефон до регистрации
  db.prepare('UPDATE orders SET user_id=? WHERE user_id IS NULL AND client_phone=?').run(lastInsertRowid, phone);
  startSession(res, lastInsertRowid);
  return { id: Number(lastInsertRowid), name, phone, role };
}));
app.post('/api/login', h((req, res) => {
  throttle(req);
  const phone = normPhone(req.body.phone);
  const u = phone && db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (!u || !checkPassword(String(req.body.password || ''), u.pass)) throw new HttpError(400, 'Неверный телефон или пароль');
  startSession(res, u.id);
  return { id: u.id, name: u.name, phone: u.phone, role: u.role };
}));
app.post('/api/logout', h((req, res) => {
  const tok = parseCookies(req.headers.cookie).sid;
  if (tok) db.prepare('DELETE FROM sessions WHERE token=?').run(tok);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
}));
app.get('/api/me', h((req) => req.user || null));
app.post('/api/me/password', need(), h((req) => {
  const u = db.prepare('SELECT pass FROM users WHERE id=?').get(req.user.id);
  if (!checkPassword(String(req.body.old || ''), u.pass)) throw new HttpError(400, 'Старый пароль неверен');
  if (String(req.body.password || '').length < 6) throw new HttpError(400, 'Пароль — минимум 6 символов');
  db.prepare('UPDATE users SET pass=? WHERE id=?').run(hashPassword(String(req.body.password)), req.user.id);
}));

// --- public ---
app.get('/api/services', h(() => db.prepare('SELECT id,name,description,duration,price FROM services WHERE active=1 ORDER BY sort,id').all()));
app.get('/api/settings', h(() => getSettings()));
app.get('/api/slots', h((req) => {
  const services = pickServices(String(req.query.services || '').split(',').filter(Boolean));
  const duration = services.reduce((a, s) => a + s.duration, 0);
  const s = getSettings();
  if (duration > s.close_min - s.open_min) return { duration, slots: [], tooLong: true };
  return { duration, slots: freeSlots(str(req.query.date, 10), duration) };
}));

// --- orders ---
function createOrder(body, { userId, clientName, clientPhone, adminMode }) {
  const services = pickServices(body.services);
  const car = str(body.car, 120);
  if (!car) throw new HttpError(400, 'Укажите марку и модель авто');
  const date = str(body.date, 10);
  const start = Number(body.start_min);
  const duration = services.reduce((a, s) => a + s.duration, 0);
  const total = services.reduce((a, s) => a + s.price, 0);
  return tx(() => {
    // проверка внутри транзакции, чтобы два клиента не заняли одно окно
    if (adminMode) {
      const s = getSettings();
      if (!validDate(date) || !Number.isInteger(start) || start < 0 || start + duration > 24 * 60) throw new HttpError(400, 'Некорректное время');
      if (!body.force && !isFree(date, start, start + duration, s.capacity)) throw new HttpError(409, 'Это время уже занято');
    } else if (!freeSlots(date, duration).includes(start)) {
      throw new HttpError(409, 'Это время уже занято — выберите другое');
    }
    const { lastInsertRowid: id } = db.prepare(
      'INSERT INTO orders(user_id,client_name,client_phone,car,date,start_min,end_min,total_price,comment,status) VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).run(userId, clientName, clientPhone, car, date, start, start + duration, total, str(body.comment, 1000), adminMode ? 'confirmed' : 'new');
    const ins = db.prepare('INSERT INTO order_services(order_id,service_id,name,duration,price) VALUES(?,?,?,?,?)');
    for (const s of services) ins.run(id, s.id, s.name, s.duration, s.price);
    return { id: Number(id) };
  });
}
function withServices(rows) {
  const q = db.prepare('SELECT service_id,name,duration,price FROM order_services WHERE order_id=?');
  return rows.map((o) => ({ ...o, services: q.all(o.id) }));
}
const ORDER_SELECT = 'SELECT o.*, w.name AS worker_name FROM orders o LEFT JOIN users w ON w.id=o.worker_id';

app.post('/api/orders', need(), h((req) => createOrder(req.body, {
  userId: req.user.id, clientName: req.user.name, clientPhone: req.user.phone, adminMode: false,
})));
app.get('/api/orders/my', need(), h((req) => withServices(
  db.prepare(`${ORDER_SELECT} WHERE o.user_id=? ORDER BY o.date DESC, o.start_min DESC`).all(req.user.id)
)));
app.post('/api/orders/:id/cancel', need(), h((req) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  if (!['new', 'confirmed'].includes(o.status)) throw new HttpError(400, 'Этот заказ уже нельзя отменить');
  db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(o.id);
}));

// --- staff (worker + admin) ---
app.get('/api/staff/orders', need('worker', 'admin'), h((req) => {
  const from = validDate(req.query.from) ? req.query.from : todayStr();
  const to = validDate(req.query.to) ? req.query.to : from;
  let sql = `${ORDER_SELECT} WHERE o.date BETWEEN ? AND ?`;
  const args = [from, to];
  if (req.user.role === 'worker' && req.query.mine === '1') { sql += ' AND o.worker_id=?'; args.push(req.user.id); }
  return withServices(db.prepare(sql + ' ORDER BY o.date, o.start_min').all(...args));
}));
app.patch('/api/staff/orders/:id', need('worker', 'admin'), h((req) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  const b = req.body;
  if (b.status !== undefined) {
    const allowed = req.user.role === 'admin' ? ['new', 'confirmed', 'in_progress', 'done', 'cancelled'] : ['in_progress', 'done'];
    if (!allowed.includes(b.status)) throw new HttpError(400, 'Недопустимый статус');
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(b.status, o.id);
  }
  if (b.take && req.user.role === 'worker') {
    if (o.worker_id && o.worker_id !== req.user.id) throw new HttpError(400, 'Заказ уже взят другим мастером');
    db.prepare('UPDATE orders SET worker_id=? WHERE id=?').run(req.user.id, o.id);
  }
  if (req.user.role === 'admin') {
    if (b.worker_id !== undefined) db.prepare('UPDATE orders SET worker_id=? WHERE id=?').run(b.worker_id ? Number(b.worker_id) : null, o.id);
    if (b.date !== undefined || b.start_min !== undefined) {
      const date = str(b.date ?? o.date, 10);
      const start = Number(b.start_min ?? o.start_min);
      const dur = o.end_min - o.start_min;
      if (!validDate(date) || !Number.isInteger(start)) throw new HttpError(400, 'Некорректное время');
      tx(() => {
        if (!b.force && !isFree(date, start, start + dur, getSettings().capacity, o.id)) throw new HttpError(409, 'Это время уже занято');
        db.prepare('UPDATE orders SET date=?, start_min=?, end_min=? WHERE id=?').run(date, start, start + dur, o.id);
      });
    }
  }
}));

// --- admin ---
app.post('/api/admin/orders', need('admin'), h((req) => {
  let userId = null, clientName, clientPhone;
  if (req.body.user_id) {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.body.user_id));
    if (!u) throw new HttpError(400, 'Клиент не найден');
    userId = u.id; clientName = u.name; clientPhone = u.phone;
  } else {
    clientName = str(req.body.client_name, 80);
    clientPhone = normPhone(req.body.client_phone);
    if (!clientName || !clientPhone) throw new HttpError(400, 'Укажите имя и телефон клиента');
    const u = db.prepare('SELECT id FROM users WHERE phone=?').get(clientPhone);
    if (u) userId = u.id;
  }
  return createOrder(req.body, { userId, clientName, clientPhone, adminMode: true });
}));
app.delete('/api/admin/orders/:id', need('admin'), h((req) => { db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id); }));

app.get('/api/admin/services', need('admin'), h(() => db.prepare('SELECT * FROM services ORDER BY sort,id').all()));
function serviceFields(b) {
  const name = str(b.name, 120);
  const duration = Math.round(Number(b.duration));
  const price = Math.round(Number(b.price) || 0);
  if (!name) throw new HttpError(400, 'Укажите название');
  if (!(duration >= 5 && duration <= 1440)) throw new HttpError(400, 'Длительность — от 5 до 1440 минут');
  if (price < 0) throw new HttpError(400, 'Некорректная цена');
  return [name, str(b.description, 300), duration, price, b.active === false || b.active === 0 ? 0 : 1, Math.round(Number(b.sort) || 0)];
}
app.post('/api/admin/services', need('admin'), h((req) => {
  const r = db.prepare('INSERT INTO services(name,description,duration,price,active,sort) VALUES(?,?,?,?,?,?)').run(...serviceFields(req.body));
  return { id: Number(r.lastInsertRowid) };
}));
app.put('/api/admin/services/:id', need('admin'), h((req) => {
  db.prepare('UPDATE services SET name=?,description=?,duration=?,price=?,active=?,sort=? WHERE id=?').run(...serviceFields(req.body), req.params.id);
}));
app.delete('/api/admin/services/:id', need('admin'), h((req) => { db.prepare('DELETE FROM services WHERE id=?').run(req.params.id); }));

app.get('/api/admin/users', need('admin'), h(() => db.prepare('SELECT id,name,phone,role,created_at FROM users ORDER BY role, name').all()));
app.patch('/api/admin/users/:id', need('admin'), h((req) => {
  if (!['client', 'worker', 'admin'].includes(req.body.role)) throw new HttpError(400, 'Недопустимая роль');
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'Нельзя менять свою роль');
  db.prepare('UPDATE users SET role=? WHERE id=?').run(req.body.role, req.params.id);
}));

app.put('/api/admin/settings', need('admin'), h((req) => {
  const b = req.body;
  const num = (v, lo, hi) => { const n = Math.round(Number(v)); if (!(n >= lo && n <= hi)) throw new HttpError(400, 'Некорректное значение настроек'); return String(n); };
  const vals = {
    open_min: num(b.open_min, 0, 1439), close_min: num(b.close_min, 1, 1440), step_min: num(b.step_min, 5, 240),
    capacity: num(b.capacity, 1, 50), booking_days: num(b.booking_days, 1, 365),
    days_off: (Array.isArray(b.days_off) ? b.days_off : []).map(Number).filter((d) => d >= 0 && d <= 6).join(','),
    address: str(b.address, 200), phone: str(b.phone, 40),
  };
  if (+vals.open_min >= +vals.close_min) throw new HttpError(400, 'Время открытия должно быть раньше закрытия');
  const up = db.prepare('UPDATE settings SET value=? WHERE key=?');
  tx(() => { for (const [k, v] of Object.entries(vals)) up.run(v, k); });
}));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Не найдено')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Ошибка сервера' : err.message });
});

app.listen(PORT, () => console.log(`D.N.A. Detailing: http://0.0.0.0:${PORT}`));
