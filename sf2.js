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

  /* ---------- learner movement ---------- */
  // A student may carry: inType ('transfer' | 'late'), inDate, inFrom, outType ('dropped' | 'transferred'), outDate, outNote
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const syYear = (y, m) => m >= 6 ? y : y - 1;                     // school year starts in June
  const firstFridayJune = sy => { const d = new Date(sy, 5, 1); while (d.getDay() !== 5) d.setDate(d.getDate() + 1); return iso(d); };
  const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return iso(new Date(y, m, 0)); };
  const enrolledOn = (st, d) => (!st.inDate || st.inDate <= d) && (!st.outDate || d < st.outDate);
  const DROP_REASONS = {
    'a.1': 'Had to take care of siblings', 'a.2': 'Early marriage/pregnancy', 'a.3': "Parents' attitude toward schooling", 'a.4': 'Family problems',
    'b.1': 'Illness', 'b.2': 'Overage', 'b.3': 'Death', 'b.4': 'Drug abuse', 'b.5': 'Poor academic performance', 'b.6': 'Lack of interest/Distractions', 'b.7': 'Hunger/Malnutrition',
    'c.1': 'Teacher factor', 'c.2': 'Physical condition of classroom', 'c.3': 'Peer influence',
    'd.1': 'Distance between home and school', 'd.2': 'Armed conflict (incl. tribal wars & clan feuds)', 'd.3': 'Calamities/Disasters',
    'e.1': 'Child labor, work', 'f': 'Others'
  };
  const shortD = s => { const [y, m, d] = s.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${d}`; };
  function remark(st, ym) {
    const inMonth = d => d && d.startsWith(ym + '-');
    if (st.outType && inMonth(st.outDate)) return st.outType === 'dropped'
      ? `DROPPED OUT ${shortD(st.outDate)}: ${st.outNote || ''}${DROP_REASONS[st.outNote] ? ' ' + DROP_REASONS[st.outNote] : ''}`.trim()
      : `TRANSFERRED OUT ${shortD(st.outDate)}${st.outNote ? ' to ' + st.outNote : ''}`;
    if (st.inType && inMonth(st.inDate)) return st.inType === 'transfer'
      ? `TRANSFERRED IN ${shortD(st.inDate)}${st.inFrom ? ' from ' + st.inFrom : ''}`
      : `LATE ENROLLEE ${shortD(st.inDate)}`;
    return '';
  }

  /* ---------- numbers for one class and month (shared by SF2 and SF4) ---------- */
  // ym = "2026-10"
  function stats(sec, ym) {
    const first = ym + '-01', last = lastDay(ym);
    const [y, m] = ym.split('-').map(Number), sy = syYear(y, m), syStart = `${sy}-06-01`, cutoff = firstFridayJune(sy);
    const dates = Object.keys(sec.att).filter(d => d.startsWith(ym + '-')).sort();
    const S_ = sec.students;
    const touched = id => { const st = S_[id]; return [st.inDate, st.outDate].some(d => d && d >= first && d <= last); };
    const ids = Object.keys(S_).filter(id => {
      const st = S_[id];
      const overlaps = (!st.inDate || st.inDate <= last) && (!st.outDate || st.outDate > first);
      return overlaps && (sec.seats.includes(id) || dates.some(d => sec.att[d][id]) || touched(id));
    });
    const byName = (a, b) => S_[a].name.localeCompare(S_[b].name);
    const male = ids.filter(id => S_[id].sex === 'M').sort(byName);
    const female = ids.filter(id => S_[id].sex === 'F').sort(byName);
    const unsorted = ids.filter(id => !['M', 'F'].includes(S_[id].sex)).map(id => S_[id].name);

    const active = (id, d) => enrolledOn(S_[id], d);
    const isAbsent = (d, id) => active(id, d) && ['A', 'E'].includes(sec.att[d][id]);
    const isLate = (d, id) => active(id, d) && sec.att[d][id] === 'L';
    const present = list => dates.map(d => list.filter(id => active(id, d) && !isAbsent(d, id)).length);
    const learner = id => {
      let abs = 0, late = 0, run = 0, maxRun = 0;
      const marks = dates.map(d => {
        if (!active(id, d)) { run = 0; return ''; }
        if (isAbsent(d, id)) { abs++; run++; maxRun = Math.max(maxRun, run); return 'x'; }
        run = 0; if (isLate(d, id)) { late++; return 'T'; } return '';
      });
      return { id, marks, abs, late, five: maxRun >= 5, remark: remark(S_[id], ym) };
    };

    // movement counts by sex, over every student this class has ever had
    const all = Object.keys(S_);
    const bySex = f => ({ M: all.filter(id => S_[id].sex === 'M' && f(S_[id])).length, F: all.filter(id => S_[id].sex === 'F' && f(S_[id])).length });
    const between = (d, a, b) => d && d >= a && d <= b;
    const prevEnd = iso(new Date(y, m - 1, 0));
    const move = test => ({
      prev: bySex(st => test(st) && between(test(st), syStart, prevEnd)),
      month: bySex(st => test(st) && between(test(st), first, last))
    });
    const drop = move(st => st.outType === 'dropped' && st.outDate);
    const out = move(st => st.outType === 'transferred' && st.outDate);
    const tin = move(st => st.inType === 'transfer' && st.inDate);
    const late = move(st => st.inType === 'late' && st.inDate);

    // enrolment as of the 1st Friday of June: typed in by the teacher, or counted from the records
    const o = sec.sf2 || {};
    const enrolAuto = bySex(st => (!st.inDate || st.inDate <= cutoff) && (!st.outDate || st.outDate > cutoff));
    const enrol = { M: o.enrolM !== undefined && o.enrolM !== '' ? +o.enrolM : enrolAuto.M, F: o.enrolF !== undefined && o.enrolF !== '' ? +o.enrolF : enrolAuto.F };
    const reg = { M: male.filter(id => active(id, last)).length, F: female.filter(id => active(id, last)).length };
    const pm = present(male), pf = present(female), days = dates.length, sum = a => a.reduce((x, v) => x + v, 0);
    const ada = { M: days ? sum(pm) / days : 0, F: days ? sum(pf) / days : 0 };
    const Ls = { M: male.map(learner), F: female.map(learner) };
    return {
      ym, dates, male, female, unsorted, Ls, pm, pf, days, enrol, reg, ada,
      five: { M: Ls.M.filter(l => l.five).length, F: Ls.F.filter(l => l.five).length },
      drop, out, tin, late, cutoff
    };
  }
  const pctOf = (a, n) => n ? Math.round(a / n * 10000) / 100 : 0;

  async function loadTemplate(file) {
    const res = await fetch(file);
    if (!res.ok) throw new Error('A form template is missing from the app. Upload all the app files again.');
    return JSZip.loadAsync(await res.arrayBuffer());
  }

  async function build(S, sec, ym) {
    const info = stats(sec, ym);
    if (!info.dates.length) throw new Error('No attendance saved for that month yet.');
    if (info.dates.length > DAY_COLS) throw new Error(`SF2 has room for ${DAY_COLS} days, but that month has ${info.dates.length}.`);
    if (info.unsorted.length) throw new Error(`Set Male or Female for: ${info.unsorted.join('; ')}. Tap their seat in the Seats tab.`);

    const zip = await loadTemplate('sf2-template.xlsx');
    const sh = new Sheet(await zip.file('xl/worksheets/sheet1.xml').async('string'));
    let drawing = await zip.file('xl/drawings/drawing1.xml').async('string');

    // make room when a group is bigger than the printed rows
    const extraM = Math.max(0, info.male.length - MALE_ROWS);
    drawing = sh.insertRows(MALE_FIRST + MALE_ROWS - 2, extraM, MALE_FIRST + MALE_ROWS - 2, drawing);
    const mTotal = MALE_FIRST + MALE_ROWS + extraM;    // "MALE TOTAL Per Day"
    const fFirst = mTotal + 1;
    const extraF = Math.max(0, info.female.length - FEMALE_ROWS);
    drawing = sh.insertRows(fFirst + FEMALE_ROWS - 2, extraF, fFirst + FEMALE_ROWS - 2, drawing);
    const fTotal = fFirst + FEMALE_ROWS + extraF, combined = fTotal + 1;
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

    const rowsOf = (list, first) => list.forEach((l, k) => {
      const r = first + k;
      sh.set('A' + r, k + 1);
      sh.set('B' + r, sec.students[l.id].name);
      l.marks.forEach((v, j) => sh.set(dayCol(j) + r, v));
      sh.set('AC' + r, l.abs);
      sh.set('AD' + r, l.late);
      sh.set('AE' + r, l.remark);
    });
    rowsOf(info.Ls.M, MALE_FIRST);
    rowsOf(info.Ls.F, fFirst);

    const sum = a => a.reduce((x, v) => x + v, 0);
    const totals = (row, perDay, ls) => {
      perDay.forEach((v, j) => sh.set(dayCol(j) + row, v));
      sh.set('AC' + row, sum(ls.map(l => l.abs)));
      sh.set('AD' + row, sum(ls.map(l => l.late)));
    };
    // the template formats the male total cells as "00000"; use the female row's plain style
    sh.copyStyle('AC' + mTotal, 'AC' + fTotal); sh.copyStyle('AD' + mTotal, 'AD' + fTotal);
    totals(mTotal, info.pm, info.Ls.M);
    totals(fTotal, info.pf, info.Ls.F);
    totals(combined, info.pm.map((v, j) => v + info.pf[j]), [...info.Ls.M, ...info.Ls.F]);

    // monthly summary (bottom right), using the formulas in the SF2 guidelines
    sh.set('AC' + R(64), MONTHS[m - 1]);
    sh.set('AG' + R(64), info.days);
    const trio = (row, o, total) => { sh.set('AH' + R(row), o.M); sh.set('AI' + R(row), o.F); sh.set('AJ' + R(row), total === undefined ? o.M + o.F : total); };
    const pctTrio = (row, a, n) => {   // written as text: the template's percent formats would show 90.91 as 9091%
      sh.set('AH' + R(row), pctOf(a.M, n.M) + '%'); sh.set('AI' + R(row), pctOf(a.F, n.F) + '%'); sh.set('AJ' + R(row), pctOf(a.M + a.F, n.M + n.F) + '%');
    };
    // some of these cells are rotated sideways in the template; give them the plain centered style
    for (const row of [66, 68, 72, 77, 79, 81, 83]) ['AH', 'AI', 'AJ'].forEach(c => sh.copyStyle(c + R(row), c + R(70)));
    trio(66, info.enrol);                                   // enrolment as of 1st Friday of June
    trio(68, info.late.month);                              // late enrolment during the month
    trio(70, info.reg);                                     // registered learners as of end of month
    pctTrio(72, info.reg, info.enrol);                      // percentage of enrolment as of end of month
    trio(74, info.ada, info.ada.M + info.ada.F);            // average daily attendance
    pctTrio(75, info.ada, info.reg);                        // percentage of attendance for the month
    trio(77, info.five);                                    // 5 consecutive days of absences
    trio(79, info.drop.month);                              // dropped out
    trio(81, info.out.month);                               // transferred out
    trio(83, info.tin.month);                               // transferred in

    zip.file('xl/worksheets/sheet1.xml', sh.xml());
    zip.file('xl/drawings/drawing1.xml', drawing);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  }

  /* ---------- SF4: one row per advisory class, then totals per grade ---------- */
  async function buildSF4(S, ym) {
    const classes = S.sections.filter(sec => (sec.sf2 || {}).sf4 !== false && Object.keys(sec.att).some(d => d.startsWith(ym + '-')));
    if (!classes.length) throw new Error('No class included in SF4 has attendance for that month. Check "Include in SF4" in School details.');
    const rows = classes.map(sec => ({ sec, st: stats(sec, ym) }));
    const missing = rows.filter(r => r.st.unsorted.length).map(r => r.sec.name);
    if (missing.length) throw new Error(`Set Male or Female for every student in: ${missing.join(', ')}.`);
    if (rows.length > 15) throw new Error('SF4 has room for 15 classes.');
    const noGrade = rows.filter(r => !String((r.sec.sf2 || {}).grade || '').trim()).map(r => r.sec.name);
    if (noGrade.length) throw new Error(`Set the grade level for ${noGrade.join(', ')} in School details, so SF4 knows which grade row to use.`);

    const zip = await loadTemplate('sf4-template.xlsx');
    const sh = new Sheet(await zip.file('xl/worksheets/sheet1.xml').async('string'));
    const [y, m] = ym.split('-').map(Number), sc = S.school || {};
    sh.set('I4', sc.region || ''); sh.set('N4', sc.division || ''); sh.set('Y4', sc.district || '');
    sh.set('C5', sc.id || ''); sh.set('C7', sc.name || '');
    sh.set('Y7', sc.year || schoolYear(y, m)); sh.set('AJ7', `${MONTHS[m - 1]} ${y}`);

    const C = n => colName(n);
    const put = (r, startCol, M, F, T) => { sh.set(C(startCol) + r, M); sh.set(C(startCol + 1) + r, F); sh.set(C(startCol + 2) + r, T); };
    const add = (a, b) => ({ M: a.M + b.M, F: a.F + b.F });
    const zero = () => ({ M: 0, F: 0 });
    function fill(r, t) {
      put(r, 4, t.reg.M, t.reg.F, t.reg.M + t.reg.F);                                           // E–G registered
      const r2 = v => Math.round(v * 100) / 100;
      put(r, 7, r2(t.ada.M), r2(t.ada.F), r2(t.ada.M + t.ada.F));                                // H–J daily average
      const p1 = (x, n) => Math.round(pctOf(x, n) * 10) / 10;                                   // narrow columns: one decimal, no % sign
      put(r, 10, p1(t.ada.M, t.reg.M), p1(t.ada.F, t.reg.F), p1(t.ada.M + t.ada.F, t.reg.M + t.reg.F)); // K–M
      [[13, t.drop], [22, t.out], [31, t.tin]].forEach(([c, mv]) => {                           // N, W, AF
        const cum = add(mv.prev, mv.month);
        put(r, c, mv.prev.M, mv.prev.F, mv.prev.M + mv.prev.F);
        put(r, c + 3, mv.month.M, mv.month.F, mv.month.M + mv.month.F);
        put(r, c + 6, cum.M, cum.F, cum.M + cum.F);
      });
    }
    const blank = () => ({ reg: zero(), ada: zero(), drop: { prev: zero(), month: zero() }, out: { prev: zero(), month: zero() }, tin: { prev: zero(), month: zero() } });
    const merge = (a, b) => ({
      reg: add(a.reg, b.reg), ada: add(a.ada, b.ada),
      drop: { prev: add(a.drop.prev, b.drop.prev), month: add(a.drop.month, b.drop.month) },
      out: { prev: add(a.out.prev, b.out.prev), month: add(a.out.month, b.out.month) },
      tin: { prev: add(a.tin.prev, b.tin.prev), month: add(a.tin.month, b.tin.month) }
    });
    const byGrade = {}; let total = blank();
    rows.forEach(({ sec, st }, k) => {
      const r = 12 + k, c = sec.sf2 || {};
      sh.set('A' + r, sc.adviser || ''); sh.set('C' + r, (c.grade || '').replace(/^grade\s*/i, '')); sh.set('D' + r, c.section || sec.name);
      fill(r, st);
      const g = parseInt(String(c.grade || '').replace(/\D+/g, ''), 10);
      const row = /kinder/i.test(c.grade || '') ? 28 : g >= 1 && g <= 12 ? 28 + ((g - 1) % 6) + 1 : 35;
      byGrade[row] = merge(byGrade[row] || blank(), st);
      total = merge(total, st);
    });
    Object.entries(byGrade).forEach(([row, t]) => fill(+row, t));
    fill(36, total);

    zip.file('xl/worksheets/sheet1.xml', sh.xml());
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
  }

  return { build, buildSF4, stats, schoolYear, MONTHS, DROP_REASONS, firstFridayJune, syYear };
})();
