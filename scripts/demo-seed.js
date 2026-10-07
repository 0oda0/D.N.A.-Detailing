'use strict';
// Демо-данные для показа клиенту: вымышленные клиенты, заказы за месяц, оплаты, расходы, отзывы.
// Запуск на ПУСТОЙ базе при работающем сервере:  node scripts/demo-seed.js
// Параметры: BASE_URL (http://localhost:3000), ADMIN_PHONE, ADMIN_PASSWORD, WORKER_CODE.
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN = { phone: process.env.ADMIN_PHONE || '+79990000000', password: process.env.ADMIN_PASSWORD || 'admin12345' };
const WORKER_CODE = process.env.WORKER_CODE || 'staff-code';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const day = (offset) => { const d = new Date(Date.now() + offset * 864e5); return d.toISOString().slice(0, 10); };

async function call(path, body, { cookie, method } = {}) {
  const r = await fetch(BASE + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${data.error || r.status}`);
  const sid = (r.headers.get('set-cookie') || '').match(/sid=([^;]+)/);
  return { data, cookie: sid ? `sid=${sid[1]}` : cookie };
}
const soft = (p) => p.catch((e) => console.log('  пропуск:', e.message));

(async () => {
  const { cookie: A } = await call('/api/login', ADMIN);
  const settings = (await call('/api/settings')).data;
  await call('/api/admin/settings', {
    ...settings, tg_contacts: 'studio_admin:Ольга, studio_master:Артём', tg_channel: 'https://t.me/autostudio_demo',
    prepay_from: 30000, prepay_pct: 30, cancel_hours: 12, onsite_capacity: 1,
  }, { cookie: A, method: 'PUT' });

  console.log('Мастера…');
  for (const [name, phone] of [['Артём Королёв', '+79990000101'], ['Сергей Белов', '+79990000102']]) {
    await soft(call('/api/register', { name, phone, password: 'master123', worker_code: WORKER_CODE }));
  }
  const users = (await call('/api/admin/users', null, { cookie: A })).data;
  const workers = users.filter((u) => u.role === 'worker');

  console.log('Клиенты с гаражом…');
  const clients = [
    ['Анна Смирнова', '+79990000201', { make: 'Toyota', model: 'Camry', year: 2021, plate: 'А123ВС777', body: 'sedan', color: 'белый' }],
    ['Игорь Петров', '+79990000202', { make: 'BMW', model: 'X5', year: 2020, plate: 'К456МН750', body: 'suv', color: 'чёрный' }],
    ['Мария Кузнецова', '+79990000203', { make: 'Kia', model: 'Sportage', year: 2022, plate: 'Е789ТР799', body: 'crossover', color: 'серый' }],
  ];
  const clientCookies = [];
  for (const [name, phone, car] of clients) {
    let r = await call('/api/register', { name, phone, password: 'client123' }).catch(() => call('/api/login', { phone, password: 'client123' }));
    clientCookies.push(r.cookie);
    await soft(call('/api/me/cars', car, { cookie: r.cookie }));
  }

  console.log('Заказы за месяц…');
  const services = (await call('/api/admin/services', null, { cookie: A })).data;
  const studio = services.filter((s) => !s.onsite && s.duration <= 360);
  const cars = [['Toyota', 'Camry', 'sedan'], ['BMW', 'X5', 'suv'], ['Kia', 'Rio', 'sedan'], ['Lada (ВАЗ)', 'Vesta', 'sedan'],
    ['Haval', 'Jolion', 'crossover'], ['Mercedes-Benz', 'E-Класс', 'sedan'], ['Chery', 'Tiggo 7 Pro', 'crossover'], ['Volkswagen', 'Tiguan', 'crossover']];
  const names = ['Дмитрий', 'Алексей', 'Елена', 'Павел', 'Ольга', 'Николай', 'Татьяна', 'Роман', 'Юлия', 'Виктор', 'Ксения', 'Андрей'];
  const created = [];
  for (let i = 0; i < 48; i++) {
    const off = Math.floor(rnd() * 37) - 29; // −29 … +7 дней
    const [make, model, body] = pick(cars);
    const svc = [pick(studio).id]; if (rnd() < 0.35) svc.push(pick(studio).id);
    const r = await soft(call('/api/admin/orders', {
      services: [...new Set(svc)], car_make: make, car_model: model, car_body: body, plate: rnd() < 0.5 ? pick(['М001ММ777', 'Т555ОР750', 'Х321АВ199']) : '',
      date: day(off), start_min: pick([540, 600, 660, 780, 900]), client_name: `${pick(names)} ${String.fromCharCode(1040 + Math.floor(rnd() * 20))}.`,
      client_phone: `+7999${String(1000000 + Math.floor(rnd() * 8999999))}`, force: true,
    }, { cookie: A }));
    if (r) created.push({ id: r.data.id, off, total: r.data.total });
  }
  for (const o of created) {
    const patch = (b) => soft(call(`/api/staff/orders/${o.id}`, b, { cookie: A, method: 'PATCH' }));
    await patch({ worker_id: pick(workers)?.id || null });
    if (o.off < 0) {
      const status = rnd() < 0.12 ? 'cancelled' : 'done';
      if (status === 'done' && rnd() < 0.2) await patch({ discount: '10%', discount_note: 'постоянный клиент' });
      await patch({ status });
      if (status === 'done' && rnd() < 0.9) await soft(call(`/api/admin/orders/${o.id}/payments`, { amount: o.total, method: pick(['card', 'card', 'cash', 'transfer']) }, { cookie: A }));
    } else if (o.off === 0) await patch({ status: 'in_progress' });
  }

  console.log('Старые визиты для «Повторов»…');
  const anti = services.find((s) => s.name === 'Антидождь'), cer = services.find((s) => s.name === 'Нанесение керамики');
  for (const [s, off, n] of [[anti, -70, 'Константин Л.'], [anti, -66, 'Светлана Р.'], [cer, -185, 'Михаил Д.']]) {
    if (!s) continue;
    const r = await soft(call('/api/admin/orders', { services: [s.id], car_make: 'Skoda', car_model: 'Octavia', date: day(off), start_min: 600,
      client_name: n, client_phone: `+7999${String(2000000 + Math.floor(rnd() * 7999999))}`, force: true }, { cookie: A }));
    if (r) await soft(call(`/api/staff/orders/${r.data.id}`, { status: 'done' }, { cookie: A, method: 'PATCH' }));
  }

  console.log('Совпадение по госномеру…');
  await soft(call('/api/admin/orders', { services: [studio[0].id], car_make: 'BMW', car_model: 'X5', plate: 'К456МН750', date: day(-40), start_min: 600,
    client_name: 'Игорь (звонок)', client_phone: '+79990000999', force: true }, { cookie: A }));

  console.log('Онлайн-записи клиентов и выезд…');
  const mebel = services.find((s) => s.onsite);
  await soft(call('/api/orders', { services: [pick(studio).id], car_make: 'Toyota', car_model: 'Camry', car_body: 'sedan', plate: 'А123ВС777', date: day(3), start_min: 600 }, { cookie: clientCookies[0] }));
  if (mebel) await soft(call('/api/orders/guest', { name: 'Наталья', phone: '+79990000301', consent: true, services: [mebel.id], address: 'ул. Садовая, 12, кв. 5', date: day(2), start_min: 660 }));

  console.log('Расходы, промокоды, заявки, отзывы…');
  for (const [cat, sum, off, note] of [['Аренда', 90000, -25, 'бокс, октябрь'], ['Химия и материалы', 38500, -20, 'полироли, керамика'], ['Зарплата', 120000, -3, 'аванс мастерам'],
    ['Реклама', 25000, -15, 'Авито + Яндекс Карты'], ['Коммунальные', 12000, -10, ''], ['Химия и материалы', 14200, -6, 'плёнка, 2 рулона']]) {
    await soft(call('/api/admin/expenses', { date: day(off), category: cat, amount: sum, note }, { cookie: A }));
  }
  await soft(call('/api/admin/promos', { code: 'AVITO10', kind: 'pct', value: 10, note: 'Авито' }, { cookie: A }));
  await soft(call('/api/admin/promos', { code: 'FIRST1000', kind: 'rub', value: 1000, min_total: 5000, max_uses: 100, note: 'первый визит' }, { cookie: A }));
  await soft(call('/api/orders/guest', { name: 'Вера', phone: '+79990000302', consent: true, services: [studio[1].id], car_make: 'Kia', car_model: 'Rio', date: day(4), start_min: 780, promo: 'AVITO10' }));
  for (const [name, phone, message] of [['Олег', '+79990000401', 'Камри, нужна керамика — сколько?'], ['Ирина', '+79990000402', 'Химчистка дивана на выезде'], ['Глеб', '+79990000403', '']]) {
    await soft(call('/api/leads', { name, phone, message }));
  }
  for (const [name, car, rating, text, source] of [
    ['Андрей', 'BMW X5', 5, 'Сделали полировку и керамику, машина как из салона. Записался онлайн за минуту, всё точно по времени.', 'Яндекс Карты'],
    ['Елена', 'Kia Sportage', 5, 'Химчистка салона — запахов нет, сиденья как новые. Напомнили в Telegram за день, удобно.', ''],
    ['Павел', 'Toyota Camry', 4, 'Бронь плёнкой зон риска, аккуратно и в срок. Минус — пришлось подождать с выдачей 20 минут.', 'Авито'],
  ]) await soft(call('/api/admin/reviews', { name, car, rating, text, source }, { cookie: A }));

  console.log('Выходной мастеру…');
  if (workers[1]) await soft(call(`/api/admin/workers/${workers[1].id}/off`, { from: day(5), to: day(8) }, { cookie: A }));
  console.log('Готово: демо-данные загружены.');
})().catch((e) => { console.error(e.message); process.exit(1); });
