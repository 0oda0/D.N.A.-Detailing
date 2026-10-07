'use strict';
const $app = document.getElementById('app');
let me = null;
let settings = null;
let services = [];

// ---------- цена по кузову и классу ----------
const kFor = (body, cls) => (settings.price_body?.[body] || 1) * (settings.price_class?.[cls] || 1);
const svcPrice = (s, k) => (s.scaled ? Math.round((s.price * k) / 100) * 100 : s.price);
const opts = (map, val, empty) => `<option value="">${empty}</option>` + Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${esc(v)}</option>`).join('');
const bodySelect = (attrs, val) => `<select ${attrs}>${opts(settings.body_types, val, '— тип кузова —')}</select>`;
const classSelect = (attrs, val) => `<select ${attrs}>${opts(settings.car_classes, val, '— класс авто —')}</select>`;
const findModel = (cars, make, model) => { const m = findMake(cars, make || ''); return m && m[3].find((x) => x[0].toLowerCase() === String(model || '').trim().toLowerCase()); };
const carMeta = (o) => [settings.body_types[o.car_body || o.body], (o.car_class) && 'класс ' + o.car_class].filter(Boolean).join(', ');

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
// контакты и бренд приходят из настроек (Админка → Настройки → Бренд)
let TG = [], TG_CHANNEL = '';
const chatLink = () => (TG[0] ? `https://t.me/${TG[0][0]}` : `tel:${tel()}`);
function applyBrand() {
  TG = settings.tg_contacts || []; TG_CHANNEL = settings.tg_channel || '';
  document.title = `${settings.brand_name} ${settings.brand_sub} — онлайн-запись`.trim();
  document.querySelector('.logo').innerHTML = `${esc(settings.brand_name)}<span>${esc(settings.brand_sub)}</span>`;
  document.getElementById('foot-brand').textContent = `${settings.brand_name} ${settings.brand_sub} · ${settings.tagline}`;
  const c = settings.brand_color || '#2f8cff';
  document.documentElement.style.setProperty('--blue', c);
  document.documentElement.style.setProperty('--blue2', c);
}
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
    links.push(['#/my', 'Мои заказы'], ['#/profile', 'Профиль']);
    if (me.role === 'worker' || me.role === 'admin') links.push(['#/staff', 'Работы']);
    if (me.role === 'admin') links.push(['#/admin', 'Админка']);
  } else links.push(['#/login', 'Вход'], ['#/register', 'Регистрация']);
  document.getElementById('nav').innerHTML =
    links.map(([h, t]) => `<a href="${h}" class="${r === h ? 'active' : ''}">${h === '#/profile' ? avatarHtml(me, 24) + ' ' : ''}${t}</a>`).join('') +
    (me ? `<button id="logout" title="${esc(me.phone)}">Выйти (${esc(me.name)})</button>` : '') +
    `<button class="theme-btn" id="theme" title="${THEMES[getTheme()][1]}">${THEMES[getTheme()][0]}</button>`;
  document.getElementById('theme').onclick = () => { setTheme(nextTheme[getTheme()]); renderNav(); toast(THEMES[getTheme()][1]); };
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = async () => { await api('/api/logout', {}); me = null; location.hash = '#/'; route(); };
  document.getElementById('foot-contacts').innerHTML = settings
    ? `<a href="tel:${tel()}">${esc(settings.phone)}</a>${TG.map(([u]) => ` · <a href="https://t.me/${esc(u)}" target="_blank" rel="noopener">@${esc(u)}</a>`).join('')}${TG_CHANNEL ? ` · <a href="${esc(TG_CHANNEL)}" target="_blank" rel="noopener">Канал</a>` : ''}<br>${esc(settings.address)} · ${hm(settings.open_min)}–${hm(settings.close_min)}`
    : '';
}

// ---------- pages ----------
const pages = {};

const ADVANTAGES = [
  ['🧪', 'Профессиональная химия', 'Работаем проверенными составами — безопасно для ЛКП, кожи и пластика'],
  ['💰', 'Цена до начала работ', 'Осматриваем авто и называем точную стоимость — без сюрпризов в конце'],
  ['⏱', 'Точное время', 'Длительность каждой процедуры известна заранее — забираете авто к сроку'],
  ['🚐', 'Выезд к вам', 'Химчистка салона и мебели у вас дома или в гараже'],
];
const STEPS = [
  ['Запись', 'Онлайн на свободное время, в Telegram или по телефону'],
  ['Осмотр', 'Оцениваем состояние и фиксируем стоимость'],
  ['Работа', 'Выполняем процедуры в оговорённое время'],
  ['Приёмка', 'Показываем результат и даём рекомендации по уходу'],
];
const FAQ = [
  ['Сколько стоят работы?', 'На сайте указаны цены «от». Итоговую стоимость называем после осмотра — она зависит от класса и состояния авто. Напишите в Telegram, пришлите фото — посчитаем заранее.'],
  ['Сколько времени займёт?', 'Длительность каждой услуги указана в карточке. При онлайн-записи сайт сам суммирует время и показывает только те окна, когда мы свободны.'],
  ['Можно оставить машину на день?', 'Да. Для бронирования плёнкой, шумоизоляции и комплексных работ авто остаётся у нас — время согласуем при записи.'],
  ['Вы выезжаете?', `Да, химчистку салона и мягкой мебели делаем на выезде {city}.`],
  ['Как отменить или перенести запись?', 'В личном кабинете в разделе «Мои заказы» или сообщением в Telegram.'],
];
const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

pages['/'] = () => {
  const tg = chatLink();
  $app.innerHTML = `
  <section class="hero">
    <div class="tag">📍 ${esc(settings.hero_tag)}</div>
    <h1>${esc(settings.brand_name)}<span>${esc(settings.brand_sub)}</span></h1>
    <p>${esc(settings.tagline)}</p>
    <div class="lead">${esc(settings.hero_lead)}</div>
    <ul class="ticks">
      <li>Онлайн-запись только на свободное время</li>
      <li>Стоимость фиксируем до начала работ</li>
      <li>Выездная химчистка салона и мебели</li>
    </ul>
    <div class="row">
      <a class="btn big" href="#/book">Записаться онлайн</a>
      <button class="btn ghost big" data-scroll="calc">Рассчитать стоимость</button>
    </div>
  </section>

  <section class="stats reveal">
    <div><b>${services.length}</b><span>видов работ</span></div>
    <div><b>от ${dur(Math.min(...services.map((s) => s.duration)))}</b><span>самая быстрая услуга</span></div>
    <div><b>${hm(settings.open_min)}–${hm(settings.close_min)}</b><span>работаем ежедневно</span></div>
    <div><b>24/7</b><span>онлайн-запись</span></div>
  </section>

  <section class="reveal"><h2>Почему ${esc(settings.brand_name)}</h2>
    <div class="grid">${ADVANTAGES.map(([i, t, d]) => `<div class="card adv"><div class="ico">${i}</div><h3>${t}</h3><div class="muted">${d}</div></div>`).join('')}</div>
  </section>

  <section class="reveal" id="services"><h2>Услуги и цены</h2>
    <p class="muted">Цена зависит от типа кузова и класса автомобиля — точную сумму покажет калькулятор ниже</p>
    <div class="grid">${services.map((s) => `
      <div class="card svc">
        <h3>${esc(s.name)}</h3>
        <div class="muted">${esc(s.description)}</div>
        <p><span class="price">от ${rub(s.price)}</span> · <span class="muted">⏱ ${dur(s.duration)}</span></p>
        <a class="btn small" href="#/book?s=${s.id}">Записаться</a>
      </div>`).join('')}
    </div>
  </section>
  <div id="works-sec"></div>

  <section class="card calc reveal" id="calc">
    <h2>Калькулятор</h2>
    <p class="muted">Укажите машину и отметьте работы — посчитаем ориентировочную стоимость и время</p>
    <div class="grid" style="margin-bottom:14px"><div>${bodySelect('id="calc-body"', '')}</div><div>${classSelect('id="calc-class"', '')}</div></div>
    <div class="grid" id="calc-list">${services.map((s) => `
      <label class="check"><input type="checkbox" value="${s.id}"><span><b>${esc(s.name)}</b><br><span class="muted"><span data-cp="${s.id}">от ${rub(s.price)}</span> · ${dur(s.duration)}</span></span></label>`).join('')}
    </div>
    <div class="calc-res"><div>Итого: <b class="price" id="calc-sum">0 ₽</b> · <span id="calc-dur">0 мин</span></div>
      <a class="btn" id="calc-go" href="#/book">Записаться на эти работы</a></div>
  </section>

  <section class="reveal"><h2>Как мы работаем</h2>
    <div class="steps4">${STEPS.map(([t, d], i) => `<div class="card"><div class="num">${i + 1}</div><h3>${t}</h3><div class="muted">${d}</div></div>`).join('')}</div>
  </section>

  <div class="banner reveal">
    <div><h2>Выездные работы</h2><div>Нет времени ехать к нам? Почистим салон или мебель прямо у вас дома или в гараже.</div></div>
    <a class="btn ghost" href="${tg}" target="_blank" rel="noopener">Заказать выезд</a>
  </div>

  <div id="reviews-sec"></div>
  <section class="reveal"><h2>Частые вопросы</h2>
    <div class="faq">${FAQ.map(([q, a]) => `<details class="card"><summary>${q}</summary><div class="muted">${a.replace('{city}', esc(settings.city))}</div></details>`).join('')}</div>
  </section>

  <section class="card lead-form reveal" id="lead">
    <div><h2>Не знаете, что выбрать?</h2><p class="muted">Оставьте номер — перезвоним за 15 минут в рабочее время, подскажем и посчитаем стоимость.</p></div>
    <form id="lf">
      <input name="name" placeholder="Имя" maxlength="80" required>
      <input name="phone" type="tel" placeholder="+7 900 000-00-00" required>
      <input name="message" placeholder="Авто и что нужно сделать (необязательно)" maxlength="500">
      <button class="btn">Перезвоните мне</button>
      <div class="muted small">Нажимая кнопку, вы соглашаетесь на обработку персональных данных</div>
    </form>
  </section>

  <section class="reveal" id="contacts"><h2>Контакты</h2>
  <div class="grid">
    <div class="card"><h3>📍 Адрес</h3><div>${esc(settings.address)}</div>
      <p class="muted">Ежедневно ${hm(settings.open_min)}–${hm(settings.close_min)}</p>
      <a class="btn small ghost" href="https://yandex.ru/maps/?text=${encodeURIComponent(settings.address)}" target="_blank" rel="noopener">Открыть на карте</a></div>
    <div class="card"><h3>📲 Запись и расчёт стоимости</h3>
      ${TG.map(([u, n]) => `<div>Telegram <a href="https://t.me/${esc(u)}" target="_blank" rel="noopener">@${esc(u)}</a>${n ? ` (${esc(n)})` : ''}</div>`).join('')}
      <div style="margin-top:6px">Телефон <a href="tel:${tel()}">${esc(settings.phone)}</a></div></div>
    ${TG_CHANNEL ? `<div class="card"><h3>📣 Наш канал</h3><div class="muted">Работы, акции и новости</div>
      <a class="btn small" style="margin-top:10px" href="${esc(TG_CHANNEL)}" target="_blank" rel="noopener">${esc(TG_CHANNEL.replace(/^https:\/\//, ''))}</a></div>` : ''}
  </div></section>`;

  $app.querySelectorAll('[data-scroll]').forEach((b) => (b.onclick = () => scrollTo(b.dataset.scroll)));
  const calc = () => {
    const ids = [...$app.querySelectorAll('#calc-list input:checked')].map((i) => Number(i.value));
    const sel = services.filter((s) => ids.includes(s.id));
    const body = document.getElementById('calc-body').value, cls = document.getElementById('calc-class').value;
    const k = kFor(body, cls);
    services.forEach((s) => { const el = $app.querySelector(`[data-cp="${s.id}"]`); if (el) el.textContent = 'от ' + rub(svcPrice(s, k)); });
    $app.querySelectorAll('#calc-list .check').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    document.getElementById('calc-sum').textContent = 'от ' + rub(sel.reduce((a, s) => a + svcPrice(s, k), 0));
    document.getElementById('calc-dur').textContent = '⏱ ' + dur(sel.reduce((a, s) => a + s.duration, 0));
    const qs = [ids.length && 's=' + ids.join(','), body && 'body=' + body, cls && 'cls=' + cls].filter(Boolean).join('&');
    document.getElementById('calc-go').href = '#/book' + (qs ? '?' + qs : '');
  };
  $app.querySelectorAll('#calc-list input, #calc-body, #calc-class').forEach((i) => (i.onchange = calc));
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/leads', formData(e.target)); e.target.reset(); toast('Спасибо! Скоро перезвоним.'); }
    catch (er) { toast(er.message, 1); }
  };
  homeExtras();
  const io = new IntersectionObserver((es) => es.forEach((x) => x.isIntersecting && (x.target.classList.add('in'), io.unobserve(x.target))), { threshold: 0.08 });
  $app.querySelectorAll('.reveal').forEach((el) => io.observe(el));
};

// Компонент записи: услуги → авто → дата → свободное время. Используется клиентом и админом.
const draft = { services: [], car_make: '', car_model: '', plate: '', car_body: '', car_class: '', address: '', promo: null, date: '', start: null, comment: '' };
function bookingForm(container, { admin, onDone }) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  if (params.get('s')) draft.services = params.get('s').split(',').map(Number).filter((id) => services.some((x) => x.id === id));
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
      <div class="card" id="b-addrcard" hidden><h3>🚐 Адрес выезда</h3>
        <label>Город, улица, дом, квартира / гараж</label><input id="b-address" maxlength="200" value="${esc(draft.address)}" placeholder="Город, ул. …">
        <div class="muted" style="margin-top:6px">Мастер приедет к вам. Автомобиль для этой услуги указывать не обязательно.</div></div>
      <div class="card" id="b-carcard"><h3>2. Автомобиль</h3><div class="slots" id="b-garage"></div>
        <label>Марка</label>
        <input id="b-make" list="b-makes" maxlength="60" autocomplete="off" placeholder="Начните вводить: BMW, Лада, Haval…" value="${esc(draft.car_make)}"><datalist id="b-makes"></datalist>
        <label>Модель</label>
        <input id="b-model" list="b-models" maxlength="60" autocomplete="off" placeholder="Выберите или впишите" value="${esc(draft.car_model)}"><datalist id="b-models"></datalist>
        <label>Госномер (необязательно)</label>
        <input id="b-plate" data-plate maxlength="12" autocomplete="off" placeholder="А 123 ВС 777" value="${esc(plateView(draft.plate))}" style="text-transform:uppercase;letter-spacing:1px">
        <div class="grid" style="margin-top:4px"><div><label>Тип кузова</label>${bodySelect('id="b-body"', draft.car_body)}</div>
          <div><label>Класс автомобиля</label>${classSelect('id="b-class"', draft.car_class)}<div class="muted" id="b-class-note"></div></div></div></div>
      <div class="card"><h3>3. Дата и время</h3>
        <label>Дата</label><input id="b-date" type="date" value="${draft.date}" ${admin ? '' : `min="${today()}"`}>
        <label>Свободное время</label><div class="slots" id="b-slots"></div>
        ${admin ? `<label>Или любое время вручную (без проверки занятости)</label><input id="b-manual" type="time" step="300">` : ''}
        <label>Комментарий</label><textarea id="b-comment" maxlength="1000">${esc(draft.comment)}</textarea></div>
      ${!admin && !me ? `<div class="card"><h3>4. Ваши контакты</h3>
        <p class="muted" style="margin-top:0">Регистрация не нужна. Уже есть аккаунт? <a href="#/login?next=book">Войдите</a></p>
        <label>Имя</label><input id="b-gname" maxlength="80" autocomplete="name">
        <label>Телефон</label><input id="b-gphone" type="tel" autocomplete="tel" placeholder="+7 (900) 000-00-00">
        <label class="check" style="margin-top:12px"><input type="checkbox" id="b-consent"><span>Согласен(на) на обработку персональных данных для записи и связи со мной</span></label></div>` : ''}
    </div>
    <div class="card summary">
      <h3>Ваш заказ</h3><div id="b-sum"></div>
      ${admin ? '' : `<div style="display:flex;gap:6px;margin-top:10px"><input id="b-promo" placeholder="Промокод" maxlength="30" style="text-transform:uppercase"><button type="button" class="btn small ghost" id="b-promo-btn">ОК</button></div>`}
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
        <span><b>${esc(s.name)}</b>${s.onsite ? ' <span class="badge">🚐 выезд</span>' : ''}<br><span class="muted">${dur(s.duration)} · от ${rub(s.price)}</span></span>
      </label>`).join('');
    q('b-services').querySelectorAll('input').forEach((i) => (i.onchange = () => {
      const id = Number(i.value);
      const sv = services.find((x) => x.id === id);
      // выездные и работы в сервисе — отдельными записями
      if (i.checked && draft.services.some((x) => !!services.find((y) => y.id === x)?.onsite !== !!sv.onsite)) {
        draft.services = [];
        toast(sv.onsite ? 'Выездная услуга оформляется отдельной записью' : 'Работы в сервисе оформляются отдельно от выездных');
      }
      draft.services = i.checked ? [...draft.services, id] : draft.services.filter((x) => x !== id);
      draft.start = null;
      renderServices(); loadSlots();
    }));
  }
  const isOnsite = () => services.some((s) => draft.services.includes(s.id) && s.onsite);
  const promoOff = (sum) => (!draft.promo ? 0 : Math.min(sum, draft.promo.kind === 'pct' ? Math.round((sum * draft.promo.value) / 100 / 100) * 100 : draft.promo.value));
  function summary() {
    const sel = services.filter((s) => draft.services.includes(s.id));
    const total = sel.reduce((a, s) => a + s.duration, 0);
    const onsite = isOnsite();
    q('b-addrcard').hidden = !onsite;
    const k = onsite ? 1 : kFor(draft.car_body, draft.car_class);
    const sum = sel.reduce((a, s) => a + svcPrice(s, k), 0);
    const off = promoOff(sum), pay = sum - off;
    const prepay = !admin && settings.prepay_from > 0 && pay >= settings.prepay_from ? Math.round((pay * settings.prepay_pct) / 100 / 100) * 100 : 0;
    q('b-sum').innerHTML = sel.length ? `
      ${sel.map((s) => `<div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(s.name)}</span><span class="muted">${rub(svcPrice(s, k))}</span></div>`).join('')}
      <p class="muted">Длительность: <b>${dur(total)}</b>${k !== 1 ? `<br>Множитель за кузов и класс: ×${+k.toFixed(2)}` : ''}
        ${off ? `<br>Промокод ${esc(draft.promo.code)}: <b>−${rub(off)}</b>` : ''}
        <br>Итого: <b class="price">от ${rub(pay)}</b>
        ${prepay ? `<br>⚠️ Предоплата <b>${rub(prepay)}</b> (${settings.prepay_pct}%) — менеджер пришлёт реквизиты` : ''}</p>
      ${draft.start != null ? `<p>📅 ${fmtDate(draft.date)}<br>🕒 ${hm(draft.start)} – ${hm(draft.start + total)}</p>` : '<p class="muted">Выберите время</p>'}
      ${!admin && settings.cancel_hours ? `<p class="muted" style="font-size:12px">Онлайн-отмена — не позднее чем за ${settings.cancel_hours} ч до визита</p>` : ''}`
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

  if (params.get('body') && settings.body_types[params.get('body')]) draft.car_body = q('b-body').value = params.get('body');
  if (params.get('cls') && settings.car_classes[params.get('cls')]) draft.car_class = q('b-class').value = params.get('cls');
  q('b-body').onchange = (e) => { draft.car_body = e.target.value; summary(); };
  q('b-class').onchange = (e) => { draft.car_class = e.target.value; summary(); };
  let carsDb = [];
  // класс подставляем из справочника; клиент его не меняет, если модель найдена
  const syncClass = () => {
    const md = findModel(carsDb, draft.car_make, draft.car_model);
    if (md && md[2]) { draft.car_class = md[2]; q('b-class').value = md[2]; }
    q('b-class').disabled = !admin && !!(md && md[2]);
    q('b-class-note').textContent = md && md[2] ? 'Определён по справочнику' + (md[3] ? `, выпуск ${md[3]}–${md[4] || 'н.в.'}` : '') : '';
    summary();
  };
  q('b-model').addEventListener('change', syncClass);
  loadCars().then((cars) => {
    carsDb = cars;
    const setModels = () => {
      const m = findMake(cars, draft.car_make);
      q('b-models').innerHTML = m ? m[3].map((x) => `<option value="${esc(x[0])}">${esc([x[1], x[3] && `${x[3]}–${x[4] || 'н.в.'}`].filter(Boolean).join(' · '))}</option>`).join('') : '';
    };
    q('b-makes').innerHTML = cars.map((m) => `<option value="${esc(m[0])}">${esc(m[1])}</option>`).join('');
    setModels();
    q('b-make').onchange = (e) => {
      const m = findMake(cars, e.target.value);
      if (m) e.target.value = m[0]; // кириллицу приводим к официальному названию
      draft.car_make = e.target.value; draft.car_model = ''; q('b-model').value = ''; setModels(); syncClass();
    };
    syncClass();
  });
  let garage = [];
  if (!admin && me) api('/api/me/profile').then(({ cars }) => {
    garage = cars;
    const pick = (c) => {
      Object.assign(draft, { car_make: c.make, car_model: c.model, plate: c.plate, car_body: c.body, car_class: c.car_class });
      q('b-make').value = c.make; q('b-model').value = c.model; q('b-plate').value = plateView(c.plate);
      q('b-body').value = c.body; q('b-class').value = c.car_class; syncClass();
      q('b-garage').querySelectorAll('.slot').forEach((x) => x.classList.toggle('on', Number(x.dataset.car) === c.id));
    };
    if (cars.length) q('b-garage').innerHTML = '<span class="muted" style="align-self:center">Из гаража:</span>' + cars.map((c) => `<button type="button" class="slot" data-car="${c.id}">🚗 ${esc(carTitle(c))}${c.plate ? ' · ' + esc(plateView(c.plate)) : ''}</button>`).join('');
    q('b-garage').querySelectorAll('.slot').forEach((x) => (x.onclick = () => pick(cars.find((c) => c.id === Number(x.dataset.car)))));
    const want = Number(params.get('car')) || (cars.length === 1 && !draft.car_make ? cars[0].id : 0);
    if (want && cars.find((c) => c.id === want)) pick(cars.find((c) => c.id === want));
  }).catch(() => {});
  q('b-make').oninput = (e) => (draft.car_make = e.target.value);
  q('b-model').oninput = (e) => (draft.car_model = e.target.value);
  q('b-plate').oninput = (e) => (draft.plate = plateRaw(e.target.value));
  q('b-comment').oninput = (e) => (draft.comment = e.target.value);
  q('b-address').oninput = (e) => (draft.address = e.target.value);
  if (q('b-promo-btn')) q('b-promo-btn').onclick = async () => {
    const code = q('b-promo').value.trim();
    if (!code) { draft.promo = null; summary(); return; }
    const k = isOnsite() ? 1 : kFor(draft.car_body, draft.car_class);
    const sum = services.filter((s) => draft.services.includes(s.id)).reduce((a, s) => a + svcPrice(s, k), 0);
    try { draft.promo = await api(`/api/promo?code=${encodeURIComponent(code)}&total=${sum}`); toast('Промокод применён'); }
    catch (e) { draft.promo = null; toast(e.message, 1); }
    summary();
  };
  q('b-date').onchange = (e) => { draft.date = e.target.value; draft.start = null; loadSlots(); };
  if (q('b-manual')) q('b-manual').onchange = (e) => {
    draft.start = e.target.value ? toMin(e.target.value) : null;
    q('b-slots').querySelectorAll('.slot').forEach((x) => x.classList.remove('on'));
    summary();
  };

  q('b-submit').onclick = async () => {
    const err = q('b-err'); err.textContent = '';
    if (!draft.services.length) return (err.textContent = 'Выберите услуги');
    const onsite = isOnsite();
    if (onsite && draft.address.trim().length < 5) return (err.textContent = 'Укажите адрес выезда');
    if (!onsite && !draft.car_make.trim()) return (err.textContent = 'Укажите марку автомобиля');
    if (!plateOk(draft.plate)) return (err.textContent = 'Госномер в формате А 123 ВС 777');
    if (draft.start == null) return (err.textContent = 'Выберите время');
    const body = { services: draft.services, car_make: draft.car_make, car_model: draft.car_model, plate: draft.plate, car_body: draft.car_body, car_class: draft.car_class,
      date: draft.date, start_min: draft.start, comment: draft.comment, address: onsite ? draft.address : '', promo: draft.promo?.code };
    const guest = !admin && !me;
    if (guest) {
      Object.assign(body, { name: q('b-gname').value, phone: q('b-gphone').value, consent: q('b-consent').checked });
      if (!body.name.trim()) return (err.textContent = 'Укажите имя');
      if (body.phone.replace(/\D/g, '').length < 11) return (err.textContent = 'Укажите телефон');
      if (!body.consent) return (err.textContent = 'Нужно согласие на обработку данных');
    }
    if (admin) {
      const typed = q('b-user').value.trim();
      const u = typed && users.find((x) => `${x.name} ${x.phone}` === typed);
      if (u) body.user_id = u.id;
      else { body.client_name = q('b-cname').value; body.client_phone = q('b-cphone').value; }
      body.force = q('b-manual') && q('b-manual').value ? true : undefined;
    }
    q('b-submit').disabled = true;
    try {
      const r = await api(admin ? '/api/admin/orders' : guest ? '/api/orders/guest' : '/api/orders', body);
      if (guest) {
        Object.assign(draft, { services: [], car_make: '', car_model: '', plate: '', car_body: '', car_class: '', start: null, comment: '', address: '', promo: null });
        location.hash = '#/order/' + r.guest_token;
        return;
      }
      // новое авто клиента сохраняем в гараж, чтобы в следующий раз выбрать в один клик
      if (!admin && !onsite && !garage.some((c) => (body.plate && c.plate === body.plate) || (c.make === body.car_make && c.model === body.car_model)))
        api('/api/me/cars', { make: body.car_make, model: body.car_model, plate: body.plate, body: body.car_body, car_class: body.car_class }).catch(() => {});
      Object.assign(draft, { services: [], car_make: '', car_model: '', plate: '', car_body: '', car_class: '', start: null, comment: '', address: '', promo: null });
      onDone(r);
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

const carLabel = (o) => esc(o.car) + (carMeta(o) ? ` <span class="muted">(${esc(carMeta(o))})</span>` : '') + (o.plate ? ` · <span class="plate">${esc(plateView(o.plate))}</span>` : '');
const PAY = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод', online: 'Онлайн' };
// деньги по заказу: скидка, предоплата, оплачено
function moneyLine(o) {
  const parts = [];
  if (o.discount) parts.push(`скидка ${rub(o.discount)}${o.discount_note ? ' (' + esc(o.discount_note) + ')' : ''}`);
  if (o.prepay_due && (o.paid || 0) < o.prepay_due && !['done', 'cancelled'].includes(o.status)) parts.push(`<b style="color:var(--warn)">ждёт предоплату ${rub(o.prepay_due)}</b>`);
  if (o.paid) parts.push(`оплачено ${rub(o.paid)}${o.paid < o.total_price ? `, остаток ${rub(o.total_price - o.paid)}` : ' ✓'}`);
  return parts.length ? `<div class="muted">💳 ${parts.join(' · ')}</div>` : '';
}
function orderLine(o) {
  return `<div class="order">
    <div><b>${fmtDate(o.date)}, ${hm(o.start_min)}–${hm(o.end_min)}</b> ${badge(o.status)}</div>
    ${o.onsite ? `<div>🚐 Выезд: ${esc(o.address)}</div>` : ''}${o.car ? `<div>🚗 ${carLabel(o)}</div>` : ''}
    <div class="muted">${o.services.map((s) => esc(s.name)).join(', ')} · ${rub(o.total_price)}</div>
    ${moneyLine(o)}
    ${o.comment ? `<div class="muted">💬 ${esc(o.comment)}</div>` : ''}
  </div>`;
}

// страница записи гостя (по секретной ссылке)
pages['/order'] = async (token) => {
  const o = await api('/api/guest/' + encodeURIComponent(token));
  const url = location.href;
  $app.innerHTML = `<div class="form" style="max-width:640px">
    <h1>${o.status === 'cancelled' ? 'Запись отменена' : '✅ Вы записаны!'}</h1>
    <div class="card">${orderLine(o)}</div>
    ${o.status !== 'cancelled' ? `<div class="card" style="margin-top:14px"><h3>Сохраните эту страницу</h3>
      <p class="muted">По этой ссылке можно посмотреть или отменить запись. Мы позвоним для подтверждения.</p>
      <input value="${esc(url)}" readonly onclick="this.select()">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn small ghost" id="g-copy">Скопировать ссылку</button>
        ${['new', 'confirmed'].includes(o.status) ? '<button class="btn small ghost" id="g-cancel">Отменить запись</button>' : ''}</div></div>` : ''}
    ${!me ? `<div class="card" style="margin-top:14px"><h3>Создайте аккаунт</h3>
      <p class="muted">История визитов, гараж с вашими авто, напоминания в Telegram и запись в один клик.</p>
      <a class="btn small" href="#/register">Зарегистрироваться</a></div>` : ''}
  </div>`;
  const cp = document.getElementById('g-copy');
  if (cp) cp.onclick = () => { navigator.clipboard?.writeText(url).then(() => toast('Ссылка скопирована'), () => toast('Скопируйте ссылку вручную', 1)); };
  const cn = document.getElementById('g-cancel');
  if (cn) cn.onclick = async () => {
    if (!confirm('Отменить запись?')) return;
    try { await api(`/api/guest/${encodeURIComponent(token)}/cancel`, {}); toast('Запись отменена'); route(); } catch (e) { toast(e.message, 1); }
  };
};

pages['/my'] = async () => {
  if (!me) return (location.hash = '#/login?next=my');
  const orders = await api('/api/orders/my');
  $app.innerHTML = `<h1>Мои заказы</h1>
    <p><a class="btn" href="#/book">+ Новая запись</a></p>
    <div id="tg-box"></div>
    <div class="steps">${orders.length ? orders.map((o) => `<div class="card">${orderLine(o)}
      ${['new', 'confirmed'].includes(o.status) ? `<button class="btn small ghost" data-cancel="${o.id}" style="margin-top:10px">Отменить</button>` : ''}
      ${o.status === 'done' && !o.has_review ? `<div data-review="${o.id}" style="margin-top:10px"><button class="btn small ghost">⭐ Оставить отзыв</button></div>` : ''}</div>`).join('')
      : '<div class="empty">Заказов пока нет</div>'}</div>`;
  $app.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Отменить запись?')) return;
    try { await api(`/api/orders/${b.dataset.cancel}/cancel`, {}); toast('Запись отменена'); route(); } catch (e) { toast(e.message, 1); }
  }));
  $app.querySelectorAll('[data-review]').forEach((b) => (b.querySelector('button').onclick = () => reviewForm(b, Number(b.dataset.review))));
  tgCard(document.getElementById('tg-box'), 'Напомним о записи за день до визита и сообщим, когда автомобиль будет готов.');
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
        <td>${esc(o.client_name)}${o.user_id ? '' : ' <span class="badge">без аккаунта</span>'}<br><a href="tel:${esc(o.client_phone)}">${esc(o.client_phone)}</a>
          ${o.onsite ? `<br>🚐 <b>Выезд:</b> ${esc(o.address)}` : ''}${o.car ? `<br>🚗 ${carLabel(o)}` : ''}${o.comment ? `<br><span class="muted">💬 ${esc(o.comment)}</span>` : ''}${moneyLine(o)}</td>
        <td>${o.services.map((s) => esc(s.name)).join('<br>')}<br>${admin ? `<input type="number" min="0" step="100" value="${o.total_price}" data-price="${o.id}" title="Итоговая сумма, ₽" style="min-width:90px;max-width:120px">` : `<span class="price">${rub(o.total_price)}</span>`}</td>
        <td>${admin
          ? `<select data-status="${o.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select>`
          : `${badge(o.status)}<br>${o.status === 'new' || o.status === 'confirmed' ? `<button class="btn small" data-set="${o.id}" data-v="in_progress">Начать</button>` : ''}
             ${o.status === 'in_progress' ? `<button class="btn small" data-set="${o.id}" data-v="done">Готово</button>` : ''}`}</td>
        <td>${admin
          ? `<select data-worker="${o.id}"><option value="">—</option>${workers.map((w) => `<option value="${w.id}" ${w.id === o.worker_id ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>`
          : o.worker_name ? esc(o.worker_name) : `<button class="btn small ghost" data-take="${o.id}">Взять</button>`}</td>
        ${admin ? `<td style="white-space:nowrap"><button class="btn small ghost" data-pay="${o.id}" data-due="${Math.max(0, o.total_price - (o.paid || 0))}" title="Принять оплату">💳</button>
          <button class="btn small ghost" data-disc="${o.id}" title="Скидка">%</button>
          <button class="btn small ghost" data-pays="${o.id}" title="История оплат">≡</button><br>
          <button class="btn small ghost" data-move="${o.id}" data-date="${o.date}" data-start="${o.start_min}" style="margin-top:4px">Перенести</button>
          <button class="btn small danger" data-del="${o.id}" title="В корзину">×</button></td>` : ''}
      </tr>`).join('')}</tbody></table>`;
    const patch = async (id, body) => { try { await api(`/api/staff/orders/${id}`, body, 'PATCH'); toast('Сохранено'); } catch (e) { toast(e.message, 1); } reload(); };
    list.querySelectorAll('[data-status]').forEach((s) => (s.onchange = () => patch(s.dataset.status, { status: s.value })));
    list.querySelectorAll('[data-price]').forEach((i) => (i.onchange = () => patch(i.dataset.price, { total_price: i.value })));
    list.querySelectorAll('[data-worker]').forEach((s) => (s.onchange = () => patch(s.dataset.worker, { worker_id: s.value || null })));
    list.querySelectorAll('[data-set]').forEach((b) => (b.onclick = () => patch(b.dataset.set, { status: b.dataset.v })));
    list.querySelectorAll('[data-take]').forEach((b) => (b.onclick = () => patch(b.dataset.take, { take: true })));
    list.querySelectorAll('[data-move]').forEach((b) => (b.onclick = async () => {
      const date = prompt('Новая дата (ГГГГ-ММ-ДД)', b.dataset.date); if (!date) return;
      const time = prompt('Новое время начала (ЧЧ:ММ)', hm(Number(b.dataset.start))); if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return;
      patch(b.dataset.move, { date, start_min: toMin(time) });
    }));
    list.querySelectorAll('[data-pay]').forEach((b) => (b.onclick = async () => {
      const amount = prompt('Сумма оплаты, ₽', b.dataset.due); if (!amount) return;
      const m = prompt('Способ: 1 — наличные, 2 — карта, 3 — перевод, 4 — онлайн', '2'); if (!m) return;
      const method = ['cash', 'card', 'transfer', 'online'][Number(m) - 1];
      const kind = confirm('Это предоплата? (ОК — да, Отмена — обычная оплата)') ? 'prepay' : 'payment';
      try { await api(`/api/admin/orders/${b.dataset.pay}/payments`, { amount, method, kind }); toast('Оплата принята'); } catch (e) { toast(e.message, 1); }
      reload();
    }));
    list.querySelectorAll('[data-disc]').forEach((b) => (b.onclick = () => {
      const discount = prompt('Скидка от суммы услуг: «10%» или сумма в ₽ (0 — убрать)', '10%'); if (discount === null) return;
      const note = discount.trim() === '0' ? '' : prompt('Причина скидки (обязательно)', 'постоянный клиент'); if (note === null) return;
      patch(b.dataset.disc, { discount, discount_note: note });
    }));
    list.querySelectorAll('[data-pays]').forEach((b) => (b.onclick = async () => {
      const pays = await api(`/api/admin/orders/${b.dataset.pays}/payments`);
      if (!pays.length) return toast('Оплат по заказу нет');
      const txt = pays.map((p, i) => `${i + 1}) ${p.created_at.slice(0, 16)} — ${p.amount} ₽, ${PAY[p.method]}${p.kind === 'prepay' ? ' (предоплата)' : ''}`).join('\n');
      const n = prompt(`${txt}\n\nЧтобы удалить ошибочную оплату, введите её номер:`, '');
      if (!n || !pays[Number(n) - 1]) return;
      await api(`/api/admin/payments/${pays[Number(n) - 1].id}`, undefined, 'DELETE'); toast('Оплата удалена'); reload();
    }));
    list.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Удалить заказ? Он попадёт в корзину (Админка → Журнал), откуда его можно восстановить.')) return;
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
  orders: ['📋 Заказы', (c) => ordersBoard(c, { admin: true })],
  create: ['➕ Новый заказ', (c) => bookingForm(c, { admin: true, onDone: () => { toast('Заказ создан'); location.hash = '#/admin?tab=orders'; } })],
  reports: ['📊 Отчёты', adminReports],
  leads: ['📞 Заявки', adminLeads],
  repeats: ['🔁 Повторы', adminRepeats],
  expenses: ['💸 Расходы', adminExpenses],
  promos: ['🏷 Промокоды', adminPromos],
  reviews: ['⭐ Отзывы', adminReviews],
  works: ['🖼 Наши работы', adminWorks],
  services: ['🧽 Услуги', adminServices],
  pricing: ['💰 Цены по авто', adminPricing],
  users: ['👥 Пользователи', adminUsers],
  workers: ['🗓 График мастеров', adminWorkers],
  audit: ['📜 Журнал и корзина', adminAudit],
  settings: ['⚙️ Настройки', adminSettings],
};
pages['/admin'] = async () => {
  if (!me || me.role !== 'admin') return (location.hash = '#/login');
  const tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || 'orders';
  $app.innerHTML = `<div class="admin">
    <aside class="side">${Object.entries(adminTabs).map(([k, [t]]) => `<a href="#/admin?tab=${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</aside>
    <div class="admin-main"><h1>${(adminTabs[tab] || adminTabs.orders)[0].replace(/^\S+\s/, '')}</h1><div id="tab"></div></div></div>`;
  await (adminTabs[tab] || adminTabs.orders)[1](document.getElementById('tab'));
};

async function adminServices(c) {
  const list = await api('/api/admin/services');
  const row = (s = {}) => `<tr data-id="${s.id || ''}">
    <td><input name="name" value="${esc(s.name)}" placeholder="Название"><input name="description" value="${esc(s.description)}" placeholder="Описание" style="margin-top:4px"></td>
    <td><input name="duration" type="number" min="5" step="5" value="${s.duration ?? 60}" style="min-width:80px"></td>
    <td><input name="price" type="number" min="0" step="100" value="${s.price ?? 0}" style="min-width:90px"></td>
    <td><input name="sort" type="number" value="${s.sort ?? 0}" style="min-width:60px"></td>
    <td><select name="scaled" title="Применять множитель кузова и класса"><option value="1" ${s.scaled !== 0 ? 'selected' : ''}>Да</option><option value="0" ${s.scaled === 0 ? 'selected' : ''}>Нет</option></select></td>
    <td><select name="onsite" title="Выездная услуга: не занимает бокс, нужен адрес"><option value="0" ${s.onsite ? '' : 'selected'}>Нет</option><option value="1" ${s.onsite ? 'selected' : ''}>🚐 Да</option></select></td>
    <td><input name="repeat_days" type="number" min="0" max="3650" value="${s.repeat_days || 0}" title="Через сколько дней напомнить о повторе (0 — не напоминать)" style="min-width:70px"></td>
    <td><select name="active"><option value="1" ${s.active !== 0 ? 'selected' : ''}>Да</option><option value="0" ${s.active === 0 ? 'selected' : ''}>Скрыта</option></select></td>
    <td><button class="btn small" data-save>${s.id ? 'Сохранить' : 'Добавить'}</button> ${s.id ? '<button class="btn small danger" data-del>×</button>' : ''}</td></tr>`;
  c.innerHTML = `<p class="muted">Длительность в минутах — по ней считается свободное время. Скрытые услуги не видны клиентам.</p>
    <div class="table"><table><thead><tr><th>Услуга</th><th>Мин</th><th>Цена от, ₽</th><th>Порядок</th><th>Множитель авто</th><th>Выезд</th><th>Повтор, дн</th><th>Видна</th><th></th></tr></thead>
    <tbody>${list.map(row).join('')}${row()}</tbody></table></div>`;
  c.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector('[data-save]').onclick = async () => {
      const b = {}; tr.querySelectorAll('[name]').forEach((i) => (b[i.name] = i.value));
      b.active = b.active === '1'; b.scaled = b.scaled === '1'; b.onsite = b.onsite === '1';
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

async function adminLeads(c) {
  const leads = await api('/api/admin/leads');
  c.innerHTML = leads.length ? `<div class="table"><table><thead><tr><th>Когда</th><th>Имя</th><th>Телефон</th><th>Комментарий</th><th>Обработана</th><th></th></tr></thead><tbody>
    ${leads.map((l) => `<tr style="${l.done ? 'opacity:.5' : ''}"><td class="muted">${esc(l.created_at.slice(0, 16))}</td><td>${esc(l.name)}</td>
      <td><a href="tel:${esc(l.phone)}">${esc(l.phone)}</a></td><td>${esc(l.message)}</td>
      <td><input type="checkbox" data-done="${l.id}" ${l.done ? 'checked' : ''} style="width:auto"></td>
      <td><button class="btn small danger" data-del="${l.id}">×</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Заявок на обратный звонок пока нет</div>';
  c.querySelectorAll('[data-done]').forEach((i) => (i.onchange = async () => { await api(`/api/admin/leads/${i.dataset.done}`, { done: i.checked }, 'PATCH'); adminLeads(c); }));
  c.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (confirm('Удалить заявку?')) { await api(`/api/admin/leads/${b.dataset.del}`, undefined, 'DELETE'); adminLeads(c); } }));
}

async function adminUsers(c) {
  const [users, matches] = await Promise.all([api('/api/admin/users'), api('/api/admin/matches')]);
  c.innerHTML = `${matches.length ? `<div class="card" style="border-color:var(--warn);margin-bottom:16px"><h3>🔗 Совпадения: старые заказы без аккаунта</h3>
      <p class="muted">Заказы, созданные вручную (по звонку), совпадают с зарегистрированным клиентом по госномеру из гаража или по телефону. Телефон при регистрации не подтверждается по SMS — сверьте имя и авто, прежде чем привязать.</p>
      <div class="table"><table><thead><tr><th>Клиент</th><th>Совпадение</th><th>Заказов</th><th>Прошлые заказы</th><th></th></tr></thead><tbody>
      ${matches.map((m) => `<tr><td>${esc(m.name)}<br><span class="muted">${esc(phoneView(m.phone))}</span></td>
        <td>${m.kind === 'plate' ? `${esc(m.make)} ${esc(m.model)}<br><span class="plate">${esc(plateView(m.plate))}</span>` : '📞 по телефону'}</td>
        <td>${m.n}</td><td class="muted" style="max-width:320px">${esc(m.samples)}</td>
        <td><button class="btn small" data-link="${m.user_id}" data-kind="${m.kind}" data-plate="${esc(m.plate)}">Привязать</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <p class="muted">Мастер может зарегистрироваться сам с кодом сотрудника или вы можете повысить клиента здесь.</p>
    <div class="table"><table><thead><tr><th></th><th>Имя</th><th>Телефон</th><th>Гараж</th><th>Заказов</th><th>Роль</th><th>Создан</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${avatarHtml(u, 36)}</td><td>${esc(u.name)}</td><td><a href="tel:${esc(u.phone)}">${esc(phoneView(u.phone))}</a></td>
      <td class="muted" style="white-space:pre-line">${esc(u.cars || '—')}</td><td>${u.orders}</td>
      <td>${u.id === me.id ? ROLE[u.role] : `<select data-u="${u.id}">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}</select>`}</td>
      <td class="muted">${esc(u.created_at.slice(0, 10))}</td>
      <td style="white-space:nowrap">${u.id === me.id ? '' : `<button class="btn small ghost" data-edit="${u.id}" title="Исправить имя или телефон">✎</button> <button class="btn small danger" data-deluser="${u.id}" title="Удалить аккаунт">×</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  c.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = async () => {
    const u = users.find((x) => x.id === Number(b.dataset.edit));
    const name = prompt('Имя', u.name); if (name === null) return;
    const phone = prompt('Телефон', phoneView(u.phone)); if (phone === null) return;
    try { await api(`/api/admin/users/${u.id}/contact`, { name, phone }, 'PUT'); toast('Сохранено'); adminUsers(c); } catch (e) { toast(e.message, 1); }
  }));
  c.querySelectorAll('[data-deluser]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Удалить аккаунт? Его заказы останутся в базе, но отвяжутся от аккаунта.')) return;
    try { await api(`/api/admin/users/${b.dataset.deluser}`, undefined, 'DELETE'); toast('Удалено'); adminUsers(c); } catch (e) { toast(e.message, 1); }
  }));
  c.querySelectorAll('[data-u]').forEach((s) => (s.onchange = async () => {
    try { await api(`/api/admin/users/${s.dataset.u}`, { role: s.value }, 'PATCH'); toast('Роль изменена'); } catch (e) { toast(e.message, 1); adminUsers(c); }
  }));
  c.querySelectorAll('[data-link]').forEach((b) => (b.onclick = async () => {
    try { const r = await api('/api/admin/matches', { user_id: b.dataset.link, plate: b.dataset.plate, kind: b.dataset.kind }); toast(`Привязано заказов: ${r.linked}`); adminUsers(c); } catch (e) { toast(e.message, 1); }
  }));
}

async function adminSettings(c) {
  await adminSettingsForm(c);
  const box = document.createElement('div'); c.prepend(box);
  tgCard(box, 'Сюда будут приходить новые онлайн-записи, заявки на звонок, отмены и отзывы.');
}
async function adminSettingsForm(c) {
  const s = await api('/api/settings');
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const contacts = (s.tg_contacts || []).map(([u, n]) => (n ? `${u}:${n}` : u)).join(', ');
  c.innerHTML = `<form class="card form" id="sf" style="margin:0;max-width:640px">
    <h3>🎨 Бренд — всё, что меняется под компанию</h3>
    <div class="grid"><div><label>Название</label><input name="brand_name" maxlength="40" value="${esc(s.brand_name)}" required></div>
      <div><label>Подпись под названием</label><input name="brand_sub" maxlength="40" value="${esc(s.brand_sub)}"></div></div>
    <label>Слоган</label><input name="tagline" maxlength="120" value="${esc(s.tagline)}">
    <label>Плашка на главной (город, район, особенность)</label><input name="hero_tag" maxlength="120" value="${esc(s.hero_tag)}">
    <label>Текст на главной</label><textarea name="hero_lead" maxlength="300">${esc(s.hero_lead)}</textarea>
    <div class="grid"><div><label>Фирменный цвет</label><input name="brand_color" type="color" value="${esc(s.brand_color)}" style="height:44px;padding:4px"></div>
      <div><label>Зона выезда (для FAQ)</label><input name="city" maxlength="80" value="${esc(s.city)}" placeholder="по городу и области"></div></div>
    <label>Telegram для записи — «логин:Имя» через запятую</label><input name="tg_contacts" maxlength="300" value="${esc(contacts)}" placeholder="ivan_master:Иван, studio_admin:Ольга">
    <label>Telegram-канал (ссылка https://t.me/…)</label><input name="tg_channel" maxlength="200" value="${esc(s.tg_channel)}">
    <h3 style="margin-top:20px">🕒 Расписание и правила</h3>
    <label>Открытие</label><input name="open" type="time" value="${hm(s.open_min)}" required>
    <label>Закрытие</label><input name="close" type="time" value="${hm(s.close_min)}" required>
    <label>Шаг сетки записи, мин</label><input name="step_min" type="number" min="5" max="240" value="${s.step_min}">
    <label>Сколько машин одновременно (боксы / мастера)</label><input name="capacity" type="number" min="1" max="50" value="${s.capacity}">
    <label>На сколько дней вперёд можно записаться</label><input name="booking_days" type="number" min="1" max="365" value="${s.booking_days}">
    <label>Выходные дни</label><div class="slots">${days.map((d, i) => `<label class="check"><input type="checkbox" name="off" value="${i}" ${s.days_off.includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
    <label>Выездных бригад одновременно</label><input name="onsite_capacity" type="number" min="0" max="20" value="${s.onsite_capacity}">
    <label>Онлайн-отмена не позднее чем за, часов (0 — в любое время)</label><input name="cancel_hours" type="number" min="0" max="168" value="${s.cancel_hours}">
    <label>Предоплата для заказов от, ₽ (0 — не нужна)</label><input name="prepay_from" type="number" min="0" step="1000" value="${s.prepay_from}">
    <label>Размер предоплаты, %</label><input name="prepay_pct" type="number" min="1" max="100" value="${s.prepay_pct}">
    <label>Телефон</label><input name="phone" value="${esc(s.phone)}">
    <label>Адрес</label><input name="address" value="${esc(s.address)}">
    <button class="btn" style="margin-top:16px">Сохранить</button></form>`;
  c.querySelector('#sf').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, d = formData(f);
    try {
      await api('/api/admin/settings', {
        price_body: s.price_body, price_class: s.price_class,
        onsite_capacity: d.onsite_capacity, cancel_hours: d.cancel_hours, prepay_from: d.prepay_from, prepay_pct: d.prepay_pct,
        open_min: toMin(d.open), close_min: d.close === '00:00' ? 1440 : toMin(d.close), step_min: d.step_min, capacity: d.capacity,
        booking_days: d.booking_days, days_off: [...f.querySelectorAll('[name=off]:checked')].map((i) => i.value), phone: d.phone, address: d.address,
        brand_name: d.brand_name, brand_sub: d.brand_sub, tagline: d.tagline, hero_tag: d.hero_tag, hero_lead: d.hero_lead,
        brand_color: d.brand_color, city: d.city, tg_contacts: d.tg_contacts, tg_channel: d.tg_channel,
      }, 'PUT');
      settings = await api('/api/settings'); applyBrand(); renderNav(); toast('Настройки сохранены');
    } catch (er) { toast(er.message, 1); }
  };
}

const settingsBody = (s) => ({
  open_min: s.open_min, close_min: s.close_min, step_min: s.step_min, capacity: s.capacity, booking_days: s.booking_days,
  days_off: s.days_off, phone: s.phone, address: s.address, price_body: s.price_body, price_class: s.price_class,
  cancel_hours: s.cancel_hours, prepay_from: s.prepay_from, prepay_pct: s.prepay_pct, onsite_capacity: s.onsite_capacity,
});
async function adminPricing(c) {
  const s = await api('/api/settings');
  const row = (group, k, label) => `<tr><td>${esc(label)}</td><td><input type="number" step="0.05" min="0.1" max="10" data-g="${group}" data-k="${k}" value="${(s[group][k] || 1)}" style="max-width:110px"></td></tr>`;
  const sample = services.find((x) => x.scaled) || services[0];
  c.innerHTML = `<p class="muted">Цена услуги = базовая цена × множитель кузова × множитель класса (округляется до 100 ₽).
      Класс определяется автоматически по справочнику моделей, тип кузова выбирает клиент. 1 — без изменений, 1.2 — дороже на 20%.
      У услуг, не зависящих от машины (например, химчистка мебели), множитель отключается во вкладке «Услуги».</p>
    <div class="charts">
      <div class="card"><h3>Тип кузова</h3><div class="table"><table><tbody>${Object.entries(s.body_types).map(([k, v]) => row('price_body', k, v)).join('')}</tbody></table></div></div>
      <div class="card"><h3>Класс автомобиля</h3><div class="table"><table><tbody>${Object.entries(s.car_classes).map(([k, v]) => row('price_class', k, v)).join('')}</tbody></table></div></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Проверка</h3>
      <div class="grid"><div>${bodySelect('id="pp-body"', 'suv')}</div><div>${classSelect('id="pp-class"', 'J')}</div></div>
      <p id="pp-res"></p>
      <button class="btn" id="pp-save">Сохранить множители</button></div>`;
  const read = () => {
    const out = { price_body: {}, price_class: {} };
    c.querySelectorAll('[data-g]').forEach((i) => (out[i.dataset.g][i.dataset.k] = Number(i.value) || 1));
    return out;
  };
  const preview = () => {
    const m = read(), b = c.querySelector('#pp-body').value, cl = c.querySelector('#pp-class').value;
    const k = (m.price_body[b] || 1) * (m.price_class[cl] || 1);
    c.querySelector('#pp-res').innerHTML = sample ? `${esc(sample.name)}: базовая ${rub(sample.price)} → <b class="price">${rub(svcPrice(sample, k))}</b> (×${+k.toFixed(3)})` : '';
  };
  c.querySelectorAll('input, select').forEach((i) => (i.oninput = i.onchange = preview));
  preview();
  c.querySelector('#pp-save').onclick = async () => {
    try {
      await api('/api/admin/settings', { ...settingsBody(s), ...read() }, 'PUT');
      settings = await api('/api/settings'); toast('Множители сохранены');
    } catch (er) { toast(er.message, 1); }
  };
}

// ---------- админка v2 ----------
async function adminRepeats(c) {
  const list = await api('/api/admin/repeats');
  c.innerHTML = `<p class="muted">Клиенты, которым пора повторить услугу (срок задаётся во вкладке «Услуги», колонка «Повтор, дн»).
    Подключившим Telegram бот напоминает сам (днём, 11:00–20:00); остальным — позвоните. После контакта нажмите «Связались».</p>
    ${list.length ? `<div class="table"><table><thead><tr><th>Пора с</th><th>Клиент</th><th>Услуга</th><th>Прошлый визит</th><th>Telegram</th><th></th></tr></thead><tbody>
    ${list.map((r) => `<tr><td><b>${fmtDate(r.due)}</b></td>
      <td>${esc(r.client_name)}<br><a href="tel:${esc(r.client_phone)}">${esc(phoneView(r.client_phone))}</a>${r.car ? `<br><span class="muted">🚗 ${esc(r.car)}</span>` : ''}</td>
      <td>${esc(r.name)}<br><span class="muted">каждые ${r.repeat_days} дн.</span></td><td>${fmtDate(r.date)}</td>
      <td>${r.sent_tg ? '✅ напомнили' : r.has_tg ? '⏳ напомним' : '<span class="muted">нет — звонок</span>'}</td>
      <td><button class="btn small" data-h="${r.order_id}" data-s="${r.service_id}">Связались</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Сейчас некому напоминать. Список наполнится, когда подойдут сроки повторов по выполненным заказам.</div>'}`;
  c.querySelectorAll('[data-h]').forEach((b) => (b.onclick = async () => { await api('/api/admin/repeats/handled', { order_id: b.dataset.h, service_id: b.dataset.s }); adminRepeats(c); }));
}

async function adminPromos(c) {
  const list = await api('/api/admin/promos');
  c.innerHTML = `<form class="card" id="pf" style="margin-bottom:16px"><h3>Новый промокод</h3>
      <div class="grid"><div><label>Код</label><input name="code" required maxlength="30" placeholder="SALE10" style="text-transform:uppercase"></div>
      <div><label>Скидка</label><div style="display:flex;gap:6px"><input name="value" type="number" min="1" required style="min-width:80px"><select name="kind" style="max-width:90px"><option value="pct">%</option><option value="rub">₽</option></select></div></div>
      <div><label>Лимит использований (0 — без лимита)</label><input name="max_uses" type="number" min="0" value="0"></div>
      <div><label>Действует до</label><input name="valid_to" type="date"></div>
      <div><label>Мин. сумма заказа, ₽</label><input name="min_total" type="number" min="0" value="0"></div>
      <div><label>Заметка (для кого / откуда)</label><input name="note" maxlength="200" placeholder="Авито, октябрь"></div></div>
      <button class="btn" style="margin-top:12px">Создать</button></form>
    ${list.length ? `<div class="table"><table><thead><tr><th>Код</th><th>Скидка</th><th>Использован</th><th>До</th><th>От суммы</th><th>Заметка</th><th>Активен</th></tr></thead><tbody>
    ${list.map((p) => `<tr style="${p.active ? '' : 'opacity:.5'}"><td><b>${esc(p.code)}</b></td><td>${p.kind === 'pct' ? p.value + '%' : rub(p.value)}</td>
      <td>${p.used}${p.max_uses ? ' / ' + p.max_uses : ''}</td><td>${p.valid_to ? esc(p.valid_to) : '—'}</td><td>${p.min_total ? rub(p.min_total) : '—'}</td>
      <td class="muted">${esc(p.note)}</td><td><input type="checkbox" data-p="${p.id}" ${p.active ? 'checked' : ''} style="width:auto"></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Промокодов пока нет. Сделайте отдельный код под каждый канал рекламы — в отчётах будет видно, какой приводит клиентов.</div>'}`;
  c.querySelector('#pf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/admin/promos', formData(e.target)); toast('Промокод создан'); adminPromos(c); } catch (er) { toast(er.message, 1); }
  };
  c.querySelectorAll('[data-p]').forEach((i) => (i.onchange = async () => { await api(`/api/admin/promos/${i.dataset.p}`, { active: i.checked }, 'PATCH'); adminPromos(c); }));
}

async function adminExpenses(c) {
  const st = adminExpenses.st ||= { from: isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: today() };
  const { categories, items } = await api(`/api/admin/expenses?from=${st.from}&to=${st.to}`);
  const total = items.reduce((a, e) => a + e.amount, 0);
  c.innerHTML = `<form class="card" id="ef" style="margin-bottom:16px"><h3>Добавить расход</h3>
      <div class="grid"><div><label>Дата</label><input name="date" type="date" value="${today()}" required></div>
      <div><label>Категория</label><select name="category">${categories.map((x) => `<option>${esc(x)}</option>`).join('')}</select></div>
      <div><label>Сумма, ₽</label><input name="amount" type="number" min="1" required></div>
      <div><label>Комментарий</label><input name="note" maxlength="200" placeholder="Например: полироль 3M, 2 шт."></div></div>
      <button class="btn" style="margin-top:12px">Добавить</button></form>
    <div class="toolbar"><div><label>С</label><input type="date" id="x-from" value="${st.from}"></div><div><label>По</label><input type="date" id="x-to" value="${st.to}"></div>
      <div style="align-self:end">Итого: <b class="price">${rub(total)}</b></div></div>
    ${items.length ? `<div class="table"><table><thead><tr><th>Дата</th><th>Категория</th><th>Сумма</th><th>Комментарий</th><th>Внёс</th><th></th></tr></thead><tbody>
    ${items.map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.category)}</td><td>${rub(e.amount)}</td><td class="muted">${esc(e.note)}</td><td class="muted">${esc(e.user_name || '')}</td>
      <td><button class="btn small danger" data-x="${e.id}">×</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Расходов за период нет</div>'}
    <p class="muted">Прибыль (выручка − расходы) — во вкладке «Отчёты».</p>`;
  c.querySelector('#ef').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/admin/expenses', formData(e.target)); toast('Расход добавлен'); adminExpenses(c); } catch (er) { toast(er.message, 1); }
  };
  c.querySelector('#x-from').onchange = (e) => { st.from = e.target.value; adminExpenses(c); };
  c.querySelector('#x-to').onchange = (e) => { st.to = e.target.value; adminExpenses(c); };
  c.querySelectorAll('[data-x]').forEach((b) => (b.onclick = async () => { if (confirm('Удалить расход?')) { await api(`/api/admin/expenses/${b.dataset.x}`, undefined, 'DELETE'); adminExpenses(c); } }));
}

async function adminWorkers(c) {
  const ws = await api('/api/admin/workers');
  const days = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [0, 'Вс']];
  c.innerHTML = `<p class="muted">Свободное время для записи считается так: не больше боксов (Настройки) и не больше мастеров, которые работают в этот день.
      Если мастер в отпуске или заболел — отметьте выходные, и окна закроются автоматически. Без мастеров в системе учитываются только боксы.</p>
    ${ws.length ? ws.map((w) => `<div class="card" style="margin-bottom:12px">
      <h3>${esc(w.name)} <span class="muted" style="font-weight:400">${esc(phoneView(w.phone))}</span></h3>
      <label>Рабочие дни</label><div class="slots">${days.map(([d, n]) => `<label class="check"><input type="checkbox" data-w="${w.id}" value="${d}" ${w.work_days.split(',').includes(String(d)) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
      <label>Выходные / отпуск</label>
      <div class="toolbar"><div><input type="date" id="of-${w.id}" min="${today()}"></div><div><input type="date" id="ot-${w.id}" min="${today()}"></div>
        <button class="btn small" data-off="${w.id}" style="align-self:center">Добавить</button></div>
      <div class="slots">${w.offs.length ? w.offs.map((d) => `<button class="slot" data-rm="${w.id}" data-d="${d}" title="Убрать">${esc(fmtDate(d))} ×</button>`).join('') : '<span class="muted">нет</span>'}</div>
    </div>`).join('') : '<div class="empty">Мастеров пока нет. Мастер регистрируется с кодом сотрудника или вы назначаете роль во вкладке «Пользователи».</div>'}`;
  c.querySelectorAll('[data-w]').forEach((i) => (i.onchange = async () => {
    const id = i.dataset.w;
    await api(`/api/admin/workers/${id}/days`, { days: [...c.querySelectorAll(`[data-w="${id}"]:checked`)].map((x) => x.value) }, 'PUT');
    toast('График сохранён');
  }));
  c.querySelectorAll('[data-off]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.off, from = c.querySelector('#of-' + id).value, to = c.querySelector('#ot-' + id).value || from;
    if (!from) return toast('Выберите дату', 1);
    try { await api(`/api/admin/workers/${id}/off`, { from, to }); adminWorkers(c); } catch (e) { toast(e.message, 1); }
  }));
  c.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/workers/${b.dataset.rm}/off/${b.dataset.d}`, undefined, 'DELETE'); adminWorkers(c); }));
}

async function adminAudit(c) {
  const st = adminAudit.st ||= { q: '' };
  const [log, trash] = await Promise.all([api('/api/admin/audit?q=' + encodeURIComponent(st.q)), api('/api/admin/trash')]);
  c.innerHTML = `${trash.length ? `<div class="card" style="margin-bottom:16px"><h3>🗑 Корзина заказов</h3><div class="table"><table><thead><tr><th>Удалён</th><th>Кем</th><th>Заказ</th><th></th></tr></thead><tbody>
      ${trash.map((t) => `<tr><td class="muted">${esc(t.deleted_at.slice(0, 16))}</td><td>${esc(t.deleted_by)}</td>
        <td>№${t.order_id} · ${esc(t.data.order.client_name)} · ${esc(t.data.order.date)} ${hm(t.data.order.start_min)} · ${rub(t.data.order.total_price)}</td>
        <td><button class="btn small" data-r="${t.id}">Восстановить</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="toolbar"><div style="flex:1"><label>Поиск: сотрудник, действие, № заказа</label><input id="a-q" value="${esc(st.q)}" placeholder="Например: скидка"></div></div>
    <div class="table"><table><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Подробности</th></tr></thead><tbody>
    ${log.map((a) => `<tr><td class="muted" style="white-space:nowrap">${esc(a.at.slice(0, 16))}</td><td>${esc(a.user_name)}</td><td>${esc(a.action)}</td>
      <td class="muted">${a.entity === 'order' ? 'заказ №' : a.entity === 'user' ? 'польз. №' : esc(a.entity) + ' '}${esc(a.entity_id || '')}</td><td>${esc(a.details)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Пусто</td></tr>'}</tbody></table></div>`;
  c.querySelector('#a-q').onchange = (e) => { st.q = e.target.value; adminAudit(c); };
  c.querySelectorAll('[data-r]').forEach((b) => (b.onclick = async () => {
    try { await api(`/api/admin/trash/${b.dataset.r}/restore`, {}); toast('Заказ восстановлен'); adminAudit(c); } catch (e) { toast(e.message, 1); }
  }));
}

// ---------- отчёты ----------
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const niceMax = (v) => { if (v <= 0) return 2; const p = 10 ** Math.floor(Math.log10(v)); const m = Math.ceil(v / p) * p; return m < 20 && m % 2 ? m + 1 : m; };
const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' млн' : n >= 1e3 ? Math.round(n / 1e3) + ' тыс' : String(n));

// Вертикальные столбцы (одна серия): [{label, value, tip}]
function colChart(rows, fmt) {
  const max = niceMax(Math.max(0, ...rows.map((r) => r.value)));
  const every = Math.ceil(rows.length / 10);
  return `<div class="cc">
    <div class="cc-grid">${[1, 0.5, 0].map((f) => `<div style="bottom:${f * 100}%"><span>${short(max * f)}</span></div>`).join('')}</div>
    <div class="cc-bars">${rows.map((r) => `<div class="cc-col" data-tip="${esc(r.tip)}"><div class="cc-bar" style="height:${(r.value / max) * 100}%"></div></div>`).join('')}</div>
    <div class="cc-x">${rows.map((r, i) => `<span>${i % every === 0 ? esc(r.label) : ''}</span>`).join('')}</div>
  </div>`;
}
// Горизонтальные полосы: [{name, value}]
function barList(rows, fmt = String) {
  if (!rows.length) return '<div class="empty">Нет данных за период</div>';
  const max = Math.max(...rows.map((r) => r.value)) || 1;
  return `<div class="bl">${rows.map((r) => `<div class="bl-row" data-tip="${esc(r.name)}: ${esc(fmt(r.value))}">
    <span class="bl-name">${esc(r.name)}</span><span class="bl-track"><span class="bl-bar" style="width:${Math.max(2, (r.value / max) * 100)}%"></span></span><span class="bl-val">${esc(fmt(r.value))}</span></div>`).join('')}</div>`;
}
// подписываем все даты периода, при длинном периоде группируем по неделям
function bucketDays(byDay, from, to) {
  const map = Object.fromEntries(byDay.map((d) => [d.date, d]));
  const days = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10);
    days.push({ date: d, revenue: map[d]?.revenue || 0, orders: map[d]?.orders || 0 });
  }
  const dm = (d) => d.slice(8, 10) + '.' + d.slice(5, 7);
  if (days.length <= 45) return { unit: 'день', rows: days.map((d) => ({ ...d, label: dm(d.date), title: fmtDate(d.date) })) };
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    const ch = days.slice(i, i + 7);
    weeks.push({ label: dm(ch[0].date), title: `${dm(ch[0].date)}–${dm(ch.at(-1).date)}`, revenue: ch.reduce((a, d) => a + d.revenue, 0), orders: ch.reduce((a, d) => a + d.orders, 0) });
  }
  return { unit: 'неделя', rows: weeks };
}

async function adminReports(c) {
  const st = adminReports.st ||= { preset: 30 };
  const t = new Date();
  const presets = [[7, '7 дней'], [30, '30 дней'], [90, '90 дней'], ['month', 'Этот месяц'], ['year', 'Этот год']];
  if (st.preset !== 'custom') {
    st.to = isoDate(t);
    st.from = st.preset === 'month' ? isoDate(new Date(t.getFullYear(), t.getMonth(), 1))
      : st.preset === 'year' ? isoDate(new Date(t.getFullYear(), 0, 1))
      : isoDate(new Date(Date.now() - (st.preset - 1) * 864e5));
  }
  const r = await api(`/api/admin/reports?from=${st.from}&to=${st.to}`);
  const k = r.kpi;
  const b = bucketDays(r.by_day, r.from, r.to);
  const statusMap = Object.fromEntries(r.statuses.map((s) => [s.status, s.n]));
  const tile = (label, value, sub = '') => `<div class="kpi"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
  c.innerHTML = `
    <div class="toolbar">
      <div class="tabs" style="margin:0">${presets.map(([v, l]) => `<button data-p="${v}" class="${st.preset === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div><label>С</label><input type="date" id="r-from" value="${r.from}"></div>
      <div><label>По</label><input type="date" id="r-to" value="${r.to}"></div>
      <a class="btn small ghost" style="align-self:end" href="/api/admin/reports.csv?from=${r.from}&to=${r.to}">⬇ Заказы в Excel (CSV)</a>
    </div>
    <div class="kpis">
      ${tile('Выручка', rub(k.revenue), `${k.done || 0} выполненных заказов`)}
      ${tile('Ожидается', rub(k.pipeline), 'новые, подтверждённые, в работе')}
      ${tile('Средний чек', rub(k.avg_check))}
      ${tile('Загрузка', k.load_pct + '%', `${dur(k.booked_min)} занято`)}
      ${tile('Заказов', k.orders, `отмен: ${k.cancelled || 0} (${pct(k.cancelled, k.orders)}%)`)}
      ${tile('Клиентов', k.clients, `повторных: ${k.repeat_clients} (${pct(k.repeat_clients, k.clients)}%)`)}
      ${tile('Регистраций', k.new_users)}
      ${tile('Заявок на звонок', k.leads)}
      ${tile('Получено денег', rub(k.received), 'по оплатам за период')}
      ${tile('Расходы', rub(k.expenses))}
      ${tile('Прибыль', rub(k.profit), 'выручка − расходы')}
      ${tile('Не оплачено', rub(k.unpaid), 'по выполненным заказам')}
      ${tile('Скидки', rub(k.discounts), 'по выполненным заказам')}
    </div>
    <div class="charts">
      <div class="card"><h3>Выручка по ${b.unit === 'день' ? 'дням' : 'неделям'}</h3><div class="muted">Сумма выполненных заказов, ₽</div>
        ${colChart(b.rows.map((d) => ({ label: d.label, value: d.revenue, tip: `${d.title}: ${rub(d.revenue)}` })))}</div>
      <div class="card"><h3>Заказы по ${b.unit === 'день' ? 'дням' : 'неделям'}</h3><div class="muted">Без отменённых, по дате визита</div>
        ${colChart(b.rows.map((d) => ({ label: d.label, value: d.orders, tip: `${d.title}: ${d.orders} заказ(ов)` })))}</div>
      <div class="card"><h3>Популярные услуги</h3><div class="muted">Количество в заказах</div>
        ${barList(r.services.map((s) => ({ name: s.name, value: s.n })))}</div>
      <div class="card"><h3>Марки автомобилей</h3><div class="muted">Топ-10 по числу заказов</div>
        ${barList(r.makes.map((m) => ({ name: m.name, value: m.n })))}</div>
      <div class="card"><h3>Загрузка по дням недели</h3><div class="muted">Число заказов — где можно дать скидку на «пустые» дни</div>
        ${colChart([1, 2, 3, 4, 5, 6, 0].map((d) => { const n = r.weekdays.find((w) => w.wd === d)?.n || 0; return { label: WD[d], value: n, tip: `${WD[d]}: ${n}` }; }))}</div>
      <div class="card"><h3>Расходы по категориям</h3>
        ${barList(r.expenses.map((x) => ({ name: x.name, value: x.sum })), rub)}</div>
      <div class="card"><h3>Оплаты по способам</h3>
        ${barList(r.pay_methods.map((x) => ({ name: x.name, value: x.sum })), rub)}</div>
      <div class="card"><h3>Промокоды</h3><div class="muted">Сколько заказов привёл каждый код</div>
        ${barList(r.promos.map((x) => ({ name: `${x.name} (−${rub(x.sum)})`, value: x.n })))}</div>
      <div class="card"><h3>Статусы заказов</h3>
        ${barList(Object.keys(STATUS).map((s) => ({ name: STATUS[s], value: statusMap[s] || 0 })).filter((x) => x.value))}</div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Мастера</h3><div class="table"><table><thead><tr><th>Мастер</th><th>Заказов</th><th>Выполнено</th><th>Выручка</th></tr></thead><tbody>
      ${r.workers.map((w) => `<tr><td>${esc(w.name)}</td><td>${w.n}</td><td>${w.done}</td><td>${rub(w.revenue)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Нет данных</td></tr>'}</tbody></table></div></div>
    <details class="card" style="margin-top:14px"><summary>Таблица по ${b.unit === 'день' ? 'дням' : 'неделям'}</summary><div class="table"><table><thead><tr><th>Период</th><th>Заказов</th><th>Выручка</th></tr></thead><tbody>
      ${b.rows.filter((d) => d.orders || d.revenue).map((d) => `<tr><td>${esc(d.title)}</td><td>${d.orders}</td><td>${rub(d.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Нет данных</td></tr>'}</tbody></table></div></details>`;
  c.querySelectorAll('[data-p]').forEach((btn) => (btn.onclick = () => { st.preset = isNaN(btn.dataset.p) ? btn.dataset.p : Number(btn.dataset.p); adminReports(c); }));
  c.querySelector('#r-from').onchange = (e) => { st.preset = 'custom'; st.from = e.target.value; if (st.to < st.from) st.to = st.from; adminReports(c); };
  c.querySelector('#r-to').onchange = (e) => { st.preset = 'custom'; st.to = e.target.value; if (st.from > st.to) st.from = st.to; adminReports(c); };
}

// общий тултип для графиков
(() => {
  const tip = document.createElement('div'); tip.id = 'ctip'; document.body.appendChild(tip);
  document.addEventListener('mouseover', (e) => { const el = e.target.closest('[data-tip]'); tip.style.display = el ? 'block' : 'none'; if (el) tip.textContent = el.dataset.tip; });
  document.addEventListener('mousemove', (e) => { tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = e.clientY - 36 + 'px'; });
})();

// ---------- маски ----------
const PLATE_LAT = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
function plateRaw(v) {
  const s = String(v).toUpperCase().replace(/[A-Z]/g, (ch) => PLATE_LAT[ch] || '').replace(/[^0-9АВЕКМНОРСТУХ]/g, '');
  const pat = 'LDDDLLDDD'; let out = '';
  for (const ch of s) { if (out.length >= 9) break; if (pat[out.length] === 'L' ? /\D/.test(ch) : /\d/.test(ch)) out += ch; }
  return out;
}
const plateView = (r) => [r.slice(0, 1), r.slice(1, 4), r.slice(4, 6), r.slice(6)].filter(Boolean).join(' ');
const plateOk = (r) => !r || /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(r);
function phoneView(v) {
  let d = String(v).replace(/\D/g, '');
  if (!d) return '';
  if (d[0] === '8') d = '7' + d.slice(1); else if (d[0] !== '7') d = '7' + d;
  d = d.slice(0, 11);
  let s = '+7';
  if (d.length > 1) s += ' (' + d.slice(1, 4);
  if (d.length >= 4) s += ')';
  if (d.length > 4) s += ' ' + d.slice(4, 7);
  if (d.length > 7) s += '-' + d.slice(7, 9);
  if (d.length > 9) s += '-' + d.slice(9, 11);
  return s;
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches('input[type=tel]') && !e.inputType?.startsWith('delete')) el.value = phoneView(el.value);
  if (el.matches('input[data-plate]')) el.value = plateView(plateRaw(el.value));
});

// ---------- справочник авто (cars-base.ru) ----------
let carsPromise;
const loadCars = () => (carsPromise ||= fetch('/cars.json').then((r) => r.json()).catch(() => []));
const findMake = (cars, v) => { const s = v.trim().toLowerCase(); return s && cars.find((m) => m[0].toLowerCase() === s || (m[1] && m[1].toLowerCase() === s)); };

// ---------- тема: как в системе / светлая / тёмная ----------
const THEMES = { auto: ['🖥', 'Тема: как в системе'], light: ['☀️', 'Тема: светлая'], dark: ['🌙', 'Тема: тёмная'] };
const getTheme = () => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } };
function setTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { t === 'auto' ? localStorage.removeItem('theme') : localStorage.setItem('theme', t); } catch {}
}
const nextTheme = { auto: 'light', light: 'dark', dark: 'auto' };

// ---------- Telegram: подключение уведомлений ----------
async function tgCard(box, text) {
  const t = await api('/api/me/telegram').catch(() => ({ enabled: false }));
  if (!t.enabled) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="card" style="margin:16px 0">
    <h3>✈ Уведомления в Telegram</h3>
    ${t.linked
      ? `<div>✅ Telegram подключён. ${text}</div><button class="btn small ghost" id="tg-off" style="margin-top:10px">Отключить</button>`
      : `<div class="muted">${text}</div><a class="btn small" style="margin-top:10px" href="${esc(t.link)}" target="_blank" rel="noopener" id="tg-on">Подключить Telegram</a>
         <div class="muted" style="margin-top:6px">Откроется бот — нажмите «Start/Запустить», затем вернитесь сюда.</div>`}
  </div>`;
  const off = box.querySelector('#tg-off');
  if (off) off.onclick = async () => { await api('/api/me/telegram', undefined, 'DELETE'); tgCard(box, text); };
  const on = box.querySelector('#tg-on');
  if (on) on.onclick = () => setTimeout(function poll(n = 0) { tgCard(box, text).then(() => { if (n < 20 && box.querySelector('#tg-on')) setTimeout(() => poll(n + 1), 3000); }); }, 4000);
}

// ---------- изображения ----------
// Сжимаем фото в браузере до 1600px, чтобы не грузить сервер многомегабайтными файлами
function shrinkImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось обработать фото'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => reject(new Error('Это не картинка'));
    img.src = URL.createObjectURL(file);
  });
}
async function uploadImage(file) {
  const blob = await shrinkImage(file);
  const r = await fetch('/api/admin/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Ошибка загрузки');
  return d.url;
}
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
function baSlider(w) {
  if (!w.before_img) return `<div class="ba"><img src="${esc(w.after_img)}" alt="${esc(w.title)}" loading="lazy"></div>`;
  return `<div class="ba"><img src="${esc(w.after_img)}" alt="После" loading="lazy"><img class="ba-before" src="${esc(w.before_img)}" alt="До" loading="lazy">
    <span class="ba-tag" style="left:8px">До</span><span class="ba-tag" style="right:8px">После</span><div class="ba-line"></div>
    <input type="range" min="0" max="100" value="50" aria-label="Сравнить до и после"></div>`;
}
function bindSliders(root) {
  root.querySelectorAll('.ba input').forEach((r) => (r.oninput = () => {
    const ba = r.closest('.ba');
    ba.querySelector('.ba-before').style.clipPath = `inset(0 ${100 - r.value}% 0 0)`;
    ba.querySelector('.ba-line').style.left = r.value + '%';
  }));
}
async function homeExtras() {
  const [works, reviews] = await Promise.all([api('/api/works').catch(() => []), api('/api/reviews').catch(() => [])]);
  const ws = document.getElementById('works-sec'), rs = document.getElementById('reviews-sec');
  if (ws && works.length) {
    ws.innerHTML = `<section><h2>Наши работы</h2><p class="muted">Потяните ползунок, чтобы сравнить «до» и «после»</p>
      <div class="grid">${works.map((w) => `<div class="card work">${baSlider(w)}${w.title ? `<h3>${esc(w.title)}</h3>` : ''}</div>`).join('')}</div>
      ${TG_CHANNEL ? `<p><a class="btn ghost small" href="${esc(TG_CHANNEL)}" target="_blank" rel="noopener">Больше работ в Telegram-канале</a></p>` : ''}</section>`;
    bindSliders(ws);
  }
  if (rs && reviews.length) {
    const avg = (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1);
    rs.innerHTML = `<section><h2>Отзывы <span class="stars" style="font-size:18px">★ ${avg}</span></h2>
      <div class="grid">${reviews.slice(0, 9).map((r) => `<div class="card review"><div class="stars">${stars(r.rating)}</div><div>${esc(r.text)}</div>
        <div class="muted"><span class="who">${esc(r.name)}</span>${r.car ? ' · ' + esc(r.car) : ''}${r.source ? ' · ' + esc(r.source) : ''}</div></div>`).join('')}</div></section>`;
  }
}

// ---------- админка: галерея и отзывы ----------
async function adminWorks(c) {
  const works = await api('/api/works');
  c.innerHTML = `<div class="card" style="margin-bottom:16px"><h3>Добавить работу</h3>
      <p class="muted">Фото «до» необязательно. Большие фото автоматически сжимаются.</p>
      <label>Название (например: «BMW X5 — полировка и керамика»)</label><input id="w-title" maxlength="120">
      <div class="grid" style="margin-top:4px"><div><label>Фото «до»</label><input type="file" id="w-before" accept="image/*"></div>
      <div><label>Фото «после» *</label><input type="file" id="w-after" accept="image/*"></div></div>
      <button class="btn" id="w-add" style="margin-top:14px">Добавить</button></div>
    ${works.length ? `<div class="grid">${works.map((w) => `<div class="card work">${baSlider(w)}<h3>${esc(w.title) || '<span class="muted">без названия</span>'}</h3>
      <button class="btn small danger" data-del="${w.id}" style="margin-top:8px">Удалить</button></div>`).join('')}</div>` : '<div class="empty">Работ пока нет — они появятся на главной, как только добавите первую.</div>'}`;
  bindSliders(c);
  c.querySelector('#w-add').onclick = async (e) => {
    const bf = c.querySelector('#w-before').files[0], af = c.querySelector('#w-after').files[0];
    if (!af) return toast('Выберите фото «после»', 1);
    e.target.disabled = true; e.target.textContent = 'Загружаю…';
    try {
      const [before_img, after_img] = await Promise.all([bf ? uploadImage(bf) : '', uploadImage(af)]);
      await api('/api/admin/works', { title: c.querySelector('#w-title').value, before_img, after_img });
      toast('Работа добавлена'); adminWorks(c);
    } catch (er) { toast(er.message, 1); e.target.disabled = false; e.target.textContent = 'Добавить'; }
  };
  c.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Удалить работу вместе с фото?')) return;
    await api(`/api/admin/works/${b.dataset.del}`, undefined, 'DELETE'); adminWorks(c);
  }));
}
async function adminReviews(c) {
  const list = await api('/api/admin/reviews');
  c.innerHTML = `<details class="card" style="margin-bottom:16px"><summary><b>+ Добавить отзыв вручную</b> <span class="muted">(например, с Авито или Яндекс Карт)</span></summary>
      <form id="rf" class="form" style="margin:0;max-width:520px"><label>Имя</label><input name="name" required maxlength="80">
      <label>Авто</label><input name="car" maxlength="120"><label>Источник</label><input name="source" maxlength="40" placeholder="Авито, Яндекс Карты, Telegram…">
      <label>Оценка</label><select name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${stars(n)}</option>`).join('')}</select>
      <label>Текст</label><textarea name="text" required maxlength="1500"></textarea><button class="btn" style="margin-top:12px">Добавить</button></form></details>
    ${list.length ? `<div class="steps">${list.map((r) => `<div class="card review" style="${r.approved ? '' : 'border-color:var(--warn)'}">
      <div><span class="stars">${stars(r.rating)}</span> ${r.approved ? '<span class="badge st-done">Опубликован</span>' : '<span class="badge st-new">Ждёт одобрения</span>'}</div>
      <div>${esc(r.text)}</div><div class="muted">${esc(r.name)}${r.car ? ' · ' + esc(r.car) : ''}${r.source ? ' · ' + esc(r.source) : ''} · ${esc(r.created_at.slice(0, 10))}</div>
      <div><button class="btn small ${r.approved ? 'ghost' : ''}" data-ap="${r.id}" data-v="${r.approved ? 0 : 1}">${r.approved ? 'Скрыть' : 'Опубликовать'}</button>
        <button class="btn small danger" data-del="${r.id}">Удалить</button></div></div>`).join('')}</div>`
      : '<div class="empty">Отзывов пока нет. Клиенты могут оставить отзыв в личном кабинете после выполненного заказа.</div>'}`;
  c.querySelector('#rf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/admin/reviews', formData(e.target)); toast('Отзыв добавлен'); adminReviews(c); } catch (er) { toast(er.message, 1); }
  };
  c.querySelectorAll('[data-ap]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/reviews/${b.dataset.ap}`, { approved: b.dataset.v === '1' }, 'PATCH'); adminReviews(c); }));
  c.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (confirm('Удалить отзыв?')) { await api(`/api/admin/reviews/${b.dataset.del}`, undefined, 'DELETE'); adminReviews(c); } }));
}
function reviewForm(box, orderId) {
  let rating = 5;
  box.innerHTML = `<div class="rate-pick">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-r="${n}" class="on">★</button>`).join('')}</div>
    <textarea placeholder="Как вам результат?" maxlength="1500"></textarea>
    <button class="btn small" style="margin-top:8px">Отправить отзыв</button>`;
  const paint = () => box.querySelectorAll('[data-r]').forEach((b) => b.classList.toggle('on', Number(b.dataset.r) <= rating));
  box.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { rating = Number(b.dataset.r); paint(); }));
  box.querySelector('.btn').onclick = async () => {
    try { await api('/api/reviews', { order_id: orderId, rating, text: box.querySelector('textarea').value }); box.innerHTML = '<div>Спасибо за отзыв! Он появится на сайте после проверки.</div>'; }
    catch (e) { toast(e.message, 1); }
  };
}

// ---------- «Заказать звонок?» у кнопки телефона ----------
function callBubble() {
  const b = document.createElement('div');
  b.className = 'call-bubble'; b.textContent = 'Заказать звонок?';
  b.onclick = () => {
    b.classList.remove('show');
    if ((location.hash.slice(1) || '/').split('?')[0] !== '/') { location.hash = '#/'; setTimeout(() => scrollTo('lead'), 400); } else scrollTo('lead');
    setTimeout(() => document.querySelector('#lf [name=name]')?.focus(), 700);
  };
  document.body.appendChild(b);
  const show = () => {
    const home = (location.hash.slice(1) || '/').split('?')[0] === '/';
    if (!home || document.hidden) return;
    b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), 5000);
  };
  setTimeout(show, 20000);   // первый раз — через 20 секунд на сайте
  setInterval(show, 120000); // дальше — раз в 2 минуты
}

// ---------- профиль и гараж ----------
const avatarHtml = (u, size = 32) => u.avatar
  ? `<img class="ava" src="${esc(u.avatar)}" alt="" style="width:${size}px;height:${size}px">`
  : `<span class="ava ava-empty" style="width:${size}px;height:${size}px;font-size:${size * 0.42}px">${esc((u.name || '?')[0].toUpperCase())}</span>`;
const carTitle = (c) => [c.make, c.model, c.year].filter(Boolean).join(' ');

function carForm(box, car, onSaved) {
  box.innerHTML = `<form class="card car-form">
    <div class="grid">
      <div><label>Марка *</label><input name="make" list="cf-makes" required maxlength="60" autocomplete="off" value="${esc(car.make || '')}"><datalist id="cf-makes"></datalist></div>
      <div><label>Модель</label><input name="model" list="cf-models" maxlength="60" autocomplete="off" value="${esc(car.model || '')}"><datalist id="cf-models"></datalist></div>
      <div><label>Год выпуска</label><input name="year" type="number" min="1950" max="${new Date().getFullYear() + 1}" value="${car.year || ''}"></div>
      <div><label>Госномер</label><input name="plate" data-plate maxlength="12" autocomplete="off" placeholder="А 123 ВС 777" value="${esc(plateView(car.plate || ''))}" style="text-transform:uppercase"></div>
      <div><label>Тип кузова</label>${bodySelect('name="body"', car.body || '')}</div>
      <div><label>Класс</label>${classSelect('name="car_class"', car.car_class || '')}<div class="muted" id="cf-cls-note"></div></div>
      <div><label>Цвет</label><input name="color" maxlength="30" value="${esc(car.color || '')}"></div>
      <div><label>VIN</label><input name="vin" maxlength="17" value="${esc(car.vin || '')}" style="text-transform:uppercase"></div>
    </div>
    <label>Заметка (плёнка, особенности, пожелания)</label><input name="note" maxlength="200" value="${esc(car.note || '')}">
    <div style="margin-top:12px;display:flex;gap:8px"><button class="btn small">${car.id ? 'Сохранить' : 'Добавить в гараж'}</button><button type="button" class="btn small ghost" data-cancel>Отмена</button></div>
  </form>`;
  const f = box.querySelector('form');
  loadCars().then((cars) => {
    const setModels = () => { const m = findMake(cars, f.make.value); f.querySelector('#cf-models').innerHTML = m ? m[3].map((x) => `<option value="${esc(x[0])}">${esc([x[1], x[3] && `${x[3]}–${x[4] || 'н.в.'}`].filter(Boolean).join(' · '))}</option>`).join('') : ''; };
    // класс и годы выпуска — из справочника
    const syncModel = () => {
      const md = findModel(cars, f.make.value, f.model.value);
      f.car_class.disabled = !!(md && md[2]);
      if (md && md[2]) f.car_class.value = md[2];
      if (md && md[3]) { f.year.min = md[3]; f.year.max = md[4] || new Date().getFullYear() + 1; f.year.placeholder = `${md[3]}–${md[4] || 'н.в.'}`; }
      f.querySelector('#cf-cls-note').textContent = md && md[2] ? 'по справочнику' : '';
    };
    f.querySelector('#cf-makes').innerHTML = cars.map((m) => `<option value="${esc(m[0])}">${esc(m[1])}</option>`).join('');
    setModels(); syncModel();
    f.make.onchange = () => { const m = findMake(cars, f.make.value); if (m) f.make.value = m[0]; setModels(); syncModel(); };
    f.model.onchange = syncModel;
  });
  f.querySelector('[data-cancel]').onclick = () => (box.innerHTML = '');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(f); d.plate = plateRaw(d.plate); d.car_class = f.car_class.value;
    if (!plateOk(d.plate)) return toast('Госномер в формате А 123 ВС 777', 1);
    try {
      const r = await api(car.id ? `/api/me/cars/${car.id}` : '/api/me/cars', d, car.id ? 'PUT' : 'POST');
      toast(r.matches ? `Сохранено. Нашли прошлые заказы на этот номер (${r.matches}) — администратор привяжет их к вашему профилю.` : 'Сохранено');
      onSaved();
    } catch (er) { toast(er.message, 1); }
  };
}

pages['/profile'] = async () => {
  if (!me) return (location.hash = '#/login?next=profile');
  const { user, cars, stats } = await api('/api/me/profile');
  $app.innerHTML = `
  <div class="profile-head card">
    <label class="ava-up" title="Сменить фото">${avatarHtml(user, 96)}<span>📷</span><input type="file" accept="image/*" id="ava-file" hidden></label>
    <div><h1 style="margin:0">${esc(user.name)}</h1><div class="muted">${esc(phoneView(user.phone))} · ${ROLE[user.role]} · с ${esc(user.created_at.slice(0, 10))}</div>
      <div class="muted" style="margin-top:6px">Заказов: <b>${stats.orders}</b> · Выполнено работ на <b>${rub(stats.spent)}</b></div></div>
  </div>
  <div class="two" style="margin-top:16px">
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">🚗 Мой гараж</h2><button class="btn small" id="car-add">+ Добавить авто</button></div>
      <div id="car-form-box" style="margin-top:12px"></div>
      <div class="grid garage" style="margin-top:12px">${cars.length ? cars.map((c) => `<div class="card">
        <h3>${esc(carTitle(c))}</h3>
        ${c.plate ? `<span class="plate">${esc(plateView(c.plate))}</span>` : ''}
        ${carMeta(c) ? `<div class="muted" style="margin-top:6px">${esc(carMeta(c))}</div>` : ''}
        <div class="muted" style="margin-top:6px">${[c.color, c.vin && 'VIN ' + c.vin].filter(Boolean).map(esc).join(' · ')}</div>
        ${c.note ? `<div class="muted">📝 ${esc(c.note)}</div>` : ''}
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><a class="btn small" href="#/book?car=${c.id}">Записать</a>
          <button class="btn small ghost" data-edit="${c.id}">Изменить</button><button class="btn small ghost" data-del="${c.id}">Удалить</button></div>
      </div>`).join('') : '<div class="empty">Добавьте свой автомобиль — при записи не придётся вводить данные заново, а по госномеру мы найдём историю обслуживания.</div>'}</div>
    </div>
    <div>
      <form class="card" id="pf"><h3>Личные данные</h3>
        <label>Имя</label><input name="name" value="${esc(user.name)}" required maxlength="80">
        <label>Телефон</label><input value="${esc(phoneView(user.phone))}" disabled>
        <div class="muted" style="margin-top:4px">Телефон — ваш логин и ключ к истории заказов. Чтобы сменить, напишите нам.</div>
        <button class="btn small" style="margin-top:12px">Сохранить</button></form>
      <div id="tg-box"></div>
      <details class="card"><summary>Сменить пароль</summary>
        <form id="pw" style="margin:0"><label>Старый пароль</label><input name="old" type="password" required>
        <label>Новый пароль</label><input name="password" type="password" minlength="6" required>
        <button class="btn small" style="margin-top:10px">Сохранить</button></form></details>
    </div>
  </div>`;
  const fbox = document.getElementById('car-form-box');
  document.getElementById('car-add').onclick = () => carForm(fbox, {}, route);
  $app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => { carForm(fbox, cars.find((c) => c.id === Number(b.dataset.edit)), route); fbox.scrollIntoView({ behavior: 'smooth' }); }));
  $app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { if (confirm('Удалить авто из гаража?')) { await api(`/api/me/cars/${b.dataset.del}`, undefined, 'DELETE'); route(); } }));
  document.getElementById('ava-file').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const blob = await shrinkImage(file, 400);
      const r = await fetch('/api/me/avatar', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      me.avatar = d.url; toast('Фото обновлено'); route();
    } catch (er) { toast(er.message || 'Ошибка загрузки', 1); }
  };
  document.getElementById('pf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/me', formData(e.target), 'PATCH'); me = await api('/api/me'); toast('Сохранено'); route(); } catch (er) { toast(er.message, 1); }
  };
  document.getElementById('pw').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/me/password', formData(e.target)); toast('Пароль изменён'); e.target.reset(); } catch (er) { toast(er.message, 1); }
  };
  tgCard(document.getElementById('tg-box'), 'Напомним о записи за день до визита и сообщим, когда автомобиль будет готов.');
};

// ---------- router ----------
async function refreshServices() { services = await api('/api/services'); }
async function route() {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  renderNav();
  document.body.classList.toggle('wide', path === '/admin');
  try {
    if (path.startsWith('/order/')) await pages['/order'](path.slice(7));
    else await (pages[path] || pages['/'])();
  } catch (e) { $app.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
function floatButtons() {
  const d = document.createElement('div');
  d.className = 'fab';
  d.innerHTML = `${TG[0] ? `<a href="https://t.me/${esc(TG[0][0])}" target="_blank" rel="noopener" class="fab-tg" title="Telegram">✈</a>` : ''}
    <a href="tel:${tel()}" class="fab-tel" title="Позвонить">📞</a>`;
  document.body.appendChild(d);
  const m = document.createElement('a');
  m.className = 'mobile-cta btn'; m.href = '#/book'; m.textContent = 'Записаться онлайн';
  document.body.appendChild(m);
}
(async () => {
  [me, settings] = await Promise.all([api('/api/me'), api('/api/settings')]);
  await refreshServices();
  applyBrand();
  floatButtons();
  callBubble();
  route();
})();
