// Minimal vanilla-JS UI. All forms/filters are built from attribute metadata
// fetched from the API — that metadata-driven rendering is the whole point of EAV.

const $ = (id) => document.getElementById(id);
let CATEGORIES = [];
const byCode = (code) => CATEGORIES.find((c) => c.code === code);

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// ---- init -------------------------------------------------------------------

async function init() {
  CATEGORIES = await api('/api/categories');
  for (const sel of ['filter-category', 'seed-category', 'form-category']) {
    $(sel).innerHTML = CATEGORIES.map((c) => `<option value="${c.code}">${c.label}</option>`).join('');
  }
  $('filter-category').addEventListener('change', renderFilterFields);
  $('form-category').addEventListener('change', renderFormFields);
  $('seed-category').addEventListener('change', renderSeedAttrs);
  $('apply-filter').addEventListener('click', () => applyFilter(1));
  $('run-seed').addEventListener('click', runSeed);
  $('save-product').addEventListener('click', saveProduct);
  $('reset-form').addEventListener('click', resetForm);

  await renderFilterFields();
  renderFormFields();
  renderSeedAttrs();
}

// ---- filter panel -----------------------------------------------------------

async function renderFilterFields() {
  const cat = byCode($('filter-category').value);
  const host = $('filter-fields');
  host.innerHTML = '';

  for (const a of cat.attributes.filter((a) => a.is_filterable)) {
    const label = `${a.label}${a.unit ? ` (${a.unit})` : ''}`;
    if (a.data_type === 'text') {
      const values = await api(`/api/attributes/${a.code}/values`);
      host.insertAdjacentHTML('beforeend',
        `<label>${label}</label><select data-code="${a.code}" data-kind="text">
           <option value="">any</option>${values.map((v) => `<option>${v}</option>`).join('')}
         </select>`);
    } else if (a.data_type === 'bool') {
      host.insertAdjacentHTML('beforeend',
        `<label>${label}</label><select data-code="${a.code}" data-kind="bool">
           <option value="">any</option><option value="true">yes</option><option value="false">no</option>
         </select>`);
    } else { // number / date
      const t = a.data_type === 'date' ? 'date' : 'number';
      host.insertAdjacentHTML('beforeend',
        `<label>${label}</label><div class="row">
           <input type="${t}" data-code="${a.code}" data-kind="min" placeholder="min" />
           <input type="${t}" data-code="${a.code}" data-kind="max" placeholder="max" />
         </div>`);
    }
  }

  // sort options: sortable attributes + relational columns
  const sortable = cat.attributes.filter((a) => a.is_sortable);
  $('sort-by').innerHTML =
    `<option value="">(none)</option><option value="price">Price</option><option value="name">Name</option>` +
    sortable.map((a) => `<option value="${a.code}">${a.label}</option>`).join('');
}

function buildFilterQuery(page) {
  const params = new URLSearchParams();
  params.set('category', $('filter-category').value);
  if ($('filter-price').value) params.set('price_lt', $('filter-price').value);

  for (const el of $('filter-fields').querySelectorAll('[data-code]')) {
    const { code, kind } = el.dataset;
    if (!el.value) continue;
    if (kind === 'text' || kind === 'bool') params.set(`f_${code}`, el.value);
    else if (kind === 'min') params.set(`f_${code}_gte`, el.value);
    else if (kind === 'max') params.set(`f_${code}_lte`, el.value);
  }

  if ($('sort-by').value) { params.set('sort', $('sort-by').value); params.set('dir', $('sort-dir').value); }
  params.set('page', page);
  if ($('show-sql').checked) params.set('explain', '1');
  return params;
}

async function applyFilter(page) {
  try {
    const params = buildFilterQuery(page);
    const data = await api('/api/products?' + params.toString());
    renderResults(data);
  } catch (e) {
    $('results-meta').textContent = 'Error: ' + e.message;
  }
}

function renderResults(data) {
  $('results-meta').innerHTML =
    `<b>${data.total.toLocaleString()}</b> match · showing page ${data.page} · query ${data.ms}ms` +
    (data.filters?.length ? ` · filters: ${data.filters.map((f) => `${f.field} ${f.op} ${f.value}`).join(', ')}` : '');

  const cols = ['id', 'sku', 'name', 'price', 'category'];
  $('results').querySelector('thead').innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`;
  $('results').querySelector('tbody').innerHTML = data.items.map((r) =>
    `<tr data-id="${r.id}">${cols.map((c) => `<td>${r[c]}</td>`).join('')}</tr>`).join('');
  for (const tr of $('results').querySelectorAll('tbody tr')) {
    tr.addEventListener('click', () => loadForEdit(tr.dataset.id));
  }

  const box = $('sql-box');
  if (data.sql) {
    box.classList.remove('hidden');
    box.textContent = data.sql + '\n\n-- params: ' + JSON.stringify(data.values) +
      '\n\n' + (data.explain || []).join('\n');
  } else {
    box.classList.add('hidden');
  }
}

// ---- create / update panel --------------------------------------------------

function renderFormFields() {
  const cat = byCode($('form-category').value);
  $('form-fields').innerHTML = cat.attributes.map((a) => {
    const label = `${a.label}${a.unit ? ` (${a.unit})` : ''}`;
    if (a.data_type === 'bool') {
      return `<label>${label}</label><select data-code="${a.code}" data-type="bool">
                <option value="">—</option><option value="true">yes</option><option value="false">no</option></select>`;
    }
    const t = a.data_type === 'number' ? 'number' : a.data_type === 'date' ? 'date' : 'text';
    return `<label>${label}</label><input type="${t}" data-code="${a.code}" data-type="${a.data_type}" />`;
  }).join('');
}

async function loadForEdit(id) {
  const p = await api('/api/products/' + id);
  $('form-title').textContent = 'Edit product #' + id;
  $('edit-id').value = id;
  $('form-category').value = p.category;
  renderFormFields();
  $('form-sku').value = p.sku;
  $('form-name').value = p.name;
  $('form-price').value = p.price;
  for (const el of $('form-fields').querySelectorAll('[data-code]')) {
    const v = p.attributes[el.dataset.code];
    if (v !== undefined && v !== null) el.value = v;
  }
  $('form-status').textContent = '';
  window.scrollTo(0, document.body.scrollHeight);
}

function resetForm() {
  $('form-title').textContent = 'Create product';
  $('edit-id').value = '';
  $('form-sku').value = $('form-name').value = $('form-price').value = '';
  renderFormFields();
  $('form-status').textContent = '';
}

async function saveProduct() {
  const attributes = {};
  for (const el of $('form-fields').querySelectorAll('[data-code]')) {
    if (el.value === '') continue;
    attributes[el.dataset.code] = el.value;
  }
  const body = {
    sku: $('form-sku').value,
    name: $('form-name').value,
    category: $('form-category').value,
    price: parseFloat($('form-price').value),
    attributes,
  };
  const id = $('edit-id').value;
  try {
    const saved = id
      ? await api('/api/products/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await api('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    $('form-status').textContent = `Saved product #${saved.id}`;
    if (!id) resetForm();
  } catch (e) {
    $('form-status').textContent = 'Error: ' + e.message;
  }
}

// ---- seed panel -------------------------------------------------------------

function renderSeedAttrs() {
  const cat = byCode($('seed-category').value);
  $('seed-attrs').innerHTML = cat.attributes.map((a) =>
    `<label class="check"><input type="checkbox" data-code="${a.code}" checked /> ${a.label}</label>`).join('');
}

async function runSeed() {
  const attributes = {};
  for (const el of $('seed-attrs').querySelectorAll('[data-code]')) {
    attributes[el.dataset.code] = { enabled: el.checked };
  }
  const body = {
    category: $('seed-category').value,
    count: parseInt($('seed-count').value, 10),
    attributes,
  };
  $('seed-status').textContent = 'Generating…';
  try {
    const r = await api('/api/seed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    $('seed-status').textContent = `Inserted ${r.inserted} ${r.category} products in ${r.ms}ms`;
  } catch (e) {
    $('seed-status').textContent = 'Error: ' + e.message;
  }
}

init().catch((e) => { document.body.insertAdjacentHTML('afterbegin', `<pre>Init failed: ${e.message}</pre>`); });
