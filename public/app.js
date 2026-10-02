'use strict';
const $app = document.getElementById('app');
let me = null;
let settings = null;
let services = [];

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const dur = (m) => { const h = Math.floor(m / 60), r = m % 60; return [h && `${h} ч`, r && `${r} мин`].filter(Boolean).join(' ') || '0 мин'; };
const rub = (n) => Number(n).toLocaleString('ru-RU') + ' ₽';
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
const isoDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const today = () => isoDate(new Date());
const STATUS = { new: 'Новый', confirmed: 'Подтверждён', in_progress: 'В работе', done: 'Готово', cancelled: 'Отменён' };
const ROLE = { client: 'Клиент', worker: 'Мастер', admin: 'Админ' };
const TG = [['brorussian8', 'Даниил'], ['nikilovs', 'Никита']];
const TG_CHANNEL = 'https://t.me/DNADetailing';
const tel = () => esc(settings.phone.replace(/[^\d+]/g, ''));
const badge = (s) => `<span class="badge st-${s}">${STATUS[s]}</span>`;

async function api(url, body, method) {
  const opt = { method: method || (body ? 'POST' : 'GET'), headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}
let toastT;
function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = ''), 3000);
}
const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ---------- layout ----------
function renderNav() {
  const r = location.hash.split('?')[0] || '#/';
  const links = [['#/', 'Главная'], ['#/book', 'Записаться']];
  if (me) {
    links.push(['#/my', 'Мои заказы']);
    if (me.role === 'worker' || me.role === 'admin') links.push(['#/staff', 'Работы']);
    if (me.role === 'admin') links.push(['#/admin', 'Админка']);
  } else links.push(['#/login', 'Вход'], ['#/register', 'Регистрация']);
  document.getElementById('nav').innerHTML =
    links.map(([h, t]) => `<a href="${h}" class="${r === h ? 'active' : ''}">${t}</a>`).join('') +
    (me ? `<button id="logout" title="${esc(me.phone)}">Выйти (${esc(me.name)})</button>` : '');
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = async () => { await api('/api/logout', {}); me = null; location.hash = '#/'; route(); };
  document.getElementById('foot-contacts').innerHTML = settings
    ? `<a href="tel:${tel()}">${esc(settings.phone)}</a> · ${TG.map(([u]) => `<a href="https://t.me/${u}" target="_blank" rel="noopener">@${u}</a>`).join(' · ')} · <a href="${TG_CHANNEL}" target="_blank" rel="noopener">Канал</a><br>${esc(settings.address)} · ${hm(settings.open_min)}–${hm(settings.close_min)}`
    : '';
}

// ---------- pages ----------
const pages = {};

pages['/'] = () => {
  $app.innerHTML = `
  <section class="hero">
    <h1>D.N.A.<span>DETAILING</span></h1>
    <p>Чистота в деталях • Совершенство в результате</p>
    <div class="lead">Новый детейлинг-центр в Балашихе на ул. Свердлова. Наводим идеальный лоск, защищаем кузов от сколов и возвращаем салону вид нового авто.</div>
    <div class="row">
      <a class="btn" href="#/book">Записаться онлайн</a>
      <a class="btn ghost" href="https://t.me/${TG[0][0]}" target="_blank" rel="noopener">Написать в Telegram</a>
      <a class="btn ghost" href="tel:${tel()}">${esc(settings.phone)}</a>
    </div>
  </section>
  <h2>Услуги</h2>
  <div class="grid">${services.map((s) => `
    <div class="card">
      <h3>${esc(s.name)}</h3>
      <div class="muted">${esc(s.description)}</div>
      <p><span class="price">от ${rub(s.price)}</span> · <span class="muted">${dur(s.duration)}</span></p>
      <a class="btn small" href="#/book?s=${s.id}">Записаться</a>
    </div>`).join('')}
  </div>
  <div class="banner">
    <div><h2>Выездные работы</h2><div>Нет времени ехать к нам? Почистим салон или мебель прямо у вас дома или в гараже.</div></div>
    <a class="btn ghost" href="tel:${tel()}">${esc(settings.phone)}</a>
  </div>
  <h2 style="margin-top:32px">Контакты</h2>
  <div class="grid">
    <div class="card"><h3>📍 Адрес</h3><div>${esc(settings.address)}</div>
      <p class="muted">Ежедневно ${hm(settings.open_min)}–${hm(settings.close_min)}</p>
      <a class="btn small ghost" href="https://yandex.ru/maps/?text=${encodeURIComponent(settings.address)}" target="_blank" rel="noopener">Открыть на карте</a></div>
    <div class="card"><h3>📲 Запись и расчёт стоимости</h3>
      ${TG.map(([u, n]) => `<div>Telegram <a href="https://t.me/${u}" target="_blank" rel="noopener">@${u}</a> (${n})</div>`).join('')}
      <div style="margin-top:6px">Телефон <a href="tel:${tel()}">${esc(settings.phone)}</a></div></div>
    <div class="card"><h3>📣 Наш канал</h3><div class="muted">Работы, акции и новости</div>
      <a class="btn small" style="margin-top:10px" href="${TG_CHANNEL}" target="_blank" rel="noopener">t.me/DNADetailing</a></div>
  </div>`;
};

// Компонент записи: услуги → авто → дата → свободное время. Используется клиентом и админом.
const draft = { services: [], car: '', date: '', start: null, comment: '' };
function bookingForm(container, { admin, onDone }) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (params.get('s') && !draft.services.length) draft.services = [Number(params.get('s'))];
  if (!draft.date) draft.date = today();
  let users = [];

  container.innerHTML = `
  <div class="two">
    <div class="steps">
      ${admin ? `<div class="card"><h3>Клиент</h3>
        <label>Найти зарегистрированного (имя или телефон)</label>
        <input id="b-user" list="b-users" placeholder="Начните вводить…"><datalist id="b-users"></datalist>
        <div class="muted" style="margin-top:6px">или новый клиент:</div>
        <label>Имя</label><input id="b-cname">
        <label>Телефон</label><input id="b-cphone" type="tel" placeholder="+7…"></div>` : ''}
      <div class="card"><h3>1. Что сделать</h3><div class="grid" id="b-services"></div></div>
      <div class="card"><h3>2. Автомобиль</h3>
        <label>Марка, модель, цвет, госномер</label>
        <input id="b-car" maxlength="120" placeholder="BMW X3, чёрный, А123АА777" value="${esc(draft.car)}"></div>
      <div class="card"><h3>3. Дата и время</h3>
        <label>Дата</label><input id="b-date" type="date" value="${draft.date}" ${admin ? '' : `min="${today()}"`}>
        <label>Свободное время</label><div class="slots" id="b-slots"></div>
        ${admin ? `<label>Или любое время вручную (без проверки занятости)</label><input id="b-manual" type="time" step="300">` : ''}
        <label>Комментарий</label><textarea id="b-comment" maxlength="1000">${esc(draft.comment)}</textarea></div>
    </div>
    <div class="card summary">
      <h3>Ваш заказ</h3><div id="b-sum"></div>
      <button class="btn" id="b-submit" style="width:100%;margin-top:14px">${admin ? 'Создать заказ' : 'Записаться'}</button>
      <div class="err" id="b-err"></div>
    </div>
  </div>`;
  const q = (id) => container.querySelector('#' + id);

  if (admin) {
    api('/api/admin/users').then((u) => {
      users = u;
      q('b-users').innerHTML = u.map((x) => `<option value="${esc(x.name)} ${esc(x.phone)}">`).join('');
    });
  }

  function renderServices() {
    q('b-services').innerHTML = services.map((s) => `
      <label class="check ${draft.services.includes(s.id) ? 'on' : ''}">
        <input type="checkbox" value="${s.id}" ${draft.services.includes(s.id) ? 'checked' : ''}>
        <span><b>${esc(s.name)}</b><br><span class="muted">${dur(s.duration)} · от ${rub(s.price)}</span></span>
      </label>`).join('');
    q('b-services').querySelectorAll('input').forEach((i) => (i.onchange = () => {
      const id = Number(i.value);
      draft.services = i.checked ? [...draft.services, id] : draft.services.filter((x) => x !== id);
      draft.start = null;
      renderServices(); loadSlots();
    }));
  }
  function summary() {
    const sel = services.filter((s) => draft.services.includes(s.id));
    const total = sel.reduce((a, s) => a + s.duration, 0);
    q('b-sum').innerHTML = sel.length ? `
      ${sel.map((s) => `<div>${esc(s.name)}</div>`).join('')}
      <p class="muted">Длительность: <b>${dur(total)}</b><br>Стоимость: <b class="price">от ${rub(sel.reduce((a, s) => a + s.price, 0))}</b></p>
      ${draft.start != null ? `<p>📅 ${fmtDate(draft.date)}<br>🕒 ${hm(draft.start)} – ${hm(draft.start + total)}</p>` : '<p class="muted">Выберите время</p>'}`
      : '<p class="muted">Выберите услуги</p>';
  }
  let slotReq = 0;
  async function loadSlots() {
    summary();
    const box = q('b-slots');
    if (!draft.services.length) { box.innerHTML = '<span class="muted">Сначала выберите услуги</span>'; return; }
    if (!draft.date) { box.innerHTML = '<span class="muted">Выберите дату</span>'; return; }
    box.innerHTML = '<span class="muted">Загрузка…</span>';
    const my = ++slotReq;
    try {
      const r = await api(`/api/slots?date=${draft.date}&services=${draft.services.join(',')}`);
      if (my !== slotReq) return;
      if (r.tooLong) { box.innerHTML = `<span class="muted">Работы занимают ${dur(r.duration)} — больше рабочего дня. Позвоните нам, согласуем несколько дней.</span>`; return; }
      if (!r.slots.length) { box.innerHTML = '<span class="muted">На эту дату свободного времени нет — выберите другой день</span>'; return; }
      if (!r.slots.includes(draft.start)) draft.start = null;
      box.innerHTML = r.slots.map((t) => `<button type="button" class="slot ${t === draft.start ? 'on' : ''}" data-t="${t}">${hm(t)}</button>`).join('');
      box.querySelectorAll('.slot').forEach((b) => (b.onclick = () => {
        draft.start = Number(b.dataset.t);
        if (q('b-manual')) q('b-manual').value = '';
        box.querySelectorAll('.slot').forEach((x) => x.classList.toggle('on', x === b));
        summary();
      }));
    } catch (e) { box.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
    summary();
  }

  q('b-car').oninput = (e) => (draft.car = e.target.value);
  q('b-comment').oninput = (e) => (draft.comment = e.target.value);
  q('b-date').onchange = (e) => { draft.date = e.target.value; draft.start = null; loadSlots(); };
  if (q('b-manual')) q('b-manual').onchange = (e) => {
    draft.start = e.target.value ? toMin(e.target.value) : null;
    q('b-slots').querySelectorAll('.slot').forEach((x) => x.classList.remove('on'));
    summary();
  };

  q('b-submit').onclick = async () => {
    const err = q('b-err'); err.textContent = '';
    if (!draft.services.length) return (err.textContent = 'Выберите услуги');
    if (!draft.car.trim()) return (err.textContent = 'Укажите автомобиль');
    if (draft.start == null) return (err.textContent = 'Выберите время');
    if (!admin && !me) { toast('Войдите или зарегистрируйтесь — заказ сохранится'); location.hash = '#/login?next=book'; return; }
    const body = { services: draft.services, car: draft.car, date: draft.date, start_min: draft.start, comment: draft.comment };
    if (admin) {
      const typed = q('b-user').value.trim();
      const u = typed && users.find((x) => `${x.name} ${x.phone}` === typed);
      if (u) body.user_id = u.id;
      else { body.client_name = q('b-cname').value; body.client_phone = q('b-cphone').value; }
      body.force = q('b-manual') && q('b-manual').value ? true : undefined;
    }
    q('b-submit').disabled = true;
    try {
      await api(admin ? '/api/admin/orders' : '/api/orders', body);
      Object.assign(draft, { services: [], car: '', start: null, comment: '' });
      onDone();
    } catch (e) { err.textContent = e.message; loadSlots(); }
    finally { q('b-submit').disabled = false; }
  };

  renderServices(); loadSlots();
}

pages['/book'] = () => {
  $app.innerHTML = '<h1>Онлайн-запись</h1><p class="muted">Показываем только свободное время с учётом длительности выбранных работ.</p><div id="bk"></div>';
  bookingForm(document.getElementById('bk'), { admin: false, onDone: () => { toast('Вы записаны! Мы свяжемся для подтверждения.'); location.hash = '#/my'; } });
};

function authPage(isReg) {
  const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next');
  $app.innerHTML = `
  <form class="card form" id="f">
    <h2>${isReg ? 'Регистрация' : 'Вход'}</h2>
    ${isReg ? '<label>Имя</label><input name="name" required maxlength="80" autocomplete="name">' : ''}
    <label>Телефон</label><input name="phone" type="tel" required placeholder="+7 900 000-00-00" autocomplete="tel">
    <label>Пароль</label><input name="password" type="password" required minlength="${isReg ? 6 : 1}" autocomplete="${isReg ? 'new-password' : 'current-password'}">
    ${isReg ? `<details style="margin-top:12px"><summary class="muted">Я сотрудник</summary>
      <label>Код сотрудника (выдаёт администратор)</label><input name="worker_code" autocomplete="off"></details>` : ''}
    <button class="btn" style="width:100%;margin-top:16px">${isReg ? 'Зарегистрироваться' : 'Войти'}</button>
    <div class="err" id="err"></div>
    <p class="muted">${isReg ? 'Уже есть аккаунт? <a href="#/login' : 'Нет аккаунта? <a href="#/register'}${next ? '?next=' + next : ''}">${isReg ? 'Войти' : 'Зарегистрироваться'}</a></p>
  </form>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (!d.worker_code) delete d.worker_code;
    try {
      me = await api(isReg ? '/api/register' : '/api/login', d);
      location.hash = next ? '#/' + next : me.role === 'admin' ? '#/admin' : me.role === 'worker' ? '#/staff' : '#/my';
    } catch (er) { document.getElementById('err').textContent = er.message; }
  };
}
pages['/login'] = () => authPage(false);
pages['/register'] = () => authPage(true);

function orderLine(o) {
  return `<div class="order">
    <div><b>${fmtDate(o.date)}, ${hm(o.start_min)}–${hm(o.end_min)}</b> ${badge(o.status)}</div>
    <div>🚗 ${esc(o.car)}</div>
    <div class="muted">${o.services.map((s) => esc(s.name)).join(', ')} · от ${rub(o.total_price)}</div>
    ${o.comment ? `<div class="muted">💬 ${esc(o.comment)}</div>` : ''}
  </div>`;
}

pages['/my'] = async () => {
  if (!me) return (location.hash = '#/login?next=my');
  const orders = await api('/api/orders/my');
  $app.innerHTML = `<h1>Мои заказы</h1>
    <p><a class="btn" href="#/book">+ Новая запись</a></p>
    <div class="steps">${orders.length ? orders.map((o) => `<div class="card">${orderLine(o)}
      ${['new', 'confirmed'].includes(o.status) ? `<button class="btn small ghost" data-cancel="${o.id}" style="margin-top:10px">Отменить</button>` : ''}</div>`).join('')
      : '<div class="empty">Заказов пока нет</div>'}</div>
    <details class="card" style="margin-top:24px"><summary>Сменить пароль</summary>
      <form id="pw" class="form" style="margin:0"><label>Старый пароль</label><input name="old" type="password" required>
      <label>Новый пароль</label><input name="password" type="password" minlength="6" required>
      <button class="btn small" style="margin-top:10px">Сохранить</button></form></details>`;
  $app.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Отменить запись?')) return;
    try { await api(`/api/orders/${b.dataset.cancel}/cancel`, {}); toast('Запись отменена'); route(); } catch (e) { toast(e.message, 1); }
  }));
  document.getElementById('pw').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/me/password', formData(e.target)); toast('Пароль изменён'); e.target.reset(); } catch (er) { toast(er.message, 1); }
  };
};

// Список заказов для мастера/админа
async function ordersBoard(container, { admin }) {
  const st = ordersBoard.state ||= { from: today(), to: isoDate(new Date(Date.now() + 6 * 864e5)), mine: false };
  container.innerHTML = `
    <div class="toolbar">
      <div><label>С</label><input type="date" id="o-from" value="${st.from}"></div>
      <div><label>По</label><input type="date" id="o-to" value="${st.to}"></div>
      ${admin ? '' : `<label class="check" style="align-self:end"><input type="checkbox" id="o-mine" ${st.mine ? 'checked' : ''}> Только мои</label>`}
    </div><div id="o-list" class="table"></div>`;
  const reload = async () => {
    const [orders, users] = await Promise.all([
      api(`/api/staff/orders?from=${st.from}&to=${st.to}${st.mine ? '&mine=1' : ''}`),
      admin ? api('/api/admin/users') : Promise.resolve([]),
    ]);
    const workers = users.filter((u) => u.role !== 'client');
    const list = container.querySelector('#o-list');
    if (!orders.length) { list.innerHTML = '<div class="empty">Нет заказов за период</div>'; return; }
    list.innerHTML = `<table><thead><tr><th>Когда</th><th>Клиент / авто</th><th>Работы</th><th>Статус</th><th>Мастер</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>
      ${orders.map((o) => `<tr>
        <td><b>${fmtDate(o.date)}</b><br>${hm(o.start_min)}–${hm(o.end_min)}</td>
        <td>${esc(o.client_name)}<br><a href="tel:${esc(o.client_phone)}">${esc(o.client_phone)}</a><br>🚗 ${esc(o.car)}${o.comment ? `<br><span class="muted">💬 ${esc(o.comment)}</span>` : ''}</td>
        <td>${o.services.map((s) => esc(s.name)).join('<br>')}<br><span class="price">${rub(o.total_price)}</span></td>
        <td>${admin
          ? `<select data-status="${o.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select>`
          : `${badge(o.status)}<br>${o.status === 'new' || o.status === 'confirmed' ? `<button class="btn small" data-set="${o.id}" data-v="in_progress">Начать</button>` : ''}
             ${o.status === 'in_progress' ? `<button class="btn small" data-set="${o.id}" data-v="done">Готово</button>` : ''}`}</td>
        <td>${admin
          ? `<select data-worker="${o.id}"><option value="">—</option>${workers.map((w) => `<option value="${w.id}" ${w.id === o.worker_id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>`
          : o.worker_name ? esc(o.worker_name) : `<button class="btn small ghost" data-take="${o.id}">Взять</button>`}</td>
        ${admin ? `<td><button class="btn small ghost" data-move="${o.id}" data-date="${o.date}" data-start="${o.start_min}">Перенести</button>
          <button class="btn small danger" data-del="${o.id}">×</button></td>` : ''}
      </tr>`).join('')}</tbody></table>`;
    const patch = async (id, body) => { try { await api(`/api/staff/orders/${id}`, body, 'PATCH'); toast('Сохранено'); } catch (e) { toast(e.message, 1); } reload(); };
    list.querySelectorAll('[data-status]').forEach((s) => (s.onchange = () => patch(s.dataset.status, { status: s.value })));
    list.querySelectorAll('[data-worker]').forEach((s) => (s.onchange = () => patch(s.dataset.worker, { worker_id: s.value || null })));
    list.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => patch(b.dataset.set, { status: b.dataset.v })));
    list.querySelectorAll('[data-take]').forEach((b) => (b.onclick = () => patch(b.dataset.take, { take: true })));
    list.querySelectorAll('[data-move]').forEach((b) => (b.onclick = async () => {
      const date = prompt('Новая дата (ГГГГ-ММ-ДД)', b.dataset.date); if (!date) return;
      const time = prompt('Новое время начала (ЧЧ:ММ)', hm(Number(b.dataset.start))); if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return;
      patch(b.dataset.move, { date, start_min: toMin(time) });
    }));
    list.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Удалить заказ безвозвратно?')) return;
      try { await api(`/api/admin/orders/${b.dataset.del}`, undefined, 'DELETE'); } catch (e) { toast(e.message, 1); }
      reload();
    }));
  };
  container.querySelector('#o-from').onchange = (e) => { st.from = e.target.value; if (st.to < st.from) st.to = st.from; reload(); };
  container.querySelector('#o-to').onchange = (e) => { st.to = e.target.value; reload(); };
  if (!admin) container.querySelector('#o-mine').onchange = (e) => { st.mine = e.target.checked; reload(); };
  await reload();
}

pages['/staff'] = async () => {
  if (!me || me.role === 'client') return (location.hash = '#/login');
  $app.innerHTML = '<h1>Работы</h1><div id="board"></div>';
  await ordersBoard(document.getElementById('board'), { admin: false });
};

// ---------- admin ----------
const adminTabs = {
  orders: ['Заказы', (c) => ordersBoard(c, { admin: true })],
  create: ['+ Новый заказ', (c) => bookingForm(c, { admin: true, onDone: () => { toast('Заказ создан'); location.hash = '#/admin?tab=orders'; } })],
  services: ['Услуги', adminServices],
  users: ['Пользователи', adminUsers],
  settings: ['Настройки', adminSettings],
};
pages['/admin'] = async () => {
  if (!me || me.role !== 'admin') return (location.hash = '#/login');
  const tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'orders';
  $app.innerHTML = `<h1>Админ-панель</h1><div class="tabs">${Object.entries(adminTabs).map(([k, [t]]) =>
    `<button class="${k === tab ? 'on' : ''}" onclick="location.hash='#/admin?tab=${k}'">${t}</button>`).join('')}</div><div id="tab"></div>`;
  await (adminTabs[tab] || adminTabs.orders)[1](document.getElementById('tab'));
};

async function adminServices(c) {
  const list = await api('/api/admin/services');
  const row = (s = {}) => `<tr data-id="${s.id || ''}">
    <td><input name="name" value="${esc(s.name)}" placeholder="Название"><input name="description" value="${esc(s.description)}" placeholder="Описание" style="margin-top:4px"></td>
    <td><input name="duration" type="number" min="5" step="5" value="${s.duration ?? 60}" style="min-width:80px"></td>
    <td><input name="price" type="number" min="0" step="100" value="${s.price ?? 0}" style="min-width:90px"></td>
    <td><input name="sort" type="number" value="${s.sort ?? 0}" style="min-width:60px"></td>
    <td><select name="active"><option value="1" ${s.active !== 0 ? 'selected' : ''}>Да</option><option value="0" ${s.active === 0 ? 'selected' : ''}>Скрыта</option></select></td>
    <td><button class="btn small" data-save>${s.id ? 'Сохранить' : 'Добавить'}</button> ${s.id ? '<button class="btn small danger" data-del>×</button>' : ''}</td></tr>`;
  c.innerHTML = `<p class="muted">Длительность в минутах — по ней считается свободное время. Скрытые услуги не видны клиентам.</p>
    <div class="table"><table><thead><tr><th>Услуга</th><th>Мин</th><th>Цена от, ₽</th><th>Порядок</th><th>Видна</th><th></th></tr></thead>
    <tbody>${list.map(row).join('')}${row()}</tbody></table></div>`;
  c.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector('[data-save]').onclick = async () => {
      const b = {}; tr.querySelectorAll('[name]').forEach((i) => (b[i.name] = i.value));
      b.active = b.active === '1';
      try {
        await api(id ? `/api/admin/services/${id}` : '/api/admin/services', b, id ? 'PUT' : 'POST');
        toast('Сохранено'); await refreshServices(); adminServices(c);
      } catch (e) { toast(e.message, 1); }
    };
    const del = tr.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!confirm('Удалить услугу? (в старых заказах она останется)')) return;
      await api(`/api/admin/services/${id}`, undefined, 'DELETE'); await refreshServices(); adminServices(c);
    };
  });
}

async function adminUsers(c) {
  const users = await api('/api/admin/users');
  c.innerHTML = `<p class="muted">Мастер может зарегистрироваться сам с кодом сотрудника или вы можете повысить клиента здесь.</p>
    <div class="table"><table><thead><tr><th>Имя</th><th>Телефон</th><th>Роль</th><th>Создан</th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${esc(u.name)}</td><td><a href="tel:${esc(u.phone)}">${esc(u.phone)}</a></td>
      <td>${u.id === me.id ? ROLE[u.role] : `<select data-u="${u.id}">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}</select>`}</td>
      <td class="muted">${esc(u.created_at.slice(0, 10))}</td></tr>`).join('')}</tbody></table></div>`;
  c.querySelectorAll('[data-u]').forEach((s) => (s.onchange = async () => {
    try { await api(`/api/admin/users/${s.dataset.u}`, { role: s.value }, 'PATCH'); toast('Роль изменена'); } catch (e) { toast(e.message, 1); adminUsers(c); }
  }));
}

async function adminSettings(c) {
  const s = await api('/api/settings');
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  c.innerHTML = `<form class="card form" id="sf" style="margin:0">
    <label>Открытие</label><input name="open" type="time" value="${hm(s.open_min)}" required>
    <label>Закрытие</label><input name="close" type="time" value="${hm(s.close_min)}" required>
    <label>Шаг сетки записи, мин</label><input name="step_min" type="number" min="5" max="240" value="${s.step_min}">
    <label>Сколько машин одновременно (боксы / мастера)</label><input name="capacity" type="number" min="1" max="50" value="${s.capacity}">
    <label>На сколько дней вперёд можно записаться</label><input name="booking_days" type="number" min="1" max="365" value="${s.booking_days}">
    <label>Выходные дни</label><div class="slots">${days.map((d, i) => `<label class="check"><input type="checkbox" name="off" value="${i}" ${s.days_off.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
    <label>Телефон</label><input name="phone" value="${esc(s.phone)}">
    <label>Адрес</label><input name="address" value="${esc(s.address)}">
    <button class="btn" style="margin-top:16px">Сохранить</button></form>`;
  c.querySelector('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, d = formData(f);
    try {
      await api('/api/admin/settings', {
        open_min: toMin(d.open), close_min: d.close === '00:00' ? 1440 : toMin(d.close), step_min: d.step_min, capacity: d.capacity,
        booking_days: d.booking_days, days_off: [...f.querySelectorAll('[name=off]:checked')].map((i) => i.value), phone: d.phone, address: d.address,
      }, 'PUT');
      settings = await api('/api/settings'); renderNav(); toast('Настройки сохранены');
    } catch (er) { toast(er.message, 1); }
  };
}

// ---------- router ----------
async function refreshServices() { services = await api('/api/services'); }
async function route() {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  renderNav();
  try { await (pages[path] || pages['/'])(); } catch (e) { $app.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
(async () => {
  [me, settings] = await Promise.all([api('/api/me'), api('/api/settings')]);
  await refreshServices();
  route();
})();
