/**
 * 年金类通用计算内核 (幸福享裕 / 臻品世家 / 百岁2026)
 * 查基础数据表 + 万能账户逐年递推, 口径已逐列零误差对齐各产品原 Excel。
 *
 * 数据表 DATA: key = "age-sex-ppp", value = [[当年保费基准, 低红利, 中红利, 生存金, 身故, 现价], ...]
 *   现价/红利/生存金 = 列值 × units
 *
 * 产品级配置 opt:
 *   unitsMode : 'premium' 表示 units=保费/10000 (xfy/bs2026); 'shares' 表示 units=演示份数 (zpsj)
 *   shares    : zpsj 的演示份数 (保费/1000)
 *   survThr   : 退保总利益"下一年生存金"计入的年龄上限；xfy=85, zpsj=Infinity(恒计入)
 *   rateLow   : 万能保底结算利率(默认0.01)
 *   rateMid   : 万能现行结算利率(默认0.03)
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AnnEngine = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var AnnData = null;
  function setData(d) { AnnData = d || {}; }

  // 一次性领取选择权数据（仅幸福享裕B使用）：全局表由 datajs/xfyb_once.js 与 xfyb_ba.js 注入
  // XFYB_ONCE[claimAge][age] = [趸M,趸F,3M,3F,5M,5F,10M,10F,15M,15F,20M,20F] 倍数
  // XFYB_BA[age] = [趸M,趸F,...] 每千元年交保费对应的基本保险金额
  var OnceData = null, BAData = null;
  function setOnceData(o, b) { OnceData = o || null; BAData = b || null; }
  var PPP_COL = { 1: 0, 3: 2, 5: 4, 10: 6, 15: 8, 20: 10 }; // 列组内偏移，女性+1
  function onceMultiplier(claimAge, age, sex, ppp) {
    if (!OnceData || !OnceData[claimAge]) return 0;
    var row = OnceData[claimAge][age];
    if (!row) return 0;
    var idx = (PPP_COL[ppp] == null ? 2 : PPP_COL[ppp]) + (sex === 'M' ? 0 : 1);
    return row[idx] || 0;
  }
  function basicSumAssured(age, sex, ppp) {
    if (!BAData || !BAData[age]) return 0;
    var idx = (PPP_COL[ppp] == null ? 2 : PPP_COL[ppp]) + (sex === 'M' ? 0 : 1);
    return BAData[age][idx] || 0; // 每千元年交保费的基本保额
  }

  var feeIn = 0.01; // 万能初始费用/持续奖金率
  function surFee(n) { return { 1: 0.03, 2: 0.02, 3: 0.01, 4: 0.01, 5: 0.01 }[n] || 0; }

  /**
   * p: { age, sex, ppp, premium, divRate(0-1), uniRate(0-1), irrAge, shares }
   * cfg: 产品配置(见上)
   */
  function compute(p, cfg) {
    cfg = cfg || {};
    var age = p.age, sex = p.sex || 'M', ppp = p.ppp || 3;
    var premium = p.premium || 0;
    // 固收产品(noDividend)：红利恒为0，不受表单分红实现率影响
    var divRate = cfg.noDividend ? 0 : (p.divRate == null ? 1 : p.divRate);
    var uniRate = (p.uniRate == null ? 0.03 : p.uniRate);
    var irrAge = p.irrAge || 60;
    var mode = p.mode; // zpsj 年金领取年龄: 1/55/60/65；其他产品为空
    // 中途领取：按年初年龄在区间内每年领取固定额度（年金险从万能账户扣，不够再从现价扣，剩余继续复利）
    var wd = p.withdraw || null;
    var wdEnabled = !!(wd && wd.enabled && wd.amount > 0 && wd.endAge >= wd.startAge);
    var i;
    var rateLow = cfg.rateLow == null ? 0.01 : cfg.rateLow;
    var rateMid = cfg.rateMid == null ? 0.03 : cfg.rateMid;
    var survThr = cfg.survThr == null ? 85 : cfg.survThr;

    // units 口径
    var units;
    if (cfg.unitsMode === 'shares') {
      units = (p.shares != null ? p.shares : (premium / 1000));
    } else {
      units = premium / 10000;
    }

    // zpsj 按 mode-age-sex-ppp 查表；其他产品沿用 age-sex-ppp
    var dataKey = (mode != null ? mode + '-' : '') + age + '-' + sex + '-' + ppp;
    var g = (AnnData && AnnData[dataKey]) || [];
    var N = g.length > 0 ? g.length : 60; // 保障至被保人105周岁：按数据表实际行数展示（原固定60年会在99岁截断）
    function cells(n) { return g[n - 1] || [0, 0, 0, 0, 0, 0]; }

    var E = [], H = [], I = [], L = [], K = [];
    for (i = 0; i <= N + 1; i++) { E[i] = 0; H[i] = 0; I[i] = 0; L[i] = 0; K[i] = 0; }
    // 一次性领取选择权：领取年停止常规生存金/现价/身故；一次性给付金额在领取年转入万能账户
    var claimAge = parseInt(p.onceClaim, 10) || 0; // 表单 select 传入的是字符串，统一转数字
    var oneAmount = 0, claimYear = 0;
    if (claimAge && cfg.onceClaim) {
      var mult = onceMultiplier(claimAge, age, sex, ppp);
      if (mult > 0) {
        // 基本保额 = 每千元保费保额 × 年交保费/1000（units口径下 premium/1000）
        var ba = basicSumAssured(age, sex, ppp) * (premium / 1000);
        oneAmount = ba * mult;
        claimYear = claimAge - age + 1; // 领取年龄对应的保单年度
      }
    }
    for (i = 1; i <= N + 1; i++) {
      var r = cells(i);
      var beginAge = age + i - 1; // 年度初年龄
      if (claimYear && beginAge >= claimAge) {
        // 领取年龄起：常规生存金/红利/身故/现价全部归零（合同按一次性给付终止）
        E[i] = r[0] * units;
        H[i] = 0; I[i] = 0; K[i] = 0; L[i] = 0;
        if (beginAge === claimAge) I[i] = oneAmount; // 一次性给付金额，作为领取年转入万能的生存类保险金
      } else {
        E[i] = r[0] * units;      // 当年保费
        H[i] = r[2] * units * divRate; // 红利(中)
        I[i] = r[3] * units;      // 生存金
        K[i] = r[4] * units;      // 年金合同身故保险金给付
        L[i] = r[5] * units;      // 现金价值
      }
    }

    // 万能账户: P=当年生存金+上年末红利; Q初始费用; R进入价值; S持续奖金; W保底1% / Y现行
    var P = [], W = [], Y = [], Wguar = [], wdActual = [];
    for (i = 0; i <= N + 1; i++) { P[i] = 0; W[i] = 0; Y[i] = 0; Wguar[i] = 0; wdActual[i] = 0; }
    var cumP = 0, cumPg = 0;
    for (i = 1; i <= N + 1; i++) {
      var J = i > 1 ? H[i - 1] : 0;
      P[i] = I[i] + J;
      var R = P[i] * (1 - feeIn);
      cumP += P[i];
      var S;
      if (i < 6) S = 0;
      else if (i === 6) S = cumP * feeIn;
      else S = P[i] * feeIn;
      W[i] = (W[i - 1] + R) * (1 + rateLow) + S;
      Y[i] = (Y[i - 1] + R) * (1 + uniRate) + S;
      // 保证专用万能账户：只计生存金转入(不含任何红利)，按1%保底利率
      var Rg = I[i] * (1 - feeIn);
      cumPg += I[i];
      var Sg = (i === 6) ? cumPg * feeIn : (i > 6 ? I[i] * feeIn : 0);
      Wguar[i] = (Wguar[i - 1] + Rg) * (1 + rateLow) + Sg;
      // 中途领取扣减：年金险只从万能账户领取，最多领到账户价值为0为止，不动主险现金价值
      // 领取在当年年末从账户扣除(领取额不再计当年利息，剩余继续复利)；显示行按年初年龄对应保单年度
      if (wdEnabled) {
        var beginAgeWd = age + i - 1;
        if (beginAgeWd >= wd.startAge && beginAgeWd <= wd.endAge && wd.amount > 0) {
          var actual = Math.min(Math.max(Y[i], 0), wd.amount); // 实际可领=账户余额与额度取小
          wdActual[i] = actual;
          Y[i] = Math.max(0, Y[i] - actual);
          W[i] = Math.max(0, W[i] - actual);
          Wguar[i] = Math.max(0, Wguar[i] - actual);
          // 不再扣现价 L[i]：万能账户领空即止
        }
      }
    }

    // 保证生存总利益 = 现价 + 保证万能账户(纯生存金1%) + (年末年龄<阈值 ? 下一年生存金 : 0)，不含任何分红
    // 预期生存总利益 = 现价 + 万能(现行利率) + 当年红利 + 下一年生存金
    var gua = [], exp = [];
    // 一次性领取时，领取前一年(年度初年龄=claimAge-1)的退保总利益额外计入"基本保额+当年红利"
    var baAmount = (claimYear ? basicSumAssured(age, sex, ppp) * (premium / 1000) : 0);
    for (i = 1; i <= N; i++) {
      var gw = Wguar[i] * (1 - surFee(i)), ew = Y[i] * (1 - surFee(i));
      var beginAge = age + i - 1;
      var survival, expectedG, guaranteedG;
      if (claimYear && beginAge === claimAge - 1) {
        // 领取前一年：一次性给付口径 = 基本保额（保证档）/ 基本保额+当年红利（预期档），不再加下一年生存金
        guaranteedG = baAmount;
        expectedG = H[i] + baAmount;
        survival = 0;
      } else if (claimYear && beginAge >= claimAge) {
        // 领取当年及以后：常规部分全为0
        guaranteedG = 0; expectedG = 0; survival = 0;
      } else {
        // 常规口径：下一年生存金（一次性领取年的 I 已是一次性金额，但此处尚未到领取年）
        survival = ((age + i) < survThr) ? (I[i + 1] || 0) : 0;
        guaranteedG = survival;   // 保证档红利=0
        expectedG = H[i] + survival;
      }
      gua[i] = L[i] + gw + guaranteedG;
      exp[i] = L[i] + ew + expectedG;
    }

    var rows = [];
    for (i = 1; i <= N; i++) {
      var ba = age + i - 1;
      rows.push({
        year: i, age: ba,
        premium: E[i], cash: L[i],
        annuity: I[i], dividend: H[i],
        transfer: Y[i],
        guaranteed: gua[i], expected: exp[i],
        // 当年实际从万能账户领取额（供计划书"当年领取"列展示，账户领空则显示实际值/0）
        withdrawAmt: wdActual[i],
        // 身故总利益：合同身故金K + 万能账户身故给付(不扣退保费) + 中档红利；保证=1%保底账户W，预期=演示利率账户Y
        legacyGuaranteed: K[i] + W[i] + H[i],
        legacyExpected: K[i] + Y[i] + H[i]
      });
    }

    var irrC = calcIRR(rows, exp, irrAge, age);
    return {
      rows: rows,
      irrGuaranteed: calcIRR(rows, gua, irrAge, age),
      irrCurrent: irrC,
      once: claimYear ? { claimAge: claimAge, claimYear: claimYear, amount: oneAmount, multiplier: onceMultiplier(claimAge, age, sex, ppp), basicSum: baAmount } : null,
      params: { age: age, sex: sex, ppp: ppp, premium: premium, divRate: divRate, uniRate: uniRate, irrAge: irrAge, units: units, mode: mode, onceClaim: claimAge }
    };
  }

  function calcIRR(rows, finalVal, irrAge, startAge) {
    var ty = irrAge - startAge;
    if (ty < 1 || ty > rows.length) return null;
    var cf = [];
    for (var t = 0; t < ty; t++) cf.push(-(rows[t].premium || 0));
    cf.push(finalVal[ty] || 0);
    function npv(r) { var s = 0; for (var i = 0; i < cf.length; i++) s += cf[i] / Math.pow(1 + r, i); return s; }
    var lo = -0.99, hi = 1.0, flo = npv(lo), fhi = npv(hi);
    if (flo * fhi > 0) return null;
    for (var it = 0; it < 300; it++) {
      var m = (lo + hi) / 2, fm = npv(m);
      if (Math.abs(fm) < 1e-9) return m;
      if (flo * fm <= 0) hi = m; else { lo = m; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  return { setData: setData, setOnceData: setOnceData, compute: compute };
});
