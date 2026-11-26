/**
 * 增额终身寿通用计算内核 (步步高 / 岁享福 / 岁享福至尊)
 * 基本保额部分 + 交清增额部分逐年递推, 口径已逐列零误差对齐原 Excel 公式。
 *
 * 数据表 DATA: { base:{key:[[保费,现价,红利,身故给付],...]}, add:{key:[[增额费率,增额现价,增额红利],...]} }
 *   key = "age-sex-ppp"; 每份=10000元保费
 *
 * 展示口径 cfg.display:
 *   'sxf'  : 岁享福 —— 退保总利益=H+K+R, 身故=G+K+O
 *   'bgb'  : 步步高/至尊 —— 分红账户=K+R, 生存总利益=现价+分红账户, 身故传承=G+K+O
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.EndowEngine = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var EndData = null;
  function setData(d) { EndData = d || { base: {}, add: {} }; }

  /**
   * p: { age, sex, ppp, premium, divRate(0-1), irrAge }
   * cfg: { startAge(投保年龄), display:'sxf'|'bgb', npYears(缴费年数), growth(交清增额身故增长率,默认0.0175) }
   */
  function compute(p, cfg) {
    cfg = cfg || {};
    var age = p.age, sex = p.sex || 'M', ppp = p.ppp || 3;
    var premium = p.premium || 0;
    var divRate = (p.divRate == null ? 1 : p.divRate);
    var irrAge = p.irrAge || 60;
    var growth = cfg.growth == null ? 0.0175 : cfg.growth;
    var display = cfg.display || 'sxf';
    var startAge = cfg.startAge == null ? age : cfg.startAge;
    // 中途领取：增额寿先从红利现价(交清增额)扣，不够从主险现价扣，剩余继续复利
    var wd = p.withdraw || null;
    var wdEnabled = !!(wd && wd.enabled && wd.amount > 0 && wd.endAge >= wd.startAge);
    var i;

    var key = age + '-' + sex + '-' + ppp;
    var base = (EndData && EndData.base && EndData.base[key]) || [];
    var add = (EndData && EndData.add && EndData.add[key]) || [];
    var N = Math.max(base.length, add.length, 60); // 与数据表行数一致(覆盖至105岁)
    var units = premium / 10000; // 份数
    function brow(n) { return base[n - 1] || [0, 0, 0, 0]; }
    function arow(n) { return add[n - 1] || [0, 0, 0]; }

    var prem = [], cumprem = [], face = [];
    var I = [], J = [], K = [], L = [], M = [], Nacc = [], O = [], P = [], R = [];
    var G = [], H = [], Y = [], Z = [], AA = [], divAcc = [];
    for (i = 0; i <= N + 1; i++) {
      prem[i] = 0; cumprem[i] = 0; face[i] = 0;
      I[i] = 0; J[i] = 0; K[i] = 0; L[i] = 0; M[i] = 0; Nacc[i] = 0;
      O[i] = 0; P[i] = 0; R[i] = 0; G[i] = 0; H[i] = 0; Y[i] = 0; Z[i] = 0; AA[i] = 0; divAcc[i] = 0;
    }
    var cum = 0;
    var withdrawBal = 0, cumDivDeducted = 0, cumMainDeducted = 0; // 累计应领 / 已从红利扣 / 已从主险扣
    for (i = 1; i <= N; i++) {
      var b = brow(i), a = arow(i);
      prem[i] = b[0] * units;
      cum += prem[i]; cumprem[i] = cum;
      // 基本部分当年红利 I = divRate × base红利 × units
      I[i] = divRate * b[2] * units;
      // 新增交清增额保额 L(n) = (上年I+J) / 上年交清增额费率 × 10000
      if (i === 1) L[i] = 0;
      else {
        var ratePrev = arow(i - 1)[0];
        L[i] = ratePrev ? (I[i - 1] + J[i - 1]) / ratePrev * 10000 : 0;
      }
      M[i] = Nacc[i - 1] + L[i];   // 累积交清增额保额
      Nacc[i] = M[i];              // 无交清增额减保
      // 交清增额部分红利 J = divRate × add红利 × M / 10000
      J[i] = divRate * a[2] * M[i] / 10000;
      K[i] = I[i] + J[i];          // 当年红利总额
      P[i] = a[1] * M[i] / 10000;  // 交清增额现价
      R[i] = P[i];                 // 交清增额退保价值(无部分领取)
      // 交清增额身故 O = MAX(R, Nacc×growth^(n-1)) 当 年末年龄>=19 且 年>缴费期
      var endAge = startAge + i;
      if (endAge < 19 || i <= ppp) O[i] = R[i];
      else O[i] = Math.max(R[i], Nacc[i] * Math.pow(1 + growth, i - 1));
      // 基本部分现价 H = base现价 × units
      H[i] = b[1] * units;
      AA[i] = H[i];
      // 基本部分有效保额身故 G = base身故给付 × units
      G[i] = b[3] * units;
      divAcc[i] = K[i] + R[i];     // 累计红利(分红账户)口径
      // 中途领取：累计应领本金 withdrawBal；先从红利账户扣、不够从主险现价扣，扣减永久累积
      // 显示行按年初年龄；领取额在年末从账户扣除、不再计当年利息
      if (wdEnabled) {
        var beginAgeWd = age + i - 1;
        if (beginAgeWd >= wd.startAge && beginAgeWd <= wd.endAge) withdrawBal += wd.amount;
        // 红利账户当期可扣上限 = 原始累计红利(K+R原始) - 已从红利扣过的累计
        var divOrig = K[i] + R[i];
        var needNow = Math.max(0, withdrawBal - cumDivDeducted - cumMainDeducted);
        var takeDiv = Math.min(Math.max(0, divOrig - cumDivDeducted), needNow);
        cumDivDeducted += takeDiv;
        divAcc[i] = Math.max(0, divOrig - cumDivDeducted);
        R[i] = Math.max(0, R[i] - takeDiv);
        // 主险现价当期可扣上限 = 原始现价AA[i] - 已从主险扣过的累计（底表无数据时AA=0，不产生负债）
        var mainAvail = Math.max(0, AA[i] - cumMainDeducted);
        var takeMain = Math.min(mainAvail, Math.max(0, withdrawBal - cumDivDeducted - cumMainDeducted));
        cumMainDeducted += takeMain;
        H[i] = Math.max(0, AA[i] - cumMainDeducted);
      }
      // 展示
      Y[i] = G[i] + K[i] + O[i];   // 身故总利益/传承
      Z[i] = H[i] + K[i] + R[i];   // 退保总利益（扣减后）
    }

    // 生成统一 rows
    var rows = [];
    for (i = 1; i <= N; i++) {
      var rowAge = startAge + i - 1;
      var wAmt = (wdEnabled && rowAge >= wd.startAge && rowAge <= wd.endAge) ? wd.amount : 0;
      if (display === 'bgb') {
        rows.push({
          year: i, age: rowAge,
          premium: prem[i], cash: H[i],
          face: G[i], dividend: I[i], divAccount: divAcc[i], divAcc: divAcc[i],
          total: H[i] + divAcc[i],   // 生存总利益
          legacy: Y[i],              // 身故传承
          withdrawAmt: wAmt
        });
      } else {
        rows.push({
          year: i, age: rowAge,
          premium: prem[i], cash: H[i],
          face: G[i], dividend: I[i], divAcc: divAcc[i],
          surrender: Z[i], legacy: Y[i],
          withdrawAmt: wAmt
        });
      }
    }

    // IRR: 现金流 = 年初保费(负), 保至 irrAge 年末收 生存总利益/退保总利益
    var finalArr = rows.map(function (r) { return display === 'bgb' ? r.total : r.surrender; });
    var irr = calcIRR(rows, finalArr, irrAge, startAge);

    return {
      rows: rows,
      irrCurrent: irr,
      params: { age: age, sex: sex, ppp: ppp, premium: premium, divRate: divRate, irrAge: irrAge, units: units, display: display }
    };
  }

  function calcIRR(rows, finalVal, irrAge, startAge) {
    var ty = irrAge - startAge;
    if (ty < 1 || ty > rows.length) return null;
    var cf = [];
    for (var t = 0; t < ty; t++) cf.push(-(rows[t].premium || 0));
    cf.push(finalVal[ty - 1] || 0);
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

  return { setData: setData, compute: compute };
});
