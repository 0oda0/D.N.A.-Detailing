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
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// миграции: новые колонки для старых баз
const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
for (const [col, def] of [['car_make', "TEXT NOT NULL DEFAULT ''"], ['car_model', "TEXT NOT NULL DEFAULT ''"], ['plate', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!orderCols.includes(col)) db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${def}`);
}
if (!orderCols.includes('reminded')) db.exec('ALTER TABLE orders ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0');
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('tg_chat_id')) db.exec('ALTER TABLE users ADD COLUMN tg_chat_id INTEGER');
if (!userCols.includes('avatar')) db.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
if (!userCols.includes('tg_token')) db.exec('ALTER TABLE users ADD COLUMN tg_token TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  order_id INTEGER UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  car TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  source TEXT NOT NULL DEFAULT '',
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cars (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  year INTEGER,
  plate TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS cars_plate ON cars(plate);
CREATE INDEX IF NOT EXISTS orders_plate ON orders(plate);
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  before_img TEXT NOT NULL DEFAULT '',
  after_img TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// тип кузова и класс авто: в заказах, гараже; флаг «применять множитель» у услуг
const addCol = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addCol('orders', 'car_body', "TEXT NOT NULL DEFAULT ''");
addCol('orders', 'car_class', "TEXT NOT NULL DEFAULT ''");
addCol('orders', 'price_k', 'REAL NOT NULL DEFAULT 1');
addCol('cars', 'body', "TEXT NOT NULL DEFAULT ''");
addCol('cars', 'car_class', "TEXT NOT NULL DEFAULT ''");
addCol('services', 'scaled', 'INTEGER NOT NULL DEFAULT 1');

// ---------- справочник авто (тот же файл, что отдаётся сайту) ----------
const CAR_DB = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'cars.json'), 'utf8')); } catch { return []; } })();
function lookupClass(make, model) {
  const m = CAR_DB.find((x) => x[0].toLowerCase() === make.toLowerCase() || (x[1] && x[1].toLowerCase() === make.toLowerCase()));
  const md = m && m[3].find((x) => x[0].toLowerCase() === model.toLowerCase());
  return md ? md[2] : '';
}

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
// Госномер РФ: А123ВС77 / А123ВС777, латинские двойники приводим к кириллице
const PLATE_LAT = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
function normPlate(p) {
  if (!String(p || '').trim()) return '';
  const v = String(p || '').toUpperCase().replace(/[A-Z]/g, (c) => PLATE_LAT[c] || c).replace(/[^0-9А-ЯЁ]/g, '');
  if (!/^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(v)) throw new HttpError(400, 'Госномер в формате А123ВС777');
  return v;
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
  address: 'г. Балашиха, ул. Свердлова, вл. 36',
  phone: '+7 (968) 610 77 99',
  price_body: '{}',
  price_class: '{}',
};
const BODY_TYPES = {
  sedan: 'Седан', hatchback: 'Хэтчбек', liftback: 'Лифтбек', wagon: 'Универсал', coupe: 'Купе', cabrio: 'Кабриолет',
  crossover: 'Кроссовер', suv: 'Внедорожник', minivan: 'Минивэн', pickup: 'Пикап', van: 'Фургон / микроавтобус',
};
const CAR_CLASSES = {
  A: 'A — мини', B: 'B — малый', C: 'C — компактный (гольф)', D: 'D — средний', E: 'E — бизнес',
  F: 'F — представительский', J: 'J — внедорожник / SUV', M: 'M — минивэн', S: 'S — спорткар',
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
    price_body: JSON.parse(s.price_body || '{}'), price_class: JSON.parse(s.price_class || '{}'),
    body_types: BODY_TYPES, car_classes: CAR_CLASSES,
  };
}
// итоговый множитель цены = кузов × класс (не заданный = 1)
function priceK(body, cls) {
  const s = getSettings();
  return Math.round((s.price_body[body] || 1) * (s.price_class[cls] || 1) * 1000) / 1000;
}
const roundPrice = (p) => Math.round(p / 100) * 100;

// ---------- seed ----------
if (!db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) {
  db.prepare("INSERT INTO users(name,phone,pass,role) VALUES(?,?,?,'admin')")
    .run('Администратор', normPhone(ADMIN_PHONE), hashPassword(ADMIN_PASSWORD));
  console.log(`Создан админ: ${normPhone(ADMIN_PHONE)} / ${ADMIN_PASSWORD} — смените пароль!`);
}
if (!db.prepare('SELECT 1 FROM services').get()) {
  const seed = [
    ['Бронирование авто плёнкой (зоны риска)', 'Антигравийная полиуретановая плёнка: броня от гравия, веток, пескоструя и мелких ДТП', 480, 45000],
    ['Химчистка салона', 'Глубокая химчистка — салон как у нового авто', 240, 12000],
    ['Химчистка мебели', 'Диваны, кресла, матрасы — профессионально, можно на выезде', 120, 5000],
    ['Полировка кузова', 'Восстановительная полировка: убираем «паутинку» и царапины, зеркальный блеск', 360, 20000],
    ['Полировка оптики', 'Возвращаем фарам прозрачность и блеск', 60, 3000],
    ['Шумо-виброизоляция авто', 'Тишина и акустический комфорт даже на плохом асфальте', 480, 35000],
    ['Нанесение керамики', 'Глубокий насыщенный цвет и мощный гидрофоб', 300, 25000],
    ['Антидождь', 'Чистые стёкла в любую непогоду', 30, 1500],
    ['Детейлинг дисков и тормозных систем', 'Чистота и безопасность', 120, 6000],
  ];
  const ins = db.prepare('INSERT INTO services(name,description,duration,price,sort) VALUES(?,?,?,?,?)');
  seed.forEach((s, i) => ins.run(...s, i));
}

// разовое обновление старого адреса-заглушки
db.prepare("UPDATE settings SET value=? WHERE key='address' AND value='Уточняйте адрес по телефону'").run(DEFAULT_SETTINGS.address);

// химчистка мебели не зависит от машины — один раз выключаем для неё множитель
if (!db.prepare("SELECT 1 FROM settings WHERE key='mig_scaled'").get()) {
  db.prepare("UPDATE services SET scaled=0 WHERE name='Химчистка мебели'").run();
  db.prepare("INSERT INTO settings(key,value) VALUES('mig_scaled','1')").run();
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
app.set('trust proxy', 'loopback'); // корректный IP клиента, если позже поставить nginx
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '30d' }));

function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
app.use((req, _res, next) => {
  const tok = parseCookies(req.headers.cookie).sid;
  if (tok) {
    req.user = db.prepare(
      'SELECT u.id,u.name,u.phone,u.role,u.avatar FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?'
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
const h = (fn) => (req, res, next) => { try { const r = fn(req, res); res.json(r === undefined ? { ok: true } : r); } catch (e) { next(e); } };

// простая защита от перебора паролей
const attempts = new Map();
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (a.every((t) => now - t > 15 * 60e3)) attempts.delete(k); }, 10 * 60e3).unref();
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
  // телефон не подтверждён (нет SMS), поэтому старые заказы на этот номер не привязываем сами —
  // они появятся у админа в «Совпадениях» для ручной проверки
  if (db.prepare('SELECT 1 FROM orders WHERE user_id IS NULL AND client_phone=?').get(phone)) {
    notifyAdmins(`🔗 <b>Совпадение по телефону</b>\n${tgEsc(name)} ${phone} зарегистрировался(ась); есть старые заказы на этот номер. Проверьте: Админка → Пользователи.`);
  }
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
  // выходим на всех остальных устройствах
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token!=?').run(req.user.id, parseCookies(req.headers.cookie).sid || '');
}));

// --- public ---
app.get('/api/services', h(() => db.prepare('SELECT id,name,description,duration,price,scaled FROM services WHERE active=1 ORDER BY sort,id').all()));
app.get('/api/settings', h(() => getSettings()));
app.get('/api/quote', h((req) => {
  const make = str(req.query.make, 60), model = str(req.query.model, 60);
  const cls = lookupClass(make, model) || (CAR_CLASSES[req.query.car_class] ? req.query.car_class : '');
  return { car_class: cls, k: priceK(BODY_TYPES[req.query.body] ? req.query.body : '', cls) };
}));
app.get('/api/slots', h((req) => {
  const services = pickServices(String(req.query.services || '').split(',').filter(Boolean));
  const duration = services.reduce((a, s) => a + s.duration, 0);
  const s = getSettings();
  if (duration > s.close_min - s.open_min) return { duration, slots: [], tooLong: true };
  return { duration, slots: freeSlots(str(req.query.date, 10), duration) };
}));

app.post('/api/leads', h((req) => {
  throttle(req);
  const name = str(req.body.name, 80);
  const phone = normPhone(req.body.phone);
  if (!name || !phone) throw new HttpError(400, 'Укажите имя и корректный телефон');
  const message = str(req.body.message, 500);
  db.prepare('INSERT INTO leads(name,phone,message) VALUES(?,?,?)').run(name, phone, message);
  notifyAdmins(`📞 <b>Заявка на звонок</b>\n👤 ${tgEsc(name)} ${phone}${message ? '\n💬 ' + tgEsc(message) : ''}`);
}));

// --- orders ---
function createOrder(body, { userId, clientName, clientPhone, adminMode }) {
  const services = pickServices(body.services);
  const make = str(body.car_make, 60), model = str(body.car_model, 60);
  const plate = normPlate(body.plate);
  const car = [make, model].filter(Boolean).join(' ') || str(body.car, 120);
  if (!make && !car) throw new HttpError(400, 'Укажите марку и модель авто');
  const date = str(body.date, 10);
  const start = Number(body.start_min);
  const duration = services.reduce((a, s) => a + s.duration, 0);
  const body_ = BODY_TYPES[body.car_body] ? body.car_body : '';
  // класс берём из справочника (клиент не может «удешевить» авто); админ может указать вручную
  const cls = (adminMode && CAR_CLASSES[body.car_class] ? body.car_class : lookupClass(make, model)) || (CAR_CLASSES[body.car_class] ? body.car_class : '');
  const k = priceK(body_, cls);
  const priced = services.map((s) => ({ ...s, price: s.scaled ? roundPrice(s.price * k) : s.price }));
  const total = priced.reduce((a, s) => a + s.price, 0);
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
      'INSERT INTO orders(user_id,client_name,client_phone,car,car_make,car_model,plate,car_body,car_class,price_k,date,start_min,end_min,total_price,comment,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(userId, clientName, clientPhone, car, make, model, plate, body_, cls, k, date, start, start + duration, total, str(body.comment, 1000), adminMode ? 'confirmed' : 'new');
    const ins = db.prepare('INSERT INTO order_services(order_id,service_id,name,duration,price) VALUES(?,?,?,?,?)');
    for (const s of priced) ins.run(id, s.id, s.name, s.duration, s.price);
    return { id: Number(id) };
  });
}
function withServices(rows) {
  const q = db.prepare('SELECT service_id,name,duration,price FROM order_services WHERE order_id=?');
  return rows.map((o) => ({ ...o, services: q.all(o.id) }));
}
const ORDER_SELECT = 'SELECT o.*, w.name AS worker_name FROM orders o LEFT JOIN users w ON w.id=o.worker_id';

const MAX_ACTIVE_ORDERS = 3;
app.post('/api/orders', need(), h((req) => {
  if (req.user.role === 'client' && db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND status IN ('new','confirmed') AND date>=?").get(req.user.id, todayStr()).n >= MAX_ACTIVE_ORDERS) {
    throw new HttpError(400, `У вас уже ${MAX_ACTIVE_ORDERS} активные записи. Чтобы записаться ещё, позвоните или напишите нам.`);
  }
  const r = createOrder(req.body, { userId: req.user.id, clientName: req.user.name, clientPhone: req.user.phone, adminMode: false });
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(r.id);
  notifyAdmins(`🆕 <b>Новая онлайн-запись</b>\n👤 ${tgEsc(o.client_name)} ${o.client_phone}\n${orderText(o)}${o.comment ? '\n💬 ' + tgEsc(o.comment) : ''}`);
  return r;
}));
app.get('/api/orders/my', need(), h((req) => withServices(
  db.prepare(`SELECT o.*, w.name AS worker_name, (SELECT 1 FROM reviews r WHERE r.order_id=o.id) AS has_review FROM orders o LEFT JOIN users w ON w.id=o.worker_id WHERE o.user_id=? ORDER BY o.date DESC, o.start_min DESC`).all(req.user.id)
)));
app.post('/api/orders/:id/cancel', need(), h((req) => {
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  if (!['new', 'confirmed'].includes(o.status)) throw new HttpError(400, 'Этот заказ уже нельзя отменить');
  db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(o.id);
  notifyAdmins(`❌ <b>Клиент отменил запись</b>\n👤 ${tgEsc(o.client_name)} ${o.client_phone}\n${orderText(o)}`);
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
    if (req.user.role === 'worker') {
      // мастер: «Начать» только у новой/подтверждённой, «Готово» только у начатой, и только свой или свободный заказ
      const from = { in_progress: ['new', 'confirmed'], done: ['in_progress'] }[b.status];
      if (!from.includes(o.status)) throw new HttpError(400, 'Сейчас этот статус поставить нельзя');
      if (o.worker_id && o.worker_id !== req.user.id) throw new HttpError(403, 'Это заказ другого мастера');
      if (!o.worker_id) db.prepare('UPDATE orders SET worker_id=? WHERE id=?').run(req.user.id, o.id);
    }
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(b.status, o.id);
    if (b.status !== o.status) notifyClient(o.id, b.status);
  }
  if (b.take && req.user.role === 'worker') {
    if (o.worker_id && o.worker_id !== req.user.id) throw new HttpError(400, 'Заказ уже взят другим мастером');
    if (['done', 'cancelled'].includes(o.status)) throw new HttpError(400, 'Заказ уже закрыт');
    db.prepare('UPDATE orders SET worker_id=? WHERE id=?').run(req.user.id, o.id);
  }
  if (req.user.role === 'admin') {
    if (b.total_price !== undefined) {
      const tp = Math.round(Number(b.total_price));
      if (!(tp >= 0)) throw new HttpError(400, 'Некорректная сумма');
      db.prepare('UPDATE orders SET total_price=? WHERE id=?').run(tp, o.id);
    }
    if (b.worker_id !== undefined) db.prepare('UPDATE orders SET worker_id=? WHERE id=?').run(b.worker_id ? Number(b.worker_id) : null, o.id);
    if (b.date !== undefined || b.start_min !== undefined) {
      const date = str(b.date ?? o.date, 10);
      const start = Number(b.start_min ?? o.start_min);
      const dur = o.end_min - o.start_min;
      if (!validDate(date) || !Number.isInteger(start)) throw new HttpError(400, 'Некорректное время');
      tx(() => {
        if (!b.force && !isFree(date, start, start + dur, getSettings().capacity, o.id)) throw new HttpError(409, 'Это время уже занято');
        db.prepare('UPDATE orders SET date=?, start_min=?, end_min=?, reminded=0 WHERE id=?').run(date, start, start + dur, o.id);
      });
      if (date !== o.date || start !== o.start_min) notifyClient(o.id, 'moved');
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
    // к аккаунту не привязываем автоматически: чтобы привязать, выберите клиента из списка
    // или подтвердите совпадение в «Пользователях» (телефоны не подтверждены SMS)
  }
  return createOrder(req.body, { userId, clientName, clientPhone, adminMode: true });
}));
app.delete('/api/admin/orders/:id', need('admin'), h((req) => { db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id); }));

// --- отчёты ---
function reportRange(q) {
  const to = validDate(q.to) ? q.to : todayStr();
  const from = validDate(q.from) ? q.from : new Date(Date.parse(to) - 29 * 864e5).toISOString().slice(0, 10);
  if (from > to) throw new HttpError(400, 'Начало периода позже конца');
  return [from, to];
}
app.get('/api/admin/reports', need('admin'), h((req) => {
  const [from, to] = reportRange(req.query);
  const all = (sql, ...a) => db.prepare(sql).all(from, to, ...a);
  const one = (sql) => db.prepare(sql).get(from, to);
  const R = "o.date BETWEEN ? AND ?";
  const kpi = one(`SELECT
      COUNT(*) AS orders,
      SUM(status='done') AS done,
      SUM(status='cancelled') AS cancelled,
      COALESCE(SUM(CASE WHEN status='done' THEN total_price END),0) AS revenue,
      COALESCE(SUM(CASE WHEN status IN ('new','confirmed','in_progress') THEN total_price END),0) AS pipeline,
      COALESCE(SUM(CASE WHEN status!='cancelled' THEN end_min-start_min END),0) AS booked_min,
      COUNT(DISTINCT CASE WHEN status!='cancelled' THEN client_phone END) AS clients
    FROM orders o WHERE ${R}`);
  kpi.avg_check = kpi.done ? Math.round(kpi.revenue / kpi.done) : 0;
  // повторные клиенты: были заказы до начала периода
  kpi.repeat_clients = db.prepare(`SELECT COUNT(DISTINCT client_phone) AS n FROM orders o WHERE ${R} AND status!='cancelled'
    AND client_phone IN (SELECT client_phone FROM orders WHERE date < ? AND status!='cancelled')`).get(from, to, from).n;
  kpi.new_users = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='client' AND date(created_at, 'localtime') BETWEEN ? AND ?").get(from, to).n;
  kpi.leads = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE date(created_at) BETWEEN ? AND ?').get(from, to).n;
  // загрузка: занятые минуты / доступные (часы работы × боксы × рабочие дни)
  const s = getSettings();
  let workDays = 0;
  for (let t = Date.parse(from); t <= Date.parse(to); t += 864e5) if (!s.days_off.includes(new Date(t).getUTCDay())) workDays++;
  const capacityMin = workDays * (s.close_min - s.open_min) * s.capacity;
  kpi.load_pct = capacityMin ? Math.round((kpi.booked_min / capacityMin) * 100) : 0;

  return {
    from, to, kpi,
    by_day: all(`SELECT date,
        COALESCE(SUM(CASE WHEN status='done' THEN total_price END),0) AS revenue,
        SUM(status!='cancelled') AS orders
      FROM orders o WHERE ${R} GROUP BY date ORDER BY date`),
    services: all(`SELECT os.name, COUNT(*) AS n, SUM(os.price) AS sum FROM order_services os JOIN orders o ON o.id=os.order_id
      WHERE ${R} AND o.status!='cancelled' GROUP BY os.name ORDER BY n DESC, sum DESC LIMIT 10`),
    makes: all(`SELECT COALESCE(NULLIF(car_make,''), 'Не указана') AS name, COUNT(*) AS n FROM orders o
      WHERE ${R} AND status!='cancelled' GROUP BY 1 ORDER BY n DESC LIMIT 10`),
    statuses: all(`SELECT status, COUNT(*) AS n FROM orders o WHERE ${R} GROUP BY status`),
    workers: all(`SELECT COALESCE(w.name,'Не назначен') AS name, SUM(o.status='done') AS done, COUNT(*) AS n,
        COALESCE(SUM(CASE WHEN o.status='done' THEN o.total_price END),0) AS revenue
      FROM orders o LEFT JOIN users w ON w.id=o.worker_id WHERE ${R} AND o.status!='cancelled' GROUP BY o.worker_id ORDER BY revenue DESC`),
    weekdays: all(`SELECT CAST(strftime('%w', date) AS INTEGER) AS wd, COUNT(*) AS n FROM orders o WHERE ${R} AND status!='cancelled' GROUP BY wd`),
  };
}));
const STATUS_RU = { new: 'Новый', confirmed: 'Подтверждён', in_progress: 'В работе', done: 'Готово', cancelled: 'Отменён' };
app.get('/api/admin/reports.csv', need('admin'), (req, res, next) => {
  try {
    const [from, to] = reportRange(req.query);
    const rows = withServices(db.prepare(`${ORDER_SELECT} WHERE o.date BETWEEN ? AND ? ORDER BY o.date, o.start_min`).all(from, to));
    // защита от формул в Excel: значение, начинающееся с = + - @, экранируем апострофом
    const q = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const lines = [['№', 'Дата', 'Начало', 'Конец', 'Клиент', 'Телефон', 'Марка', 'Модель', 'Госномер', 'Кузов', 'Класс', 'Множитель', 'Услуги', 'Сумма', 'Статус', 'Мастер', 'Комментарий'].map(q).join(';')];
    for (const o of rows) lines.push([o.id, o.date, hhmm(o.start_min), hhmm(o.end_min), o.client_name, o.client_phone, o.car_make || o.car, o.car_model, o.plate, BODY_TYPES[o.car_body] || '', o.car_class, o.price_k,
      o.services.map((x) => x.name).join(', '), o.total_price, STATUS_RU[o.status], o.worker_name, o.comment].map(q).join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dna-orders-${from}_${to}.csv"`);
    res.send('\ufeff' + lines.join('\r\n'));
  } catch (e) { next(e); }
});

app.get('/api/admin/leads', need('admin'), h(() => db.prepare('SELECT * FROM leads ORDER BY done, id DESC LIMIT 500').all()));
app.patch('/api/admin/leads/:id', need('admin'), h((req) => { db.prepare('UPDATE leads SET done=? WHERE id=?').run(req.body.done ? 1 : 0, req.params.id); }));
app.delete('/api/admin/leads/:id', need('admin'), h((req) => { db.prepare('DELETE FROM leads WHERE id=?').run(req.params.id); }));

app.get('/api/admin/services', need('admin'), h(() => db.prepare('SELECT * FROM services ORDER BY sort,id').all()));
function serviceFields(b) {
  const name = str(b.name, 120);
  const duration = Math.round(Number(b.duration));
  const price = Math.round(Number(b.price) || 0);
  if (!name) throw new HttpError(400, 'Укажите название');
  if (!(duration >= 5 && duration <= 1440)) throw new HttpError(400, 'Длительность — от 5 до 1440 минут');
  if (price < 0) throw new HttpError(400, 'Некорректная цена');
  return [name, str(b.description, 300), duration, price, b.active === false || b.active === 0 ? 0 : 1, Math.round(Number(b.sort) || 0), b.scaled === false || b.scaled === 0 ? 0 : 1];
}
app.post('/api/admin/services', need('admin'), h((req) => {
  const r = db.prepare('INSERT INTO services(name,description,duration,price,active,sort,scaled) VALUES(?,?,?,?,?,?,?)').run(...serviceFields(req.body));
  return { id: Number(r.lastInsertRowid) };
}));
app.put('/api/admin/services/:id', need('admin'), h((req) => {
  db.prepare('UPDATE services SET name=?,description=?,duration=?,price=?,active=?,sort=?,scaled=? WHERE id=?').run(...serviceFields(req.body), req.params.id);
}));
app.delete('/api/admin/services/:id', need('admin'), h((req) => { db.prepare('DELETE FROM services WHERE id=?').run(req.params.id); }));

app.get('/api/admin/users', need('admin'), h(() => db.prepare(`SELECT u.id,u.name,u.phone,u.role,u.avatar,u.created_at,
    (SELECT GROUP_CONCAT(c.make || ' ' || c.model || CASE WHEN c.plate!='' THEN ' · ' || c.plate ELSE '' END, '\n') FROM cars c WHERE c.user_id=u.id) AS cars,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.status!='cancelled') AS orders
  FROM users u ORDER BY u.role, u.name`).all()));
app.put('/api/admin/users/:id/contact', need('admin'), h((req) => {
  const name = str(req.body.name, 80), phone = normPhone(req.body.phone);
  if (!name || !phone) throw new HttpError(400, 'Укажите имя и корректный телефон');
  if (db.prepare('SELECT 1 FROM users WHERE phone=? AND id!=?').get(phone, req.params.id)) throw new HttpError(400, 'Этот телефон уже у другого аккаунта');
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name, phone, req.params.id);
}));
app.delete('/api/admin/users/:id', need('admin'), h((req) => {
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'Нельзя удалить себя');
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id); // заказы остаются, отвязываются от аккаунта
}));
app.patch('/api/admin/users/:id', need('admin'), h((req) => {
  if (!['client', 'worker', 'admin'].includes(req.body.role)) throw new HttpError(400, 'Недопустимая роль');
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'Нельзя менять свою роль');
  db.prepare('UPDATE users SET role=? WHERE id=?').run(req.body.role, req.params.id);
}));

function multipliers(obj, allowed) {
  const out = {};
  for (const k of Object.keys(allowed)) {
    const v = Number(obj?.[k] ?? 1);
    if (!(v >= 0.1 && v <= 10)) throw new HttpError(400, `Множитель «${allowed[k]}» — от 0.1 до 10`);
    if (v !== 1) out[k] = Math.round(v * 100) / 100;
  }
  return out;
}
app.put('/api/admin/settings', need('admin'), h((req) => {
  const b = req.body;
  const num = (v, lo, hi) => { const n = Math.round(Number(v)); if (!(n >= lo && n <= hi)) throw new HttpError(400, 'Некорректное значение настроек'); return String(n); };
  const vals = {
    open_min: num(b.open_min, 0, 1439), close_min: num(b.close_min, 1, 1440), step_min: num(b.step_min, 5, 240),
    capacity: num(b.capacity, 1, 50), booking_days: num(b.booking_days, 1, 365),
    days_off: (Array.isArray(b.days_off) ? b.days_off : []).map(Number).filter((d) => d >= 0 && d <= 6).join(','),
    address: str(b.address, 200), phone: str(b.phone, 40),
    price_body: JSON.stringify(multipliers(b.price_body, BODY_TYPES)),
    price_class: JSON.stringify(multipliers(b.price_class, CAR_CLASSES)),
  };
  if (+vals.open_min >= +vals.close_min) throw new HttpError(400, 'Время открытия должно быть раньше закрытия');
  const up = db.prepare('UPDATE settings SET value=? WHERE key=?');
  tx(() => { for (const [k, v] of Object.entries(vals)) up.run(v, k); });
}));

// ---------- Telegram-бот: напоминания клиентам и уведомления админам ----------
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SITE_URL = process.env.SITE_URL || '';
let tgBot = '';
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const ruDate = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
async function tg(method, body) {
  if (!TG_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(65000),
    });
    const j = await r.json();
    if (!j.ok) console.error('telegram', method, j.description);
    return j.ok ? j.result : null;
  } catch (e) { console.error('telegram', method, e.message); return null; }
}
const tgSend = (chatId, text) => chatId && tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
const tgEsc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function notifyAdmins(text) {
  for (const a of db.prepare("SELECT tg_chat_id FROM users WHERE role='admin' AND tg_chat_id IS NOT NULL").all()) tgSend(a.tg_chat_id, text);
}
function orderText(o) {
  const sv = db.prepare('SELECT name FROM order_services WHERE order_id=?').all(o.id).map((x) => x.name).join(', ');
  return `📅 ${ruDate(o.date)}, ${hhmm(o.start_min)}–${hhmm(o.end_min)}\n🚗 ${tgEsc(o.car)}${o.plate ? ' · ' + o.plate : ''}\n🧽 ${tgEsc(sv)}`;
}
function notifyClient(orderId, kind) {
  const o = db.prepare('SELECT o.*, u.tg_chat_id FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?').get(orderId);
  if (!o?.tg_chat_id) return;
  const addr = getSettings().address;
  const msg = {
    confirmed: `✅ <b>Запись подтверждена</b>\n${orderText(o)}\n📍 ${tgEsc(addr)}`,
    done: `🎉 <b>Ваш автомобиль готов!</b>\n🚗 ${tgEsc(o.car)}\nБудем рады отзыву${SITE_URL ? ` в личном кабинете: ${SITE_URL}/#/my` : ' в личном кабинете на сайте'}`,
    cancelled: `❌ Запись отменена\n${orderText(o)}`,
    moved: `🔁 <b>Запись перенесена</b>\n${orderText(o)}\n📍 ${tgEsc(addr)}`,
    reminder: `⏰ <b>Напоминаем о записи в D.N.A. Detailing</b>\n${orderText(o)}\n📍 ${tgEsc(addr)}\n\nЕсли планы изменились — отмените запись в личном кабинете или напишите нам.`,
  }[kind];
  if (msg) tgSend(o.tg_chat_id, msg);
}
async function tgPoll() {
  let offset = 0;
  for (;;) {
    const ups = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
    if (!ups) { await new Promise((r) => setTimeout(r, 10000)); continue; }
    for (const u of ups) {
      offset = u.update_id + 1;
      const m = u.message;
      if (!m?.text) continue;
      const token = m.text.match(/^\/start\s+(\w+)/)?.[1];
      const user = token && db.prepare('SELECT * FROM users WHERE tg_token=?').get(token);
      if (user) {
        db.prepare('UPDATE users SET tg_chat_id=NULL WHERE tg_chat_id=?').run(m.chat.id);
        db.prepare('UPDATE users SET tg_chat_id=?, tg_token=NULL WHERE id=?').run(m.chat.id, user.id); // ссылка одноразовая
        tgSend(m.chat.id, user.role === 'admin'
          ? `Готово, ${tgEsc(user.name)}! Сюда будут приходить новые записи, заявки и отзывы.`
          : `Готово, ${tgEsc(user.name)}! Мы пришлём напоминание за день до визита и сообщим, когда авто будет готово.`);
      } else {
        tgSend(m.chat.id, `Здравствуйте! Это бот D.N.A. Detailing.\nЧтобы получать напоминания о записи, нажмите «Подключить Telegram» в личном кабинете на сайте${SITE_URL ? ': ' + SITE_URL : ''}.\n📲 Запись: ${tgEsc(getSettings().phone)}`);
      }
    }
  }
}
function sendReminders() {
  const today = todayStr();
  const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
  const now = nowMin();
  // все записи, до которых меньше суток; свежие (созданные < 2 ч назад) не беспокоим
  const due = db.prepare(`SELECT o.id FROM orders o JOIN users u ON u.id=o.user_id
    WHERE o.reminded=0 AND o.status IN ('new','confirmed') AND u.tg_chat_id IS NOT NULL
      AND o.created_at < datetime('now','-2 hours')
      AND ((o.date=? AND o.start_min>?) OR (o.date=? AND o.start_min<=?))`).all(today, now, tomorrow, now);
  for (const { id } of due) {
    db.prepare('UPDATE orders SET reminded=1 WHERE id=?').run(id);
    notifyClient(id, 'reminder');
  }
}
if (TG_TOKEN) {
  tg('getMe').then((me) => { if (me) { tgBot = me.username; console.log('Telegram-бот: @' + tgBot); tgPoll(); } });
  setInterval(sendReminders, 5 * 60e3);
}
app.get('/api/me/telegram', need(), h((req) => {
  if (!tgBot) return { enabled: false };
  let u = db.prepare('SELECT tg_token, tg_chat_id FROM users WHERE id=?').get(req.user.id);
  if (!u.tg_token) {
    const t = crypto.randomBytes(12).toString('hex');
    db.prepare('UPDATE users SET tg_token=? WHERE id=?').run(t, req.user.id);
    u = { ...u, tg_token: t };
  }
  return { enabled: true, linked: !!u.tg_chat_id, link: `https://t.me/${tgBot}?start=${u.tg_token}` };
}));
app.delete('/api/me/telegram', need(), h((req) => { db.prepare('UPDATE users SET tg_chat_id=NULL WHERE id=?').run(req.user.id); }));

// ---------- отзывы ----------
app.get('/api/reviews', h(() => db.prepare('SELECT id,name,car,text,rating,source,created_at FROM reviews WHERE approved=1 ORDER BY id DESC LIMIT 30').all()));
app.post('/api/reviews', need(), h((req) => {
  const o = db.prepare("SELECT * FROM orders WHERE id=? AND user_id=? AND status='done'").get(Number(req.body.order_id), req.user.id);
  if (!o) throw new HttpError(400, 'Отзыв можно оставить после выполненного заказа');
  if (db.prepare('SELECT 1 FROM reviews WHERE order_id=?').get(o.id)) throw new HttpError(400, 'Отзыв на этот заказ уже есть');
  const rating = Math.round(Number(req.body.rating));
  const text = str(req.body.text, 1500);
  if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Поставьте оценку от 1 до 5');
  if (text.length < 5) throw new HttpError(400, 'Напишите пару слов');
  db.prepare('INSERT INTO reviews(user_id,order_id,name,car,text,rating) VALUES(?,?,?,?,?,?)').run(req.user.id, o.id, req.user.name, o.car, text, rating);
  notifyAdmins(`⭐ <b>Новый отзыв (${rating}/5)</b> — ждёт одобрения\n${tgEsc(req.user.name)}, ${tgEsc(o.car)}\n«${tgEsc(text)}»`);
}));
app.get('/api/admin/reviews', need('admin'), h(() => db.prepare('SELECT * FROM reviews ORDER BY approved, id DESC').all()));
app.post('/api/admin/reviews', need('admin'), h((req) => {
  const name = str(req.body.name, 80), text = str(req.body.text, 1500);
  const rating = Math.round(Number(req.body.rating));
  if (!name || !text || !(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Заполните имя, текст и оценку 1–5');
  db.prepare('INSERT INTO reviews(name,car,text,rating,source,approved) VALUES(?,?,?,?,?,1)').run(name, str(req.body.car, 120), text, rating, str(req.body.source, 40));
}));
app.patch('/api/admin/reviews/:id', need('admin'), h((req) => { db.prepare('UPDATE reviews SET approved=? WHERE id=?').run(req.body.approved ? 1 : 0, req.params.id); }));
app.delete('/api/admin/reviews/:id', need('admin'), h((req) => { db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id); }));

// ---------- галерея «до/после» ----------
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const IMG_URL = /^\/uploads\/[a-f0-9]{24}\.(jpg|png|webp)$/;
const IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
app.post('/api/admin/upload', need('admin'), express.raw({ type: Object.keys(IMG_TYPES), limit: '10mb' }), h((req) => ({ url: saveImage(req) })));
app.get('/api/works', h(() => db.prepare('SELECT id,title,before_img,after_img FROM works ORDER BY sort, id DESC').all()));
app.post('/api/admin/works', need('admin'), h((req) => {
  const { before_img: b = '', after_img: a } = req.body;
  if (!IMG_URL.test(a || '') || (b && !IMG_URL.test(b))) throw new HttpError(400, 'Загрузите фото «после» (и по желанию «до»)');
  db.prepare('INSERT INTO works(title,before_img,after_img,sort) VALUES(?,?,?,?)').run(str(req.body.title, 120), b, a, Math.round(Number(req.body.sort) || 0));
}));
app.delete('/api/admin/works/:id', need('admin'), h((req) => {
  const w = db.prepare('SELECT * FROM works WHERE id=?').get(req.params.id);
  if (!w) return;
  [w.before_img, w.after_img].forEach(removeImage);
  db.prepare('DELETE FROM works WHERE id=?').run(w.id);
}));

// ---------- профиль и гараж ----------
function saveImage(req) {
  const ext = IMG_TYPES[req.headers['content-type']];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Нужна картинка JPG, PNG или WebP');
  // проверяем сигнатуру файла, а не только заявленный тип
  const b = req.body;
  const ok = (b[0] === 0xff && b[1] === 0xd8) || b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw new HttpError(400, 'Файл не похож на картинку');
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
  return '/uploads/' + name;
}
const removeImage = (u) => { if (IMG_URL.test(u || '')) fs.rmSync(path.join(UPLOAD_DIR, path.basename(u)), { force: true }); };
// незакреплённые заказы с этим госномером (например, созданные админом по звонку)
const unlinkedByPlate = (plate) => db.prepare('SELECT COUNT(*) AS n FROM orders WHERE plate=? AND user_id IS NULL').get(plate).n;

app.get('/api/me/profile', need(), h((req) => ({
  user: db.prepare('SELECT id,name,phone,role,avatar,created_at FROM users WHERE id=?').get(req.user.id),
  cars: db.prepare('SELECT * FROM cars WHERE user_id=? ORDER BY id').all(req.user.id),
  stats: db.prepare("SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN status='done' THEN total_price END),0) AS spent FROM orders WHERE user_id=? AND status!='cancelled'").get(req.user.id),
})));
app.patch('/api/me', need(), h((req) => {
  // телефон — это логин и ключ к истории заказов; без SMS-подтверждения его меняет только админ
  const name = str(req.body.name, 80);
  if (!name) throw new HttpError(400, 'Укажите имя');
  db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id);
}));
app.post('/api/me/avatar', need(), express.raw({ type: Object.keys(IMG_TYPES), limit: '5mb' }), h((req) => {
  const url = saveImage(req);
  removeImage(db.prepare('SELECT avatar FROM users WHERE id=?').get(req.user.id).avatar);
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(url, req.user.id);
  return { url };
}));
function carFields(b) {
  const make = str(b.make, 60);
  if (!make) throw new HttpError(400, 'Укажите марку');
  const year = b.year ? Math.round(Number(b.year)) : null;
  if (year !== null && !(year >= 1950 && year <= new Date().getFullYear() + 1)) throw new HttpError(400, 'Некорректный год');
  const model = str(b.model, 60);
  return [make, model, year, normPlate(b.plate), str(b.color, 30), str(b.vin, 17).toUpperCase(), str(b.note, 200),
    BODY_TYPES[b.body] ? b.body : '', lookupClass(make, model) || (CAR_CLASSES[b.car_class] ? b.car_class : '')];
}
function carSaved(userId, plate) {
  if (!plate) return {};
  const n = unlinkedByPlate(plate);
  if (n) {
    const u = db.prepare('SELECT name, phone FROM users WHERE id=?').get(userId);
    notifyAdmins(`🔗 <b>Совпадение по госномеру</b>\n${tgEsc(u.name)} ${u.phone} добавил(а) авто ${plate}.\nНайдено старых заказов без привязки: ${n}. Привязать: Админка → Пользователи.`);
  }
  return { matches: n };
}
app.post('/api/me/cars', need(), h((req) => {
  if (db.prepare('SELECT COUNT(*) AS n FROM cars WHERE user_id=?').get(req.user.id).n >= 10) throw new HttpError(400, 'Не больше 10 авто');
  const f = carFields(req.body);
  db.prepare('INSERT INTO cars(user_id,make,model,year,plate,color,vin,note,body,car_class) VALUES(?,?,?,?,?,?,?,?,?,?)').run(req.user.id, ...f);
  return carSaved(req.user.id, f[3]);
}));
app.put('/api/me/cars/:id', need(), h((req) => {
  const f = carFields(req.body);
  const r = db.prepare('UPDATE cars SET make=?,model=?,year=?,plate=?,color=?,vin=?,note=?,body=?,car_class=? WHERE id=? AND user_id=?').run(...f, req.params.id, req.user.id);
  if (!r.changes) throw new HttpError(404, 'Авто не найдено');
  return carSaved(req.user.id, f[3]);
}));
app.delete('/api/me/cars/:id', need(), h((req) => { db.prepare('DELETE FROM cars WHERE id=? AND user_id=?').run(req.params.id, req.user.id); }));

// админ: совпадения «авто в гараже ↔ старые заказы без привязки» по госномеру
app.get('/api/admin/matches', need('admin'), h(() => db.prepare(`
  SELECT 'plate' AS kind, c.user_id, u.name, u.phone, c.plate, c.make, c.model, COUNT(o.id) AS n,
    GROUP_CONCAT(o.date || ' ' || o.client_name || ' ' || o.client_phone, '; ') AS samples
  FROM cars c JOIN users u ON u.id=c.user_id JOIN orders o ON o.plate=c.plate AND o.user_id IS NULL
  WHERE c.plate!='' GROUP BY c.user_id, c.plate
  UNION ALL
  SELECT 'phone', u.id, u.name, u.phone, '', '', '', COUNT(o.id),
    GROUP_CONCAT(o.date || ' ' || o.client_name || ' ' || o.car, '; ')
  FROM users u JOIN orders o ON o.client_phone=u.phone AND o.user_id IS NULL
  GROUP BY u.id
  ORDER BY 8 DESC`).all()));
app.post('/api/admin/matches', need('admin'), h((req) => {
  const uid = Number(req.body.user_id);
  if (req.body.kind === 'phone') {
    const u = db.prepare('SELECT phone FROM users WHERE id=?').get(uid);
    if (!u) throw new HttpError(400, 'Клиент не найден');
    return { linked: db.prepare('UPDATE orders SET user_id=? WHERE client_phone=? AND user_id IS NULL').run(uid, u.phone).changes };
  }
  const plate = normPlate(req.body.plate);
  if (!plate || !db.prepare('SELECT 1 FROM cars WHERE user_id=? AND plate=?').get(uid, plate)) throw new HttpError(400, 'Нет такого авто у клиента');
  return { linked: db.prepare('UPDATE orders SET user_id=? WHERE plate=? AND user_id IS NULL').run(uid, plate).changes };
}));
app.get('/api/admin/users/:id/cars', need('admin'), h((req) => db.prepare('SELECT * FROM cars WHERE user_id=? ORDER BY id').all(req.params.id)));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Не найдено')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Ошибка сервера' : err.message });
});

app.listen(PORT, () => console.log(`D.N.A. Detailing: http://0.0.0.0:${PORT}`));
