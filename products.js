/* ============================================================
 * 计划书制作器 —— 6 产品配置
 * 每个产品定义: 引擎、数据表、定制表单、计划书表格列、展示口径
 * ============================================================ */
(function () {
  'use strict';

  // 通用表单字段定义（type: select/number/range）
  function F(key, label, type, opts) {
    return Object.assign({ key: key, label: label, type: type || 'number' }, opts || {});
  }
  var AGE = function (max) { return F('age', '投保年龄', 'select', { max: max, unit: '岁', def: 40 }); };
  var SEX = F('sex', '被保险人性别', 'select', { options: [['F', '女'], ['M', '男']], def: 'F' });
  function PPP(options, def) { return F('ppp', '交费期间', 'select', { options: options, def: def || 3, unit: '年' }); }
  var PREMIUM = F('premium', '年交保费', 'number', { def: 1000000, unit: '元', min: 1000 });
  var DIV = F('divRate', '分红实现率', 'number', { def: 100, unit: '%', min: 0, max: 200, scale: 0.01 });
  var UNI = F('uniRate', '万能结算利率', 'number', { def: 3, unit: '%', min: 0, max: 6, scale: 0.01 });
  // 单利显示开关（除安盈外所有产品）：否 / 是；是则在表尾追加"单利"列
  var SHOWRATE = F('showRate', '显示单利', 'select', {
    options: [[0, '否'], [1, '是']], def: 0
  });
  // 逐年IRR显示开关：默认不显示，界面标注"不要点"；开启后在表尾追加"逐年IRR"列
  var SHOWIRR = F('showIrr', 'IRR/（不要点）', 'select', {
    options: [[0, '否'], [1, '是']], def: 0
  });
  // 逐年显示开关：选"是"则计划书逐年展示全部保单年度（图片超长时分两页，表头一致）
  var SHOWALLYEARS = F('showAllYears', '逐年显示', 'select', {
    options: [[0, '否'], [1, '是']], def: 0
  });
  // 中途领取：选"是"后联动显示开始/结束年龄与额度；按产品规则从账户/现价扣除
  var WITHDRAW_FLAG = F('withdrawFlag', '中途领取', 'select', {
    options: [[0, '否'], [1, '是']], def: 0
  });
  var WITHDRAW_START = F('withdrawStart', '开始领取年龄', 'number', { def: 60, unit: '岁', min: 0, max: 105, step: 1 });
  var WITHDRAW_END = F('withdrawEnd', '结束领取年龄', 'number', { def: 80, unit: '岁', min: 0, max: 105, step: 1 });
  var WITHDRAW_AMT = F('withdrawAmt', '每年领取额度', 'number', { def: 0, unit: '元', min: 0 });
  var WITHDRAW_FIELDS = [WITHDRAW_FLAG, WITHDRAW_START, WITHDRAW_END, WITHDRAW_AMT];
  // 身故利益显示开关（年金险）：不显示 / 保证身故利益 / 预期身故利益
  var DEATHVIEW = F('deathView', '身故利益', 'select', {
    options: [[0, '不显示'], ['guaranteed', '保证身故利益'], ['expected', '预期身故利益']], def: 0
  });
  // 一次性领取选择权（仅幸福享裕B）：否 / 60 / 70 / 80 岁一次性领取
  var ONCECLAIM = F('onceClaim', '一次性领取', 'select', {
    options: [[0, '否（按年领取）'], [60, '60岁一次性领取'], [70, '70岁一次性领取'], [80, '80岁一次性领取']], def: 0
  });
  // 年金领取年龄（仅臻品世家）：即期 / 55 / 60 / 65 岁领取
  var ANNMOD = F('annuityMode', '年金领取年龄', 'select', {
    options: [[65, '65岁领取'], [60, '60岁领取'], [55, '55岁领取'], [1, '即期领取']], def: 65
  });
  // 各领取年龄允许的投保年龄区间与性别（来自臻品世家原表）；key 为数值转字符串
  var ZPSJ_MODE_CFG = {
    1:  { minAge: 54, maxAge: 75, sexes: ['F', 'M'] },
    55: { minAge: 0,  maxAge: 53, sexes: ['F'] },
    60: { minAge: 0,  maxAge: 58, sexes: ['F', 'M'] },
    65: { minAge: 0,  maxAge: 63, sexes: ['F', 'M'] }
  };

  // 两全险（安盈尊享版）：趸交、固定保险期间，无分红/万能
  var TERM = F('term', '保险期间', 'select', { options: [[6, '6年'], [8, '8年'], [10, '10年']], def: 6 });
  var PREMIUM_LUMP = F('premium', '一次性交纳保费', 'number', { def: 100000, unit: '元', min: 10000 });

  var PPP_ALL = [[1, '1年'], [3, '3年'], [5, '5年'], [10, '10年'], [15, '15年'], [20, '20年']];
  var PPP_4 = [[1, '1年'], [3, '3年'], [5, '5年'], [10, '10年']];

  // ---- 年金险共用表单/列 ----
  function annuityForm(maxAge, pppOpts) { return [AGE(maxAge), SEX, PPP(pppOpts, 3), PREMIUM, DIV, UNI, DEATHVIEW, SHOWRATE, SHOWIRR].concat(WITHDRAW_FIELDS, [SHOWALLYEARS]); }
  // 固收年金(无分红)：表单去掉分红实现率
  function fixedAnnuityForm(maxAge, pppOpts) { return [AGE(maxAge), SEX, PPP(pppOpts, 3), PREMIUM, UNI, DEATHVIEW, SHOWRATE, SHOWIRR].concat(WITHDRAW_FIELDS, [SHOWALLYEARS]); }
  // 固收年金表格列：无年度红利，转入列改为"年金转入万能账户"
  var FIXED_ANNUITY_COLS = [
    { k: 'premium', t: '当期保费' },
    { k: 'cash', t: '现金价值' },
    { k: 'annuity', t: '年金' },
    { k: 'transfer', t: '年金转入万能账户', dyn: 'uni' },
    { k: 'guaranteed', t: '保证生存总利益' },
    { k: 'expected', t: '预期生存总利益', last: true }
  ];
  // 年金险表格列（9列，含年金转入万能）
  var ANNUITY_COLS = [
    { k: 'premium', t: '当期保费' },
    { k: 'cash', t: '现金价值' },
    { k: 'annuity', t: '年金' },
    { k: 'dividend', t: '年度红利' },
    { k: 'transfer', t: '年金+分红转入万能账户', dyn: 'uni' },
    { k: 'guaranteed', t: '保证生存总利益' },
    { k: 'expected', t: '预期生存总利益', last: true }
  ];

  // ---- 增额寿(sxf 岁享福)：去当年分红，现金价值→保证部分现金价值，身故列移到现金价值右侧且不高亮，退保总利益高亮 ----
  var ENDOW_SXF_COLS = [
    { k: 'premium', t: '当期保费' },
    { k: 'cash', t: '保证部分\n现金价值' },
    { k: 'legacy', t: '身故总利益' },
    { k: 'divAcc', t: '累计分红' },
    { k: 'surrender', t: '预期\n退保总利益', last: true }
  ];
  // ---- 增额寿(bgb/至尊)：去当年分红，主险现价→保证部分现金价值，身故列移到现金价值右侧且不高亮，生存总利益高亮 ----
  var ENDOW_BGB_COLS = [
    { k: 'premium', t: '当期保费' },
    { k: 'cash', t: '保证部分\n现金价值' },
    { k: 'legacy', t: '身故传承' },
    { k: 'divAcc', t: '累计分红' },
    { k: 'total', t: '预期\n生存总利益', last: true }
  ];
  function endowForm(maxAge, pppOpts) {
    return [AGE(maxAge), SEX, PPP(pppOpts, 3), PREMIUM, DIV, SHOWRATE, SHOWIRR].concat(WITHDRAW_FIELDS, [SHOWALLYEARS]);
  }
  // ---- 两全险(安盈尊享版)：趸交固定期间，无分红/万能；年末退保金(满期总利益)末列突出 ----
  var ENDOWMENT_COLS = [
    { k: 'premium', t: '当期保费' },
    { k: 'cash', t: '现金价值' },
    { k: 'legacy', t: '身故给付' },
    { k: 'survival', t: '满期生存金' },
    { k: 'surrender', t: '生存总利益' },
    { k: 'rate', t: '单利', fmt: 'pct', last: true }
  ];

  var PRODUCTS = [
    {
      id: 'changle', name: '长乐尊享', full: '长乐金生（尊享版）分红年金', kind: 'annuity',
      engine: 'changle', dataKey: 'changle', badge: '分红年金',
      desc: '经典长乐尊享 · 年金+分红转入万能账户',
      cfg: { unitsMode: 'premium', irrMaxOffset: 60 },
      form: annuityForm(75, PPP_4), cols: ANNUITY_COLS, defAge: 45,
      note: '保证生存总利益为分红实现率0%、万能结算利率1%口径；预期生存总利益按当前演示口径。年金及红利转入万能账户累积，106岁起按比例领取。'
    },
    {
      id: 'xfy', name: '幸福享裕', full: '泰康幸福享裕年金保险（分红型）', kind: 'annuity',
      engine: 'annuity', dataKey: 'xfy', badge: '分红年金',
      desc: '分红型年金 · 生存金转入万能账户',
      cfg: { unitsMode: 'premium', survThr: 85, rateLow: 0.01, rateMid: 0.03, onceClaim: true },
      form: [AGE(80), SEX, PPP(PPP_ALL, 3), PREMIUM, DIV, UNI, ONCECLAIM, DEATHVIEW, SHOWRATE, SHOWIRR].concat(WITHDRAW_FIELDS, [SHOWALLYEARS]), cols: ANNUITY_COLS,
      note: '保证生存总利益为分红实现率0%、万能结算利率1%口径；预期生存总利益按当前演示口径。生存金及红利转入万能账户累积。可在60/70/80岁行使一次性领取选择权，按条款《一次性领取倍数表》给付后合同终止。'
    },
    {
      id: 'xfyb', name: '幸福享裕B', full: '泰康幸福享裕B款年金保险（分红型）', kind: 'annuity',
      engine: 'annuity', dataKey: 'xfyb', badge: '分红年金',
      desc: '幸福享裕B款 · 生存金+分红转入万能账户',
      cfg: {
        unitsMode: 'premium', survThr: 1e9, rateLow: 0.01, rateMid: 0.03,
        // 各交费期允许的最大投保年龄（与精算底表覆盖一致）
        pppAgeMax: { 1: 80, 3: 75, 5: 70, 10: 55, 15: 50, 20: 45 },
        onceClaim: true
      },
      form: [AGE(80), SEX, PPP(PPP_ALL, 3), PREMIUM, DIV, UNI, ONCECLAIM, DEATHVIEW, SHOWRATE, SHOWIRR].concat(WITHDRAW_FIELDS, [SHOWALLYEARS]), cols: ANNUITY_COLS,
      note: '未满60周岁投保者自第6个保单年度起给付生存保险金，年满60周岁后给付养老保险金；已满60周岁投保者自犹豫期结束次日领取。保证生存总利益为分红实现率0%、万能结算利率1%口径；预期生存总利益按当前演示口径。生存金及红利转入万能账户累积，具体以保险合同为准。'
    },
    {
      id: 'zpsj', name: '臻品世家', full: '泰康臻品世家E款养老年金保险（分红型）', kind: 'annuity',
      engine: 'annuity', dataKey: 'zpsj', badge: '分红年金',
      desc: '养老年金 · 养老保险金转入万能账户',
      cfg: { unitsMode: 'shares', survThr: 1e9, rateLow: 0.01, rateMid: 0.03, shareDiv: 1000, modeCfg: ZPSJ_MODE_CFG },
      form: [ANNMOD, AGE(75), SEX, PPP(PPP_4, 3), PREMIUM, DIV, UNI, DEATHVIEW, SHOWRATE, SHOWIRR].concat(WITHDRAW_FIELDS, [SHOWALLYEARS]), cols: ANNUITY_COLS,
      note: '保证生存总利益为分红实现率0%、万能结算利率1%口径；预期生存总利益按当前演示口径。演示份数=年交保费÷1000。不同年金领取年龄对应不同的演示数据。'
    },
    {
      id: 'bs2026', name: '百岁2026', full: '泰康百岁人生保险产品计划', kind: 'annuity',
      engine: 'annuity', dataKey: 'bs2026', badge: '固收年金险',
      desc: '固定收益年金 · 无分红 · 生存金转入万能账户',
      cfg: { unitsMode: 'premium', survThr: 1e9, rateLow: 0.01, rateMid: 0.03, noDividend: true },
      form: fixedAnnuityForm(80, PPP_ALL), cols: FIXED_ANNUITY_COLS,
      note: '本产品为固定收益年金，无分红。保证生存总利益为万能结算利率1%口径；预期生存总利益按当前万能演示利率口径。具体领取以保险合同为准。'
    },
    {
      id: 'bgb', name: '步步高E尊享版', full: '步步高E尊享版', kind: 'endow',
      engine: 'endow', dataKey: 'bgb', badge: '增额终身寿',
      desc: '增额终身寿 · 交清增额 · 无年金转入万能',
      cfg: { display: 'bgb', growth: 0.0175 },
      form: endowForm(73, PPP_4), cols: ENDOW_BGB_COLS,
      note: '累计分红=当年分红+交清增额现价；生存总利益=保证部分现金价值+累计分红。分红及交清增额部分不确定，以保险合同为准。'
    },
    {
      id: 'sxf', name: '岁享福', full: '泰康岁享福终身寿险（分红型）', kind: 'endow',
      engine: 'endow', dataKey: 'sxf', badge: '增额终身寿',
      desc: '增额终身寿 · 交清增额 · 无年金转入万能',
      cfg: { display: 'sxf', growth: 0.0175 },
      form: endowForm(72, PPP_ALL), cols: ENDOW_SXF_COLS,
      note: '累计分红=当年分红+交清增额现价；退保总利益=保证部分现金价值+累计分红。分红及交清增额部分不确定，以保险合同为准。'
    },
    {
      id: 'sxfzz', name: '岁享福至尊', full: '泰康岁享福（至尊）终身寿险（分红型）', kind: 'endow',
      engine: 'endow', dataKey: 'sxfzz', badge: '增额终身寿',
      desc: '增额终身寿至尊版 · 交清增额 · 无年金转入万能',
      cfg: { display: 'bgb', growth: 0.0175 },
      form: endowForm(73, PPP_4), cols: ENDOW_BGB_COLS,
      note: '累计分红=当年分红+交清增额现价；生存总利益=保证部分现金价值+累计分红。分红及交清增额部分不确定，以保险合同为准。'
    },
    {
      id: 'aying', name: '安盈尊享版', full: '泰康安盈（尊享版）两全保险', kind: 'endowment',
      engine: 'aying', dataKey: 'aying', badge: '两全保险',
      desc: '趸交固定期间 · 满期一次性给付 · 无分红无万能',
      cfg: {},
      form: [AGE(78), SEX, TERM, PREMIUM_LUMP, SHOWALLYEARS], cols: ENDOWMENT_COLS,
      note: '趸交两全保险，保险期间6/8/10年，满期一次性给付生存金，所有数值为确定值；身故给付按到达年龄比例(0-17岁100%/18-40岁160%/41-60岁140%/61岁以上120%)与现金价值取大。平均年单利=(退保总利益-保费)÷保费÷保单年度。具体以保险合同为准。',
      services: [
        {
          name: '重疾绿通',
          std: '总保费 10 万元对接，适用所有客户',
          content: '确诊后一次安排专家号、床位、手术排期；含三专四护、检查加急、出院陪护(5000元)、住院护(15天)、上门照护(6次)。覆盖1600+家三甲医院、30个省市，百强医院全覆盖。',
          valid: '权益随保单产生，在保单有效期内可申请，按统一入口交付并有时效'
        },
        {
          name: '高客体检',
          std: '总保费 50 万元对接，适用白金及以上、幸福有约客户',
          content: '每年筛查心脑血管与肿瘤风险，按总保费分5档：50万(800元)/100万(1200元)/200万(1800元)/500万(5000元)/1000万(13000元)；含96家三甲医院体检中心、1300+家门店；100万及以上档位可转让。',
          valid: '每年一次（保单有效期）'
        }
      ],
      serviceNote: '资料依据原图及资料库《泰康人寿2027开门红·核心资源介绍》整理，仅供内部学习交流，不构成任何权益承诺；具体服务内容、标准与适用条件以保险合同及泰康官方服务手册为准。'
    }
  ];

  var byId = {};
  PRODUCTS.forEach(function (p) { byId[p.id] = p; });
  var API = { products: PRODUCTS, get: function (id) { return byId[id]; } };
  window.PRODUCTS = API;
})();
