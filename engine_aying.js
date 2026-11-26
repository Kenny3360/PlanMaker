/**
 * 两全险计算内核（安盈尊享版）
 * 趸交固定期间，无分红、无万能账户；满期一次性给付生存金。
 *
 * 数据表 DATA: key = "期间-投保年龄-性别" (如 "6-39-M")
 *   value = [满期保险金, 回正时间, 第1年现价, ..., 第10年现价]（每1000元保费单位）
 *
 * 口径（与原 Excel 一致）：
 *   现金价值     = 对应年度列 × (保费/1000)
 *   生存给付     = 仅满期年度 = 满期保险金 × (保费/1000)，其余为 0
 *   年末退保金   = 现金价值 + 生存给付（唯一利益口径，末列突出）
 *   身故给付     = MAX(现金价值, 保费 × 年龄段比例)
 *     比例：0-17岁 1.0；18-40岁 1.6；41-60岁 1.4；61岁以上 1.2（按到达年龄）
 *   平均年单利   = (年末退保金 - 保费) / 保费 / 保单年度（满期按保险期间）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AyingEngine = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var Data = null;
  function setData(d) { Data = d || {}; }

  function deathRatio(attainAge) {
    if (attainAge <= 17) return 1.0;
    if (attainAge <= 40) return 1.6;
    if (attainAge <= 60) return 1.4;
    return 1.2;
  }

  /**
   * p: { age, sex, ppp(=1), premium, term(6/8/10) }
   */
  function compute(p) {
    var age = p.age, sex = p.sex || 'M', term = parseInt(p.term || 6, 10); // term 可能来自 select 字符串
    var premium = p.premium || 0;
    var units = premium / 1000;
    var key = term + '-' + age + '-' + sex;
    var g = (Data && Data[key]) || [];
    var maturity = g[0] || 0;   // 每1000元单位满期金
    var payback = g[1] || 0;    // 回正时间(年)
    var cashBase = g.slice(2);  // 第1-10年现价基数

    var rows = [];
    var maturitySimple = 0;
    for (var i = 1; i <= term; i++) {
      var cash = (cashBase[i - 1] || 0) * units;
      var survival = (i === term) ? maturity * units : 0;
      var surrender = cash + survival; // 年末退保金（满期=满期总利益）
      var attain = age + i - 1;
      var death = Math.max(cash, premium * deathRatio(attain));
      var simple = premium > 0 ? (surrender - premium) / premium / i : 0;
      if (i === term) maturitySimple = simple;
      // 单利列：负数或0留空，仅正单利展示
      var rate = (payback > 0 && i >= payback && simple > 0) ? simple : null;
      rows.push({
        year: i, age: attain,
        premium: (i === 1 ? premium : 0),
        cash: cash,
        legacy: death,
        survival: survival,
        surrender: surrender,
        rate: rate
      });
    }

    // IRR（现金流：年初交保费，第term年末收满期总利益）——用于兼容界面卡片，但两全险主要看满期年单利
    var irr = null;
    if (premium > 0 && term > 0) {
      var cf = [-premium];
      for (var t = 1; t < term; t++) cf.push(0);
      cf.push(rows[term - 1].surrender);
      function npv(r) { var s = 0; for (var k = 0; k < cf.length; k++) s += cf[k] / Math.pow(1 + r, k); return s; }
      var lo = -0.99, hi = 1.0, flo = npv(lo), fhi = npv(hi);
      if (flo * fhi <= 0) {
        for (var it = 0; it < 300; it++) {
          var m = (lo + hi) / 2, fm = npv(m);
          if (Math.abs(fm) < 1e-10) break;
          if (flo * fm <= 0) hi = m; else { lo = m; flo = fm; }
        }
        irr = (lo + hi) / 2;
      }
    }

    return {
      rows: rows,
      irrCurrent: irr,
      irrGuaranteed: maturitySimple, // 复用字段位：保证列显示满期年单利
      maturitySimple: maturitySimple,
      payback: payback,
      params: { age: age, sex: sex, term: term, premium: premium, units: units }
    };
  }

  return { setData: setData, compute: compute };
});
