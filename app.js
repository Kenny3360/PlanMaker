/* 计划书制作器 —— 主应用：登录 / 选产品 / 定制表单 / 计算 / 渲染 / 出图 */
(function () {
  'use strict';

  var CONFIG = window.APP_CONFIG || { accessCode: '888888' };
  var PROD = window.PRODUCTS;
  var Ann = window.AnnEngine;
  var End = window.EndowEngine;
  var Aying = window.AyingEngine;
  var $ = function (id) { return document.getElementById(id); };

  var currentProduct = null;
  var lastResult = null;
  var dataCache = {}; // dataKey -> true 已加载
  // 计划书顶部金树插画（预加载，供 Canvas 出图使用）
  var heroImg = new Image();
  heroImg.src = 'assets/gold-tree.jpg';

  // ---------- 工具 ----------
  function fmtMoney(v) {
    if (v == null || isNaN(v)) return '0';
    return Math.round(v).toLocaleString('en-US');
  }
  function sexName(s) { return s === 'M' ? '男' : '女'; }
  function pct(v, d) { return (v == null || isNaN(v)) ? '--' : (v * 100).toFixed(d == null ? 2 : d) + '%'; }
  // 单元格格式化：null/空留白；pct 列按百分比；premium 为 0 留白；其余金额千分位
  function fmtCell(c, val) {
    if (val == null || val === '') return '';
    if (c.fmt === 'pct') return pct(val);
    if (c.k === 'premium' || c.k === 'withdrawAmt') return (val > 0) ? fmtMoney(val) : '';
    return fmtMoney(val);
  }
  // 逐年IRR：第 y 保单年度末，现金流=第1..y年初保费(负)+第y年末期末利益(正)，求年化收益率
  function solveIRR(cf) {
    function npv(r) { var s = 0; for (var i = 0; i < cf.length; i++) s += cf[i] / Math.pow(1 + r, i); return s; }
    var lo = -0.99, hi = 1, flo = npv(lo), fhi = npv(hi);
    if (flo * fhi > 0) return null;
    for (var it = 0; it < 200; it++) {
      var m = (lo + hi) / 2, fm = npv(m);
      if (Math.abs(fm) < 1e-9) return m;
      if (flo * fm <= 0) hi = m; else { lo = m; flo = fm; }
    }
    return (lo + hi) / 2;
  }
  function calcYearlyIRR(rows) {
    var out = new Array(rows.length).fill(null);
    for (var y = 0; y < rows.length; y++) {
      var cf = [];
      for (var t = 0; t <= y; t++) cf.push(-(rows[t].premium || 0));
      // 期末利益：预期生存总利益口径，与末列高亮一致
      var finalVal = rows[y].expected != null ? rows[y].expected : (rows[y].total != null ? rows[y].total : rows[y].surrender);
      cf.push(finalVal || 0);
      out[y] = solveIRR(cf);
    }
    return out;
  }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.add('hidden'); }, ms || 1900);
  }
  function showLoading(on) { $('loading').classList[on ? 'remove' : 'add']('hidden'); }

  // ---------- 鉴权（口令校验走云数据库）----------
  var AUTH_KEY = 'plan_maker_auth';
  function codeSig(s) {
    s = String(s); var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return String(h);
  }
  function showLoginError(msg) { $('loginErr').textContent = msg || ''; }
  function showApp() {
    $('loginLayer').classList.add('hidden');
    $('app').classList.remove('hidden');
    showLoginError('');
    renderHome();
  }
  function showLogin() {
    $('app').classList.add('hidden');
    $('loginLayer').classList.remove('hidden');
    showLoginError('');
  }
  function isAuthed() {
    try {
      var o = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      // 口令变更后旧授权自动失效
      return !!(o && o.ok && o.c === codeSig(CONFIG.accessCode));
    } catch (e) { return false; }
  }
  function setAuthed() { localStorage.setItem(AUTH_KEY, JSON.stringify({ ok: true, t: Date.now(), c: codeSig(CONFIG.accessCode) })); }
  // 口令按钮：本地比对哈希（口令写在 config.js，不落明文）
  $('loginBtn').addEventListener('click', function () {
    var code = ($('codeInput').value || '').trim();
    if (!code) { showLoginError('请输入访问口令'); return; }
    if (codeSig(code) === codeSig(CONFIG.accessCode)) {
      setAuthed(); showApp(); $('codeInput').value = ''; showLoginError('');
    } else {
      showLoginError('口令不正确，请重新输入');
      $('codeInput').value = ''; $('codeInput').focus();
    }
  });
  $('codeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('loginBtn').click(); });
  $('logoutBtn').addEventListener('click', function () {
    localStorage.removeItem(AUTH_KEY);
    showLogin();
  });
  // 启动：本机已授权直接进入，否则显示口令登录
  function restoreAuth() { if (isAuthed()) showApp(); else showLogin(); }
  $('backBtn').addEventListener('click', showHome);

  // ---------- 产品选择页 ----------
  function renderHome() {
    $('calcPage').classList.add('hidden');
    $('home').classList.remove('hidden');
    $('backBtn').classList.add('hidden');
    $('topbarTitle').textContent = '计划书制作器';
    var grid = $('prodGrid');
    grid.innerHTML = '';
    PROD.products.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'prod-card';
      card.setAttribute('data-pid', p.id);
      var kindCls = p.kind === 'annuity' ? 'kind-annuity' : 'kind-endow';
      card.innerHTML =
        '<div class="prod-badge ' + kindCls + '">' + p.badge + '</div>' +
        '<div class="prod-name">' + p.name + '</div>' +
        '<div class="prod-full">' + p.full + '</div>' +
        '<div class="prod-desc">' + p.desc + '</div>' +
        '<div class="prod-go">开始制作 ›</div>';
      card.addEventListener('click', function () { openProduct(p); });
      grid.appendChild(card);
    });
  }
  function showHome() { renderHome(); window.scrollTo(0, 0); }

  // ---------- 打开产品 ----------
  var loadingP = null;
  function openProduct(p) {
    currentProduct = p; lastResult = null;
    $('home').classList.add('hidden');
    $('calcPage').classList.remove('hidden');
    $('backBtn').classList.remove('hidden');
    $('topbarTitle').textContent = p.name;
    $('calcTitle').textContent = p.name;
    $('calcKind').textContent = p.badge + ' · ' + p.desc;
    $('resultPanel').classList.add('hidden');
    expandForm();
    buildForm(p);
    loadData(p, function () { /* 数据懒加载完成 */ });
    window.scrollTo(0, 0);
  }

  // ---------- 动态表单 ----------
  function buildForm(p) {
    var grid = $('formGrid');
    grid.innerHTML = '';
    // 分组：填写方案（核心方案参数）/ 显示设置（其余展示类参数）
    var PLAN_KEYS = { age: 1, sex: 1, ppp: 1, premium: 1, divRate: 1, uniRate: 1 };
    function sectionTitle(text, sub) {
      var t = document.createElement('div');
      t.className = 'form-section-title';
      t.innerHTML = '<span class="fst-main">' + text + '</span>' + (sub ? '<span class="fst-sub">' + sub + '</span>' : '');
      grid.appendChild(t);
    }
    function renderField(f0) {
      var f = f0;
      if (f.key === 'age' && p.defAge != null) {
        f = Object.assign({}, f0, { def: p.defAge });
      }
      var wrap = document.createElement('div');
      wrap.className = 'field';
      var lab = document.createElement('label');
      lab.className = 'field-label';
      lab.textContent = f.label + (f.unit ? '（' + f.unit + '）' : '');
      wrap.appendChild(lab);
      var input;
      // 性别：参考风格的分段选择器
      if (f.key === 'sex') {
        var seg = document.createElement('div');
        seg.className = 'seg';
        (f.options || []).forEach(function (o) {
          var lb = document.createElement('label');
          var rd = document.createElement('input');
          rd.type = 'radio'; rd.name = 'sexSeg'; rd.value = o[0];
          rd.checked = (o[0] === f.def);
          lb.appendChild(rd);
          var sp = document.createElement('span');
          sp.textContent = (o[1] === '女' ? '女士' : (o[1] === '男' ? '男士' : o[1]));
          lb.appendChild(sp);
          if (rd.checked) lb.classList.add('on');
          rd.addEventListener('change', function () {
            [].forEach.call(seg.querySelectorAll('label'), function (x) { x.classList.remove('on'); });
            lb.classList.add('on');
            var sel = $('f_sex'); if (sel) { sel.value = o[0]; sel.dispatchEvent(new Event('change')); }
          });
          seg.appendChild(lb);
        });
        // 隐藏的原生 select，保持现有读取逻辑不变
        input = document.createElement('select');
        (f.options || []).forEach(function (o) {
          var op = document.createElement('option');
          op.value = o[0]; op.textContent = o[1];
          if (o[0] === f.def) op.selected = true;
          input.appendChild(op);
        });
        input.style.display = 'none';
        wrap.appendChild(seg);
      } else if (f.type === 'select') {
        input = document.createElement('select');
        if (f.key === 'sex') {
          (f.options || []).forEach(function (o) {
            var op = document.createElement('option');
            op.value = o[0]; op.textContent = o[1];
            if (o[0] === f.def) op.selected = true;
            input.appendChild(op);
          });
        } else if (f.key === 'age') {
          for (var a = 0; a <= f.max; a++) {
            var op = document.createElement('option');
            op.value = a; op.textContent = a + ' 岁';
            if (a === f.def) op.selected = true;
            input.appendChild(op);
          }
        } else { // ppp
          (f.options || []).forEach(function (o) {
            var op = document.createElement('option');
            op.value = o[0]; op.textContent = o[1];
            if (o[0] === f.def) op.selected = true;
            input.appendChild(op);
          });
        }
      } else {
        input = document.createElement('input');
        input.type = 'number';
        input.value = f.def;
        if (f.min != null) input.min = f.min;
        if (f.max != null) input.max = f.max;
        input.step = 'any';
      }
      input.id = 'f_' + f.key;
      input.dataset.key = f.key;
      wrap.appendChild(input);
      grid.appendChild(wrap);
    }
    // 第一组：填写方案
    sectionTitle('填写方案');
    p.form.filter(function (f) { return PLAN_KEYS[f.key]; }).forEach(renderField);
    // 汇总信息条（参考风格）：总保费 / 万能账户演示利率
    var strip = document.createElement('div');
    strip.className = 'summary-strip';
    strip.innerHTML =
      '<div class="summary-item"><span class="k">总保费</span><span class="v" id="sumPremium">—</span></div>' +
      '<div class="summary-item"><span class="k">万能账户演示利率</span><span class="v" id="sumUni">—</span></div>';
    grid.appendChild(strip);
    // 第二组：显示设置（其余展示类参数）
    sectionTitle('显示设置', '以下为展示选项，一般无需调整');
    p.form.filter(function (f) { return !PLAN_KEYS[f.key]; }).forEach(renderField);
    function refreshSummary() {
      var prem = $('f_premium'), ppp = $('f_ppp'), uni = $('f_uniRate');
      var total = 0;
      if (prem) {
        var pv = parseFloat(prem.value) || 0;
        var yrs = ppp ? (parseInt(ppp.value, 10) || 1) : 1;
        total = pv * yrs;
      }
      $('sumPremium').textContent = total ? total.toLocaleString('zh-CN') + ' 元' : '—';
      $('sumUni').textContent = uni ? (parseFloat(uni.value) || 0).toFixed(2) + '%' : '—';
    }
    ['f_premium', 'f_ppp', 'f_uniRate'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', refreshSummary);
      if (el) el.addEventListener('change', refreshSummary);
    });
    refreshSummary();
    // 臻品世家：切换年金领取年龄时，联动限制投保年龄范围与性别选项
    if (p.cfg && p.cfg.modeCfg) {
      var modeSel = $('f_annuityMode');
      if (modeSel) {
        var applyMode = function () {
          var mode = String(modeSel.value);
          var mc = p.cfg.modeCfg[mode];
          if (!mc) return;
          var ageSel = $('f_age'), sexSel = $('f_sex');
          // 性别：如 mode=55 仅女性
          var keepSex = sexSel.value;
          var sexOpts = mc.sexes.indexOf('F') >= 0 ? [['F', '女'], ['M', '男']] : [['F', '女']];
          if (mc.sexes.indexOf('M') < 0) sexOpts = [['F', '女']];
          sexSel.innerHTML = '';
          sexOpts.forEach(function (o) {
            var op = document.createElement('option');
            op.value = o[0]; op.textContent = o[1];
            sexSel.appendChild(op);
          });
          if (mc.sexes.indexOf(keepSex) >= 0) sexSel.value = keepSex;
          // 投保年龄：按区间重建
          var keepAge = parseInt(ageSel.value, 10);
          ageSel.innerHTML = '';
          for (var a = mc.minAge; a <= mc.maxAge; a++) {
            var op2 = document.createElement('option');
            op2.value = a; op2.textContent = a + ' 岁';
            ageSel.appendChild(op2);
          }
          if (keepAge >= mc.minAge && keepAge <= mc.maxAge) ageSel.value = keepAge;
        };
        modeSel.addEventListener('change', applyMode);
        applyMode();
      }
    }
    // 幸福享裕B：按交费期联动限制投保年龄上限（底表覆盖：趸交80/3年75/5年70/10年55/15年50/20年45）
    if (p.cfg && p.cfg.pppAgeMax) {
      var pppSel = $('f_ppp');
      if (pppSel) {
        var applyPppAge = function () {
          var max = p.cfg.pppAgeMax[parseInt(pppSel.value, 10)];
          if (!max) return;
          var ageSel = $('f_age');
          if (!ageSel) return;
          var keep = parseInt(ageSel.value, 10);
          var opts = '';
          for (var a = 0; a <= max; a++) opts += '<option value="' + a + '">' + a + ' 岁</option>';
          ageSel.innerHTML = opts;
          ageSel.value = (keep <= max ? keep : max);
        };
        pppSel.addEventListener('change', applyPppAge);
        applyPppAge();
      }
    }
    // 幸福享裕B：一次性领取年龄按投保年龄过滤（领取倍数表覆盖：60岁≤54投保 / 70岁≤65 / 80岁≤71）
    if (p.cfg && p.cfg.onceClaim) {
      var onceSel = $('f_onceClaim'), ageSel2 = $('f_age');
      if (onceSel && ageSel2) {
        var applyOnce = function () {
          var a = parseInt(ageSel2.value, 10);
          var limits = [[60, 54], [70, 65], [80, 71]];
          var cur = parseInt(onceSel.value, 10);
          // 重建选项：只保留投保年龄允许的领取年龄
          var opts = '<option value="0">否（按年领取）</option>';
          limits.forEach(function (L) {
            if (a <= L[1]) opts += '<option value="' + L[0] + '">' + L[0] + '岁一次性领取</option>';
          });
          onceSel.innerHTML = opts;
          var allowed = limits.some(function (L) { return cur === L[0] && a <= L[1]; });
          onceSel.value = (cur === 0 || allowed) ? cur : 0;
        };
        ageSel2.addEventListener('change', applyOnce);
        applyOnce();
      }
    }
    // 中途领取：选"是"才显示 开始/结束年龄、领取额度
    var wf = $('f_withdrawFlag');
    if (wf) {
      var wFields = [$('f_withdrawStart'), $('f_withdrawEnd'), $('f_withdrawAmt')].filter(Boolean);
      var wWrapper = function (el) { return el ? el.closest('.field') : null; };
      var applyWithdraw = function () {
        var on = String(wf.value) === '1';
        wFields.forEach(function (el) {
          var wr = wWrapper(el);
          if (wr) wr.style.display = on ? '' : 'none';
        });
      };
      wf.addEventListener('change', applyWithdraw);
      applyWithdraw();
    }
  }

  function readForm(p) {
    var vals = {};
    p.form.forEach(function (f) {
      var el = $('f_' + f.key);
      var raw = el.value;
      var v;
      if (f.type === 'select' || f.key === 'sex') v = (f.key === 'age' || f.key === 'ppp') ? parseInt(raw, 10) : raw;
      else v = parseFloat(raw);
      if (f.scale) v = v * f.scale;
      vals[f.key] = v;
    });
    return vals;
  }

  // ---------- 数据懒加载 ----------
  function loadData(p, cb) {
    if (dataCache[p.dataKey]) { cb(); return; }
    showLoading(true);
    var s = document.createElement('script');
    s.src = 'datajs/' + p.dataKey + '.js';
    s.onload = function () {
      dataCache[p.dataKey] = true;
      showLoading(false);
      cb();
    };
    s.onerror = function () {
      showLoading(false);
      toast('数据加载失败，请检查网络后重试', 3000);
    };
    document.head.appendChild(s);
  }

  // ---------- 计算 ----------
  $('calcBtn').addEventListener('click', function () {
    if (!currentProduct) return;
    var p = currentProduct;
    loadData(p, function () { doCompute(p); });
  });

  function doCompute(p) {
    var v = readForm(p);
    var age = v.age, sex = v.sex, ppp = v.ppp, premium = v.premium;
    var irrAge = Math.max(60, age + 1); // 表单已移除该项，IRR 默认按 60 岁(不小于投保年龄+1)计算
    if (p.cfg && p.cfg.onceClaim && v.onceClaim) irrAge = Math.max(parseInt(v.onceClaim, 10) - 1, age + 1); // 一次性领取：按领取前一年计 IRR
    // 中途领取参数（除安盈外）：选"是"且额度>0、区间合法才启用
    var withdraw = { enabled: false, startAge: 0, endAge: 0, amount: 0 };
    if (p.engine !== 'aying' && String(v.withdrawFlag) === '1') {
      var ws = parseInt(v.withdrawStart, 10), we = parseInt(v.withdrawEnd, 10), wa = parseFloat(v.withdrawAmt);
      if (!isNaN(ws) && !isNaN(we) && !isNaN(wa) && wa > 0 && we >= ws) {
        withdraw = { enabled: true, startAge: ws, endAge: we, amount: wa };
      } else {
        toast('中途领取设置无效：结束年龄需≥开始年龄、额度需大于0，本次按不领取计算', 3200);
      }
    }
    if (p.engine === 'aying') { ppp = 1; v.ppp = 1; } // 两全险趸交：总保费=一次性保费
    if (!premium || premium <= 0) { toast(p.engine === 'aying' ? '请输入有效的一次性交纳保费' : '请输入有效的年交保费'); return; }
    if (p.engine === 'aying') {
      var term = v.term;
      var dataKeyA = term + '-' + age + '-' + sex;
      var hasA = window.PRODUCT_DATA && window.PRODUCT_DATA[p.dataKey] && window.PRODUCT_DATA[p.dataKey][dataKeyA];
      if (!hasA) { toast('暂无该保险期间/年龄/性别组合的数据，请调整'); return; }
      Aying.setData(window.PRODUCT_DATA[p.dataKey]);
      var resA = Aying.compute({ age: age, sex: sex, ppp: 1, premium: premium, term: term });
      lastResult = { res: resA, p: p, v: v };
    } else if (p.engine === 'changle') {
      var CL = window.ChangleEngine;
      var hasCL = window.PRODUCT_DATA && window.PRODUCT_DATA[p.dataKey] && window.PRODUCT_DATA[p.dataKey][age + '-' + sex + '-' + ppp];
      if (!hasCL) { toast('暂无该年龄/性别/缴费期组合的数据，请调整'); return; }
      CL.setData(window.PRODUCT_DATA[p.dataKey]);
      var resCL = CL.compute({
        age: age, sex: sex, ppp: ppp, premium: premium,
        divRate: v.divRate, uniRate: v.uniRate, irrAge: irrAge, withdraw: withdraw
      });
      lastResult = { res: resCL, p: p, v: v };
    } else if (p.engine === 'annuity') {
      var mode = (v.annuityMode != null ? String(v.annuityMode) : null); // 臻品世家年金领取年龄，其他产品为空
      var dataKey = (mode ? mode + '-' : '') + age + '-' + sex + '-' + ppp;
      var hasData = window.PRODUCT_DATA && window.PRODUCT_DATA[p.dataKey] && window.PRODUCT_DATA[p.dataKey][dataKey];
      if (!hasData) { toast('暂无该领取年龄/年龄/性别/缴费期组合的数据，请调整'); return; }
      Ann.setData(window.PRODUCT_DATA[p.dataKey]);
      var opts = Object.assign({}, p.cfg);
      if (opts.unitsMode === 'shares') opts.shares = premium / (opts.shareDiv || 1000);
      if (opts.onceClaim) {
        // 一次性领取数据表按产品切换：幸福享裕用 XFY_*，幸福享裕B用 XFYB_*
        if (p.dataKey === 'xfy') Ann.setOnceData(window.XFY_ONCE, window.XFY_BA);
        else Ann.setOnceData(window.XFYB_ONCE, window.XFYB_BA);
      }
      var res = Ann.compute({
        age: age, sex: sex, ppp: ppp, premium: premium,
        divRate: v.divRate, uniRate: v.uniRate, irrAge: irrAge, mode: mode,
        onceClaim: (opts.onceClaim ? (v.onceClaim || 0) : 0),
        shares: (opts.unitsMode === 'shares' ? premium / (opts.shareDiv || 1000) : undefined),
        withdraw: withdraw
      }, opts);
      lastResult = { res: res, p: p, v: v };
    } else {
      var DS = window.PRODUCT_DATA[p.dataKey];
      if (!DS || !DS.base || !DS.base[age + '-' + sex + '-' + ppp]) { toast('暂无该组合数据，请调整'); return; }
      End.setData(DS);
      var cfg = Object.assign({}, p.cfg, { startAge: age, irrAge: irrAge });
      var res2 = End.compute({
        age: age, sex: sex, ppp: ppp, premium: premium,
        divRate: v.divRate, irrAge: irrAge, withdraw: withdraw
      }, cfg);
      lastResult = { res: res2, p: p, v: v };
    }
    var irrRow = document.querySelector('.irr-row');
    // 安盈尊享利率表按钮：仅安盈尊享产品显示
    var rateBtn = $('rateTableBtn');
    if (rateBtn) rateBtn.classList[p.id === 'aying' ? 'remove' : 'add']('hidden');
    if (p.kind === 'endowment') {
      // 安盈两全险保留顶部卡片：回正时间 / 满期平均年单利
      if (irrRow) irrRow.classList.remove('hidden');
      $('irrG').textContent = (lastResult.res.payback || '--') + ' 年';
      $('irrC').textContent = pct(lastResult.res.maturitySimple);
      $('irrGLabel').textContent = '回正时间';
      $('irrCLabel').textContent = '满期平均年单利';
    } else {
      // 其余产品：预览页不再展示顶部 IRR 卡片（逐年IRR改由可选参数控制，默认不显示）
      if (irrRow) irrRow.classList.add('hidden');
    }
    renderPlanTable(lastResult);
    $('resultPanel').classList.remove('hidden');
    // 生成后收起填写表单，让结果区紧随 banner 显示
    collapseForm(v, p);
    setTimeout(function () { $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  }

  // 生成后折叠表单，显示一行参数摘要
  function collapseForm(v, p) {
    var card = $('formCard');
    if (!card) return;
    var bits = [];
    if (v.age != null) bits.push(v.age + '岁' + (v.sex === 'M' ? '男' : '女'));
    if (v.ppp != null && p.engine !== 'aying') bits.push('缴' + v.ppp + '年');
    if (v.premium != null) bits.push('年交 ' + Number(v.premium).toLocaleString('zh-CN'));
    if (v.divRate != null && !(p.cfg && p.cfg.noDividend)) bits.push('分红 ' + Math.round(v.divRate * 100) + '%');
    if (v.uniRate != null) bits.push('万能 ' + (v.uniRate * 100).toFixed(2) + '%');
    if (lastResult && lastResult.res && lastResult.res.once) {
      var o = lastResult.res.once;
      bits.push(o.claimAge + '岁一次性领取 ' + fmtMoney(o.amount) + '元（' + o.multiplier + '倍）');
    }
    if (String(v.withdrawFlag) === '1' && v.withdrawAmt > 0) {
      bits.push('中途领取 ' + v.withdrawStart + '-' + v.withdrawEnd + '岁 每年' + fmtMoney(v.withdrawAmt) + '元');
    }
    $('formSummary').innerHTML = '<b>' + p.name + '</b>　' + bits.join(' · ');
    $('formSummary').classList.remove('hidden');
    $('formToggle').classList.remove('hidden');
    card.classList.add('collapsed');
  }
  function expandForm() {
    var card = $('formCard');
    if (!card) return;
    card.classList.remove('collapsed');
    $('formSummary').classList.add('hidden');
    $('formToggle').classList.add('hidden');
  }

  // 展示规则说明（逐年显示 / 默认规则）
  function displayRuleNote(d) {
    return String(d.v.showAllYears) === '1'
      ? '注：逐年展示全部保单年度。'
      : '注：20年后(含20年)每5年展示一次，回本年与翻倍年强制保留。';
  }

  // ---------- 里程碑分析 ----------
  function analyzePlan(d) {
    var rows = d.res.rows;
    // 逐年IRR（可选）：仅在参数开启时计算，默认不算以免影响性能
    var yearlyIRR = (String(d.v.showIrr) === '1') ? calcYearlyIRR(rows) : null;
    // 预期总利益: 年金=expected; 增额sxf=surrender; 增额bgb=total
    function totalOf(r) {
      if (d.p.kind === 'annuity') return r.expected;
      return (d.p.cfg.display === 'bgb') ? r.total : r.surrender;
    }
    var totalPremium = d.v.premium * d.v.ppp;
    var breakEvenYear = null, doubleYear = null;
    for (var i = 0; i < rows.length; i++) {
      var y = rows[i].year, tot = totalOf(rows[i]);
      if (breakEvenYear === null && tot >= totalPremium) breakEvenYear = y;
      if (doubleYear === null && tot >= totalPremium * 2) doubleYear = y;
    }
    var display = [];
    // 逐年显示开关：选"是"则展示全部保单年度；否则按 20年内每年/之后每5年 + 回本年/翻倍年/末年
    var showAll = String(d.v.showAllYears) === '1';
    // 除安盈尊享外：最后一年强制展示；年龄一律用引擎/底表真实年初年龄，不人为改写（各产品底表末行年龄本就不同，强行统一会与上一年度重复）
    var lastYear = rows.length ? rows[rows.length - 1].year : 0;
    var to105 = (d.p && d.p.id !== 'aying');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], y = r.year;
      var show = showAll ? true : ((y <= 20) ? true : (y % 5 === 0));
      if (y === breakEvenYear || y === doubleYear) show = true;
      if (to105 && y === lastYear) show = true; // 最后一年(年末满105周岁)始终展示
      if (show) {
        var c = {}; for (var k in r) c[k] = r[k];
        if (yearlyIRR) c.irr = yearlyIRR[i];
        // 年龄列沿用引擎真实年初年龄：末行不再强制改写，避免与上一展示年度年龄重复
        // 单利开关(除安盈外)：单利 = (预期生存总利益 - 累计保费) / 累计保费 / 保单年度
        if (d.p.kind !== 'endowment' && String(d.v.showRate) === '1') {
          var paidPremium = d.v.premium * Math.min(y, d.v.ppp);
          var tot = totalOf(r);
          var rate = paidPremium > 0 ? (tot - paidPremium) / paidPremium / y : null;
          c.rate = (rate != null && rate > 0) ? rate : null; // 负数或0留空
        }
        c._mark = (y === doubleYear) ? 'double' : (y === breakEvenYear ? 'breakeven' : '');
        display.push(c);
      }
    }
    return { rows: display, totalPremium: totalPremium, breakEvenYear: breakEvenYear, doubleYear: doubleYear };
  }

  function paramLine(d) {
    var v = d.v;
    var s;
    if (d.p.kind === 'endowment') {
      s = v.age + '岁' + sexName(v.sex) + '　趸交' + fmtMoney(v.premium) + '元　保' + v.term + '年';
    } else {
      s = v.age + '岁' + sexName(v.sex) + '　每年' + fmtMoney(v.premium) + '元　缴' + v.ppp + '年';
      if (v.annuityMode != null) {
        var mLabels = { 1: '即期领取', 55: '55岁领取', 60: '60岁领取', 65: '65岁领取' };
        s += '　' + (mLabels[String(v.annuityMode)] || (v.annuityMode + '岁领取'));
      }
      if (d.p.cfg && d.p.cfg.noDividend) s += '　固定收益　万能' + (v.uniRate * 100).toFixed(2) + '%';
      else if (d.p.kind === 'annuity') s += '　分红实现率' + (v.divRate * 100).toFixed(0) + '%　万能' + (v.uniRate * 100).toFixed(2) + '%';
      else s += '　红利实现率' + (v.divRate * 100).toFixed(0) + '%';
    }
    if (String(v.withdrawFlag) === '1' && v.withdrawAmt > 0) {
      s += '　中途领取' + v.withdrawStart + '-' + v.withdrawEnd + '岁每年' + fmtMoney(v.withdrawAmt) + '元';
    }
    return s;
  }

  // ---------- 对接服务文案（产品配置 → 行数组，供网页/图片/Excel共用） ----------
  function serviceLines(p) {
    var out = [];
    if (!p.services || !p.services.length) return out;
    p.services.forEach(function (s, i) {
      out.push((i + 1) + '. ' + s.name + '｜对接标准：' + s.std);
      out.push('    服务内容：' + s.content);
      out.push('    有效期：' + s.valid);
    });
    if (p.serviceNote) out.push(p.serviceNote);
    return out;
  }

  // ---------- 对接服务图片布局（与网页同款字体层次，精确测量换行） ----------
  function svcLayout(p, tableW) {
    var empty = { h: 0, headH: 34, pad: 14, nameH: 28, labelW: 64, rowH: 19, cardGap: 10, items: [], note: '' };
    if (!p.services || !p.services.length) return empty;
    var probe = document.createElement('canvas').getContext('2d');
    var labelW = 64, nameH = 28, rowH = 19, cardGap = 10, pad = 14, headH = 34;
    var contentMaxW = tableW - 28 - labelW;
    var items = [], total = headH + pad;
    p.services.forEach(function (s, i) {
      var rows = [];
      [['对接标准', s.std], ['服务内容', s.content], ['有效期', s.valid]].forEach(function (f) {
        probe.font = '13px "Microsoft YaHei",sans-serif';
        var lines = wrapCount(probe, f[1], contentMaxW);
        rows.push({ label: f[0], text: f[1] });
        total += 14 + lines * rowH + 2; // 14=首行基线偏移，与绘制 sy+14 对齐
      });
      items.push({ no: i + 1, name: s.name, rows: rows });
      total += nameH + cardGap;
    });
    var note = p.serviceNote || '';
    if (note) {
      probe.font = '11px "Microsoft YaHei",sans-serif';
      total += 12 + wrapCount(probe, note, tableW - 28) * 17 + 10; // 12=note首行基线偏移
    }
    total += pad;
    return { h: total, headH: headH, pad: pad, nameH: nameH, labelW: labelW, rowH: rowH, cardGap: cardGap, items: items, note: note };
  }
  function wrapCount(ctx, text, maxW) {
    var line = '', n = 1;
    for (var i = 0; i < text.length; i++) {
      var t = line + text[i];
      if (ctx.measureText(t).width > maxW && line) { n++; line = text[i]; } else line = t;
    }
    return n;
  }

  // ---------- 组装 Excel 导出数据（与出图同口径） ----------
  function buildExcelPayload(d) {
    var a = analyzePlan(d);
    var cols = effectiveCols(d);
    var heads = ['保单\n年度', '年初\n年龄'];
    cols.forEach(function (c) { heads.push(colTitle(c, d)); });
    var rows = a.rows.map(function (r) {
      var cells = [r.year, r.age];
      cols.forEach(function (c) {
        cells.push(fmtCell(c, r[c.k]));
      });
      return { cells: cells, mark: r._mark || '' };
    });
    var notes = [];
    if (a.breakEvenYear != null) notes.push('★ 第' + a.breakEvenYear + '年：预期总利益首超累计保费 ' + fmtMoney(a.totalPremium) + ' 元');
    if (a.doubleYear != null) notes.push('★ 第' + a.doubleYear + '年：预期总利益首超累计保费 2 倍');
    notes.push(displayRuleNote(d));
    if (d.p.services && d.p.services.length) {
      notes.push('【对接服务】');
      serviceLines(d.p).forEach(function (ln) { notes.push(ln); });
    }
    notes.push('① 仅供内部学习交流，数据仅供参考，' + (d.p.kind === 'endowment' ? '具体以保险合同为准。' : '分红部分不确定，以保险合同为准。'));
    notes.push('② ' + d.p.note);
    return {
      filename: d.p.name + '计划书_' + d.v.age + '岁' + sexName(d.v.sex) + '.xlsx',
      title: d.p.full,
      subtitle: paramLine(d),
      headers: heads,
      rows: rows,
      notes: notes
    };
  }

  // 按"身故利益"开关，在现金价值后动态插入一列（网页/图片/Excel同口径）
  function effectiveCols(d) {
    var base = d.p.cols;
    var out = base;
    // 中途领取：在"预期生存总利益"(末列)左边插入"当年领取"列
    if (String(d.v.withdrawFlag) === '1' && parseFloat(d.v.withdrawAmt) > 0) {
      out = base.slice();
      var lastIdx = -1;
      for (var li = 0; li < out.length; li++) { if (out[li].last) { lastIdx = li; break; } }
      var wcol = { k: 'withdrawAmt', t: '当年\n领取' };
      if (lastIdx >= 0) out.splice(lastIdx, 0, wcol);
      else out.push(wcol);
    }
    var dv = String(d.v.deathView == null ? 0 : d.v.deathView);
    if (d.p.kind === 'annuity' && dv !== '0' && dv !== 'none') {
      var col = dv === 'guaranteed'
        ? { k: 'legacyGuaranteed', t: '保证\n身故利益' }
        : { k: 'legacyExpected', t: '预期\n身故利益' };
      var idx = 0;
      for (var i = 0; i < out.length; i++) { if (out[i].k === 'cash') { idx = i + 1; break; } }
      out.splice(idx, 0, col);
    }
    // 表尾追加可选列：单利、逐年IRR（除安盈外），高亮末列随之转移到最后一列
    var extra = [];
    if (d.p.kind !== 'endowment' && String(d.v.showRate) === '1') {
      extra.push({ k: 'rate', t: '单利', fmt: 'pct' });
    }
    if (d.p.kind !== 'endowment' && String(d.v.showIrr) === '1') {
      extra.push({ k: 'irr', t: '逐年\nIRR', fmt: 'pct' });
    }
    if (extra.length) {
      out = out.map(function (c) { var n = {}; for (var k in c) n[k] = c[k]; n.last = false; return n; });
      extra[extra.length - 1].last = true;
      out = out.concat(extra);
    }
    return out;
  }

  function colTitle(c, d) {
    var t = c.t;
    if (c.dyn === 'uni') t = (d.p.cfg && d.p.cfg.noDividend) ? '年金转入\n万能账户' : '年金+分红\n' + (d.v.uniRate * 100).toFixed(2) + '%万能账户';
    return t;
  }

  // ---------- 渲染计划书表格 ----------
  function renderPlanTable(d) {
    var a = analyzePlan(d);
    var cols = effectiveCols(d);
    var html = '';
    html += '<div class="pt-title">' + d.p.full + '</div>';
    html += '<div class="pt-sub">' + paramLine(d) + '</div>';
    html += '<table class="pt-table"><thead><tr>';
    html += '<th>保单<br>年度</th><th>年初<br>年龄</th>';
    cols.forEach(function (c, i) {
      var cls = c.last ? ' class="col-expected"' : '';
      html += '<th' + cls + '>' + String(colTitle(c, d)).replace(/\n/g, '<br>') + '</th>';
    });
    html += '</tr></thead><tbody>';
    a.rows.forEach(function (r) {
      var cls = r._mark === 'double' ? ' class="mark-double"' : (r._mark === 'breakeven' ? ' class="mark-breakeven"' : '');
      html += '<tr' + cls + '><td>' + r.year + '</td><td>' + r.age + '</td>';
      cols.forEach(function (c) {
        var txt = fmtCell(c, r[c.k]);
        var tdcls = c.last ? ' class="col-expected"' : '';
        html += '<td' + tdcls + '>' + txt + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    // 图例
    var legend = [];
    if (a.breakEvenYear != null) legend.push('第' + a.breakEvenYear + '年 预期总利益首超累计保费 <span class="lg-be">' + fmtMoney(a.totalPremium) + '元</span>');
    if (a.doubleYear != null) legend.push('第' + a.doubleYear + '年 首超2倍 <span class="lg-db">红色行</span>');
    if (legend.length) html += '<div class="pt-legend">' + legend.join('　　') + '</div>';
    // 对接服务：并入计划书内，随图片/Excel 一页展示
    if (d.p.services && d.p.services.length) {
      html += '<div class="pt-services"><div class="pt-svc-head">对接服务</div>';
      d.p.services.forEach(function (s, i) {
        html += '<div class="svc-card">';
        html += '<div class="svc-name"><span class="svc-no">' + (i + 1) + '</span>' + s.name + '</div>';
        html += '<div class="svc-row"><span class="svc-k">对接标准</span><span class="svc-v">' + s.std + '</span></div>';
        html += '<div class="svc-row"><span class="svc-k">服务内容</span><span class="svc-v">' + s.content + '</span></div>';
        html += '<div class="svc-row"><span class="svc-k">有效期</span><span class="svc-v">' + s.valid + '</span></div>';
        html += '</div>';
      });
      if (d.p.serviceNote) html += '<div class="svc-note">' + d.p.serviceNote + '</div>';
      html += '</div>';
    }
    var koujing;
    var noDiv = d.p.kind === 'endowment' || (d.p.cfg && d.p.cfg.noDividend);
    if (d.p.kind === 'endowment') koujing = '本产品为趸交两全保险，满期一次性给付，所有利益为确定值，无分红及万能账户';
    else if (d.p.cfg && d.p.cfg.noDividend) koujing = '本产品为固定收益年金，无分红；保证生存总利益为万能结算利率1%口径，预期生存总利益按当前万能演示利率口径';
    else if (d.p.kind === 'annuity') koujing = '保证生存总利益为分红实现率0%、万能结算利率1%口径；预期生存总利益按当前演示口径';
    else koujing = '红利及交清增额部分不确定，退保/身故总利益含非保证红利演示';
    html += '<div class="pt-note">① 本页及说明仅供内部从业人员学习交流，数据仅供参考，' + (noDiv ? '' : '含分红部分不确定，') + '具体内容以保单条款及保险合同为准。② ' + koujing + '。③ ' + displayRuleNote(d).replace(/^注：/, '') + '④ ' + d.p.note + '</div>';
    $('planTable').innerHTML = html;
    // 等布局完成后再测量缩放，避免拿到未重排的尺寸
    requestAnimationFrame(function () { requestAnimationFrame(fitPlanTable); });
  }

  // 预览自适应：把整张计划书缩放到容器宽度内，无需横向滑动即可看全
  function fitPlanTable() {
    var table = $('planTable'), wrap = table && table.parentNode;
    if (!table || !wrap) return;
    table.style.transform = ''; wrap.style.height = '';
    var allBlocks = table.querySelectorAll('.pt-title, .pt-sub, .pt-legend, .pt-services, .pt-note');
    for (var q = 0; q < allBlocks.length; q++) allBlocks[q].style.width = '';
    var avail = wrap.clientWidth;
    // 内部表格的自然宽度（外层 width:auto 时由内容决定）
    var inner = table.querySelector('.pt-table');
    var natural = inner ? inner.getBoundingClientRect().width : table.getBoundingClientRect().width;
    if (!avail || !natural) return;
    var scale = Math.min(1, avail / natural);
    if (scale >= 0.999) return;
    // 标题/副标题/图例/说明/对接服务统一按表格自然宽对齐，避免缩放后右侧留白
    var heads = table.querySelectorAll('.pt-title, .pt-sub, .pt-legend, .pt-services, .pt-note');
    for (var i = 0; i < heads.length; i++) heads[i].style.width = natural + 'px';
    table.style.transform = 'scale(' + scale + ')';
    wrap.style.height = (table.offsetHeight * scale) + 'px';
  }
  window.addEventListener('resize', function () { if (lastResult) fitPlanTable(); });

  // ---------- Canvas 出图（参考风格：金树banner + 书法标题 + 红表头） ----------
  function drawPlanImage(d) {
    var a = analyzePlan(d);
    var cols = effectiveCols(d);
    // 逐年显示且行数较多时分页；每页最多 40 行，第二页起表头与第一页一致
    var ROWS_PER_PAGE = 40;
    var chunks = [];
    if (String(d.v.showAllYears) === '1' && a.rows.length > ROWS_PER_PAGE) {
      for (var s = 0; s < a.rows.length; s += ROWS_PER_PAGE) chunks.push(a.rows.slice(s, s + ROWS_PER_PAGE));
    } else {
      chunks = [a.rows];
    }
    return chunks.map(function (pageRows, pi) {
      return drawPlanPage(d, a, cols, pageRows, pi + 1, chunks.length);
    });
  }

  function drawPlanPage(d, a, cols, rows, pageNo, pageTotal) {
    var scale = 2, W = 1080, pad = 24;
    var ncol = cols.length + 2; // +年度+年龄
    // 参考风格尺寸
    var bannerH = 340, titleH = 46, subH = 52, headH = 72, rowH = 52, noteH = 150;
    var tableW = W - pad * 2;
    // 结构化布局：与网页展示同款字体层次，精确计算服务区高度
    var svcLay = svcLayout(d.p, tableW);
    var svcHeadH = svcLay.items.length ? svcLay.headH : 0;
    var svcH = svcLay.h;
    // 列宽: 年度/年龄固定较窄，其余平均，末列略宽
    var weights = [0.9, 0.9];
    cols.forEach(function (c, i) { weights.push(c.last ? 1.3 : 1.15); });
    var wsum = weights.reduce(function (x, y) { return x + y; }, 0);
    var colW = weights.map(function (w) { return w / wsum * tableW; });
    var isLastPage = (pageNo === pageTotal);
    // 服务/说明只在最后一页展示，避免第一页重复；表头每页都有
    var pageSvcH = isLastPage ? svcH : 0;
    var pageNoteH = isLastPage ? noteH : 0;
    // 绘制累计：bannerH + 副标题(subH-14) + 参数行48 + headH + ...
    var H = bannerH + (subH - 14) + 48 + headH + rows.length * rowH + pageSvcH + pageNoteH + pad;
    var canvas = document.createElement('canvas');
    canvas.width = W * scale; canvas.height = H * scale;
    var ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#faf1e0'; ctx.fillRect(0, 0, W, H);

    var y = 0;
    // 顶部金树 banner
    if (heroImg.complete && heroImg.naturalWidth) {
      var iw = heroImg.naturalWidth, ih = heroImg.naturalHeight;
      var sh = iw / W * bannerH; if (sh > ih) sh = ih;
      ctx.drawImage(heroImg, 0, (ih - sh) / 2, iw, sh, 0, 0, W, bannerH);
    } else {
      var grd = ctx.createLinearGradient(0, 0, 0, bannerH);
      grd.addColorStop(0, '#fbf0dc'); grd.addColorStop(1, '#f3dfc0');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, W, bannerH);
    }
    // 方案一·典雅红金蒙版（左侧深红渐隐衬白字，右侧露出金树金门）
    var shade = ctx.createLinearGradient(0, 0, W, 0);
    shade.addColorStop(0, 'rgba(90,20,22,.5)'); shade.addColorStop(0.45, 'rgba(90,20,22,.26)'); shade.addColorStop(0.8, 'rgba(90,20,22,0)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, W, bannerH);
    // 右上角金色「泰」logo
    (function () {
      var s = 84, x = W - pad - s, y0 = 22, r = 16;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x + r, y0); ctx.lineTo(x + s - r, y0); ctx.quadraticCurveTo(x + s, y0, x + s, y0 + r);
      ctx.lineTo(x + s, y0 + s - r); ctx.quadraticCurveTo(x + s, y0 + s, x + s - r, y0 + s);
      ctx.lineTo(x + r, y0 + s); ctx.quadraticCurveTo(x, y0 + s, x, y0 + s - r);
      ctx.lineTo(x, y0 + r); ctx.quadraticCurveTo(x, y0, x + r, y0); ctx.closePath();
      ctx.fillStyle = 'rgba(123,17,19,.55)'; ctx.fill();
      var lg = ctx.createLinearGradient(x, y0, x + s, y0 + s);
      lg.addColorStop(0, '#F6DFA0'); lg.addColorStop(0.5, '#D9A94E'); lg.addColorStop(1, '#B8862A');
      ctx.strokeStyle = lg; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.fillStyle = '#F5E6C0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 52px "STKaiti","KaiTi","楷体",serif';
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4;
      ctx.fillText('泰', x + s / 2, y0 + s / 2 + 2);
      ctx.restore();
    })();
    // 大标题（产品简称，白色大字，位于 banner 中下部）
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 54px "STKaiti","KaiTi","楷体",serif';
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8;
    fitText(ctx, d.p.name, W / 2, bannerH - 66, tableW - 40);
    ctx.shadowBlur = 0;
    if (pageTotal > 1) {
      ctx.fillStyle = '#F5E6C0'; ctx.font = 'bold 22px "Microsoft YaHei",sans-serif';
      ctx.fillText('（第 ' + pageNo + ' / ' + pageTotal + ' 页）', W / 2, bannerH - 30);
    }
    y = bannerH;
    // 产品全称副标题
    ctx.fillStyle = '#6b4a1e'; ctx.font = 'bold 24px "Microsoft YaHei",sans-serif';
    fitText(ctx, d.p.full, W / 2, y + 18, tableW - 40);
    y += subH - 14;
    // 参数摘要行（白底框 + 深红粗体，居中）
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(pad, y, tableW, 48);
    ctx.strokeStyle = '#E4BE72'; ctx.lineWidth = 1.5; ctx.strokeRect(pad, y, tableW, 48);
    ctx.fillStyle = '#7B1113'; ctx.font = 'bold 24px "Microsoft YaHei",sans-serif';
    fitText(ctx, paramLine(d), W / 2, y + 25, tableW - 30);
    y += 48;
    // 表头（红底金字）
    var heads = ['保单\n年度', '年初\n年龄'];
    cols.forEach(function (c) { heads.push(colTitle(c, d).replace('\n', '\n')); });
    ctx.fillStyle = '#921B1E'; ctx.fillRect(pad, y, tableW, headH);
    var lastX = pad + colW.slice(0, ncol - 1).reduce(function (x, z) { return x + z; }, 0);
    ctx.fillStyle = '#B8862A'; ctx.fillRect(lastX, y, colW[ncol - 1], headH);
    var x = pad;
    for (var c = 0; c < ncol; c++) {
      ctx.fillStyle = (c === ncol - 1) ? '#FFF6DC' : '#F5E6C0';
      ctx.font = 'bold 16px "Microsoft YaHei",sans-serif';
      var lines = heads[c].split('\n');
      for (var li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], x + colW[c] / 2, y + headH / 2 + (li - (lines.length - 1) / 2) * 23);
      }
      x += colW[c];
    }
    y += headH;
    // 数据行
    rows.forEach(function (r, ri) {
      var bg, fg = '#1a1a1a';
      if (r._mark === 'double') { bg = '#F8D7DA'; fg = '#8B0000'; }
      else if (r._mark === 'breakeven') { bg = '#F9CDB6'; fg = '#A83E12'; }
      else if (r.year === 10 || r.year === 20 || r.year === 30) { bg = '#F5E6C0'; fg = '#7B1113'; } // 第10/20/30年金色底纹
      else bg = (ri % 2 === 0) ? '#FAF3F3' : '#FBF5E6';
      ctx.fillStyle = bg; ctx.fillRect(pad, y, tableW, rowH);
      var isMark = (r._mark === 'double' || r._mark === 'breakeven');
      if (!isMark) {
        ctx.fillStyle = '#F7DE8F'; ctx.fillRect(lastX, y, colW[ncol - 1], rowH);
      }
      ctx.strokeStyle = '#ecdfc8'; ctx.lineWidth = 1; ctx.strokeRect(pad, y, tableW, rowH);
      ctx.textAlign = 'center';
      var cx = pad;
      // 年度/年龄
      ctx.fillStyle = fg; ctx.font = 'bold 21px "Microsoft YaHei",sans-serif';
      ctx.fillText(String(r.year), cx + colW[0] / 2, y + rowH / 2); cx += colW[0];
      ctx.fillText(String(r.age), cx + colW[1] / 2, y + rowH / 2); cx += colW[1];
      cols.forEach(function (c, ci) {
        var txt = fmtCell(c, r[c.k]);
        if (c.last) { ctx.fillStyle = '#8B0000'; ctx.font = 'bold 23px "Microsoft YaHei",sans-serif'; }
        else { ctx.fillStyle = fg; ctx.font = 'bold 21px "Microsoft YaHei",sans-serif'; }
        ctx.fillText(txt, cx + colW[ci + 2] / 2, y + rowH / 2);
        cx += colW[ci + 2];
      });
      y += rowH;
    });
    // 对接服务（并入计划书，仅最后一页展示，字体层次与网页一致）
    if (isLastPage && svcLay.items.length) {
      ctx.fillStyle = '#fdf8e8'; ctx.fillRect(pad, y, tableW, svcH);
      ctx.strokeStyle = '#e6d9c0'; ctx.lineWidth = 1; ctx.strokeRect(pad, y, tableW, svcH);
      // 标题条（红底金字，与网页 .pt-svc-head 一致）
      ctx.fillStyle = '#921B1E'; ctx.fillRect(pad, y, tableW, svcHeadH);
      ctx.fillStyle = '#F5E6C0'; ctx.font = 'bold 16px "Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('对接服务', W / 2, y + svcHeadH / 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      var sy = y + svcHeadH + svcLay.pad;
      svcLay.items.forEach(function (item) {
        // 服务名：金色圆形编号 + 粗体红字（与网页 .svc-name/.svc-no 一致）
        ctx.beginPath(); ctx.arc(pad + 14 + 11, sy + 11, 11, 0, Math.PI * 2);
        ctx.fillStyle = '#C9A24A'; ctx.fill();
        ctx.fillStyle = '#4a2f00'; ctx.font = 'bold 13px "Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(item.no), pad + 14 + 11, sy + 12);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#7B1113'; ctx.font = 'bold 17px "Microsoft YaHei",sans-serif';
        ctx.fillText(item.name, pad + 14 + 30, sy + 17);
        sy += svcLay.nameH;
        // 字段行：标签粗体金褐 + 内容普通深色（与网页 .svc-k/.svc-v 一致）
        item.rows.forEach(function (row) {
          ctx.fillStyle = '#8a7340'; ctx.font = 'bold 13px "Microsoft YaHei",sans-serif';
          ctx.fillText(row.label, pad + 14, sy + 14);
          ctx.fillStyle = '#444'; ctx.font = '13px "Microsoft YaHei",sans-serif';
          sy = wrapTextH(ctx, row.text, pad + 14 + svcLay.labelW, sy + 14, tableW - 28 - svcLay.labelW, svcLay.rowH) + 2;
        });
        sy += svcLay.cardGap;
      });
      // 说明：灰色小字（与网页 .svc-note 一致）
      if (svcLay.note) {
        ctx.fillStyle = '#999'; ctx.font = '11px "Microsoft YaHei",sans-serif';
        wrapTextH(ctx, svcLay.note, pad + 14, sy + 12, tableW - 28, 17);
      }
      y += svcH;
    }
    // 说明（仅最后一页展示）
    if (isLastPage) {
      ctx.fillStyle = '#fafafa'; ctx.fillRect(pad, y, tableW, noteH);
      ctx.strokeStyle = '#e6d9c0'; ctx.strokeRect(pad, y, tableW, noteH);
      ctx.fillStyle = '#888'; ctx.font = '12px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'left';
      var notes = [];
      if (a.breakEvenYear != null) notes.push('★ 第' + a.breakEvenYear + '年：预期总利益首超累计保费 ' + fmtMoney(a.totalPremium) + ' 元');
      if (a.doubleYear != null) notes.push('★ 第' + a.doubleYear + '年：预期总利益首超累计保费 2 倍');
      notes.push(displayRuleNote(d));
      notes.push('① 仅供内部学习交流，数据仅供参考，' + (d.p.kind === 'endowment' ? '具体以保险合同为准。' : '分红部分不确定，以保险合同为准。'));
      notes.push('② ' + d.p.note);
      notes.forEach(function (n, i) {
        wrapText(ctx, n, pad + 12, y + 20 + i * 22, tableW - 24);
      });
    }
    return { url: canvas.toDataURL('image/png'), page: pageNo, total: pageTotal };
  }
  function fitText(ctx, text, x, y, maxW) {
    var w = ctx.measureText(text).width;
    if (w <= maxW) { ctx.fillText(text, x, y); return; }
    var rate = maxW / w, size = parseInt(ctx.font.match(/(\d+)px/)[1], 10);
    ctx.font = ctx.font.replace(/(\d+)px/, Math.floor(size * rate) + 'px');
    ctx.fillText(text, x, y);
  }
  function wrapText(ctx, text, x, y, maxW) {
    var line = '', yy = y;
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = text[i]; yy += 20; }
      else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }
  // 返回绘制结束后的 y（供多段文本累加）
  function wrapTextH(ctx, text, x, y, maxW, lineH) {
    var line = '', yy = y;
    for (var i = 0; i < text.length; i++) {
      var test = line + text[i];
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = text[i]; yy += lineH; }
      else line = test;
    }
    if (line) { ctx.fillText(line, x, yy); yy += lineH; }
    return yy;
  }

  // 在弹窗中展示一或多张图片，并为每张生成下载按钮
  function showImagePages(pages, baseName, title) {
    var box = $('imgBox'), bar = $('imgDownloadBar');
    box.innerHTML = ''; bar.innerHTML = '';
    pages.forEach(function (pg, idx) {
      var img = document.createElement('img');
      img.src = pg.url; img.alt = title + (pages.length > 1 ? (' 第' + (idx + 1) + '页') : '');
      box.appendChild(img);
      var a = document.createElement('a');
      a.className = 'btn btn-gold';
      a.href = pg.url;
      a.download = baseName + (pages.length > 1 ? '_第' + (idx + 1) + '页' : '') + '.png';
      a.textContent = pages.length > 1 ? ('下载第 ' + (idx + 1) + ' 页') : '下载图片';
      bar.appendChild(a);
    });
    $('imgModalTitle').textContent = title + (pages.length > 1 ? '（共' + pages.length + '页，长按保存 / 点击下载）' : '（长按保存 / 点击下载）');
    $('imgModal').classList.remove('hidden');
  }
  $('exportBtn').addEventListener('click', function () {
    if (!lastResult) { toast('请先生成计划书'); return; }
    try {
      var pages = drawPlanImage(lastResult);
      var base = lastResult.p.name + '计划书_' + lastResult.v.age + '岁' + sexName(lastResult.v.sex);
      showImagePages(pages.map(function (p) { return { url: p.url }; }), base, '计划书图片');
    } catch (e) {
      toast('图片生成失败：' + e.message, 3000);
    }
  });
  $('exportExcelBtn').addEventListener('click', function () {
    if (!lastResult) { toast('请先生成计划书'); return; }
    if (!window.ExcelExporter) { toast('Excel 组件未加载'); return; }
    try {
      var payload = buildExcelPayload(lastResult);
      window.ExcelExporter.exportPlan(payload);
      toast('Excel 已生成，可在下载目录查看');
    } catch (e) {
      toast('Excel 生成失败：' + e.message, 3000);
    }
  });
  // 通用：在弹窗中展示静态图片（供多个生成按钮复用）
  function showStaticImage(src, alt, filename, title) {
    var box = $('imgBox'), bar = $('imgDownloadBar');
    box.innerHTML = ''; bar.innerHTML = '';
    var img = document.createElement('img');
    img.src = src; img.alt = alt; box.appendChild(img);
    var a = document.createElement('a');
    a.className = 'btn btn-gold'; a.href = src; a.download = filename; a.textContent = '下载图片';
    bar.appendChild(a);
    $('imgModalTitle').textContent = title + '（长按保存 / 点击下载）';
    $('imgModal').classList.remove('hidden');
  }
  // 生成高客服务图片（泰康人寿客户等级权益梳理）
  $('vipImgBtn').addEventListener('click', function () {
    showStaticImage('vip-rights.png', '泰康人寿客户等级权益梳理', '泰康人寿客户等级权益梳理.png', '高客服务图片');
  });
  // 生成城市版对接明细（泰康三类服务）
  $('cityImgBtn').addEventListener('click', function () {
    showStaticImage('city-services.png', '泰康三类服务对接明细', '城市版对接明细.png', '城市版对接明细');
  });
  // 生成重疾绿通服务图片（泰康绿通2026服务速览·客户版金饰背景版）
  $('greenImgBtn').addEventListener('click', function () {
    showStaticImage('green-channel.png', '泰康绿通2026服务速览', '泰康绿通2026服务速览.png', '重疾绿通服务图片');
  });
  // 安盈尊享利率表（仅安盈产品）：两全保险满期利率速查表
  $('rateTableBtn').addEventListener('click', function () {
    showStaticImage('anying-rate-table.jpg', '安盈尊享利率表', '安盈尊享利率表.jpg', '安盈尊享利率表');
  });
  $('formToggle').addEventListener('click', function () {
    expandForm();
    $('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('imgClose').addEventListener('click', function () { $('imgModal').classList.add('hidden'); });
  $('imgModal').addEventListener('click', function (e) { if (e.target === $('imgModal')) $('imgModal').classList.add('hidden'); });

  // ---------- 启动 ----------
  restoreAuth();
})();
