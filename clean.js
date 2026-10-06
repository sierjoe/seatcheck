/* Cleaning tasks: weekly groups, QR scanning, daily points, bonuses and deductions.
   Data lives on each class as sec.clean = { tasks, weeks, log }:
     tasks: [{ id, name, pts, size }]                   size = how many students per group (0 = share evenly)
     weeks: { "2026-10-05": { taskId: [studentId] } }   keyed by the Monday of the week
     log:   [{ id, sid, date, kind: 'task' | 'adj', pts, task, ts }]
   A student earns task points at most once per day; adjustments can be added any number of times. */

const Clean = (() => {
  const st = { sub: 'week', week: null, day: null, period: 'week' };
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  const data = sec => sec.clean || (sec.clean = { tasks: [], weeks: {}, log: [] });
  const mondayOf = s => { const d = toDate(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return fmt(d); };
  const weekDays = wk => DOW.map((_, k) => shiftDate(wk, k));
  const nameOf = (sec, sid) => (sec.students[sid] || { name: '(removed)' }).name;
  const shortName = n => { const k = n.indexOf(','); const f = n.slice(k + 1).trim(); return k > 0 ? `${n.slice(0, k).trim()}${f ? ', ' + f[0] + '.' : ''}` : n; };
  const roster = sec => sec.seats.filter(Boolean).sort((a, b) => nameOf(sec, a).localeCompare(nameOf(sec, b)));
  const weekOf = (sec, wk) => data(sec).weeks[wk] || (data(sec).weeks[wk] = {});
  const rangeLabel = wk => `${shortDate(wk)} – ${shortDate(shiftDate(wk, 4))}`;

  function taskOf(sec, sid, date) {
    const cl = data(sec), a = cl.weeks[mondayOf(date)] || {};
    const id = Object.keys(a).find(t => a[t].includes(sid));
    return cl.tasks.find(t => t.id === id) || null;
  }
  const taskEntry = (sec, sid, date) => data(sec).log.find(e => e.sid === sid && e.date === date && e.kind === 'task');

  const r2 = v => Math.round(v * 100) / 100;
  const PCTS = [1, 0.75, 0.5];
  const pctLabel = p => Math.round(p * 100) + '%';
  function award(sec, sid, date, pct = 1) {
    if (taskEntry(sec, sid, date)) return { status: 'dup', entry: taskEntry(sec, sid, date) };
    const t = taskOf(sec, sid, date);
    if (!t) return { status: 'none' };
    const entry = { id: uid(), sid, date, kind: 'task', pts: r2(t.pts * pct), pct, task: t.name, ts: Date.now() };
    data(sec).log.push(entry);
    return { status: 'ok', entry };
  }
  function adjust(sec, sid, date, pts) {
    const entry = { id: uid(), sid, date, kind: 'adj', pts, task: pts > 0 ? 'Bonus' : 'Deduction', ts: Date.now() };
    data(sec).log.push(entry);
    return entry;
  }
  function setPct(sec, entry, pct) {
    const t = taskOf(sec, entry.sid, entry.date);
    const full = t ? t.pts : entry.pts / (entry.pct || 1);
    entry.pct = pct; entry.pts = r2(full * pct);
  }
  async function pickPct(sec, sid, date, title, msg) {
    const t = taskOf(sec, sid, date);
    if (!t) { toast('No cleaning task this week. Add them to a group first.'); return null; }
    return choose(title || nameOf(sec, sid), msg || `${esc(t.name)} on ${esc(prettyDate(date))}. How well was it done?`,
      PCTS.map(p => ({ label: `${pctLabel(p)}: ${r2(t.pts * p)} pts`, value: p, cls: 'span' + (p === 1 ? ' primary' : '') })));
  }
  const removeEntry = (sec, id) => { const cl = data(sec); cl.log = cl.log.filter(e => e.id !== id); };
  const dayPoints = (sec, sid, date) => data(sec).log.filter(e => e.sid === sid && e.date === date).reduce((a, e) => a + e.pts, 0);

  function inPeriod(date) {
    const t = todayStr();
    if (st.period === 'week') return mondayOf(date) === mondayOf(t);
    if (st.period === 'month') return date.slice(0, 7) === t.slice(0, 7);
    return true;
  }

  /* ---------- small dialogs ---------- */
  function choose(title, msg, opts) {
    return new Promise(res => {
      const d = $('#choiceDlg');
      $('#chTitle').textContent = title;
      $('#chMsg').innerHTML = msg || ''; $('#chMsg').hidden = !msg;
      $('#chOpts').innerHTML = opts.map((o, i) => `<button value="${i}" class="btn ${o.cls || ''}">${esc(o.label)}</button>`).join('');
      d.returnValue = '';
      d.onclose = () => { const i = d.returnValue; res(i !== '' && i !== 'cancel' ? opts[+i].value : null); };
      d.showModal();
    });
  }

  function taskForm(t) {
    return new Promise(res => {
      const d = $('#taskDlg');
      $('#tkTitle').textContent = t ? 'Edit task' : 'Add a task';
      $('#tkName').value = t ? t.name : ''; $('#tkPts').value = t ? t.pts : 5; $('#tkSize').value = t && t.size ? t.size : '';
      $('#tkDel').hidden = !t;
      d.returnValue = '';
      d.onclose = () => {
        if (d.returnValue === 'del') return res('del');
        if (d.returnValue !== 'ok') return res(null);
        const name = $('#tkName').value.trim();
        if (!name) return res(null);
        res({ name, pts: Math.round(+$('#tkPts').value || 0), size: Math.max(0, Math.round(+$('#tkSize').value || 0)) });
      };
      d.showModal();
      setTimeout(() => $('#tkName').focus(), 60);
    });
  }

  function pickMembers(sec, task) {
    return new Promise(res => {
      const d = $('#memberDlg'), a = weekOf(sec, st.week);
      const where = sid => data(sec).tasks.find(t => t.id !== task.id && (a[t.id] || []).includes(sid));
      $('#mbTitle').textContent = `${task.name} (${targets(sec)[task.id]} members)`;
      $('#mbList').innerHTML = roster(sec).map(sid => {
        const other = where(sid);
        return `<label class="mb"><input type="checkbox" value="${sid}" ${(a[task.id] || []).includes(sid) ? 'checked' : ''}>
          <span>${esc(nameOf(sec, sid))}</span>${other ? `<small>${esc(other.name)}</small>` : ''}</label>`;
      }).join('') || '<p class="muted small">No students in this class yet.</p>';
      d.returnValue = '';
      d.onclose = () => res(d.returnValue === 'ok' ? [...$('#mbList').querySelectorAll('input:checked')].map(i => i.value) : null);
      d.showModal();
    });
  }

  async function adjustFlow(sec, sid, date) {
    const v = await choose(`${nameOf(sec, sid)}`, `Add or deduct points for ${esc(prettyDate(date))}.`, [
      { label: '+1', value: 1 }, { label: '+2', value: 2 }, { label: '+3', value: 3 }, { label: '+5', value: 5 },
      { label: '−1', value: -1, cls: 'neg' }, { label: '−2', value: -2, cls: 'neg' }, { label: '−3', value: -3, cls: 'neg' }, { label: '−5', value: -5, cls: 'neg' },
      { label: 'Other amount', value: 'other', cls: 'span' }
    ]);
    if (v === null) return false;
    let pts = v;
    if (v === 'other') {
      const s = await ask({ title: 'Other amount', msg: 'Type a number. Use a minus sign to deduct, like -4.', placeholder: '-4' });
      pts = Math.round(+String(s || '').replace('−', '-'));
      if (!pts) return false;
    }
    adjust(sec, sid, date, pts); save();
    toast(`${shortName(nameOf(sec, sid))}: ${pts > 0 ? '+' : ''}${pts} points`);
    return true;
  }

  /* ---------- groups ---------- */
  /* How many students each task should get.
     Tasks with a size get exactly that many; the rest are shared evenly by tasks without a size.
     If every task has a size, extra students are spread across tasks one at a time.
     If there are fewer students than the sizes add up to, each group shrinks in proportion. */
  function targets(sec, n = roster(sec).length) {
    const tasks = data(sec).tasks, out = {};
    const sized = tasks.filter(t => t.size > 0), open = tasks.filter(t => !(t.size > 0));
    const S = sized.reduce((a, t) => a + t.size, 0);
    tasks.forEach(t => out[t.id] = 0);
    if (n >= S) {
      sized.forEach(t => out[t.id] = t.size);
      let rest = n - S;
      const pool = open.length ? open : tasks;
      for (let k = 0; rest > 0; k++, rest--) out[pool[k % pool.length].id]++;
    } else {
      const raw = sized.map(t => ({ t, v: t.size * n / S }));
      raw.forEach(r => out[r.t.id] = Math.floor(r.v));
      let left = n - raw.reduce((a, r) => a + Math.floor(r.v), 0);
      raw.sort((x, y) => (y.v % 1) - (x.v % 1)).forEach(r => { if (left > 0) { out[r.t.id]++; left--; } });
    }
    return out;
  }
  // fill tasks, in order, from a list of students
  function fillByTargets(sec, ids) {
    const tasks = data(sec).tasks, want = targets(sec, ids.length), a = {};
    let k = 0;
    tasks.forEach(t => { a[t.id] = ids.slice(k, k + want[t.id]); k += want[t.id]; });
    return a;
  }
  const mixed = list => { const l = list.slice(); for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };

  function shuffle(sec) {
    data(sec).weeks[st.week] = fillByTargets(sec, mixed(roster(sec)));
  }
  // rotate: everyone moves on to the next task; groups are then trimmed or topped up to the right size
  function fromLastWeek(sec, rotate) {
    const tasks = data(sec).tasks, prev = data(sec).weeks[shiftDate(st.week, -7)];
    if (!prev || !Object.values(prev).some(l => l.length)) return false;
    const inClass = new Set(roster(sec));
    if (!rotate) {
      const a = {}; tasks.forEach(t => a[t.id] = (prev[t.id] || []).filter(id => inClass.has(id)));
      data(sec).weeks[st.week] = a;
      return true;
    }
    const order = [];
    tasks.forEach((t, i) => (prev[tasks[(i - 1 + tasks.length) % tasks.length].id] || []).forEach(id => inClass.has(id) && order.push(id)));
    const seen = new Set(order);
    roster(sec).forEach(id => { if (!seen.has(id)) order.push(id); });   // new students go last
    data(sec).weeks[st.week] = fillByTargets(sec, order);
    return true;
  }
  // keep everyone where they are as far as possible, only moving extras into groups that are short
  function balance(sec) {
    const tasks = data(sec).tasks, a = weekOf(sec, st.week), want = targets(sec), inClass = new Set(roster(sec));
    const placed = new Set(), pool = [];
    tasks.forEach(t => {
      const keep = (a[t.id] || []).filter(id => inClass.has(id) && !placed.has(id));
      keep.forEach(id => placed.add(id));
      a[t.id] = keep.slice(0, want[t.id]);
      pool.push(...keep.slice(want[t.id]));
    });
    roster(sec).forEach(id => { if (!placed.has(id)) pool.push(id); });
    const extra = mixed(pool);
    tasks.forEach(t => { while (a[t.id].length < want[t.id] && extra.length) a[t.id].push(extra.shift()); });
  }
  function sizeNote(sec) {
    const tasks = data(sec).tasks, n = roster(sec).length, S = tasks.reduce((x, t) => x + (t.size || 0), 0);
    if (tasks.every(t => t.size > 0) && n > S) return `Shuffled. Sizes add up to ${S} but there are ${n} students, so ${n - S} extra were spread across tasks.`;
    if (n < S) return `Shuffled. Sizes add up to ${S} but there are only ${n} students, so groups were made smaller.`;
    return '';
  }
  function mismatches(sec) {
    const a = data(sec).weeks[st.week] || {}, want = targets(sec);
    const assigned = Object.values(a).flat().length;
    return data(sec).tasks.filter(t => (a[t.id] || []).length !== want[t.id]).length + (assigned < roster(sec).length ? 1 : 0);
  }

  /* ---------- views ---------- */
  function render(sec) {
    if (!st.week) { st.day = todayStr(); st.week = mondayOf(st.day); }
    const seg = `<div class="seg seg3">
      ${[['week', 'Groups'], ['points', 'Points'], ['tasks', 'Tasks']].map(([k, l]) => `<button class="${st.sub === k ? 'on' : ''}" data-act="cl-sub" data-k="${k}">${l}</button>`).join('')}
    </div>`;
    return seg + (st.sub === 'week' ? weekView(sec) : st.sub === 'points' ? pointsView(sec) : tasksView(sec));
  }

  function weekView(sec) {
    const cl = data(sec);
    if (!cl.tasks.length) return `<p class="empty-note">No cleaning tasks yet.<br>Add your tasks and their points first.</p>
      <button class="btn primary wide" data-act="cl-sub" data-k="tasks">Set up tasks</button>`;
    const a = cl.weeks[st.week] || {};
    const assigned = new Set(Object.values(a).flat());
    const free = roster(sec).filter(sid => !assigned.has(sid));
    const days = weekDays(st.week), t = todayStr();
    const chips = days.map((d, k) => `<button class="day${d === st.day ? ' on' : ''}${d === t ? ' is-today' : ''}" data-act="cl-day" data-d="${d}">
      <span>${DOW[k]}</span><b>${toDate(d).getDate()}</b></button>`).join('');
    const want = targets(sec), off = Object.values(a).some(l => l.length) && mismatches(sec);
    const cards = cl.tasks.map(task => {
      const mem = (a[task.id] || []);
      const bad = Object.values(a).some(l => l.length) && mem.length !== want[task.id];
      const done = mem.filter(sid => taskEntry(sec, sid, st.day)).length;
      return `<section class="task">
        <div class="task-top"><h3>${esc(task.name)}</h3><span class="pts">${task.pts} pts</span></div>
        <div class="size${bad ? ' bad' : ''}">${mem.length} of ${want[task.id]} members${task.size ? '' : ' (shares the rest)'}</div>
        <div class="chips">${mem.map(sid => {
          const e = taskEntry(sec, sid, st.day), p = dayPoints(sec, sid, st.day);
          return `<button class="chip${e ? ' done' : ''}" data-act="cl-chip" data-sid="${sid}">${esc(shortName(nameOf(sec, sid)))}${e ? `<em>${p > 0 ? '+' : ''}${p}</em>` : ''}</button>`;
        }).join('') || '<span class="muted small">No one yet</span>'}</div>
        <div class="task-foot">
          <span class="muted small">${mem.length ? `${done} of ${mem.length} done` : ''}</span>
          <span>${mem.length && done < mem.length ? `<button class="link" data-act="cl-all" data-t="${task.id}">${ic('checks')}Give all</button>` : ''}
          <button class="link" data-act="cl-members" data-t="${task.id}">${ic('users')}Members</button></span>
        </div>
      </section>`;
    }).join('');
    return `
      <button class="btn primary wide scanbtn" data-act="cl-scan">${ic('qr')}Scan QR cards</button>
      <div class="datebar" style="margin-top:12px">
        <button class="icon-btn" data-act="cl-wk" data-n="-7" aria-label="Previous week">‹</button>
        <div class="date"><span>Week of ${esc(rangeLabel(st.week))}</span></div>
        <button class="icon-btn" data-act="cl-wk" data-n="7" aria-label="Next week">›</button>
      </div>
      <div class="days">${chips}</div>
      ${off ? `<div class="warnbox"><span>Some groups don't match the sizes in Tasks.</span><button class="btn primary" data-act="cl-balance">${ic('users')}Fix group sizes</button></div>` : ''}
      <p class="muted small hint">Tap a name to give points for ${esc(prettyDate(st.day))}. Tap again to adjust or remove.</p>
      ${cards}
      ${free.length ? `<p class="muted small"><b>Not in a group:</b> ${free.map(sid => esc(shortName(nameOf(sec, sid)))).join(', ')}</p>` : ''}
      <div class="row wrap">
        <button class="btn" data-act="cl-shuffle">${ic('shuffle')}Shuffle groups</button>
        <button class="btn" data-act="cl-rotate">${ic('rotate')}Rotate from last week</button>
        <button class="btn" data-act="cl-copy">${ic('copy')}Same as last week</button>
        <button class="btn" data-act="cl-printgroups">${ic('print')}Print groups</button>
      </div>`;
  }

  function pointsView(sec) {
    const cl = data(sec), t = todayStr();
    const rows = roster(sec).concat(Object.keys(sec.students).filter(id => !sec.seats.includes(id) && cl.log.some(e => e.sid === id)))
      .map(sid => {
        const es = cl.log.filter(e => e.sid === sid && inPeriod(e.date));
        const task = taskOf(sec, sid, t);
        return { sid, name: nameOf(sec, sid), task: task ? task.name : '', total: es.reduce((a, e) => a + e.pts, 0), days: es.filter(e => e.kind === 'task').length };
      }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return `
      <div class="seg seg3 small-seg">
        ${[['week', 'This week'], ['month', 'This month'], ['all', 'All']].map(([k, l]) => `<button class="${st.period === k ? 'on' : ''}" data-act="cl-period" data-k="${k}">${l}</button>`).join('')}
      </div>
      <div class="rec-head"><span>Student</span><span>Points</span></div>
      <ul class="rec">${rows.map(r => `<li><button class="rowbtn" data-act="cl-student" data-sid="${r.sid}">
        <div class="rec-top"><span>${esc(r.name)}</span><span class="total">${r.total}</span></div>
        <div class="muted small">${r.task ? esc(r.task) + ' this week' : 'No group this week'}${r.days ? `, ${r.days} day${r.days > 1 ? 's' : ''} done` : ''}</div>
      </button></li>`).join('')}</ul>
      <button class="btn wide" data-act="cl-csv" style="margin-top:14px">${ic('sheet')}Export points to Excel</button>`;
  }

  function tasksView(sec) {
    const cl = data(sec);
    return `
      <ul class="classes">${cl.tasks.map(t => `<li>
        <button class="cls" data-act="cl-edit" data-t="${t.id}"><span>${esc(t.name)}</span>
        <small>${t.pts} points a day (75% = ${r2(t.pts * .75)}, 50% = ${r2(t.pts * .5)})${t.size ? `, groups of ${t.size}` : ''}</small></button>
        <button class="link" data-act="cl-edit" data-t="${t.id}" aria-label="Edit">${ic('edit')}</button></li>`).join('')}</ul>
      ${cl.tasks.length ? '' : '<p class="muted small">Example: Sweep the floor, 5 points, group of 4.</p>'}
      <button class="btn wide" data-act="cl-add" style="margin-top:12px">${ic('plus')}Add a task</button>
      <h2 class="h">QR cards</h2>
      <p class="muted small">Each student gets one card for the whole year. Print them from your Mac for the best result, then cut along the lines.</p>
      <button class="btn primary wide" data-act="cl-print">${ic('print')}Print QR cards for ${esc(sec.name)}</button>`;
  }

  /* ---------- actions ---------- */
  async function click(act, b) {
    const sec = cur(), cl = data(sec);
    switch (act) {
      case 'cl-sub': st.sub = b.dataset.k; return render_();
      case 'cl-period': st.period = b.dataset.k; return render_();
      case 'cl-wk': st.week = shiftDate(st.week, +b.dataset.n); st.day = weekDays(st.week).includes(todayStr()) ? todayStr() : st.week; return render_();
      case 'cl-day': st.day = b.dataset.d; return render_();
      case 'cl-chip': {
        const sid = b.dataset.sid, e = taskEntry(sec, sid, st.day);
        if (!e) {
          const p = await pickPct(sec, sid, st.day);
          if (p !== null) { award(sec, sid, st.day, p); save(); }
          return render_();
        }
        const v = await choose(nameOf(sec, sid), `${esc(e.task)} on ${esc(prettyDate(st.day))}: ${dayPoints(sec, sid, st.day)} points so far.`, [
          { label: 'Change rating (100%, 75%, 50%)', value: 'pct', cls: 'span' },
          { label: 'Add or deduct points', value: 'adj', cls: 'span' },
          { label: 'Remove this day\'s points', value: 'rm', cls: 'span neg' }
        ]);
        if (v === 'pct') { const p = await pickPct(sec, sid, st.day); if (p !== null) { setPct(sec, e, p); save(); } }
        if (v === 'adj') await adjustFlow(sec, sid, st.day);
        if (v === 'rm') { cl.log = cl.log.filter(x => !(x.sid === sid && x.date === st.day)); save(); }
        return render_();
      }
      case 'cl-all': {
        const mem = weekOf(sec, st.week)[b.dataset.t] || [];
        let n = 0; mem.forEach(sid => { if (award(sec, sid, st.day).status === 'ok') n++; });
        save(); render_(); return toast(`Points given to ${n} student${n === 1 ? '' : 's'}`);
      }
      case 'cl-members': {
        const task = cl.tasks.find(t => t.id === b.dataset.t);
        const ids = await pickMembers(sec, task);
        if (!ids) return;
        const a = weekOf(sec, st.week);
        for (const k in a) if (k !== task.id) a[k] = a[k].filter(x => !ids.includes(x));
        a[task.id] = ids; save(); return render_();
      }
      case 'cl-shuffle': {
        const a = cl.weeks[st.week];
        if (a && Object.values(a).some(l => l.length) && !confirm('Replace this week\'s groups with new random groups?')) return;
        shuffle(sec); save(); render_();
        return toast(sizeNote(sec) || 'Groups shuffled');
      }
      case 'cl-balance': balance(sec); save(); render_(); return toast('Groups now match the sizes in Tasks');
      case 'cl-rotate': case 'cl-copy': {
        const a = cl.weeks[st.week];
        if (a && Object.values(a).some(l => l.length) && !confirm('Replace this week\'s groups?')) return;
        if (!fromLastWeek(sec, act === 'cl-rotate')) return toast('Last week has no groups to copy');
        save(); render_(); return toast(act === 'cl-rotate' ? 'Each group moved to the next task' : 'Copied last week\'s groups');
      }
      case 'cl-student': {
        const sid = b.dataset.sid;
        const es = cl.log.filter(e => e.sid === sid && inPeriod(e.date)).sort((x, y) => y.date.localeCompare(x.date) || y.ts - x.ts);
        const v = await choose(nameOf(sec, sid), es.length
          ? `<ul class="hist">${es.slice(0, 30).map(e => `<li><span>${esc(shortDate(e.date))}, ${esc(e.task)}</span><b class="${e.pts < 0 ? 'neg' : ''}">${e.pts > 0 ? '+' : ''}${e.pts}</b></li>`).join('')}</ul>`
          : 'No points in this period yet.', [{ label: 'Add or deduct points today', value: 'adj', cls: 'span' }]);
        if (v === 'adj') { await adjustFlow(sec, sid, todayStr()); render_(); }
        return;
      }
      case 'cl-add': case 'cl-edit': {
        const t = act === 'cl-edit' ? cl.tasks.find(x => x.id === b.dataset.t) : null;
        const r = await taskForm(t);
        if (!r) return;
        if (r === 'del') {
          if (!confirm(`Delete ${t.name}? Points already given stay in the records.`)) return;
          cl.tasks = cl.tasks.filter(x => x.id !== t.id);
          for (const w of Object.values(cl.weeks)) delete w[t.id];
        } else if (t) Object.assign(t, r);
        else cl.tasks.push({ id: uid(), ...r });
        save(); return render_();
      }
      case 'cl-print': return printCards(sec);
      case 'cl-printgroups': return printGroups(sec);
      case 'cl-csv': return exportCSV(sec);
      case 'cl-scan': return Scanner.open();
    }
  }
  const render_ = () => render_hook();
  let render_hook = () => {};

  function exportCSV(sec) {
    const cl = data(sec);
    const weeks = [...new Set(cl.log.map(e => mondayOf(e.date)))].sort();
    const ids = roster(sec).concat(Object.keys(sec.students).filter(id => !sec.seats.includes(id) && cl.log.some(e => e.sid === id)));
    const summary = [['Student', 'Task points', 'Bonus', 'Deductions', 'Total', 'Days done', ...weeks.map(w => 'Week of ' + shortDate(w))]];
    const rows = ids.map(sid => {
      const es = cl.log.filter(e => e.sid === sid);
      const s = f => r2(es.filter(f).reduce((a, e) => a + e.pts, 0));
      return [nameOf(sec, sid), s(e => e.kind === 'task'), s(e => e.kind === 'adj' && e.pts > 0), s(e => e.kind === 'adj' && e.pts < 0),
        s(() => true), es.filter(e => e.kind === 'task').length, ...weeks.map(w => s(e => mondayOf(e.date) === w))];
    }).sort((x, y) => y[4] - x[4] || x[0].localeCompare(y[0]));
    const log = [['Date', 'Student', 'Task', 'Rating', 'Points']].concat(
      cl.log.slice().sort((x, y) => x.date.localeCompare(y.date) || x.ts - y.ts)
        .map(e => [e.date, nameOf(sec, e.sid), e.task, e.kind === 'task' ? pctLabel(e.pct || 1) : (e.pts > 0 ? 'Bonus' : 'Deduction'), e.pts]));
    const safe = sec.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-') || 'class';
    XLSX_MINI.make([
      { name: 'Points', rows: summary.concat(rows), widths: [30, 11, 8, 11, 8, 10, ...weeks.map(() => 13)] },
      { name: 'Daily log', rows: log, widths: [12, 30, 22, 10, 8] }
    ]).then(b => shareFile(`${safe}-cleaning-points-${todayStr()}.xlsx`, b, b.type));
  }

  /* ---------- QR cards ---------- */
  const payload = (sec, sid) => `SC:${sec.id}:${sid}`;

  // QR with error correction H, so a label can sit in the middle and it still scans
  function qrCanvas(text, label, size = 360) {
    const qr = qrcode(0, 'H'); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), quiet = 4, cell = Math.floor(size / (n + quiet * 2)), dim = cell * (n + quiet * 2);
    const c = document.createElement('canvas'); c.width = c.height = dim;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, dim, dim); g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qr.isDark(r, k)) g.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
    // label box: about a third of the code wide, a sixth tall
    const bw = Math.round(n * cell * 0.38), bh = Math.round(n * cell * 0.17), bx = (dim - bw) / 2, by = (dim - bh) / 2;
    g.fillStyle = '#fff'; g.fillRect(bx, by, bw, bh);
    g.strokeStyle = '#000'; g.lineWidth = Math.max(1, cell * 0.4); g.strokeRect(bx, by, bw, bh);
    g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = bh * 0.55;
    do { g.font = `700 ${fs}px -apple-system, "Helvetica Neue", Arial, sans-serif`; fs -= 1; } while (g.measureText(label).width > bw * 0.9 && fs > 8);
    g.fillText(label, dim / 2, dim / 2 + 1);
    return c;
  }

  function printGroups(sec) {
    const cl = data(sec), a = cl.weeks[st.week] || {};
    const tasks = cl.tasks.filter(t => (a[t.id] || []).length);
    if (!tasks.length) return toast('This week has no groups yet');
    const area = $('#printArea');
    area.innerHTML = `<div class="gp">
      <h1>Cleaning groups</h1>
      <p>${esc(sec.name)}, week of ${esc(rangeLabel(st.week))}, ${toDate(st.week).getFullYear()}</p>
      <div class="gp-grid">${tasks.map(t => `<section class="gp-box">
        <h2><span>${esc(t.name)}</span><small>${a[t.id].length} members, ${t.pts} pts</small></h2>
        <ol>${a[t.id].slice().sort((x, y) => nameOf(sec, x).localeCompare(nameOf(sec, y))).map(sid => `<li>${esc(nameOf(sec, sid))}</li>`).join('')}</ol>
      </section>`).join('')}</div></div>`;
    fitA4(area);
    setTimeout(() => window.print(), 150);
  }

  // shrink the text until the sheet fits one A4 page (190 × 277 mm inside 10 mm margins)
  function fitA4(area) {
    const mm = 96 / 25.4, maxH = 272 * mm;
    const gp = area.querySelector('.gp');
    area.classList.add('measure');
    let best = null;
    outer: for (const cols of [2, 3]) {
      for (let fs = 13; fs >= 7; fs -= 0.5) {
        gp.style.setProperty('--fs', fs + 'pt');
        gp.style.setProperty('--cols', cols);
        gp.querySelectorAll('ol').forEach(ol => ol.style.columns = ol.children.length > (cols === 2 ? 9 : 12) ? 2 : 1);
        if (gp.scrollHeight <= maxH) { best = { cols, fs }; break outer; }
      }
    }
    if (!best) { gp.style.setProperty('--fs', '7pt'); gp.style.setProperty('--cols', 3); }
    area.classList.remove('measure');
  }

  function printCards(sec) {
    const ids = roster(sec);
    if (!ids.length) return toast('Add students to this class first');
    const area = $('#printArea');
    // fixed A4 pages: 3 across, 4 down, 12 cards a page
    const card = sid => {
      const n = nameOf(sec, sid), k = n.indexOf(',');
      // surname when the name has one ("Dela Cruz, Juan"), otherwise the whole name, so JAY ANN and JAY AR differ
      const mid = (k > 0 ? n.slice(0, k) : n).trim().toUpperCase();
      return `<div class="card"><img src="${qrCanvas(payload(sec, sid), mid).toDataURL()}" alt=""><b>${esc(n)}</b><small>${esc(sec.name)}</small></div>`;
    };
    const pages = [];
    for (let i = 0; i < ids.length; i += 12) pages.push(`<div class="qpage">${ids.slice(i, i + 12).map(card).join('')}</div>`);
    area.innerHTML = pages.join('');
    setTimeout(() => window.print(), 150);
  }

  /* ---------- scanner ---------- */
  const Scanner = (() => {
    let stream = null, raf = 0, last = { code: '', t: 0 }, current = null, audio = null;
    const el = id => document.getElementById(id);

    function beep(ok) {
      try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        const o = audio.createOscillator(), gn = audio.createGain();
        o.frequency.value = ok ? 880 : 300; gn.gain.value = 0.08;
        o.connect(gn); gn.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.12 : 0.25));
      } catch (e) {}
    }

    async function open() {
      el('scan').hidden = false; document.body.classList.add('scanning');
      el('scResult').hidden = true; el('scLast').hidden = true; pending = null; el('scHint').textContent = 'Point the camera at a QR card';
      beep(true); // unlocks sound on iPhone (needs a tap first)
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        const v = el('scVideo'); v.srcObject = stream; await v.play();
        loop();
      } catch (e) {
        el('scHint').textContent = 'Camera is blocked. Allow camera access for SeatCheck in Settings, then try again.';
      }
    }
    function close() {
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null; el('scan').hidden = true; document.body.classList.remove('scanning');
      render_hook();
    }
    function loop() {
      const v = el('scVideo'), c = el('scCanvas');
      if (!stream) return;
      if (v.readyState >= 2 && v.videoWidth) {
        const w = 480, h = Math.round(v.videoHeight / v.videoWidth * w);
        c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(v, 0, 0, w, h);
        const code = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (code && code.data) handle(code.data);
      }
      raf = requestAnimationFrame(loop);
    }
    // scanning pauses while a rating is being picked, then carries on by itself
    let pending = null;
    function handle(text) {
      if (pending) return;
      const now = Date.now();
      if (text === last.code && now - last.t < 4000) return;
      last = { code: text, t: now };
      const m = /^SC:([\w-]+):([\w-]+)$/.exec(text);
      if (!m) { beep(false); return note('Not a SeatCheck card', ''); }
      const sec = S.sections.find(s => s.id === m[1]), sid = m[2];
      if (!sec || !sec.students[sid]) { beep(false); return note('Card not found', 'This student is not in any class on this device.'); }
      const day = todayStr(), t = taskOf(sec, sid, day), n = nameOf(sec, sid);
      if (!t) { beep(false); return note(n, 'No cleaning task this week. Add them to a group first.'); }
      const existing = taskEntry(sec, sid, day);
      pending = { sec, sid, day, t, existing };
      beep(true);
      el('scResult').hidden = false;
      el('scName').textContent = n;
      el('scPts').textContent = '';
      el('scTask').textContent = (sec.id !== S.current ? sec.name + ': ' : '') + t.name +
        (existing ? `. Already rated ${pctLabel(existing.pct || 1)} today; pick again to change it.` : '. How well was it done?');
      el('scPick').hidden = false;
      el('scPick').innerHTML = PCTS.map(p => `<button class="btn${p === 1 ? ' primary' : ''}" data-pct="${p}"><b>${r2(t.pts * p)}</b><small>${pctLabel(p)}</small></button>`).join('')
        + `<button class="btn skip" data-skip="1">Skip, no points</button>`;
    }
    function note(title, msg) {
      el('scResult').hidden = false; el('scPick').hidden = true;
      el('scName').textContent = title; el('scTask').textContent = msg; el('scPts').textContent = '';
    }
    function onClick(e) {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'scClose') return close();
      if (b.dataset.pct && pending) {
        const p = +b.dataset.pct, { sec, sid, day, existing } = pending;
        let entry = existing;
        if (existing) setPct(sec, existing, p); else entry = award(sec, sid, day, p).entry;
        save(); beep(true);
        current = { sec, sid, entry };
        el('scPts').textContent = '+' + entry.pts;
        el('scTask').textContent = 'Saved. Scan the next card.';
        el('scPick').hidden = true;
        el('scLast').hidden = false;
        el('scLastTxt').textContent = `Last: ${shortName(nameOf(sec, sid))} +${entry.pts} (${pctLabel(p)})`;
        pending = null; last.t = Date.now();
        return;
      }
      if (b.dataset.skip) { pending = null; last.t = Date.now(); return note('Skipped', 'Scan the next card.'); }
      if (b.id === 'scUndo' && current && current.entry) {
        removeEntry(current.sec, current.entry.id); save();
        el('scLastTxt').textContent = `Undone: ${shortName(nameOf(current.sec, current.sid))}`;
        current = null; last = { code: '', t: 0 };
      }
    }
    document.addEventListener('DOMContentLoaded', () => el('scan').addEventListener('click', onClick));
    return { open, close, handle };
  })();

  return { render, click, setRender: f => render_hook = f, qrCanvas, payload, Scanner, award, mondayOf, _st: st };
})();
