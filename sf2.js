/* Fills the DepEd SF2 template (sf2-template.xlsx) with a class's attendance for one month.
   It edits the template's cells in place, so the layout, borders and logos stay as DepEd made them.
   Codes used: x = absent (excused absences also count as absent), T = tardy. */

const SF2 = (() => {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const DAY_COLS = 25;                          // columns D..AB
  const MALE_FIRST = 14, MALE_ROWS = 21;        // rows 14..34, total on 35
  const FEMALE_ROWS = 25;                       // rows 36..60, totals on 61 and 62
  const DAY_CODE = ['SUN', 'M', 'T', 'W', 'TH', 'F', 'SAT'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const colName = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  const colNum = s => [...s].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const splitRef = r => { const m = /^([A-Z]+)(\d+)$/.exec(r); return [m[1], +m[2]]; };
  const dayCol = k => colName(3 + k);            // D = index 3

  function schoolYear(y, m) { return m >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`; }

  /* ---------- sheet editing ---------- */
  class Sheet {
    constructor(xml) {
      this.doc = new DOMParser().parseFromString(xml, 'application/xml');
      this.data = this.doc.getElementsByTagNameNS(NS, 'sheetData')[0];
    }
    row(r) {
      for (const el of this.data.children) { const n = +el.getAttribute('r'); if (n === r) return el; if (n > r) break; }
      const el = this.doc.createElementNS(NS, 'row'); el.setAttribute('r', r);
      const after = [...this.data.children].find(x => +x.getAttribute('r') > r);
      this.data.insertBefore(el, after || null);
      return el;
    }
    cell(ref) {
      const [c, r] = splitRef(ref), row = this.row(r), ci = colNum(c);
      for (const el of row.children) {
        const k = colNum(splitRef(el.getAttribute('r'))[0]);
        if (k === ci) return el;
        if (k > ci) { const n = this.doc.createElementNS(NS, 'c'); n.setAttribute('r', ref); row.insertBefore(n, el); return n; }
      }
      const n = this.doc.createElementNS(NS, 'c'); n.setAttribute('r', ref); row.appendChild(n); return n;
    }
    set(ref, v) {
      if (v === '' || v === null || v === undefined) return;
      const c = this.cell(ref);
      while (c.firstChild) c.removeChild(c.firstChild);
      c.removeAttribute('t');
      if (typeof v === 'number') {
        const e = this.doc.createElementNS(NS, 'v'); e.textContent = String(Math.round(v * 100) / 100); c.appendChild(e);
      } else {
        c.setAttribute('t', 'inlineStr');
        const is = this.doc.createElementNS(NS, 'is'), t = this.doc.createElementNS(NS, 't');
        t.textContent = String(v); is.appendChild(t); c.appendChild(is);
      }
    }
    // copy row `src` n times right after row `after`, pushing everything below down
    insertRows(after, n, src, drawing) {
      if (n <= 0) return drawing;
      const shiftRef = ref => { const [c, r] = splitRef(ref); return r > after ? c + (r + n) : ref; };
      for (const row of [...this.data.children].reverse()) {
        const r = +row.getAttribute('r');
        if (r <= after) break;
        row.setAttribute('r', r + n);
        for (const c of row.children) c.setAttribute('r', shiftRef(c.getAttribute('r')));
      }
      const tpl = [...this.data.children].find(x => +x.getAttribute('r') === src);
      const anchor = [...this.data.children].find(x => +x.getAttribute('r') > after);
      const mc = this.doc.getElementsByTagNameNS(NS, 'mergeCells')[0];
      for (const m of [...mc.children]) m.setAttribute('ref', m.getAttribute('ref').split(':').map(shiftRef).join(':'));
      for (let k = 1; k <= n; k++) {
        const r = after + k, copy = tpl.cloneNode(true);
        copy.setAttribute('r', r);
        for (const c of copy.children) {
          c.setAttribute('r', splitRef(c.getAttribute('r'))[0] + r);
          while (c.firstChild) c.removeChild(c.firstChild); c.removeAttribute('t');
        }
        this.data.insertBefore(copy, anchor || null);
        for (const ref of [`B${r}:C${r}`, `AE${r}:AJ${r}`]) {
          const m = this.doc.createElementNS(NS, 'mergeCell'); m.setAttribute('ref', ref); mc.appendChild(m);
        }
      }
      mc.setAttribute('count', mc.children.length);
      const dim = this.doc.getElementsByTagNameNS(NS, 'dimension')[0];
      if (dim) dim.setAttribute('ref', dim.getAttribute('ref').split(':').map(shiftRef).join(':'));
      // drawings use 0-based rows
      return drawing.replace(/<xdr:row>(\d+)<\/xdr:row>/g, (m, v) => +v >= after ? `<xdr:row>${+v + n}</xdr:row>` : m);
    }
    copyStyle(ref, from) { const st = this.cell(from).getAttribute('s'); if (st) this.cell(ref).setAttribute('s', st); }
    xml() { return new XMLSerializer().serializeToString(this.doc); }
  }

  /* ---------- the report ---------- */
  // ym = "2026-10"
  function collect(sec, ym) {
    const dates = Object.keys(sec.att).filter(d => d.startsWith(ym + '-')).sort();
    const ids = Object.keys(sec.students).filter(id => sec.seats.includes(id) || dates.some(d => sec.att[d][id]));
    const byName = (a, b) => sec.students[a].name.localeCompare(sec.students[b].name);
    return {
      dates,
      male: ids.filter(id => sec.students[id].sex === 'M').sort(byName),
      female: ids.filter(id => sec.students[id].sex === 'F').sort(byName),
      unsorted: ids.filter(id => !['M', 'F'].includes(sec.students[id].sex)).map(id => sec.students[id].name)
    };
  }

  async function build(S, sec, ym) {
    const info = collect(sec, ym);
    if (!info.dates.length) throw new Error('No attendance saved for that month yet.');
    if (info.dates.length > DAY_COLS) throw new Error(`SF2 has room for ${DAY_COLS} days, but that month has ${info.dates.length}.`);
    if (info.unsorted.length) throw new Error(`Set Male or Female for: ${info.unsorted.join('; ')}. Tap their seat in the Seats tab.`);

    const res = await fetch('sf2-template.xlsx');
    if (!res.ok) throw new Error('The SF2 template is missing from the app.');
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const sh = new Sheet(await zip.file('xl/worksheets/sheet1.xml').async('string'));
    let drawing = await zip.file('xl/drawings/drawing1.xml').async('string');

    // make room when a group is bigger than the printed rows
    const extraM = Math.max(0, info.male.length - MALE_ROWS);
    drawing = sh.insertRows(MALE_FIRST + MALE_ROWS - 2, extraM, MALE_FIRST + MALE_ROWS - 2, drawing);
    const mRows = MALE_ROWS + extraM;
    const mTotal = MALE_FIRST + mRows;                 // "MALE TOTAL Per Day"
    const fFirst = mTotal + 1;
    const extraF = Math.max(0, info.female.length - FEMALE_ROWS);
    drawing = sh.insertRows(fFirst + FEMALE_ROWS - 2, extraF, fFirst + FEMALE_ROWS - 2, drawing);
    const fRows = FEMALE_ROWS + extraF;
    const fTotal = fFirst + fRows, combined = fTotal + 1;
    const shift = extraM + extraF;                     // for everything below the table
    const R = r => r + shift;

    const [y, m] = ym.split('-').map(Number);
    const sc = S.school || {}, cls = sec.sf2 || {};

    // header
    sh.set('C6', sc.id || '');
    sh.set('K6', sc.year || schoolYear(y, m));
    sh.set('X6', `${MONTHS[m - 1]} ${y}`);
    sh.set('C8', sc.name || '');
    sh.set('X8', cls.grade || '');
    sh.set('AC8', cls.section || sec.name);

    // dates and day codes
    info.dates.forEach((d, k) => {
      const dt = new Date(y, m - 1, +d.slice(8));
      sh.set(dayCol(k) + 11, dt.getDate());
      sh.set(dayCol(k) + 12, DAY_CODE[dt.getDay()]);
    });

    const isAbsent = (d, id) => ['A', 'E'].includes(sec.att[d][id]);
    const isLate = (d, id) => sec.att[d][id] === 'L';
    let fiveDays = { M: 0, F: 0 };

    function group(ids, first, sexKey) {
      ids.forEach((id, k) => {
        const r = first + k;
        sh.set('A' + r, k + 1);
        sh.set('B' + r, sec.students[id].name);
        let abs = 0, late = 0, run = 0, maxRun = 0;
        info.dates.forEach((d, j) => {
          if (isAbsent(d, id)) { sh.set(dayCol(j) + r, 'x'); abs++; run++; maxRun = Math.max(maxRun, run); }
          else { run = 0; if (isLate(d, id)) { sh.set(dayCol(j) + r, 'T'); late++; } }
        });
        sh.set('AC' + r, abs);
        sh.set('AD' + r, late);
        if (maxRun >= 5) fiveDays[sexKey]++;
      });
      return info.dates.map(d => ids.filter(id => !isAbsent(d, id)).length);   // present per day
    }
    const pm = group(info.male, MALE_FIRST, 'M');
    const pf = group(info.female, fFirst, 'F');

    const sum = a => a.reduce((x, v) => x + v, 0);
    const totals = (row, perDay, ids) => {
      perDay.forEach((v, j) => sh.set(dayCol(j) + row, v));
      sh.set('AC' + row, sum(ids.map(id => info.dates.filter(d => isAbsent(d, id)).length)));
      sh.set('AD' + row, sum(ids.map(id => info.dates.filter(d => isLate(d, id)).length)));
    };
    // the template formats the male total cells as "00000"; use the female row's plain style
    sh.copyStyle('AC' + mTotal, 'AC' + fTotal); sh.copyStyle('AD' + mTotal, 'AD' + fTotal);
    totals(mTotal, pm, info.male);
    totals(fTotal, pf, info.female);
    totals(combined, pm.map((v, j) => v + pf[j]), [...info.male, ...info.female]);

    // monthly summary (bottom right)
    const days = info.dates.length;
    const nM = info.male.length, nF = info.female.length;
    sh.set('AC' + R(64), MONTHS[m - 1]);
    sh.set('AG' + R(64), days);
    const trio = (row, a, b, total = a + b) => { sh.set('AH' + R(row), a); sh.set('AI' + R(row), b); sh.set('AJ' + R(row), total); };
    trio(70, nM, nF);                                                   // registered learners as of end of month
    const adaM = sum(pm) / days, adaF = sum(pf) / days;
    trio(74, adaM, adaF, adaM + adaF);                                  // average daily attendance
    // text here too: the template's percent formats would show 90.91 as 9091%
    const pct = (a, n) => (n ? Math.round(a / n * 10000) / 100 : 0) + '%';
    sh.set('AH' + R(75), pct(adaM, nM)); sh.set('AI' + R(75), pct(adaF, nF)); sh.set('AJ' + R(75), pct(adaM + adaF, nM + nF));
    // these cells are rotated sideways in the template; give them the plain centered style used above
    ['AH', 'AI', 'AJ'].forEach(c => sh.copyStyle(c + R(77), c + R(70)));
    trio(77, fiveDays.M, fiveDays.F);

    zip.file('xl/worksheets/sheet1.xml', sh.xml());
    zip.file('xl/drawings/drawing1.xml', drawing);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  }

  return { build, collect, schoolYear, MONTHS };
})();
