/* 计划书 → Excel 导出（纯前端，手写 OOXML xlsx，无外部依赖）
 * 样式与计划书图片一致：红金配色、表头、斑马纹、回本/翻倍整行高亮、末列金底红字突出、合并标题与说明。
 * 暴露 window.ExcelExporter.exportPlan(payload)，payload 结构见 app.js 的 buildExcelPayload。
 */
(function () {
  'use strict';

  // ---------- UTF-8 编码 ----------
  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else if (c < 0xD800 || c >= 0xE000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      else { i++; c = 0x10000 + (((c & 0x3FF) << 10) | (str.charCodeAt(i) & 0x3FF)); out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
    }
    return new Uint8Array(out);
  }

  // ---------- CRC32 ----------
  var CRC_TABLE = null;
  function crc32(buf) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------- ZIP (store, 无压缩) ----------
  function buildZip(files) {
    var parts = [], central = [], offset = 0;
    function bytesOf(x) { return typeof x === 'string' ? utf8(x) : x; }
    files.forEach(function (f) {
      var name = utf8(f.name);
      var data = bytesOf(f.data);
      var crc = crc32(data);
      var size = data.length;
      // local file header (30 bytes)
      var lh = new Uint8Array(30 + name.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);      // version needed
      dv.setUint16(6, 0x0800, true);  // flag: UTF-8 filename
      dv.setUint16(8, 0, true);       // store
      dv.setUint16(10, 0, true);      // time
      dv.setUint16(12, 0, true);      // date
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, name.length, true);
      dv.setUint16(28, 0, true);
      lh.set(name, 30);
      parts.push(lh, data);
      // central directory header (46 bytes)
      var ch = new Uint8Array(46 + name.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);      // version made by
      cv.setUint16(6, 20, true);      // version needed
      cv.setUint16(8, 0x0800, true);  // flag
      cv.setUint16(10, 0, true);      // store
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, 0, true);      // extra
      cv.setUint16(32, 0, true);      // comment
      cv.setUint16(34, 0, true);      // disk
      cv.setUint16(36, 0, true);      // internal attr
      cv.setUint32(38, 0, true);      // external attr
      cv.setUint32(42, offset, true); // local header offset
      ch.set(name, 46);
      central.push(ch);
      offset += lh.length + data.length;
    });
    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);
    var all = parts.concat(central, [eocd]);
    var total = 0;
    all.forEach(function (p) { total += p.length; });
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  // ---------- XML 工具 ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function colName(n) {
    var s = '';
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  }

  // ---------- 样式定义（与图片一致） ----------
  // 颜色: 标题底 #7B1113/金字 #E8C875; 副标题底 #FBF5E6/红字 #7B1113;
  // 表头底 #921B1E/金字 #F5E6C0; 末列表头底 #B8862A/字 #FFF6DC;
  // 斑马 #FAF3F3 / #FBF5E6; 回本 #F9CDB6/#A83E12; 翻倍 #F8D7DA/#8B0000;
  // 末列底 #F3E3B0/红字 #8B0000; 说明 #FAFAD9 系。
  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="176" formatCode="#,##0"/></numFmts>' +
    '<fonts count="8">' +
      '<font><sz val="11"/><name val="Microsoft YaHei"/></font>' +                                              // 0 默认
      '<font><b/><sz val="20"/><color rgb="FFE8C875"/><name val="Microsoft YaHei"/></font>' +                   // 1 标题 金
      '<font><b/><sz val="14"/><color rgb="FF7B1113"/><name val="Microsoft YaHei"/></font>' +                   // 2 副标题 红
      '<font><b/><sz val="12"/><color rgb="FFF5E6C0"/><name val="Microsoft YaHei"/></font>' +                   // 3 表头 金
      '<font><b/><sz val="12"/><color rgb="FFFFF6DC"/><name val="Microsoft YaHei"/></font>' +                   // 4 末列表头 浅金
      '<font><b/><sz val="12"/><color rgb="FF1A1A1A"/><name val="Microsoft YaHei"/></font>' +                   // 5 数据 深灰
      '<font><b/><sz val="12"/><color rgb="FF8B0000"/><name val="Microsoft YaHei"/></font>' +                   // 6 末列 红
      '<font><sz val="10"/><color rgb="FF888888"/><name val="Microsoft YaHei"/></font>' +                       // 7 说明 灰
    '</fonts>' +
    '<fills count="10">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF7B1113"/><bgColor indexed="64"/></patternFill></fill>' + // 2 标题底
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFBF5E6"/><bgColor indexed="64"/></patternFill></fill>' + // 3 副标题底
      '<fill><patternFill patternType="solid"><fgColor rgb="FF921B1E"/><bgColor indexed="64"/></patternFill></fill>' + // 4 表头底
      '<fill><patternFill patternType="solid"><fgColor rgb="FFB8862A"/><bgColor indexed="64"/></patternFill></fill>' + // 5 末列表头底
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFAF3F3"/><bgColor indexed="64"/></patternFill></fill>' + // 6 斑马A
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF8D7DA"/><bgColor indexed="64"/></patternFill></fill>' + // 7 翻倍底(红系)
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF9CDB6"/><bgColor indexed="64"/></patternFill></fill>' + // 8 回本底(橘系)
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF3E3B0"/><bgColor indexed="64"/></patternFill></fill>' + // 9 末列底
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFE6D9C0"/></left><right style="thin"><color rgb="FFE6D9C0"/></right>' +
      '<top style="thin"><color rgb="FFE6D9C0"/></top><bottom style="thin"><color rgb="FFE6D9C0"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="13">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                                                  // 0 默认
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 1 标题
      '<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 2 副标题
      '<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + // 3 表头
      '<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + // 4 末列表头
      '<xf numFmtId="176" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 5 数据普通
      '<xf numFmtId="176" fontId="5" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 6 数据斑马
      '<xf numFmtId="176" fontId="6" fillId="9" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 7 末列(金底红字)
      '<xf numFmtId="176" fontId="5" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 8 回本行普通格(橘底深字)
      '<xf numFmtId="176" fontId="5" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 9 翻倍行普通格(红底深字)
      '<xf numFmtId="176" fontId="6" fillId="8" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 10 回本行末列(橘底红字)
      '<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +                    // 11 说明
      '<xf numFmtId="176" fontId="6" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' + // 12 翻倍行末列(红底红字)
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  // 单元格: s=样式, v=值(数字或字符串)
  function cell(ref, s, val, isNum) {
    if (val == null || val === '') return '<c r="' + ref + '" s="' + s + '"/>';
    if (isNum) return '<c r="' + ref + '" s="' + s + '"><v>' + val + '</v></c>';
    return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(val) + '</t></is></c>';
  }

  function buildSheet(payload) {
    var headers = payload.headers;      // ['保单\n年度','年初\n年龄', ...] 已含 \n
    var rows = payload.rows;             // [{cells:[...], mark:'double'|'breakeven'|''}]
    var ncol = headers.length;
    var last = ncol - 1;
    var lastColLetter = colName(ncol);

    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';

    // sheetViews 需在 cols / sheetData 之前
    xml += '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>';

    // 列宽：年度/年龄窄，其余按表头长度，末列略宽
    xml += '<cols>';
    for (var ci = 0; ci < ncol; ci++) {
      var w;
      if (ci === 0 || ci === 1) w = 9;
      else if (ci === last) w = Math.max(16, Math.min(24, (headers[ci].replace(/\n/g, '').length * 2.2)));
      else w = Math.max(12, Math.min(20, (headers[ci].replace(/\n/g, '').length * 1.9)));
      xml += '<col min="' + (ci + 1) + '" max="' + (ci + 1) + '" width="' + w.toFixed(1) + '" customWidth="1"/>';
    }
    xml += '</cols>';

    xml += '<sheetData>';
    var rowIdx = 1;
    // 标题 (合并)
    xml += '<row r="1" ht="34" customHeight="1">' + cell('A1', 1, payload.title, false) + '</row>';
    rowIdx++;
    // 副标题 (合并)
    xml += '<row r="2" ht="26" customHeight="1">' + cell('A2', 2, payload.subtitle, false) + '</row>';
    rowIdx++;
    // 表头
    var hr = rowIdx;
    var headXml = '<row r="' + hr + '" ht="40" customHeight="1">';
    for (var h = 0; h < ncol; h++) headXml += cell(colName(h + 1) + hr, (h === last ? 4 : 3), headers[h], false);
    headXml += '</row>';
    xml += headXml;
    rowIdx++;
    // 数据行
    rows.forEach(function (r, ri) {
      var rn = rowIdx;
      var mark = r.mark || '';
      var lx = '<row r="' + rn + '" ht="21" customHeight="1">';
      for (var c = 0; c < ncol; c++) {
        var raw = r.cells[c];
        var isNum = (typeof raw === 'number') || (/^-?\d[\d,]*$/.test(String(raw)));
        var numVal = isNum ? String(raw).replace(/,/g, '') : raw;
        var s;
        if (c === last) {
          // 末列：字体跟末列(红字)，底色：回本行橘/翻倍行红/普通金
          s = (mark === 'double') ? 12 : (mark === 'breakeven') ? 10 : 7;
        } else {
          if (mark === 'double') s = 9;
          else if (mark === 'breakeven') s = 8;
          else s = (ri % 2 === 0) ? 5 : 6;
        }
        lx += cell(colName(c + 1) + rn, s, isNum ? numVal : raw, isNum);
      }
      lx += '</row>';
      xml += lx;
      rowIdx++;
    });
    // 说明 (每条一行，合并)
    (payload.notes || []).forEach(function (n) {
      xml += '<row r="' + rowIdx + '" ht="20" customHeight="1">' + cell('A' + rowIdx, 11, n, false) + '</row>';
      rowIdx++;
    });
    xml += '</sheetData>';

    // 合并：标题、副标题、每条说明
    var merges = [];
    merges.push('A1:' + lastColLetter + '1');
    merges.push('A2:' + lastColLetter + '2');
    var noteStart = rowIdx - (payload.notes || []).length;
    for (var m = noteStart; m < rowIdx; m++) merges.push('A' + m + ':' + lastColLetter + m);
    xml += '<mergeCells count="' + merges.length + '">';
    merges.forEach(function (ref) { xml += '<mergeCell ref="' + ref + '"/>'; });
    xml += '</mergeCells>';

    xml += '</worksheet>';
    return xml;
  }

  function buildWorkbook() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="计划书" sheetId="1" r:id="rId1"/></sheets></workbook>';
  }
  function buildWorkbookRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
  }
  function buildRootRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
  }
  function buildContentTypes() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';
  }

  function exportPlan(payload) {
    var files = [
      { name: '[Content_Types].xml', data: buildContentTypes() },
      { name: '_rels/.rels', data: buildRootRels() },
      { name: 'xl/workbook.xml', data: buildWorkbook() },
      { name: 'xl/_rels/workbook.xml.rels', data: buildWorkbookRels() },
      { name: 'xl/styles.xml', data: STYLES },
      { name: 'xl/worksheets/sheet1.xml', data: buildSheet(payload) }
    ];
    var bytes = buildZip(files);
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = payload.filename || '计划书.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    return bytes.length;
  }

  window.ExcelExporter = { exportPlan: exportPlan, _buildZip: buildZip };
})();
