// 영수증 OCR 정적 데모 (GitHub Pages). 서버 없이 data/results.json 만 읽는다
// 결과 파일은 web/scripts/export-demo.js 로 로컬에서 만든다. 화면 모양은 web/public/app.js 와 같다

const STATUS_LABEL = { CONFIRMED: '확정', REVIEW_REQUIRED: '검토 필요' };
const ENGINE_LABEL = { paddle: 'PaddleOCR', tesseract: 'tesseract.js' };

const $ = (s) => document.querySelector(s);
const won = (n) => (n == null ? '' : Number(n).toLocaleString('ko-KR'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v) => (v == null ? '' : Math.round(v * 100) + '%');

let data = { results: [] };
let shownId = null;

// ── 결과 ─────────────────────────────────────────────────

function field(label, value) {
  const empty = value == null || value === '';
  return `<div><dt>${label}</dt><dd class="${empty ? 'none' : ''}">${empty ? '인식 안 됨' : value}</dd></div>`;
}

function issueItems(issues) {
  if (!issues.length) return '<li class="pass">모든 검증을 통과했습니다</li>';
  return issues.map((i) => `<li><span>${esc(i.message)} <code>${esc(i.code)}</code></span></li>`).join('');
}

function show(id) {
  const r = data.results.find((x) => x.id === id);
  if (!r) return;
  shownId = id;
  document.querySelectorAll('.sample').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.id) === id));
  document.querySelectorAll('#rows tr[data-id]').forEach((tr) => tr.classList.toggle('is-active', Number(tr.dataset.id) === id));

  $('#preview').src = 'samples/' + r.file;
  $('#result-file').textContent = `샘플 · ${r.name} (${r.file})`;
  $('#result').hidden = false;

  const conf = r.confidence ?? 0;
  const payment = r.paymentMethod ? esc(r.paymentMethod) + (r.cardLast4 ? ` (끝 ${esc(r.cardLast4)})` : '') : null;
  const engine = ENGINE_LABEL[data.engine] ?? esc(data.engine);
  $('#extract').innerHTML = `
    <div class="extract-head">
      <div>
        <div class="merchant${r.merchant ? '' : ' empty'}">${r.merchant ? esc(r.merchant) : '가맹점 인식 안 됨'}</div>
        <div class="meta">#${r.id} · ${engine} · 처리 ${(r.ms / 1000).toFixed(1)}초 (저장된 결과)</div>
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

    <p class="local-only">${
      r.status === 'REVIEW_REQUIRED' ? '"검토하고 확정하기"' : '"값 수정하기"'
    }(수정 → 재검증 → DB 저장)는 MySQL이 필요해 이 데모에서는 뺐습니다. 로컬에서 <code>npm start</code>로 실행하면 쓸 수 있습니다.</p>

    <details class="raw"><summary>OCR 원문 보기 (카드번호 마스킹됨)</summary><pre>${esc(r.rawText || '')}</pre></details>`;
}

// ── 목록 ─────────────────────────────────────────────────

function renderRows() {
  const status = $('#f-status').value;
  const rows = data.results.filter((r) => !status || r.status === status);
  $('#list-count').textContent = `${rows.length}건`;
  $('#rows').innerHTML =
    rows
      .map(
        (r) => `
      <tr data-id="${r.id}" class="${r.id === shownId ? 'is-active' : ''}">
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
      </tr>`,
      )
      .join('') || '<tr class="empty"><td colspan="10">조건에 맞는 결과가 없습니다.</td></tr>';
}

// ── 이벤트 ───────────────────────────────────────────────

$('#samples').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-id]');
  if (!btn) return;
  show(Number(btn.dataset.id));
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#rows').addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-id]');
  if (!tr) return;
  show(Number(tr.dataset.id));
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#f-status').addEventListener('change', renderRows);

fetch('data/results.json')
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then((d) => {
    data = d;
    const day = d.generatedAt ? d.generatedAt.slice(0, 10) : '';
    $('#data-info').textContent = `${ENGINE_LABEL[d.engine] ?? d.engine} · ${day} 처리 결과`;
    $('#samples').innerHTML = d.results
      .map(
        (s) => `
      <button type="button" class="sample" data-id="${s.id}" aria-label="${esc(s.name)} 샘플 결과 보기">
        <img src="samples/${esc(s.file)}" alt="" loading="lazy">
        <span class="sample-text"><span class="sample-name">${esc(s.name)}</span><span class="sample-note">${esc(s.note)}</span></span>
      </button>`,
      )
      .join('');
    renderRows();
  })
  .catch((e) => {
    $('#samples').innerHTML = `<div class="error-box" role="alert"><strong>저장된 결과를 불러오지 못했습니다</strong>${esc(e.message)}</div>`;
    $('#rows').innerHTML = '<tr class="empty"><td colspan="10">결과 없음</td></tr>';
  });
