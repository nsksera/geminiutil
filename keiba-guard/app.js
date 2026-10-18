/* ===== 馬券配分プランナー ロジック =====
   条件: どの馬券が的中(単体/複数)しても 払戻 >= 総掛金
   理論: 配分 x_i = 予算 * (1/o_i) / S,  S = Σ (1/o_i) <= 1 で成立
   まとめ(ボックス/ながし/フォーメーション): 入力オッズを「全組合せの最低払戻倍率」とし、
   実効オッズ e = オッズ/点数 で既存理論に統合。丸めは1点あたり100円単位を維持。
   ===== */
(() => {
'use strict';

const $ = id => document.getElementById(id);
const list = $('patternList');
const result = $('result');

/* ---------- 馬券種別 ---------- */
const BET = {
  tan:        { label: '単勝',   field: 'h', count: 1, ordered: false },
  fuku:       { label: '複勝',   field: 'h', count: 1, ordered: false },
  wakuren:    { label: '枠連',   field: 'w', count: 2, ordered: false },
  wakutan:    { label: '枠単',   field: 'w', count: 2, ordered: true  },
  umaren:     { label: '馬連',   field: 'h', count: 2, ordered: false },
  wide:       { label: 'ワイド', field: 'h', count: 2, ordered: false },
  umatan:     { label: '馬単',   field: 'h', count: 2, ordered: true  },
  sanrenpuku: { label: '3連複',  field: 'h', count: 3, ordered: false },
  sanrentan:  { label: '3連単',  field: 'h', count: 3, ordered: true  },
};

/* ---------- ユーティリティ ---------- */
const yen  = n => '¥' + (n < 0 ? '−' : '') + Math.round(Math.abs(n)).toLocaleString('ja-JP');
const yenF = n  => { const s = Number(n.toFixed(2)).toLocaleString('ja-JP', { maximumFractionDigits: 2 }); return '¥' + s; };
const lcm  = (a, b) => { const g = (x, y) => y ? g(y, x % y) : x; return a / g(a, b) * b; };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function cardRow(nameText, subText, mainText, secondaryText, isTotal) {
  const r = el('div', 'result-row' + (isTotal ? ' total' : ''));
  const left = el('div');
  left.appendChild(el('div', 'name', nameText));
  if (subText) left.appendChild(el('div', 'sub', subText));
  const right = el('div');
  right.style.textAlign = 'right';
  right.appendChild(el('div', null, mainText));
  if (secondaryText) right.appendChild(el('div', 'sub', secondaryText));
  r.append(left, right);
  return r;
}

function bannerState(state, title, desc, sValue, sDrop, dropRate) {
  const b = el('div', 'banner ' + state);
  const t = el('div', 'banner-title');
  t.appendChild(el('span', null, title));
  if (sValue != null) t.appendChild(el('span', 'badge ' + (state === 'ok' ? 'g' : 'r'), 'S = ' + sValue));
  if (sDrop != null && dropRate > 0) {
    const okDrop = Number(sDrop) <= 1 + 1e-9;
    t.appendChild(el('span', 'badge ' + (okDrop ? 'g' : 'r'), `下落${dropRate}%後 = ${sDrop}`));
  }
  b.appendChild(t);
  b.appendChild(el('div', 'banner-desc', desc));
  if (sValue != null) {
    const g = el('div', 'gauge');
    const f = el('div', 'gauge-fill');
    f.style.width = Math.min(sValue, 1) * 100 + '%';
    g.appendChild(f);
    b.appendChild(g);
  }
  return b;
}

/* ---------- 自動再計算 ---------- */
let calcTimer = null;
function scheduleCalc() {
  clearTimeout(calcTimer);
  calcTimer = setTimeout(runCalc, 120);
  scheduleSave();
}

/* カード追加/削除の演出（OSで「視覚効果を減らす」なら即時表示） */
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
function markEntering(card) {
  if (REDUCED_MOTION) return;
  card.classList.add('entering');
  card.addEventListener('animationend', () => card.classList.remove('entering'), { once: true });
}

/* ---------- まとめ: 組合せ生成 ---------- */
function poolCombos(st) {
  const cf = BET[st.type];
  const active = st.pools.filter(p => p.length).map(p => [...new Set(p)]);
  const res = [];
  if (!cf.ordered && active.length === 1) {
    /* ボックス: 1プールから count頭の組合せ */
    const p = active[0];
    if (p.length < cf.count) return { combos: res, count: 0 };
    const rec = (start, acc) => {
      if (acc.length === cf.count) { res.push(acc.slice()); return; }
      for (let i = start; i < p.length; i++) { acc.push(p[i]); rec(i + 1, acc); acc.pop(); }
    };
    rec(0, []);
    return { combos: res, count: res.length };
  }
  if (active.length !== cf.count) return { combos: res, count: 0 };
  /* 直積（同頭重複は除外、無順序はソート署名で重複統合） */
  const used = new Set(); const acc = [];
  const rec = idx => {
    if (idx === cf.count) {
      if (cf.ordered) res.push(acc.slice());
      else {
        const sig = acc.slice().sort((a, b) => a - b).join('-');
        if (!res.some(c => c.slice().sort((a, b) => a - b).join('-') === sig)) res.push(acc.slice());
      }
      return;
    }
    for (const v of active[idx]) {
      if (used.has(v)) continue;
      used.add(v); acc.push(v); rec(idx + 1); acc.pop(); used.delete(v);
    }
  };
  rec(0);
  return { combos: res, count: res.length };
}

function rowInfo(st, vm = 'num') {
  const cf = BET[st.type];
  if (!cf) return null;
  if (vm === 'multi') {
    const g = poolCombos(st);
    if (!g.count) return null;
    const pools = st.pools.map(p => [...new Set(p)]);
    if (!cf.ordered && pools.filter(p => p.length).length === 1) {
      const p = pools.find(p => p.length);
      return { name: `${cf.label}ボックス ${p.slice().sort((a, b) => a - b).join('-')}`, count: g.count };
    }
    return { name: `${cf.label}まとめ ${pools.map(p => p.join(',')).join(' / ')}`, count: g.count };
  }
  if (st.sel.length !== cf.count) return null;
  return { name: `${cf.label} ` + st.sel.join(cf.ordered ? '→' : '-'), count: 1 };
}

/* ---------- パターン行の生成 ---------- */
function addPatternRow() {
  const card = el('div', 'pattern-card');
  const st = { type: null, mode: 'num', dataMode: 'num', sel: [], odds: '', pools: [ [], [], [] ], focus: 0, memo: '' };
  card._st = st;

  /* 種類チップ */
  const chips = el('div', 'chips');
  for (const key of Object.keys(BET)) {
    const c = el('button', 'chip', BET[key].label);
    c.type = 'button';
    c.addEventListener('click', () => {
      st.type = st.type === key ? null : key;
      st.sel = [];
      st.focus = 0;
      const cf = st.type ? BET[st.type] : null;
      st.pools = cf ? Array.from({ length: cf.count }, () => []) : [];
      if (st.mode === 'multi' && !(cf && cf.count >= 2)) { st.mode = 'num'; st.dataMode = 'num'; }
      chips.querySelectorAll('.chip.on').forEach(x => x.classList.remove('on'));
      if (st.type === key) c.classList.add('on');
      renderKeypad();
      scheduleCalc();
    });
    chips.appendChild(c);
  }

  /* キーパッド（番号 / まとめ / オッズ） */
  const keypad = el('div', 'keypad');

  /* 下段: 状態＋オッズ＋削除 */
  const combo = el('div', 'combo', '種類を選択してください');
  const oddsDisp = el('button', 'odds-disp', 'オッズ —');
  oddsDisp.type = 'button';
  oddsDisp.addEventListener('click', () => {
    st.mode = 'odds';
    renderKeypad();
    scheduleCalc();
  });
  const del = el('button', 'del-btn', '✕');
  del.type = 'button';
  del.setAttribute('aria-label', '削除');
  let removing = false;
  del.addEventListener('click', () => {
    if (removing) return;
    removing = true;
    scheduleCalc();
    if (REDUCED_MOTION) { card.remove(); return; }
    /* 削除演出: 右へスライドしながらフェード＋高さを縮めて詰めさせる */
    card.style.overflow = 'hidden';
    card.style.minHeight = '0';
    const anim = card.animate([
      { opacity: 1, height: card.offsetHeight + 'px', transform: 'none' },
      { opacity: 0, height: '0px', transform: 'translateX(32px)' }
    ], { duration: 200, easing: 'ease-in' });
    anim.onfinish = () => card.remove();
    anim.oncancel = () => card.remove();
  });

  /* カードメモ（計算には影響しない・保存対象） */
  const memoInput = el('input', 'memo-input');
  memoInput.type = 'text';
  memoInput.placeholder = 'メモ — 軸の狙いや買い目の意図など';
  memoInput.addEventListener('input', () => { st.memo = memoInput.value; scheduleCalc(); });

  const foot = el('div', 'pattern-foot');
  foot.append(combo, oddsDisp);
  /* ✕はカード右上に浮かせて配置（行フッターから独立させた直感的な位置） */
  card.append(chips, keypad, foot, memoInput, del);
  list.appendChild(card);

  function updateOddsDisp() {
    oddsDisp.textContent = st.odds === '' ? 'オッズ —' : st.odds + '倍';
    const v = parseFloat(st.odds);
    oddsDisp.classList.toggle('set', st.odds !== '');
    oddsDisp.classList.toggle('on', st.mode === 'odds');
    oddsDisp.classList.toggle('invalid', st.odds !== '' && !(v > 1));
  }

  function refreshCombo() {
    const cf = st.type ? BET[st.type] : null;
    if (!cf) { combo.textContent = '種類を選択してください'; combo.classList.remove('set'); return; }
    const vm = st.mode === 'odds' ? st.dataMode : st.mode;
    if (vm === 'multi') {
      const g = poolCombos(st);
      const info = rowInfo(st, 'multi');
      if (!info) {
        combo.textContent = 'まとめ — 各着（各組）に番号を選択';
        combo.classList.remove('set');
      } else {
        combo.textContent = `${info.name}（${g.count}点・最低オッズ ≥ ${g.count}倍）`;
        combo.classList.add('set');
      }
      return;
    }
    const need = cf.count - st.sel.length;
    if (!st.sel.length) {
      combo.textContent = `${cf.label} — ${cf.count}点の番号を選択`;
      combo.classList.remove('set');
    } else if (need > 0) {
      combo.textContent = st.sel.join(cf.ordered ? ' → ' : ' - ') + `（あと${need}点）`;
      combo.classList.remove('set');
    } else {
      combo.textContent = `${cf.label} ` + st.sel.join(cf.ordered ? ' → ' : ' - ');
      combo.classList.add('set');
    }
  }

  /* キーパッド描画 */
  function renderKeypad() {
    keypad.replaceChildren();
    updateOddsDisp();

    /* セグメント */
    const cf = st.type ? BET[st.type] : null;
    const seg = el('div', 'seg');
    const mkSeg = (label, mode) => {
      const b = el('button', st.mode === mode ? 'on' : '', label);
      b.type = 'button';
      b.addEventListener('click', () => { if (st.mode !== mode) { st.mode = mode; if (mode !== 'odds') st.dataMode = mode; renderKeypad(); } });
      return b;
    };
    if (cf && cf.count >= 2) seg.append(mkSeg('番号', 'num'), mkSeg('まとめ', 'multi'), mkSeg('オッズ', 'odds'));
    else seg.append(mkSeg('番号', 'num'), mkSeg('オッズ', 'odds'));
    keypad.appendChild(seg);

    /* まとめ: プールタブ */
    if (st.mode === 'multi' && cf) {
      const tabs = el('div', 'pool-tabs');
      for (let i = 0; i < cf.count; i++) {
        const lbl = cf.ordered ? `${i + 1}着` : `組${i + 1}`;
        const t = el('button', 'pool-tab' + (st.focus === i ? ' on' : ''),
          lbl + (st.pools[i].length ? ' ' + st.pools[i].join(',') : ''));
        t.type = 'button';
        t.addEventListener('click', () => { st.focus = i; renderKeypad(); });
        tabs.appendChild(t);
      }
      keypad.appendChild(tabs);
    }

    const grid = el('div', 'keygrid');

    if (st.mode === 'num' || st.mode === 'multi') {
      if (!st.type) {
        keypad.appendChild(el('div', 'kp-hint', '先に馬券の種類を選択してください'));
        return;
      }
      const max = cf.field === 'w' ? 8 : 18;
      grid.style.gridTemplateColumns = cf.field === 'w' ? 'repeat(4, 1fr)' : 'repeat(6, 1fr)';

      const activeSet = () => st.mode === 'num' ? st.sel : st.pools[st.focus];

      /* 満席時に追加しようとした場合の拒否フィードバック（揺れ＋理由メッセージ） */
      let denyTimer = null;
      const denyFlash = btn => {
        btn.classList.remove('deny');
        void btn.offsetWidth;
        btn.classList.add('deny');
        setTimeout(() => btn.classList.remove('deny'), 450);
        let m = keypad.querySelector('.deny-msg');
        if (!m) {
          m = el('div', 'deny-msg');
          keypad.insertBefore(m, grid);
        }
        m.textContent = `${cf.label}は選択 ${cf.count} までです。⌫や再タップで外してから選び直してください。`;
        clearTimeout(denyTimer);
        denyTimer = setTimeout(() => m.remove(), 2200);
      };

      for (let n = 1; n <= max; n++) {
        const k = el('button', 'key' + (cf.field === 'w' ? ' waku w' + n : ''), String(n));
        k.type = 'button';
        k.dataset.n = n;
        k.addEventListener('click', () => {
          const arr = activeSet();
          const i = arr.indexOf(n);
          if (i >= 0) {
            arr.splice(i, 1);                         /* 選択解除 */
          } else if (st.mode === 'multi') {
            arr.push(n);                              /* まとめ: プールへの追加は自由 */
          } else if (cf.count === 1) {
            arr[0] = n;                               /* 単勝・複勝: 1点確定型は置換 */
          } else if (arr.length < cf.count) {
            arr.push(n);
          } else {
            denyFlash(k);                             /* 満席: 拒否して無視 */
            return;
          }
          if (st.mode === 'num') refreshKeys(); else renderKeypad();
          scheduleCalc();
        });
        grid.appendChild(k);
      }
      const span = cf.field === 'w' ? 'u2' : 'u3';
      const back = el('button', 'key util ' + span, '⌫');
      back.type = 'button';
      back.addEventListener('click', () => { activeSet().pop(); if (st.mode === 'num') refreshKeys(); else renderKeypad(); scheduleCalc(); });
      const clear = el('button', 'key util ' + span, st.mode === 'multi' ? '全クリア' : 'クリア');
      clear.type = 'button';
      clear.addEventListener('click', () => {
        if (st.mode === 'num') st.sel = [];
        else st.pools = st.pools.map(() => []);
        if (st.mode === 'num') refreshKeys(); else renderKeypad();
        scheduleCalc();
      });
      grid.append(back, clear);
      refreshKeys();
    } else {
      /* オッズ: 789 / 456 / 123 / 0 . ⌫ / クリア */
      grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
      ['7','8','9','4','5','6','1','2','3','0','.','⌫'].forEach(k => {
        const b = el('button', 'key' + (k === '⌫' ? ' util' : ''), k);
        b.type = 'button';
        b.addEventListener('click', () => {
          if (k === '⌫') st.odds = st.odds.slice(0, -1);
          else if (k === '.') { if (!st.odds.includes('.') && st.odds.replace('.', '').length < 7) st.odds += st.odds === '' ? '0.' : '.'; }
          else if (st.odds.replace('.', '').length < 7) st.odds += k;
          updateOddsDisp();
          scheduleCalc();
        });
        grid.appendChild(b);
      });
      const clear = el('button', 'key util u3', 'クリア');
      clear.type = 'button';
      clear.addEventListener('click', () => { st.odds = ''; updateOddsDisp(); scheduleCalc(); });
      grid.appendChild(clear);
      refreshCombo();
    }

    keypad.appendChild(grid);
  }

  function refreshKeys() {
    const arr = st.mode === 'num' ? st.sel : st.pools[st.focus];
    keypad.querySelectorAll('.key[data-n]').forEach(k =>
      k.classList.toggle('on', arr.includes(Number(k.dataset.n))));
    refreshCombo();
  }

  /* 保存データからの復元（serialize の1行分を受け取る） */
  card._applyState = r => {
    r = (r && typeof r === 'object') ? r : {};
    st.type = BET[r.type] ? r.type : null;
    const cf = st.type ? BET[st.type] : null;
    const maxNum = cf ? (cf.field === 'w' ? 8 : 18) : 18;
    const okN = n => Number.isInteger(n) && n >= 1 && n <= maxNum;

    st.sel = (Array.isArray(r.sel) ? r.sel : []).filter(okN);
    st.sel = [...new Set(st.sel)].slice(0, cf ? cf.count : 0);

    st.pools = cf ? (Array.isArray(r.pools) ? r.pools.slice(0, cf.count) : [])
                  .map(p => [...new Set((Array.isArray(p) ? p : []).filter(okN))]) : [];
    while (st.pools.length < (cf ? cf.count : 0)) st.pools.push([]);

    st.odds = typeof r.odds === 'string' ? r.odds.replace(/[^0-9.]/g, '').slice(0, 9)
            : (typeof r.odds === 'number' && isFinite(r.odds) ? String(r.odds) : '');
    st.memo = typeof r.memo === 'string' ? r.memo.slice(0, 300) : '';

    if (cf && cf.count >= 2 && r.dataMode === 'multi') st.dataMode = 'multi'; else st.dataMode = 'num';
    if (cf ? (r.mode === 'multi' && cf.count >= 2) : false) st.mode = 'multi';
    else if (r.mode === 'odds' && cf) st.mode = 'odds';
    else st.mode = 'num';
    st.focus = 0;

    chips.querySelectorAll('.chip.on').forEach(x => x.classList.remove('on'));
    if (st.type) {
      const cc = [...chips.children].find(c => c.textContent === cf.label);
      if (cc) cc.classList.add('on');
    }
    memoInput.value = st.memo;

    renderKeypad();
    scheduleCalc();
  };

  return card;
}
for (let i = 0; i < 2; i++) addPatternRow();
$('addPattern').addEventListener('click', () => {
  const c = addPatternRow();
  markEntering(c);
  scheduleCalc();
});

/* 直前の馬券カードを複製（券種・番号/まとめ・オッズ・メモをまるごとコピー） */
$('dupLast').addEventListener('click', () => {
  const cards = [...list.children];
  if (!cards.length) return;
  const s = cards[cards.length - 1]._st;
  const row = { type: s.type, mode: s.mode, dataMode: s.dataMode,
    sel: s.sel.slice(), pools: s.pools.map(p => p.slice()),
    odds: s.odds, memo: s.memo };
  const card = addPatternRow();   // list 末尾に追加 → _applyState がコピーを適用
  card._applyState(row);
  markEntering(card);
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

/* ---------- 入力収集 ---------- */
function readRows() {
  const rows = [];
  [...list.children].forEach(card => {
    const st = card._st;
    const vm = st.mode === 'odds' ? st.dataMode : st.mode;
    const info = st.type ? (vm === 'multi' ? (poolCombos(st).count ? rowInfo(st, 'multi') : null) : rowInfo(st, 'num')) : null;
    const odds = parseFloat(st.odds);
    if (info && odds > 1 && odds < 999999) {
      rows.push({ name: info.name, odds, count: info.count });
    }
  });
  return rows;
}

/* ---------- 計算 ---------- */
function runCalc() {
  const raw = readRows();
  if (!raw.length) { result.classList.add('hidden'); return; }
  result.classList.remove('hidden');

  const B = Math.floor(Number(($('budget').value || '').replace(/[,\s]/g, '')) || 0);
  const unit = $('roundToggle').checked ? 100 : 1;

  if (B < unit) {
    result.replaceChildren(bannerState('warn', '予算を確認してください',
      unit === 100 ? '100円単位の丸めが有効のため、予算は100円以上にしてください。' : '予算には1円以上の値を入力してください。'));
    return;
  }

  /* 実効オッズ e = オッズ / 点数、刻み gran = 点数 × unit（1点あたり単位を維持） */
  const rows = raw.map(r => ({
    name: r.name, odds: r.odds, count: r.count,
    e: r.odds / r.count,
    gran: r.count * unit,
  }));

  const S = rows.reduce((s, r) => s + 1 / r.e, 0);
  const sTxt = S.toFixed(3);
  const drop = Number($('dropRate').value);
  const kDrop = 1 - drop / 100;             /* 全券種一律の補正係数 */
  const Sdrop = drop > 0 ? S / kDrop : null;  /* 下落後の S */
  const sTxtDrop = Sdrop != null ? Sdrop.toFixed(3) : null;

  const alpha = Number($('alpha').value);
  syncFocusSelect(rows, alpha);

  if (S <= 1) {
    if (alpha >= 100) renderPlan(rows, B, S, sTxt, drop, kDrop, sTxtDrop, Sdrop);
    else renderAttack(rows, B, S, sTxt, alpha, drop, kDrop, sTxtDrop, Sdrop);
  }
  else renderInfeasible(rows, B, S, sTxt, drop, Sdrop);
}

/* ---------- 本命行の選択 ---------- */
function pickFocus(rows) {
  const v = $('focusRow').value;
  if (v !== 'auto') {
    const i = rows.findIndex(r => r.name === v);
    if (i >= 0) return i;
  }
  return rows.reduce((a, r, i) => r.odds > rows[a].odds ? i : a, 0);
}

function syncFocusSelect(rows, alpha) {
  const sel = $('focusRow');
  let prev = sel.value;
  if (sel.dataset.restore) { prev = sel.dataset.restore; delete sel.dataset.restore; }
  sel.replaceChildren();
  const addOpt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
  addOpt('auto', '自動（もっとも高いオッズの行）');
  rows.forEach(r => addOpt(r.name, r.name));
  sel.value = (prev !== 'auto' && rows.some(r => r.name === prev)) ? prev : 'auto';
  sel.disabled = alpha >= 100 || rows.length < 2;
}

$('calcBtn').addEventListener('click', runCalc);
$('budget').addEventListener('input', scheduleCalc);
$('roundToggle').addEventListener('change', scheduleCalc);
$('alpha').addEventListener('input', e => { $('alphaVal').textContent = e.target.value + '%'; scheduleCalc(); });
$('alpha').addEventListener('change', scheduleCalc);
$('focusRow').addEventListener('change', scheduleCalc);
$('dropRate').addEventListener('input', e => { $('dropVal').textContent = e.target.value + '%'; scheduleCalc(); });
$('dropRate').addEventListener('change', scheduleCalc);

/* ---------- 予想からの提案（着順ごと候補 → 打ち方の提案） ---------- */
const yState = { pools: [ [], [], [] ], tab: 0 };

/* 提案行が馬券カードに渡す serialize 形式のデータ */
function mkRow(type, pools, sel, memo) {
  return { type, mode: (pools && pools.some(p => p.length)) ? 'multi' : 'num',
    dataMode: pools ? 'multi' : 'num', sel: sel || [], pools: pools || [],
    odds: '', memo: memo || '' };
}

const yComb = (n, r) => { let x = 1; for (let i = 0; i < r; i++) x = x * (n - i) / (i + 1); return Math.round(x); };

/* 3連単フォーメーション: 着順候補の直積（同番号重複を除く） */
function yOrdCombos(a, b, c) {
  const out = [];
  for (const x of a) for (const yv of b) for (const z of c) {
    if (x !== yv && yv !== z && x !== z) out.push([ x, yv, z ]);
  }
  return out;
}

function ySuggestions() {
  const P1 = [ ...yState.pools[0] ].sort((a, b) => a - b);
  const P2 = [ ...yState.pools[1] ].sort((a, b) => a - b);
  const P3 = [ ...yState.pools[2] ].sort((a, b) => a - b);
  const U = [ ...new Set([ ...P1, ...P2, ...P3 ]) ].sort((a, b) => a - b);
  const j = a => a.join('・');
  const out = [];

  /* 1. 3連単フォーメーション（着順ごとの候補を活かす） */
  if (P1.length && P2.length && P3.length) {
    const ex = `${j(P1)}-[${j(P2)}]-[${j(P3)}]`;
    out.push({ kind: '3連単 フォーメーション', ex, count: yOrdCombos(P1, P2, P3).length,
      memo: `3連単 組 ${ex}`, row: mkRow('sanrentan', [ P1, P2, P3 ]) });
  }

  /* 2. 3連単 軸ながし（1着候補が1頭のとき） */
  if (P1.length === 1 && U.length >= 3) {
    const h = P1[0];
    const oth = U.filter(x => x !== h);
    out.push({ kind: '3連単 ながし', ex: `${h} → ${j(oth)}（2・3着いずれか）`,
      count: oth.length * (oth.length - 1), memo: `3連単 ながし ${h}`,
      row: mkRow('sanrentan', [[ h ], oth, oth ]) });
  }

  /* 3. 3連複 ボックス（予想候補全体） */
  if (U.length >= 3) {
    out.push({ kind: '3連複 ボックス（候補全体）', ex: `${j(U)} のうち3頭`,
      count: yComb(U.length, 3), memo: `3連複 ボックス ${j(U)}`,
      row: mkRow('sanrenpuku', [ U, [], [] ]) });
  }

  /* 4. 軸ながし（馬単/馬連/ワイド） */
  if (P1.length === 1 && U.length >= 2) {
    const h = P1[0];
    const oth = U.filter(x => x !== h);
    out.push({ kind: '馬単 ながし', ex: `${h} → ${j(oth)}`, count: oth.length,
      memo: `馬単 ながし ${h}`, row: mkRow('umatan', [[ h ], oth ]) });
    out.push({ kind: '馬連 ながし', ex: `${h} - ${j(oth)}`, count: oth.length,
      memo: `馬連 ながし ${h}`, row: mkRow('umaren', [[ h ], oth ]) });
    out.push({ kind: 'ワイド ながし', ex: `${h} × ${j(oth)}`, count: oth.length,
      memo: `ワイド ながし ${h}`, row: mkRow('wide', [[ h ], oth ]) });
  }

  /* 5. 単勝（1着候補それぞれ・最大4行） */
  P1.slice(0, 4).forEach(h => {
    out.push({ kind: '単勝', ex: `${h}番`, count: 1, memo: `単勝 ${h}番`,
      row: mkRow('tan', null, [ h ]) });
  });

  return out;
}

function renderYoso() {
  /* タブ */
  const seg = $('yosoTabs');
  if (seg.children.length === 0) {
    ['1着', '2着', '3着'].forEach((label, i) => {
      const b = el('button', null, label);
      b.type = 'button';
      b.addEventListener('click', () => { yState.tab = i; refreshYKeys(); scheduleSave(); });
      seg.appendChild(b);
    });
  }
  [...seg.children].forEach((b, i) => b.classList.toggle('on', i === yState.tab));

  /* キーパッド */
  const kp = $('yosoKeypad');
  if (kp.children.length === 0) {
    const grid = el('div', 'keygrid');
    grid.style.gridTemplateColumns = 'repeat(6, 1fr)';
    for (let n = 1; n <= 18; n++) {
      const b = el('button', 'key', String(n));
      b.type = 'button';
      b.dataset.n = String(n);
      b.addEventListener('click', () => {
        const pool = yState.pools[yState.tab];
        const i = pool.indexOf(n);
        if (i >= 0) pool.splice(i, 1); else pool.push(n);
        refreshYKeys();
        renderYosoList();
        scheduleSave();
      });
      grid.appendChild(b);
    }
    kp.appendChild(grid);
  }
  refreshYKeys();

  /* 提案リスト */
  renderYosoList();
}

function refreshYKeys() {
  const arr = yState.pools[yState.tab];
  $('yosoKeypad').querySelectorAll('.key[data-n]').forEach(k =>
    k.classList.toggle('on', arr.includes(Number(k.dataset.n))));
  const seg = $('yosoTabs');
  [...seg.children].forEach((b, i) => b.classList.toggle('on', i === yState.tab));
}

function renderYosoList() {
  const box = $('yosoList');
  const list = ySuggestions();
  if (!list.length) {
    box.replaceChildren(el('p', 'y-hint', '1〜3着の候補をキーで選ぶと、打ち方の提案が出ます。'));
    return;
  }
  box.replaceChildren();
  list.slice(0, 12).forEach(s => {
    const row = el('div', 'y-row');
    const info = el('div', 'y-info');
    info.append(el('div', 'y-kind', s.kind), el('span', 'y-ex', `${s.ex} — ${s.count}点`));
    const add = el('button', 'y-add', '追加');
    add.type = 'button';
    add.addEventListener('click', () => {
      const card = addPatternRow();
      const row = Object.assign({}, s.row, { memo: s.memo });
      card._applyState(row);
      markEntering(card);
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    row.append(info, add);
    box.appendChild(row);
  });
}

$('yosoClear').addEventListener('click', () => {
  yState.pools = [ [], [], [] ];
  refreshYKeys();
  renderYosoList();
  scheduleSave();
});

renderYoso();

/* ---------- データの保存 / 読込 ---------- */
const LS_KEY = 'keibaGuardState.v1';
let saveTimer = null;

function serialize() {
  return JSON.stringify({
    v: 1,
    race: $('raceDate').value || $('raceVenue').value || $('raceNo').value
      ? { date: $('raceDate').value || '', venue: $('raceVenue').value || '', no: $('raceNo').value || '' }
      : null,
    yoso: yState.pools.some(p => p.length)
      ? { p: yState.pools.map(p => p.slice()), t: yState.tab } : null,
    budget: $('budget').value,
    round: $('roundToggle').checked,
    alpha: $('alpha').value,
    drop: $('dropRate').value,
    focus: $('focusRow').value || 'auto',
    rows: [...list.children].map(card => {
      const st = card._st;
      return { type: st.type, mode: st.mode, dataMode: st.dataMode,
        sel: st.sel.slice(), pools: st.pools.map(p => p.slice()),
        odds: st.odds, memo: st.memo };
    })
  });
}

/* 保存ファイル名（英数字のみの安全な形式） */
function buildFileName() {
  const d = $('raceDate').value.replace(/[^0-9-]/g, '');
  const v = $('raceVenue').value.replace(/[^A-Za-z]/g, '');
  const n = String(parseInt($('raceNo').value, 10) || '').replace(/[^0-9]/g, '');
  const parts = ['keiba-guard', d, v, n].filter(Boolean)
    .map(s => s.replace(/[^A-Za-z0-9._-]/g, ''));
  return parts.join('-') + '.json';
}

function updateFileNameNote() {
  $('fileNameNote').textContent = buildFileName();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

function saveNow() {
  if (!$('autoSave').checked) return;
  try { localStorage.setItem(LS_KEY, serialize()); } catch (e) { /* file:// で無効な場合はファイル保存で代替 */ }
}

/* 保存データ（JSONオブジェクト）を UI に復元 */
function applyData(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.rows)) return false;
  [...list.children].forEach(c => c.remove());
  data.rows.forEach(r => { const card = addPatternRow(); card._applyState(r); });
  if (data.race && typeof data.race === 'object') {
    $('raceDate').value = /^[0-9-]{0,10}$/.test(String(data.race.date)) ? String(data.race.date) : '';
    $('raceVenue').value = /^[A-Za-z]{0,12}$/.test(String(data.race.venue)) ? String(data.race.venue) : '';
    const noNum = parseInt(data.race.no, 10);
    $('raceNo').value = (noNum >= 1 && noNum <= 12) ? String(noNum) : '';
    updateFileNameNote();
  }
  if (data.yoso && Array.isArray(data.yoso.p)) {
    for (let i = 0; i < 3; i++) {
      const up = data.yoso.p[i];
      yState.pools[i] = [...new Set((Array.isArray(up) ? up : [])
        .filter(n => Number.isInteger(n) && n >= 1 && n <= 18))];
    }
    yState.tab = (data.yoso.t >= 0 && data.yoso.t <= 2) ? data.yoso.t : 0;
    refreshYKeys();
    renderYosoList();
  }
  if (data.budget != null) $('budget').value = String(data.budget);
  if (typeof data.round === 'boolean') $('roundToggle').checked = data.round;
  const aNum = Math.min(100, Math.max(0, Math.round(Number(data.alpha))) || 0);
  if (data.alpha != null) { $('alpha').value = aNum; $('alphaVal').textContent = aNum + '%'; }
  const dNum = Math.min(80, Math.max(0, Math.round(Number(data.drop))) || 0);
  if (data.drop != null) { $('dropRate').value = dNum; $('dropVal').textContent = dNum + '%'; }
  if (data.focus && typeof data.focus === 'string') $('focusRow').dataset.restore = data.focus;
  scheduleCalc();
  return true;
}

/* 書き出す（JSONダウンロード） */
$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([serialize()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = buildFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* 読み込む（ファイル選択 → 復元） */
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    let d = null;
    try { d = JSON.parse(String(fr.result)); } catch (err) { d = null; }
    if (!applyData(d)) {
      /* 計算の自動バナーで上書きされないよう、ここでは再計算を発火しない */
      result.replaceChildren(bannerState('warn', '読み込めませんでした',
        '有効なバックアップファイルではないため、入力内容は変更していません。'));
    }
  };
  fr.readAsText(f);
});

/* 自動保存スイッチ（ONにした時点で即保存） */
$('autoSave').addEventListener('change', () => { if ($('autoSave').checked) saveNow(); });

/* レース情報（日付・競馬場・レース番号）: 保存とファイル名表示に反映 */
['raceDate', 'raceVenue', 'raceNo'].forEach(id => {
  $(id).addEventListener('input', () => {
    if (id === 'raceNo') {
      const n = parseInt($(id).value, 10);
      if (n > 12) $(id).value = '12';
    }
    scheduleSave();
    updateFileNameNote();
  });
  $(id).addEventListener('change', () => { scheduleSave(); updateFileNameNote(); });
});

/* 起動時: 端末の自動保存があれば復元（なければ2枚の空カードを既定に） */
let restoredData = null;
try { restoredData = JSON.parse(localStorage.getItem(LS_KEY) || ''); } catch (e) {}
if (restoredData && restoredData.v === 1 && Array.isArray(restoredData.rows) && restoredData.rows.length) {
  applyData(restoredData);
} else {
  /* 保存データがないときの利便性: 日付だけ本日を既定入力 */
  const t = new Date();
  $('raceDate').value = t.getFullYear() + '-' +
    String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}
updateFileNameNote();

/* ---------- 配分エンジン（貪欲＋丸め修正＋調整） ---------- */
function allocate(rows, budget, S) {
  const gran0 = Math.min(...rows.map(r => r.gran));

  let stake;
  if (gran0 === 1) {
    stake = rows.map(r => budget * (1 / r.e) / S);   /* 丸めなし: 理論比そのまま */
  } else {
    /* 1点あたり100円単位を維持する貪欲配分 */
    const u = rows.map(() => 0);
    let spent = 0;
    /* 念のため上限（巨大入力の暴走ガード） */
    const maxIter = 200000;
    for (let it = 0; it < maxIter; it++) {
      let bi = -1, best = Infinity;
      for (let i = 0; i < u.length; i++) {
        if (spent + rows[i].gran > budget) continue;
        const cand = (spent - rows[i].e * u[i]) - (rows[i].e - 1) * rows[i].gran;
        if (cand < best) { best = cand; bi = i; }
      }
      if (bi < 0) break;
      u[bi] += rows[bi].gran;
      spent += rows[bi].gran;
    }
    stake = u;
  }

  /* 丸め修正: どのパターン単体でも 払戻 >= 総掛金 になるよう移動 */
  for (let guard = 0; guard < 3000; guard++) {
    const T = stake.reduce((a, b) => a + b, 0);
    const deficit = stake.map((x, i) => T - rows[i].e * x);
    const t = deficit.indexOf(Math.max(...deficit));
    if (deficit[t] <= 1e-6) break;

    let donor = -1, bestNew = Infinity, A = 0;
    for (let j = 0; j < stake.length; j++) {
      if (j === t || stake[j] <= rows[j].gran) continue;
      const a = lcm(rows[j].gran, rows[t].gran);
      if (a > budget) continue;
      const newDef = deficit[j] + rows[j].e * a;
      if (newDef < bestNew) { bestNew = newDef; donor = j; A = a; }
    }
    if (donor === -1) break;
    stake[donor] -= A;
    stake[t] += A;
  }

  /* それでも成立しない場合: 総掛金を下げてでも成立する配分を探す（端数は未使用に） */
  {
    let T0 = stake.reduce((a, b) => a + b, 0);
    let ok0 = Math.min(...rows.map((r, i) => r.e * stake[i])) + 1e-6 >= T0;
    for (let step = 0; !ok0 && step < 300; step++) {
      let best = null;   /* 成立候補を最優先、無ければ最も成立に近い候補 */
      for (let j = 0; j < stake.length; j++) {
        if (stake[j] - rows[j].gran < rows[j].gran) continue;   /* 各行は最低1点維持 */
        const s2 = stake.slice();
        s2[j] -= rows[j].gran;
        const T2 = s2.reduce((a, b) => a + b, 0);
        const minP2 = Math.min(...rows.map((r, i) => r.e * s2[i]));
        const slack = minP2 - T2;
        const feas = slack >= -1e-6;
        if (best && best.feas && !feas) continue;
        if (best && feas === best.feas && slack <= best.slack + 1e-9) continue;
        best = { s2, slack, feas };
      }
      if (!best) break;
      stake = best.s2;
      T0 = stake.reduce((a, b) => a + b, 0);
      ok0 = Math.min(...rows.map((r, i) => r.e * stake[i])) + 1e-6 >= T0;
    }
  }
  return stake;
}

/* ---------- 成立時: 配分 ---------- */
function renderPlan(rows, B, S, sTxt, drop, kDrop, sTxtDrop, Sdrop) {
  const stake = allocate(rows, B, S);
  const T = stake.reduce((a, b) => a + b, 0);
  const payouts = rows.map((r, i) => r.e * stake[i]);   /* 最悪組合せ的中時の払戻 */
  const minP = Math.min(...payouts);
  const minPd = kDrop < 1 ? minP * kDrop : null;        /* 下落想定の最低払戻 */
  const okExact = minP + 1e-6 >= T;
  const spare = B - T;
  const hasMulti = rows.some(r => r.count > 1);
  /* 下落を考慮しても成立するか（全券種一律なので S/kDrop ≤ 1 が条件） */
  const okDrop = Sdrop == null || Sdrop <= 1 + 1e-9;

  result.replaceChildren(
    bannerState(
      okExact ? (okDrop ? 'ok' : 'warn') : 'warn',
      okExact
        ? (okDrop ? '成立 — 下落しても保証内です' : '成立 — ただし下落すると保証外')
        : 'ほぼ成立 — 丸めの関係で若干の不足があります',
      okExact
        ? (okDrop
          ? `どのパターンが単体でも・同時でも的中しても、払戻は総掛金 ${yen(T)} 以上です。オッズが ${drop}% 下がっても保証は壊れません。`
          : `現在のオッズではどの的中でも総掛金 ${yen(T)} 以上が返ります。ただしオッズが ${drop}% 下落すると、最悪時の払戻は ${yen(minPd)} に押さえられ、保証は外れます。`)
        : `最悪シナリオの払戻が総掛金を ${yen(T - minP)} 下回ります。丸めをオフにすると理論どおりになります。`,
      sTxt, sTxtDrop, drop
    )
  );

  const c1 = el('div', 'result-card');
  rows.forEach((r, i) => {
    const per = r.count > 1 ? yenF(stake[i] / r.count) + ' × ' + r.count + '点' : yen(stake[i]);
    const subText = 'オッズ ' + r.odds + '倍（最低）' + (r.count > 1 ? '・' + r.count + '点' : '');
    const sec = '的中時(最悪) ' + yen(payouts[i]) +
      (minPd != null ? '（下落想定 ' + yen(payouts[i] * kDrop) + '）' : '');
    c1.appendChild(cardRow(r.name, subText, per, sec, false));
  });
  c1.appendChild(cardRow('総掛金', spare > 0.5 ? `端数 ${yen(spare)} は未使用` : '', yen(T), null, true));
  c1.appendChild(cardRow(hasMulti ? '最低払戻（最悪組合せ的中時）' : '最低払戻（1点的中時）',
    '全パターン共通', yen(minP),
    '利益 ' + yen(Math.max(minP - T, 0)) +
      (minPd != null ? ` / 下落想定 ${yen(minPd)}・利益 ${yen(Math.round(minPd - T))}` : ''),
    true));
  result.appendChild(c1);

  const c2 = el('div', 'result-card');
  c2.appendChild(cardRow('すべて外れた場合', '', '−' + yen(T), null, false));
  c2.appendChild(cardRow('複数点が同時的中した場合', '', '＋払戻加算（単体でも成立済み）', null, false));
  result.appendChild(c2);
}

/* ---------- 攻撃配分（保険 ＋ 本命集中） ---------- */
function renderAttack(rows, B, S, sTxt, alpha, drop, kDrop, sTxtDrop, Sdrop) {
  const k = pickFocus(rows);
  const G = Math.floor(B * alpha / 100);   /* 保険に回す予算 */
  const C = B - G;                          /* 本命に集中させる予算 */

  let stake = rows.map(() => 0);
  if (G > 0) stake = allocate(rows, G, S);
  const gTotal = stake.reduce((a, b) => a + b, 0);
  const granK = rows[k].gran;
  /* 集中額: 指定の (1−α)分 ＋ 保険側で丸めなどに使えなかった残余（上振れに回す） */
  const y = Math.floor((C + (G - gTotal)) / granK) * granK;
  stake[k] += y;

  const T = stake.reduce((a, b) => a + b, 0);
  const payouts = rows.map((r, i) => r.e * stake[i]);   /* 最悪組合せ的中時の払戻 */
  const minP = Math.min(...payouts);
  const minPd = kDrop < 1 ? minP * kDrop : null;
  const spare = B - T;
  const hasMulti = rows.some(r => r.count > 1);
  const gSpent = T - y;
  const okDrop = Sdrop == null || Sdrop <= 1 + 1e-9;
  const dropNote = minPd != null
    ? `オッズが ${drop}% 下がると最低 ${yen(minPd)}（利益 ${yen(Math.round(minPd - T))}）まで縮みます${okDrop ? '' : '。保証は外れます'}。`
    : '';

  /* 集中に必要な金額が丸め単位に満たない場合の注意 */
  const tooSmall = y === 0 && alpha > 0;

  result.replaceChildren(
    bannerState(
      'warn',
      alpha === 0 ? '攻撃 — 全額本命集中' : `攻撃配分 — 保険 ${alpha}% ＋ 本命集中`,
      alpha === 0
        ? (tooSmall ? '集中額が丸め単位に満たず、投じられていません。' : `予算すべてを本命「${rows[k].name}」に集中しています。本命が外れた場合、掛けた全額を失います。`)
        : (tooSmall
          ? 'この安全率では集中額が100円単位に満たず、 通常どおりの保険配分になります。安全率をさらに下げるか馬券の点数を減らすと集中できます。'
          : `保険 ${yen(gSpent)}: 本命以外の行が的中した場合も最低 ${yen(minP)} は返ります。本命「${rows[k].name}」に ${yen(y)} を集中し、的中時は最大 ${yen(payouts[k])}。${dropNote ? ' ' + dropNote : ''}`),
      sTxt, sTxtDrop, drop
    )
  );

  const c1 = el('div', 'result-card');
  rows.forEach((r, i) => {
    const per = r.count > 1 ? yenF(stake[i] / r.count) + ' × ' + r.count + '点' : yen(stake[i]);
    let subText = 'オッズ ' + r.odds + '倍（最低）' + (r.count > 1 ? '・' + r.count + '点' : '');
    if (i === k && y > 0) subText += '・集中 ' + yen(y);
    const sec = '的中時(最悪) ' + yen(payouts[i]) +
      (minPd != null ? '（下落想定 ' + yen(payouts[i] * kDrop) + '）' : '');
    c1.appendChild(cardRow((i === k ? '★本命 ' : '') + r.name, subText, per, sec, false));
  });
  c1.appendChild(cardRow('総掛金',
    `保険 ${yen(gSpent)} ＋ 集中 ${yen(y)}` + (spare > 0.5 ? `・端数 ${yen(spare)} 未使用` : ''),
    yen(T), null, true));
  c1.appendChild(cardRow(hasMulti ? '最低払戻（本命以外が的中時）' : '最低払戻（他行が的中時）',
    '保険部分の保証', yen(minP),
    '本命中との差 ' + yen(payouts[k] - minP) +
      (minPd != null ? ` / 下落想定 ${yen(minPd)}・利益 ${yen(Math.round(minPd - T))}` : ''),
    true));
  result.appendChild(c1);

  const c2 = el('div', 'result-card');
  c2.appendChild(cardRow('すべて外れた場合', '', '−' + yen(T), null, false));
  c2.appendChild(cardRow('本命行が外れた場合', '', '最悪 ' + yen(minP) + ' まで（保険分のみ）', null, false));
  c2.appendChild(cardRow('複数点が同時的中した場合', '', '＋払戻加算（本命中が最大）', null, false));
  result.appendChild(c2);
}

/* ---------- 不成立時: 削除候補 + 均衡配分 ---------- */
function renderInfeasible(rows, B, S, sTxt, drop, Sdrop) {
  const dropLine = (drop > 0 && Sdrop != null)
    ? ` 下落${drop}%想定では S = ${Sdrop.toFixed(3)}。${Sdrop <= 1 ? 'そこまで下がれば成立します。' : '下がっても成立しません。'}`
    : '';
  result.replaceChildren(
    bannerState('ng', '不成立 — 理論上ショート不可避',
      'このパターン群全体では、どれが的中しても損しない配分は存在しません（実効オッズの逆数合計 S が 1 を超えています）。一部を外すか、まとめの点数・オッズを見直してください。' + dropLine,
      sTxt, Sdrop != null ? Sdrop.toFixed(3) : null, drop)
  );

  /* 貪欲法: 実効オッズの低い（逆数比の重い）パターンから順に外す */
  let cur = [...rows];
  let curS = cur.reduce((s, r) => s + 1 / r.e, 0);
  const suggestions = [];
  while (cur.length >= 2 && curS > 1 && suggestions.length < 3) {
    const drop = cur.reduce((a, r) => (r.e < a.e ? r : a), cur[0]);
    cur = cur.filter(r => r !== drop);
    curS = cur.reduce((s, r) => s + 1 / r.e, 0);
    suggestions.push({ drop, rest: cur.length, s: curS, pay: B / curS });
  }

  if (suggestions.length) {
    const card = el('div', 'result-card');
    card.appendChild(cardRow('外すと成立する候補', '', '参考', null, false));
    suggestions.forEach(s => {
      const item = el('div', 'suggest-item');
      item.appendChild(el('span', 's-name', '「' + s.drop.name + '」を外す'));
      item.appendChild(el('span', 'sub', `残${s.rest}パターン / S=${s.s.toFixed(3)} / 最低払戻 ${yen(s.pay)}`));
      card.appendChild(item);
    });
    result.appendChild(card);
  }

  /* 参考: 均衡配分（最悪損失を一定にする割り方） */
  const card2 = el('div', 'result-card');
  card2.appendChild(cardRow('参考: 均衡配分（あえて全点打つ場合）', 'どれが1点的中しても損失は同じ',
    '損失 ' + yen(B - B / S), null, false));
  rows.forEach(r => {
    const per = r.count > 1 ? yenF(B * (1 / r.e) / S / r.count) + ' × ' + r.count + '点' : yen(B * (1 / r.e) / S);
    card2.appendChild(cardRow(r.name, 'オッズ ' + r.odds + '倍（最低）' + (r.count > 1 ? '・' + r.count + '点' : ''),
      per, '的中時(最悪) ' + yen(B / S), false));
  });
  result.appendChild(card2);
}

})();
