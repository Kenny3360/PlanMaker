/* 长乐（尊享）计算内核 —— 已验证零误差，UMD 隔离版 */
(function(){
"use strict";
/**
 * 长乐（尊享）年金计划书 计算内核
 * 从原 Excel《长乐（尊享）计算器_高端美化版.xlsx》逐公式复刻并经全量对账验证（六列零误差）。
 *
 * DATA: { "age-sex-ppp": [ [prem, lowDiv, midDiv, surv, death, cash], ... ] }
 *       按保单年度 1..N 排列。
 */

var DATA = null; // 由 setData 注入

function setData(d) { DATA = d; }

function surreFee(year) {
    if (year === 1) return 0.03;
    if (year === 2) return 0.02;
    if (year === 3) return 0.01;
    if (year === 4) return 0.01;
    if (year === 5) return 0.01;
    return 0;
}

function rowAt(age, sex, ppp, year) {
    if (!DATA) return null;
    var g = DATA[age + '-' + sex + '-' + ppp];
    if (!g) return null;
    return g[year - 1] || null;
}

/**
 * 计算计划书
 * @param {object} p 参数:
 *   age 投保年龄(0-75), sex 'M'/'F', ppp 缴费期(1/3/5/10),
 *   premium 年交保费, divRate 分红实现率(如1.0), uniRate 万能结算利率(如0.0285),
 *   irrAge IRR保至年龄(默认60), withdrawals 长度>=60的每年部分领取数组
 * @returns {object} { rows, irrGuaranteed, irrCurrent, params }
 *   rows: [{year, age, premium, cash, annuity, dividend, transfer, guaranteed, expected}]
 */
function compute(p) {
    var age = p.age, sex = p.sex || 'M', ppp = p.ppp || 3;
    var premium = p.premium || 0;
    var divRate = (p.divRate == null ? 1 : p.divRate);
    var uniRate = (p.uniRate == null ? 0.0285 : p.uniRate);
    var irrAge = p.irrAge || 60;
    // 中途领取：从 withdraw 对象生成按年领取额（年初年龄在区间内每年领固定额度）
    var wdCfg = p.withdraw || null;
    var wdEnabled = !!(wdCfg && wdCfg.enabled && wdCfg.amount > 0 && wdCfg.endAge >= wdCfg.startAge);
    // 保障期间至被保人105周岁：按数据表实际行数展示（原固定60年会在99岁截断）
    var g0 = DATA ? DATA[age + '-' + sex + '-' + ppp] : null;
    var N = (g0 && g0.length) ? g0.length : 60;
    var units = premium / 1000;          // 份数 L7
    var G11 = 106, G12 = 0.03;           // 领取年龄/比例
    var feeIn = 0.01;                    // 转入初始费用
    var RATE_LOW = 0.01, RATE_MID = 0.03; // 万能最低保证/结息
    var i;

    function wd(n) {
      if (!wdEnabled) return 0;
      var beginAgeWd = age + n - 1; // 显示行按年初年龄；领取额在年末从账户扣除、不再计当年利息
      return (beginAgeWd >= wdCfg.startAge && beginAgeWd <= wdCfg.endAge) ? wdCfg.amount : 0;
    }

    // 年金险查表列
    var E = new Array(N + 1).fill(0), G = new Array(N + 1).fill(0),
        H = new Array(N + 1).fill(0), I = new Array(N + 1).fill(0),
        L = new Array(N + 1).fill(0), K = new Array(N + 1).fill(0);
    for (i = 1; i <= N; i++) {
        var r = rowAt(age, sex, ppp, i) || [0, 0, 0, 0, 0, 0];
        E[i] = r[0] * units;              // 当期保费
        G[i] = r[1] * units;              // 保证红利(低)
        H[i] = r[2] * units * divRate;    // 红利利益(中×实现率)
        I[i] = r[3] * units;              // 生存给付(年金)
        K[i] = r[4] * units;              // 年金合同身故保险金给付
        L[i] = r[5] * units;              // 现金价值
    }

    // 万能账户三口径递推 (W 最低保证 / X 结息 / Y 自定义)
    var W = new Array(N + 1).fill(0), X = new Array(N + 1).fill(0), Y = new Array(N + 1).fill(0);
    var wdActual = new Array(N + 1).fill(0); // 每年实际从万能账户领取额（受账户余额上限约束）
    var O = new Array(N + 1).fill(0), J = new Array(N + 1).fill(0),
        Q = new Array(N + 1).fill(0), R = new Array(N + 1).fill(0);
    var S = new Array(N + 1).fill(0), T = new Array(N + 1).fill(0), U = new Array(N + 1).fill(0);
    for (i = 1; i <= N; i++) {
        var startAge = age + i - 1;
        J[i] = i > 1 ? H[i - 1] : 0;
        O[i] = (i > 1 ? I[i - 1] : 0) + J[i];
        var Pn = O[i] * feeIn;
        Q[i] = O[i] - Pn;
        if (i === 6) {
            var sumO = 0; for (var k = 1; k <= 6; k++) sumO += O[k];
            R[i] = sumO * feeIn;
        } else if (i > 6) {
            R[i] = O[i] * feeIn;
        }
        if (startAge >= G11) {
            S[i] = G12 * (W[i - 1] + Q[i]);
            T[i] = G12 * (X[i - 1] + Q[i]);
            U[i] = G12 * (Y[i - 1] + Q[i]);
        }
        var v = wd(i);
        // 中途领取：年金险只从万能账户领取，最多领到账户价值为0，不扣主险现价
        var yBefore = (Y[i - 1] + Q[i] - U[i]) * (1 + uniRate) + R[i];
        var actual = (v > 0) ? Math.min(Math.max(yBefore, 0), v) : 0;
        wdActual[i] = actual;
        W[i] = Math.max(0, (W[i - 1] + Q[i] - S[i]) * (1 + RATE_LOW) - actual + R[i]);
        X[i] = Math.max(0, (X[i - 1] + Q[i] - T[i]) * (1 + RATE_MID) - actual + R[i]);
        Y[i] = Math.max(0, yBefore - actual);
    }

    // 扣退保费用后的万能现金价值
    var AC = new Array(N + 1).fill(0), AE = new Array(N + 1).fill(0);
    for (i = 1; i <= N; i++) {
        var sf = surreFee(i);
        AC[i] = W[i] * (1 - sf);
        AE[i] = Y[i] * (1 - sf);
    }

    // 保证口径: 只计生存金转入、不含任何红利，万能按1%保底
    var Dg = new Array(N + 1).fill(0), Ehg = new Array(N + 1).fill(0),
        Fhg = new Array(N + 1).fill(0), Hhg = new Array(N + 1).fill(0),
        Ig = new Array(N + 1).fill(0);
    for (i = 1; i <= N; i++) {
        var endAge = age + i;
        Dg[i] = (i <= N) ? (i > 1 ? I[i - 1] : 0) : 0;
        Ehg[i] = Dg[i] * (1 - feeIn);
        if (i === 6) { var sDg = 0; for (var jg = 1; jg <= 6; jg++) sDg += Dg[jg]; Fhg[i] = sDg * feeIn; }
        else if (i > 6) { Fhg[i] = Dg[i] * feeIn; }
        var drawg = endAge >= G11 ? G12 * (Hhg[i - 1] + Ehg[i]) : 0;
        Hhg[i] = Math.max(0, (Hhg[i - 1] + Ehg[i] - drawg) * (1 + RATE_LOW) - wd(i) + Fhg[i]);
        Ig[i] = Hhg[i] * (1 - surreFee(i));
    }

    // 计划书 9 列
    var rows = [];
    for (i = 1; i <= N; i++) {
        rows.push({
            year: i,
            age: age + i - 1,
            premium: E[i],
            cash: L[i],
            annuity: I[i],
            dividend: H[i],
            transfer: Y[i],
            guaranteed: L[i] + Ig[i] + I[i],
            expected: L[i] + AE[i] + H[i] + I[i],
            withdrawAmt: wdActual[i],
            // 身故总利益：合同身故金K + 万能账户身故给付(W保底1%/Y自定义，不扣退保费) + 中档红利H
            legacyGuaranteed: K[i] + W[i] + H[i],
            legacyExpected: K[i] + Y[i] + H[i]
        });
    }

    // AF / AH 退保总利益口径 (仅用于IRR)
    //   AF(保证IRR) = 现价 + 最低保证万能价值(AC) + 红利利益(H) + 年金(I)
    //   AH(现行IRR) = 现价 + 自定义万能价值(AE) + 红利利益(H) + 年金(I)
    var AF = new Array(N + 1).fill(0), AH = new Array(N + 1).fill(0);
    for (i = 1; i <= N; i++) {
        AF[i] = L[i] + AC[i] + H[i] + I[i];
        AH[i] = L[i] + AE[i] + H[i] + I[i];
    }

    // IRR: 现金流从 AJ=0 起, 缴费期每年初扣保费, 保至年龄(AK=irrAge-1)年末收期末利益
    var irrGuaranteed = calcIRR(rows, AF, irrAge, age);
    var irrCurrent = calcIRR(rows, AH, irrAge, age);

    return {
        rows: rows,
        irrGuaranteed: irrGuaranteed,
        irrCurrent: irrCurrent,
        params: { age: age, sex: sex, ppp: ppp, premium: premium, divRate: divRate, uniRate: uniRate, irrAge: irrAge }
    };
}

/** IRR: 用二分法求使 NPV=0 的年化利率
 *  现金流对齐原表 AJ 列: t=0 对应保单年度1(年初Age), 每年初扣当期保费;
 *  保至年龄那年末(年初年龄=irrAge-1, 即保单年度 targetYear)收期末利益 finalVal[targetYear]。
 */
function calcIRR(rows, finalVal, irrAge, startAge) {
    var targetYear = irrAge - startAge; // 保至年龄-投保年龄 = 目标保单年度 (如 60-45=15)
    if (targetYear < 1 || targetYear > rows.length) return null;
    var cf = [];
    // t=0..targetYear-1: 年初保费 (TVM: 第t期年初)
    for (var t = 0; t < targetYear; t++) {
        cf.push(-(rows[t].premium || 0));
    }
    // t=targetYear: 期末利益 (不再扣保费, 对应原表 AL 到保至年龄那期改取 AF/AH)
    cf.push(finalVal[targetYear] || 0);

    function npv(rate) {
        var s = 0;
        for (var i = 0; i < cf.length; i++) s += cf[i] / Math.pow(1 + rate, i);
        return s;
    }
    var lo = -0.99, hi = 1.0;
    var flo = npv(lo), fhi = npv(hi);
    if (flo * fhi > 0) return null;
    for (var it = 0; it < 300; it++) {
        var mid = (lo + hi) / 2, fm = npv(mid);
        if (Math.abs(fm) < 1e-9) return mid;
        if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
}

var API = { setData: setData, compute: compute, calcIRR: calcIRR };
if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
if (typeof window !== 'undefined') { window.ChangleEngine = API; }

})();
