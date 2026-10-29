// 영수증 OCR 데모 화면. 빌드 없이 브라우저에서 바로 실행되는 vanilla JS
// API: POST /api/receipts, GET /api/receipts, PATCH /api/receipts/:id, GET /api/receipts/export.csv

const CATEGORIES = ['식대', '교통비', '사무용품', '접대비', '통신비', '기타'];
const STATUS_LABEL = { CONFIRMED: '확정', REVIEW_REQUIRED: '검토 필요' };
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_BYTES = 5 * 1024 * 1024;
// web/public/samples/ 의 가상 영수증 (저장소 samples/ 의 복사본)
const SAMPLES = [
  { file: 'receipt01_cafe.png', name: '카페', note: '공급가액·부가세' },
  { file: 'receipt02_stationery.jpg', name: '문구점', note: '할인 · 1.5° 회전' },
  { file: 'receipt03_taxi.jpg', name: '택시', note: '2자리 연도 · 블러' },
  { file: 'receipt04_restaurant.jpg', name: '식당', note: '회전 · 블러 · 저대비' },
  { file: 'receipt05_convenience.jpg', name: '편의점', note: '현금 · 거스름돈' },
];

const $ = (s) => document.querySelector(s);
const won = (n) => (n == null ? '' : Number(n).toLocaleString('ko-KR'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v == null ? '' : Math.round(v * 100) + '%');

let records = []; // 처리 내역
let shownId = null; // 결과 영역에 표시 중인 영수증 id
let previewUrl = null;
let busy = false;
let demoMode = false; // /api/config 로 받는다

async function api(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `HTTP ${res.status}`);
  return body.data;
}

let toastTimer;
function toast(text, isErr = false) {
  const t = $('#toast');
  t.textContent = text;
  t.className = `toast show${isErr ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3200);
}

// ── 업로드 ───────────────────────────────────────────────

function setBusy(on) {
  busy = on;
  $('#dropzone').classList.toggle('is-busy', on);
  $('#file').disabled = on;
  document.querySelectorAll('.sample').forEach((b) => (b.disabled = on));
}

function checkFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return `jpg, png, webp 이미지만 올릴 수 있습니다 (${file.name})`;
  if (file.size > MAX_BYTES) return '파일 크기는 5MB 이하여야 합니다';
  return null;
}

function processFile(file, label = file.name) {
  if (busy) return;
  const invalid = checkFile(file);
  if (invalid) return toast(invalid, true);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  // 원본은 브라우저 안에서만 미리 보기 (서버는 처리 후 원본을 삭제)
  previewUrl = URL.createObjectURL(file);
  const fd = new FormData();
  fd.append('image', file, file.name);
  return runOcr(() => api('/api/receipts', { method: 'POST', body: fd }), previewUrl, label);
}

/** 서버에 있는 샘플 이미지를 처리 (업로드가 꺼진 데모에서도 동작) */
function processSample(s) {
  if (busy) return;
  return runOcr(
    () => api('/api/receipts/samples/' + encodeURIComponent(s.file), { method: 'POST' }),
    'samples/' + s.file,
    `샘플 · ${s.name} (${s.file})`,
  );
}

async function runOcr(request, previewSrc, label) {
  setBusy(true);
  showPreview(previewSrc, label);
  const stop = renderLoading();
  try {
    const r = await request();
    stop();
    shownId = r.id;
    renderResult(r);
    await loadRecords();
  } catch (e) {
    stop();
    shownId = null;
    renderError(e.message);
  } finally {
    setBusy(false);
  }
}

function showPreview(src, label) {
  $('#preview').src = src;
  $('#result-file').textContent = label;
  $('#result').hidden = false;
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderLoading() {
  $('.preview').classList.add('is-loading');
  $('#extract').innerHTML = `
    <div class="loading">
      <div class="spinner" aria-hidden="true"></div>
      <div class="loading-title">OCR 처리 중… <span class="loading-time" id="elapsed">0.0초</span></div>
      <div class="loading-sub">전처리 → OCR → 필드 추출 → 검증 순서로 처리합니다. PaddleOCR 엔진은 건당 5초 정도 걸립니다.${
        demoMode ? ' 무료 서버라 다른 사람이 처리 중이면 조금 더 기다릴 수 있습니다.' : ''
      }</div>
    </div>`;
  const start = performance.now();
  const timer = setInterval(() => {
    const el = $('#elapsed');
    if (el) el.textContent = ((performance.now() - start) / 1000).toFixed(1) + '초';
  }, 100);
  return () => {
    clearInterval(timer);
    $('.preview').classList.remove('is-loading');
  };
}

function renderError(message) {
  $('#extract').innerHTML = `
    <div class="error-box" role="alert">
      <strong>처리하지 못했습니다</strong>${esc(message)}
    </div>`;
}

function field(label, value) {
  const empty = value == null || value === '';
  return `<div><dt>${label}</dt><dd class="${empty ? 'none' : ''}">${empty ? '인식 안 됨' : value}</dd></div>`;
}

function issueItems(issues) {
  if (!issues.length) return '<li class="pass">모든 검증을 통과했습니다</li>';
  return issues.map((i) => `<li><span>${esc(i.message)} <code>${esc(i.code)}</code></span></li>`).join('');
}

function renderResult(r) {
  const conf = r.confidence ?? 0;
  const payment = r.paymentMethod ? esc(r.paymentMethod) + (r.cardLast4 ? ` (끝 ${esc(r.cardLast4)})` : '') : null;
  $('#extract').innerHTML = `
    <div class="extract-head">
      <div>
        <div class="merchant${r.merchant ? '' : ' empty'}">${r.merchant ? esc(r.merchant) : '가맹점 인식 안 됨'}</div>
        <div class="meta">#${r.id} · ${esc(r.createdAt ?? '')}</div>
      </div>
      <span class="badge ${r.status}">${STATUS_LABEL[r.status] ?? esc(r.status)}</span>
    </div>

    <div class="total">
      <span>합계</span>
      <strong>${r.totalAmount == null ? '—' : `${won(r.totalAmount)}<small>원</small>`}</strong>
    </div>

    <dl class="fields">
      ${field('일자', r.date ? esc(r.date) + (r.time ? ' ' + esc(r.time) : '') : null)}
      ${field('계정과목', r.category ? `<span class="chip">${esc(r.category)}</span>` : null)}
      ${field('공급가액', r.supplyAmount == null ? null : won(r.supplyAmount) + '원')}
      ${field('부가세', r.vat == null ? null : won(r.vat) + '원')}
      ${field('결제수단', payment)}
      ${field('사업자번호', r.bizNo ? esc(r.bizNo) : null)}
    </dl>

    <div class="confidence">
      <div class="confidence-top"><span>종합 신뢰도 (OCR ${pct(r.ocrConfidence)} × 0.4 + 검증 × 0.6)</span><b>${pct(conf)}</b></div>
      <div class="bar"><i class="${conf < 0.75 ? 'low' : ''}" style="width:${Math.round(conf * 100)}%"></i></div>
    </div>

    <ul class="issue-list">${issueItems(r.issues)}</ul>

    <div class="extract-actions">
      <button type="button" class="btn ${r.status === 'REVIEW_REQUIRED' ? 'primary' : ''}" data-edit="${r.id}">
        ${r.status === 'REVIEW_REQUIRED' ? '검토하고 확정하기' : '값 수정하기'}
      </button>
    </div>

    <details class="raw"><summary>OCR 원문 보기 (카드번호 마스킹됨${demoMode ? ' · 데모에서는 저장하지 않음' : ''})</summary><pre>${esc(r.rawText || '')}</pre></details>`;
}

// ── 처리 내역 ───────────────────────────────────────────

function filters() {
  const p = new URLSearchParams();
  if ($('#f-status').value) p.set('status', $('#f-status').value);
  if ($('#f-from').value) p.set('from', $('#f-from').value);
  if ($('#f-to').value) p.set('to', $('#f-to').value);
  return p;
}

async function loadRecords() {
  try {
    records = await api('/api/receipts?' + filters());
  } catch (e) {
    return toast(e.message, true);
  }
  $('#list-count').textContent = `${records.length}건`;
  $('#rows').innerHTML =
    records
      .map(
        (r) => `
      <tr>
        <td data-label="ID">#${r.id}</td>
        <td data-label="상태"><span class="badge ${r.status}">${STATUS_LABEL[r.status] ?? esc(r.status)}</span></td>
        <td data-label="일자">${esc(r.date)}</td>
        <td data-label="가맹점">${esc(r.merchant)}</td>
        <td data-label="계정과목">${esc(r.category)}</td>
        <td data-label="공급가액" class="num">${won(r.supplyAmount)}</td>
        <td data-label="부가세" class="num">${won(r.vat)}</td>
        <td data-label="합계" class="num"><b>${won(r.totalAmount)}</b></td>
        <td data-label="신뢰도" class="num">${pct(r.confidence)}</td>
        <td data-label="이슈" class="issues">${r.issues.map((i) => esc(i.message)).join('<br>')}</td>
        <td data-label="" class="actions"><button type="button" class="btn small ${r.status === 'REVIEW_REQUIRED' ? 'primary' : ''}" data-edit="${r.id}">${r.status === 'REVIEW_REQUIRED' ? '검토' : '수정'}</button></td>
      </tr>`,
      )
      .join('') || '<tr class="empty"><td colspan="11">아직 처리한 영수증이 없습니다. 위에서 샘플을 눌러 보세요.</td></tr>';
}

// ── 검토·수정 창 ─────────────────────────────────────────

async function openEdit(id) {
  let r = records.find((x) => x.id === id);
  if (!r) {
    try {
      r = await api('/api/receipts/' + id);
    } catch (e) {
      return toast(e.message, true);
    }
  }
  const f = $('#edit-form');
  $('#e-id').textContent = r.id;
  for (const k of ['merchant', 'bizNo', 'date', 'category', 'supplyAmount', 'vat', 'totalAmount']) f[k].value = r[k] ?? '';
  $('#e-issues').innerHTML = r.issues.length ? issueItems(r.issues) : '';
  $('#e-raw').textContent = r.rawText || (demoMode ? '(데모 모드에서는 OCR 원문을 저장하지 않습니다)' : '');
  $('#edit').showModal();
}

$('#edit').addEventListener('close', async () => {
  const action = $('#edit').returnValue;
  if (action !== 'save' && action !== 'confirm') return;
  const f = $('#edit-form');
  const str = (v) => (v.trim() === '' ? null : v.trim());
  const num = (v) => (v === '' ? null : Number(v));
  const body = {
    merchant: str(f.merchant.value),
    bizNo: str(f.bizNo.value),
    date: str(f.date.value),
    category: f.category.value,
    supplyAmount: num(f.supplyAmount.value),
    vat: num(f.vat.value),
    totalAmount: num(f.totalAmount.value),
    confirm: action === 'confirm',
  };
  try {
    const r = await api('/api/receipts/' + $('#e-id').textContent, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    toast(`#${r.id} 저장됨 · ${STATUS_LABEL[r.status]}`);
    if (r.id === shownId) renderResult(r);
    await loadRecords();
  } catch (e) {
    toast(e.message, true);
  }
});

// ── 이벤트 ───────────────────────────────────────────────

$('#edit-form').category.innerHTML = CATEGORIES.map((c) => `<option>${c}</option>`).join('');

$('#samples').innerHTML = SAMPLES.map(
  (s) => `
  <button type="button" class="sample" data-sample="${s.file}" aria-label="${s.name} 샘플로 테스트">
    <img src="samples/${s.file}" alt="" loading="lazy">
    <span class="sample-text"><span class="sample-name">${s.name}</span><span class="sample-note">${s.note}</span></span>
  </button>`,
).join('');

$('#samples').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-sample]');
  if (!btn || busy) return;
  await processSample(SAMPLES.find((x) => x.file === btn.dataset.sample));
});

$('#file').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (file) processFile(file);
});

const dz = $('#dropzone');
['dragenter', 'dragover'].forEach((t) =>
  dz.addEventListener(t, (ev) => {
    ev.preventDefault();
    if (!busy) dz.classList.add('is-over');
  }),
);
['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('is-over')));
dz.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const file = ev.dataTransfer.files[0];
  if (file) processFile(file);
});
// 업로드 영역 밖에 떨어뜨려도 브라우저가 이미지를 열어 페이지를 떠나지 않게
['dragover', 'drop'].forEach((t) => window.addEventListener(t, (ev) => ev.preventDefault()));

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-edit]');
  if (btn) openEdit(Number(btn.dataset.edit));
});

$('#btn-search').addEventListener('click', loadRecords);
$('#btn-csv').addEventListener('click', () => {
  const p = filters();
  p.delete('status');
  location.href = '/api/receipts/export.csv?' + p;
});

// 데모 설정: 업로드가 꺼져 있으면 업로드 영역을 숨기고 샘플만 보여 준다
api('/api/config')
  .then((c) => {
    demoMode = c.demoMode;
    if (!c.uploadEnabled) {
      $('#dropzone').hidden = true;
      $('#upload-off').hidden = false;
      $('#upload-title').textContent = '샘플로 테스트';
      $('#upload-hint').textContent = '가상 영수증 5장';
    }
  })
  .catch(() => {});

loadRecords();
