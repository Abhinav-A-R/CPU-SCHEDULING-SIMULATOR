/**
 * DCPS Scheduling Simulator — vanilla JS
 * Security: strict input bounds, textContent-only for user data, schema-checked localStorage, no eval.
 */
'use strict';

// ---------------------------------------------------------------------------
// Security & limits
// ---------------------------------------------------------------------------
const LIMITS = {
  maxProcesses: 20,
  minProcesses: 1,
  maxTime: 50000,
  maxBurst: 10000,
  maxArrival: 10000,
  maxPriority: 1000,
  maxQuantum: 1000,
  minQuantum: 1,
  maxDiskRequests: 50,
  maxCylinder: 10000,
  maxQueueStringLen: 500,
  storageKey: 'dcps_simulator_v1',
  storageVersion: 1,
  bankMinN: 2,
  bankMaxN: 8,
  bankMinM: 1,
  bankMaxM: 6,
  bankMaxCell: 999,
};

/** @param {unknown} n */
function isSafeInt(n) {
  return typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n;
}

/**
 * Parse bounded non-negative integer from string input.
 * @param {string} raw
 * @param {number} min
 * @param {number} max
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
function parseBoundedInt(raw, min, max) {
  if (typeof raw !== 'string') raw = String(raw ?? '');
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return { ok: false, error: 'Use digits only (no decimals or signs).' };
  const v = parseInt(t, 10);
  if (!isSafeInt(v) || v < min || v > max) return { ok: false, error: `Value must be between ${min} and ${max}.` };
  return { ok: true, value: v };
}

/**
 * Disk queue: comma-separated positive integers, max count.
 * @param {string} str
 */
function parseDiskQueue(str) {
  if (typeof str !== 'string' || str.length > LIMITS.maxQueueStringLen) {
    return { ok: false, error: 'Queue string is too long.' };
  }
  const parts = str.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: 'Enter at least one cylinder request.' };
  if (parts.length > LIMITS.maxDiskRequests) return { ok: false, error: `At most ${LIMITS.maxDiskRequests} requests.` };
  const out = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return { ok: false, error: 'Queue must contain only non-negative integers.' };
    const v = parseInt(p, 10);
    if (v > LIMITS.maxCylinder) return { ok: false, error: `Each request must be ≤ ${LIMITS.maxCylinder}.` };
    out.push(v);
  }
  return { ok: true, value: out };
}

/** @param {HTMLElement} el @param {string} text */
function setText(el, text) {
  el.textContent = text;
}

/** @param {HTMLElement} el */
function clearEl(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ---------------------------------------------------------------------------
// CPU scheduling
// ---------------------------------------------------------------------------

/**
 * @typedef {{ pid: number, arrival: number, burst: number, priority: number }} Proc
 * @typedef {{ id: string, start: number, end: number }} GanttSeg
 */

/** @param {Proc[]} processes */
function scheduleFCFS(processes) {
  const sorted = [...processes].sort((a, b) => a.arrival - b.arrival || a.pid - b.pid);
  let t = 0;
  /** @type {GanttSeg[]} */
  const gantt = [];
  /** @type {Proc & { completion: number, tat: number, wt: number }}[] */
  const done = [];
  for (const p of sorted) {
    if (t < p.arrival) {
      gantt.push({ id: 'Idle', start: t, end: p.arrival });
      t = p.arrival;
    }
    gantt.push({ id: `P${p.pid}`, start: t, end: t + p.burst });
    t += p.burst;
    done.push({
      ...p,
      completion: t,
      tat: t - p.arrival,
      wt: t - p.arrival - p.burst,
    });
  }
  return { gantt, processes: done.sort((a, b) => a.pid - b.pid) };
}

/** @param {Proc[]} processes */
function scheduleSJF_NP(processes) {
  const n = processes.length;
  const remaining = processes.map((p) => ({ ...p, left: p.burst, finished: false }));
  let t = 0;
  /** @type {GanttSeg[]} */
  const gantt = [];
  /** @type {Map<number, { completion: number, tat: number, wt: number }>} */
  const stats = new Map();
  let completed = 0;

  while (completed < n) {
    const ready = remaining.filter((p) => !p.finished && p.arrival <= t);
    if (ready.length === 0) {
      const pending = remaining.filter((p) => !p.finished);
      if (pending.length === 0) break;
      const nextT = Math.min(...pending.map((p) => p.arrival));
      if (t < nextT) gantt.push({ id: 'Idle', start: t, end: nextT });
      t = nextT;
      continue;
    }
    ready.sort((a, b) => a.left - b.left || a.arrival - b.arrival || a.pid - b.pid);
    const p = ready[0];
    gantt.push({ id: `P${p.pid}`, start: t, end: t + p.left });
    t += p.left;
    p.finished = true;
    completed++;
    stats.set(p.pid, {
      completion: t,
      tat: t - p.arrival,
      wt: t - p.arrival - p.burst,
    });
  }

  const procs = processes
    .map((p) => {
      const s = stats.get(p.pid);
      return { ...p, completion: s.completion, tat: s.tat, wt: s.wt };
    })
    .sort((a, b) => a.pid - b.pid);
  return { gantt, processes: procs };
}

/** Lower priority number = higher priority. @param {Proc[]} processes */
function schedulePriority_NP(processes) {
  const n = processes.length;
  const remaining = processes.map((p) => ({ ...p, left: p.burst, finished: false }));
  let t = 0;
  /** @type {GanttSeg[]} */
  const gantt = [];
  const stats = new Map();
  let completed = 0;

  while (completed < n) {
    const ready = remaining.filter((p) => !p.finished && p.arrival <= t);
    if (ready.length === 0) {
      const pending = remaining.filter((p) => !p.finished);
      if (pending.length === 0) break;
      const nextT = Math.min(...pending.map((p) => p.arrival));
      if (t < nextT) gantt.push({ id: 'Idle', start: t, end: nextT });
      t = nextT;
      continue;
    }
    ready.sort((a, b) => a.priority - b.priority || a.arrival - b.arrival || a.pid - b.pid);
    const p = ready[0];
    gantt.push({ id: `P${p.pid}`, start: t, end: t + p.left });
    t += p.left;
    p.finished = true;
    completed++;
    stats.set(p.pid, {
      completion: t,
      tat: t - p.arrival,
      wt: t - p.arrival - p.burst,
    });
  }

  const procs = processes
    .map((p) => {
      const s = stats.get(p.pid);
      return { ...p, completion: s.completion, tat: s.tat, wt: s.wt };
    })
    .sort((a, b) => a.pid - b.pid);
  return { gantt, processes: procs };
}

/** @param {Proc[]} processes @param {number} quantum */
function scheduleRR(processes, quantum) {
  const procs = processes.map((p) => ({
    pid: p.pid,
    arrival: p.arrival,
    burst: p.burst,
    priority: p.priority,
    rem: p.burst,
    inQueue: false,
  }));
  const n = procs.length;
  let t = Math.min(...procs.map((p) => p.arrival));
  /** @type {typeof procs} */
  const ready = [];
  /** @type {GanttSeg[]} */
  const gantt = [];
  let done = 0;
  /** @type {Record<number, number>} */
  const completion = {};

  function addNewArrivals() {
    const candidates = procs.filter((p) => p.rem > 0 && p.arrival <= t && !p.inQueue);
    candidates.sort((a, b) => a.arrival - b.arrival || a.pid - b.pid);
    for (const p of candidates) {
      p.inQueue = true;
      ready.push(p);
    }
  }

  addNewArrivals();

  while (done < n) {
    if (ready.length === 0) {
      const future = procs.filter((p) => p.rem > 0 && p.arrival > t);
      if (future.length === 0) break;
      const nextT = Math.min(...future.map((p) => p.arrival));
      gantt.push({ id: 'Idle', start: t, end: nextT });
      t = nextT;
      addNewArrivals();
      continue;
    }

    const p = ready.shift();
    p.inQueue = false;
    const run = Math.min(quantum, p.rem);
    const start = t;
    t += run;
    gantt.push({ id: `P${p.pid}`, start, end: t });
    p.rem -= run;

    const midArrivals = procs.filter(
      (o) => o.rem > 0 && o.arrival > start && o.arrival <= t && !o.inQueue
    );
    midArrivals.sort((a, b) => a.arrival - b.arrival || a.pid - b.pid);
    for (const o of midArrivals) {
      o.inQueue = true;
      ready.push(o);
    }

    if (p.rem > 0) {
      p.inQueue = true;
      ready.push(p);
    } else {
      completion[p.pid] = t;
      done++;
    }
  }

  const out = processes.map((orig) => {
    const c = completion[orig.pid];
    const tat = c - orig.arrival;
    const wt = tat - orig.burst;
    return { ...orig, completion: c, tat, wt };
  });
  return { gantt, processes: out.sort((a, b) => a.pid - b.pid) };
}

/** Preemptive SJF (SRTF). @param {Proc[]} processes */
function scheduleSRTF(processes) {
  const rem = Object.fromEntries(processes.map((p) => [p.pid, p.burst]));
  let t = Math.min(...processes.map((p) => p.arrival));
  /** @type {GanttSeg[]} */
  const gantt = [];
  let completed = 0;
  const n = processes.length;
  /** @type {Record<number, number>} */
  const completion = {};

  while (completed < n) {
    const ready = processes.filter((p) => rem[p.pid] > 0 && p.arrival <= t);
    if (ready.length === 0) {
      const pending = processes.filter((p) => rem[p.pid] > 0);
      if (pending.length === 0) break;
      const nextArr = Math.min(...pending.map((p) => p.arrival));
      if (nextArr > t) gantt.push({ id: 'Idle', start: t, end: nextArr });
      t = nextArr;
      continue;
    }
    ready.sort((a, b) => rem[a.pid] - rem[b.pid] || a.arrival - b.arrival || a.pid - b.pid);
    const p = ready[0];
    const nextArrCandidates = processes.filter(
      (o) => o.arrival > t && o.arrival < t + rem[p.pid] && rem[o.pid] > 0
    );
    if (nextArrCandidates.length > 0) {
      const nextArr = Math.min(...nextArrCandidates.map((o) => o.arrival));
      const slice = nextArr - t;
      gantt.push({ id: `P${p.pid}`, start: t, end: nextArr });
      rem[p.pid] -= slice;
      t = nextArr;
    } else {
      const end = t + rem[p.pid];
      gantt.push({ id: `P${p.pid}`, start: t, end });
      t = end;
      rem[p.pid] = 0;
      completion[p.pid] = t;
      completed++;
    }
  }

  const procs = processes
    .map((p) => ({
      ...p,
      completion: completion[p.pid],
      tat: completion[p.pid] - p.arrival,
      wt: completion[p.pid] - p.arrival - p.burst,
    }))
    .sort((a, b) => a.pid - b.pid);
  return { gantt, processes: procs };
}

/** Preemptive priority: lower priority number = higher priority; preempt on arrival (tie: arrival, PID). */
function schedulePriority_Preemptive(processes) {
  const rem = Object.fromEntries(processes.map((p) => [p.pid, p.burst]));
  let t = Math.min(...processes.map((p) => p.arrival));
  /** @type {GanttSeg[]} */
  const gantt = [];
  let completed = 0;
  const n = processes.length;
  /** @type {Record<number, number>} */
  const completion = {};

  while (completed < n) {
    const ready = processes.filter((p) => rem[p.pid] > 0 && p.arrival <= t);
    if (ready.length === 0) {
      const pending = processes.filter((p) => rem[p.pid] > 0);
      if (pending.length === 0) break;
      const nextArr = Math.min(...pending.map((p) => p.arrival));
      if (nextArr > t) gantt.push({ id: 'Idle', start: t, end: nextArr });
      t = nextArr;
      continue;
    }
    ready.sort((a, b) => a.priority - b.priority || a.arrival - b.arrival || a.pid - b.pid);
    const p = ready[0];
    const nextArrCandidates = processes.filter(
      (o) => o.arrival > t && o.arrival < t + rem[p.pid] && rem[o.pid] > 0
    );
    if (nextArrCandidates.length > 0) {
      const nextArr = Math.min(...nextArrCandidates.map((o) => o.arrival));
      const slice = nextArr - t;
      gantt.push({ id: `P${p.pid}`, start: t, end: nextArr });
      rem[p.pid] -= slice;
      t = nextArr;
    } else {
      const end = t + rem[p.pid];
      gantt.push({ id: `P${p.pid}`, start: t, end });
      t = end;
      rem[p.pid] = 0;
      completion[p.pid] = t;
      completed++;
    }
  }

  const procs = processes
    .map((p) => ({
      ...p,
      completion: completion[p.pid],
      tat: completion[p.pid] - p.arrival,
      wt: completion[p.pid] - p.arrival - p.burst,
    }))
    .sort((a, b) => a.pid - b.pid);
  return { gantt, processes: procs };
}

/** @param {Proc[]} processes @param {string} algo */
function runCPU(processes, algo, quantum) {
  switch (algo) {
    case 'fcfs':
      return scheduleFCFS(processes);
    case 'sjf-np':
      return scheduleSJF_NP(processes);
    case 'sjf-p':
      return scheduleSRTF(processes);
    case 'priority':
      return schedulePriority_NP(processes);
    case 'priority-p':
      return schedulePriority_Preemptive(processes);
    case 'rr':
      return scheduleRR(processes, quantum);
    default:
      return scheduleFCFS(processes);
  }
}

// ---------------------------------------------------------------------------
// Disk scheduling
// ---------------------------------------------------------------------------

/**
 * @param {number[]} path
 * @returns {{ from: number, to: number, dist: number }[]}
 */
function pairwiseSeeks(path) {
  const seeks = [];
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    seeks.push({ from, to, dist: Math.abs(to - from) });
  }
  return seeks;
}

/** @param {number[]} requests @param {number} head */
function diskFCFS(requests, head) {
  const path = [head, ...requests];
  const seeks = pairwiseSeeks(path);
  const total = seeks.reduce((s, x) => s + x.dist, 0);
  return { path, seeks, total };
}

/** @param {number[]} requests @param {number} head */
function diskSSTF(requests, head) {
  const pending = new Set(requests);
  const path = [head];
  let pos = head;
  while (pending.size) {
    let best = null;
    let bestD = Infinity;
    for (const r of pending) {
      const d = Math.abs(r - pos);
      if (d < bestD || (d === bestD && r < best)) {
        bestD = d;
        best = r;
      }
    }
    pending.delete(best);
    path.push(best);
    pos = best;
  }
  const seeks = pairwiseSeeks(path);
  const total = seeks.reduce((s, x) => s + x.dist, 0);
  return { path, seeks, total };
}

/** @param {number[]} requests @param {number} head @param {number} maxCyl @param {boolean} goRight */
function diskSCAN(requests, head, maxCyl, goRight) {
  const left = requests.filter((r) => r < head).sort((a, b) => b - a);
  const right = requests.filter((r) => r >= head).sort((a, b) => a - b);
  /** @type {number[]} */
  const path = [head];
  let pos = head;
  let total = 0;
  function go(to) {
    total += Math.abs(to - pos);
    pos = to;
    path.push(to);
  }
  if (goRight) {
    for (const r of right) go(r);
    if (pos < maxCyl) go(maxCyl);
    for (const r of left) go(r);
  } else {
    for (const r of left) go(r);
    if (pos > 0) go(0);
    for (const r of right) go(r);
  }
  const seeks = pairwiseSeeks(path);
  return { path, seeks, total };
}

/** @param {number[]} requests @param {number} head @param {number} maxCyl @param {boolean} goRight */
function diskCSCAN(requests, head, maxCyl, goRight) {
  const sorted = [...requests].sort((a, b) => a - b);
  const path = [head];
  let pos = head;
  let total = 0;
  /** @type {{ from: number, to: number, dist: number }[]} */
  const seeks = [];
  function move(to) {
    const d = Math.abs(to - pos);
    total += d;
    seeks.push({ from: pos, to, dist: d });
    pos = to;
    path.push(to);
  }
  /** Instant reposition — not counted as seek. */
  function jump(to) {
    pos = to;
    path.push(to);
  }
  if (goRight) {
    const right = sorted.filter((r) => r >= head);
    const left = sorted.filter((r) => r < head);
    for (const r of right) move(r);
    if (pos < maxCyl) move(maxCyl);
    jump(0);
    for (const r of left) move(r);
  } else {
    const left = sorted.filter((r) => r <= head).sort((a, b) => b - a);
    const right = sorted.filter((r) => r > head).sort((a, b) => a - b);
    for (const r of left) move(r);
    if (pos > 0) move(0);
    jump(maxCyl);
    for (const r of right.sort((a, b) => b - a)) move(r);
  }
  return { path, seeks, total };
}

/** @param {number[]} requests @param {number} head @param {boolean} goRight */
function diskLOOK(requests, head, goRight) {
  if (requests.length === 0) return { path: [head], seeks: [], total: 0 };
  const left = requests.filter((r) => r < head).sort((a, b) => b - a);
  const right = requests.filter((r) => r > head).sort((a, b) => a - b);
  const path = [head];
  let pos = head;
  let total = 0;
  function go(to) {
    total += Math.abs(to - pos);
    pos = to;
    path.push(to);
  }
  if (goRight) {
    for (const r of right) go(r);
    for (const r of left) go(r);
  } else {
    for (const r of left) go(r);
    for (const r of right) go(r);
  }
  const seeks = pairwiseSeeks(path);
  return { path, seeks, total };
}

/** @param {number[]} requests @param {number} head @param {boolean} goRight */
function diskCLOOK(requests, head, goRight) {
  if (requests.length === 0) return { path: [head], seeks: [], total: 0 };
  const sorted = [...requests].sort((a, b) => a - b);
  const path = [head];
  let pos = head;
  let total = 0;
  /** @type {{ from: number, to: number, dist: number }[]} */
  const seeks = [];
  function move(to) {
    const d = Math.abs(to - pos);
    total += d;
    seeks.push({ from: pos, to, dist: d });
    pos = to;
    path.push(to);
  }
  function jump(to) {
    pos = to;
    path.push(to);
  }
  if (goRight) {
    const ge = sorted.filter((r) => r >= head);
    const lt = sorted.filter((r) => r < head);
    for (const r of ge) move(r);
    if (lt.length) {
      jump(lt[0]);
      for (let i = 1; i < lt.length; i++) move(lt[i]);
    }
  } else {
    const le = sorted.filter((r) => r <= head).sort((a, b) => b - a);
    const gt = sorted.filter((r) => r > head);
    for (const r of le) move(r);
    if (gt.length) {
      const hi = Math.max(...gt);
      jump(hi);
      const down = [...gt].sort((a, b) => b - a);
      for (const r of down) {
        if (r !== pos) move(r);
      }
    }
  }
  return { path, seeks, total };
}

/** @param {number[]} queue @param {number} head @param {number} maxC @param {string} algo @param {boolean} goRight */
function runDisk(queue, head, maxC, algo, goRight) {
  switch (algo) {
    case 'fcfs':
      return diskFCFS(queue, head);
    case 'sstf':
      return diskSSTF(queue, head);
    case 'scan':
      return diskSCAN(queue, head, maxC, goRight);
    case 'cscan':
      return diskCSCAN(queue, head, maxC, goRight);
    case 'look':
      return diskLOOK(queue, head, goRight);
    case 'clook':
      return diskCLOOK(queue, head, goRight);
    default:
      return diskFCFS(queue, head);
  }
}

// ---------------------------------------------------------------------------
// UI: Gantt & tables (DOM safe)
// ---------------------------------------------------------------------------

const GANTT_PALETTE = [
  '#3b82f6',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];

/**
 * @param {GanttSeg[]} gantt
 * @param {HTMLElement} container
 * @param {HTMLElement} axisEl
 * @param {number} [highlightIndex]
 */
function renderGantt(gantt, container, axisEl, highlightIndex) {
  clearEl(container);
  clearEl(axisEl);
  const total = gantt.length ? Math.max(...gantt.map((g) => g.end)) : 0;
  const scale = total > 0 ? 100 / total : 100;
  gantt.forEach((seg, i) => {
    const div = document.createElement('div');
    div.className = 'gantt-seg';
    const w = (seg.end - seg.start) * scale;
    div.style.flexBasis = `${Math.max(w, 0.5)}%`;
    const pid = seg.id;
    const idx = pid === 'Idle' ? -1 : parseInt(pid.replace(/^P/, ''), 10);
    const colorIdx = Number.isFinite(idx) && idx > 0 ? (idx - 1) % GANTT_PALETTE.length : 0;
    if (pid !== 'Idle') div.style.backgroundColor = GANTT_PALETTE[colorIdx];
    else div.classList.add('idle');
    if (highlightIndex === i) div.classList.add('current-step');
    const label = document.createElement('span');
    label.textContent = pid;
    div.appendChild(label);
    const sub = document.createElement('small');
    sub.style.fontSize = '0.6rem';
    sub.style.opacity = '0.9';
    sub.textContent = `${seg.start}–${seg.end}`;
    div.appendChild(sub);
    container.appendChild(div);
  });
  setText(axisEl, total ? `0 — ${total} time units` : 'Run a simulation to see the timeline.');
}

/** @param {GanttSeg[]} gantt */
function executionOrderFromGantt(gantt) {
  /** @type {string[]} */
  const collapsed = [];
  for (const seg of gantt) {
    if (seg.id === 'Idle') continue;
    if (collapsed[collapsed.length - 1] !== seg.id) collapsed.push(seg.id);
  }
  return collapsed.length ? collapsed.join(' → ') : '—';
}

/** @param {any[]} processes Rows with completion, pid */
function completionOrderFromProcesses(processes) {
  if (!processes.length) return '—';
  return processes
    .slice()
    .sort((a, b) => a.completion - b.completion || a.pid - b.pid)
    .map((p) => `P${p.pid}`)
    .join(' → ');
}

/**
 * @param {HTMLElement} tbody
 * @param {any[]} rows
 * @param {boolean} showPriority
 */
function renderCPUTable(tbody, rows, showPriority) {
  clearEl(tbody);
  const keys = showPriority
    ? ['pid', 'arrival', 'burst', 'priority', 'completion', 'tat', 'wt']
    : ['pid', 'arrival', 'burst', 'completion', 'tat', 'wt'];
  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const key of keys) {
      const td = document.createElement('td');
      td.textContent = String(r[key]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

/**
 * @param {HTMLElement} el
 * @param {any[]} processes
 * @param {number} avgTat
 * @param {number} avgWt
 */
function renderCPUMetrics(el, processes, avgTat, avgWt) {
  clearEl(el);
  const sumTat = processes.reduce((s, p) => s + p.tat, 0);
  const sumWt = processes.reduce((s, p) => s + p.wt, 0);
  const lines = [
    { label: 'Average turnaround time (TAT)', value: avgTat.toFixed(2) },
    { label: 'Average waiting time (WT)', value: avgWt.toFixed(2) },
    { label: 'Sum of TAT (all processes)', value: String(sumTat) },
    { label: 'Sum of WT (all processes)', value: String(sumWt) },
  ];
  for (const row of lines) {
    const p = document.createElement('p');
    p.className = 'metric-row';
    const lab = document.createElement('span');
    lab.className = 'metric-label';
    lab.textContent = row.label + ': ';
    const val = document.createElement('strong');
    val.textContent = row.value;
    p.appendChild(lab);
    p.appendChild(val);
    el.appendChild(p);
  }
}

/**
 * @param {GanttSeg[]} gantt
 * @param {any[]} processes
 * @param {HTMLElement} block
 * @param {HTMLElement} execEl
 * @param {HTMLElement} completeEl
 */
function renderCPUOrderBlock(gantt, processes, block, execEl, completeEl) {
  block.hidden = false;
  setText(execEl, executionOrderFromGantt(gantt));
  setText(completeEl, completionOrderFromProcesses(processes));
}

/**
 * Disk head graph: X = visit step, Y = cylinder (0 … disk max).
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} path
 * @param {{ from: number, to: number, dist: number }[]} seeks Physical seeks only (in order).
 * @param {number} diskMaxCyl User-configured max cylinder (full disk scale).
 * @param {HTMLElement | null} captionEl
 */
function drawDiskChart(canvas, path, seeks, diskMaxCyl, captionEl) {
  const ctx = canvas.getContext('2d');
  if (!ctx || path.length < 1) return;

  const root = document.documentElement;
  const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#2563eb';
  const border = getComputedStyle(root).getPropertyValue('--border').trim() || '#ccc';
  const text = getComputedStyle(root).getPropertyValue('--text').trim() || '#111';
  const muted = getComputedStyle(root).getPropertyValue('--text-muted').trim() || '#666';
  const elevated = getComputedStyle(root).getPropertyValue('--bg-elevated').trim() || '#fff';
  const jumpColor = '#c026d3';
  const startFill = '#059669';

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.max(canvas.clientWidth || 920, 320);
  const cssH = 400;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.imageSmoothingEnabled = true;

  const padL = 58;
  const padR = 22;
  const padT = 44;
  const padB = 62;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  const yMin = 0;
  const maxCInput =
    typeof diskMaxCyl === 'number' && Number.isFinite(diskMaxCyl) && diskMaxCyl > 0 ? diskMaxCyl : 0;
  const yMax = Math.max(maxCInput, ...path, 1);
  const ySpan = yMax - yMin || 1;
  const n = path.length;

  const xFor = (i) => padL + (i / Math.max(n - 1, 1)) * plotW;
  const yFor = (c) => padT + (1 - (c - yMin) / ySpan) * plotH;

  const seekList = Array.isArray(seeks) ? seeks : [];

  function niceGridStep(maxVal) {
    if (maxVal <= 10) return 2;
    if (maxVal <= 50) return 5;
    if (maxVal <= 200) return 20;
    if (maxVal <= 500) return 50;
    return Math.ceil(maxVal / 10 / 5) * 5;
  }

  const gridStep = niceGridStep(yMax);

  ctx.fillStyle = elevated;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  roundRect(ctx, padL - 6, padT - 6, plotW + 12, plotH + 12, 8);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.45;
  for (let g = 0; g <= yMax; g += gridStep) {
    const y = yFor(g);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.stroke();

  ctx.fillStyle = muted;
  ctx.font = '600 11px system-ui, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Visit step (order of head positions)', padL + plotW / 2, cssH - 18);

  ctx.save();
  ctx.translate(16, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Cylinder # (track)', 0, 0);
  ctx.restore();

  ctx.textAlign = 'right';
  ctx.font = '10px ui-monospace, Consolas, monospace';
  for (let g = 0; g <= yMax; g += gridStep) {
    const y = yFor(g);
    ctx.fillText(String(g), padL - 10, y + 4);
  }

  ctx.textAlign = 'center';
  ctx.font = '9px ui-monospace, Consolas, monospace';
  const stepEvery = n > 36 ? 3 : n > 20 ? 2 : 1;
  for (let i = 0; i < n; i += stepEvery) {
    ctx.fillText(String(i), xFor(i), padT + plotH + 17);
  }

  let seekIdx = 0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < path.length; i++) {
    const c0 = path[i - 1];
    const c1 = path[i];
    if (c0 === c1) continue;
    const x0 = xFor(i - 1);
    const y0 = yFor(c0);
    const x1 = xFor(i);
    const y1 = yFor(c1);
    const sk = seekList[seekIdx];
    const physical = sk && sk.from === c0 && sk.to === c1;

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    if (physical) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.stroke();
      seekIdx++;
    } else {
      ctx.strokeStyle = jumpColor;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      ctx.fillStyle = jumpColor;
      ctx.font = '600 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('jump', mx, my - 8);
    }
  }

  path.forEach((cyl, i) => {
    const x = xFor(i);
    const y = yFor(cyl);
    const r = i === 0 ? 8 : 7;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? startFill : elevated;
    ctx.fill();
    ctx.strokeStyle = i === 0 ? startFill : accent;
    ctx.lineWidth = i === 0 ? 3 : 2;
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.font = '600 10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    const above = i % 2 === 0;
    ctx.fillText(String(cyl), x, above ? y - r - 6 : y + r + 14);

    ctx.fillStyle = muted;
    ctx.font = '600 9px system-ui, sans-serif';
    if (i === 0) ctx.fillText('START', x, above ? y + r + 16 : y - r - 18);
    else ctx.fillText(`#${i}`, x, above ? y + r + 16 : y - r - 18);
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = muted;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText(`Cylinder scale: 0 … ${yMax}`, padL, padT - 22);

  const legY = padT + 12;
  const legR = padL + plotW - 8;
  ctx.textAlign = 'right';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(legR - 118, legY);
  ctx.lineTo(legR - 78, legY);
  ctx.stroke();
  ctx.fillStyle = text;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('Seek', legR - 72, legY + 4);

  ctx.strokeStyle = jumpColor;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(legR - 48, legY);
  ctx.lineTo(legR - 8, legY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillText('Jump', legR - 2, legY + 4);

  if (captionEl) {
    const jumps = Math.max(0, n - 1 - seekList.length);
    setText(
      captionEl,
      `${n} positions · ${seekList.length} physical seek${seekList.length === 1 ? '' : 's'}${jumps ? ` · ${jumps} jump${jumps === 1 ? '' : 's'}` : ''}`
    );
  }
}

/** @param {CanvasRenderingContext2D} ctx */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Banker's algorithm (safety check)
// ---------------------------------------------------------------------------

/** Classic textbook 5×3 snapshot (safe state). */
const BANKER_EXAMPLE_5x3 = {
  max: [
    [7, 5, 3],
    [3, 2, 2],
    [9, 0, 2],
    [2, 2, 2],
    [4, 3, 3],
  ],
  alloc: [
    [0, 1, 0],
    [2, 0, 0],
    [3, 0, 2],
    [2, 1, 1],
    [0, 0, 2],
  ],
  avail: [3, 3, 2],
};

/**
 * @param {number[][]} alloc
 * @param {number[][]} max
 * @param {number[]} available
 */
function bankersSafety(alloc, max, available) {
  const n = alloc.length;
  if (n === 0 || !alloc[0]) return { ok: false, error: 'Matrices are empty.' };
  const m = alloc[0].length;
  if (available.length !== m) return { ok: false, error: 'Available vector length must equal resource types (m).' };
  for (let i = 0; i < n; i++) {
    if (!alloc[i] || alloc[i].length !== m || !max[i] || max[i].length !== m) {
      return { ok: false, error: 'Allocation and Max must be n×m matrices.' };
    }
  }

  const need = alloc.map((row, i) => row.map((_, j) => max[i][j] - alloc[i][j]));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (need[i][j] < 0) {
        return { ok: false, error: `P${i}: allocation exceeds maximum (column ${j}).` };
      }
    }
  }

  const work = [...available];
  const finish = new Array(n).fill(false);
  const sequence = [];
  /** @type {any[]} */
  const trace = [];
  trace.push({
    type: 'init',
    work: [...work],
    finish: [...finish],
    need: need.map((r) => [...r]),
  });

  while (sequence.length < n) {
    let found = -1;
    for (let i = 0; i < n; i++) {
      if (!finish[i] && need[i].every((nj, j) => nj <= work[j])) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      trace.push({
        type: 'blocked',
        work: [...work],
        finish: [...finish],
        need: need.map((r) => [...r]),
      });
      return { ok: true, safe: false, sequence: null, need, trace };
    }
    const workBefore = [...work];
    for (let j = 0; j < m; j++) work[j] += alloc[found][j];
    finish[found] = true;
    sequence.push(found);
    trace.push({
      type: 'release',
      process: found,
      workBefore,
      workAfter: [...work],
      finish: [...finish],
      sequence: [...sequence],
    });
  }
  return { ok: true, safe: true, sequence, need, trace };
}

/**
 * @param {number[][]} alloc
 * @param {number[][]} max
 * @param {number[]} available
 * @param {number} pi
 * @param {number[]} request
 */
function bankersRequestGrantSafe(alloc, max, available, pi, request) {
  const n = alloc.length;
  const m = alloc[0].length;
  if (pi < 0 || pi >= n) return { ok: false, error: 'Invalid process index.' };
  if (request.length !== m) return { ok: false, error: 'Request vector length must equal m.' };
  const need = alloc.map((row, i) => row.map((_, j) => max[i][j] - alloc[i][j]));
  for (let j = 0; j < m; j++) {
    if (request[j] < 0 || request[j] > LIMITS.bankMaxCell) return { ok: false, error: 'Request values must be valid non-negative integers.' };
    if (request[j] > need[pi][j]) return { ok: false, error: `Request exceeds remaining need for P${pi} (column ${j}).` };
    if (request[j] > available[j]) return { ok: false, error: `Not enough available resources (column ${j}).` };
  }
  const newAlloc = alloc.map((row) => [...row]);
  const newAvail = [...available];
  for (let j = 0; j < m; j++) {
    newAlloc[pi][j] += request[j];
    newAvail[j] -= request[j];
  }
  const res = bankersSafety(newAlloc, max, newAvail);
  if (!res.ok) return res;
  return { ok: true, safe: res.safe, sequence: res.sequence, need: res.need, trace: res.trace, hypothetical: true };
}

/** @param {any} step */
function formatBankerTraceLine(step) {
  if (step.type === 'init') {
    return `Start: Work = [${step.work.join(', ')}], Finish = [${step.finish.map((f) => (f ? 'T' : 'F')).join(', ')}]. Compare each unfinished process: Need ≤ Work?`;
  }
  if (step.type === 'blocked') {
    return `No unfinished process has Need ≤ Work. The state is UNSAFE — deadlock is possible if all hold and wait.`;
  }
  if (step.type === 'release') {
    const seq = step.sequence.map((p) => `P${p}`).join(' → ');
    return `Choose P${step.process} (smallest index among those with Need ≤ Work). Assume it runs to completion and releases its allocation: Work [${step.workBefore.join(', ')}] → [${step.workAfter.join(', ')}]. Order so far: ${seq}.`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// localStorage (schema-validated)
// ---------------------------------------------------------------------------

function safeStorageGet() {
  try {
    const raw = localStorage.getItem(LIMITS.storageKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== LIMITS.storageVersion) return null;
    return data;
  } catch {
    return null;
  }
}

function safeStorageSet(payload) {
  try {
    localStorage.setItem(LIMITS.storageKey, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// App state & elements
// ---------------------------------------------------------------------------
const els = {
  tabCpu: document.getElementById('tab-cpu'),
  tabDisk: document.getElementById('tab-disk'),
  tabBanker: document.getElementById('tab-banker'),
  panelCpu: document.getElementById('panel-cpu'),
  panelDisk: document.getElementById('panel-disk'),
  panelBanker: document.getElementById('panel-banker'),
  btnTheme: document.getElementById('btn-theme'),
  formCpu: document.getElementById('form-cpu'),
  cpuN: document.getElementById('cpu-n'),
  cpuAlgo: document.getElementById('cpu-algo'),
  cpuQuantum: document.getElementById('cpu-quantum'),
  cpuQuantumWrap: document.getElementById('cpu-quantum-wrap'),
  cpuProcessFields: document.getElementById('cpu-process-fields'),
  cpuError: document.getElementById('cpu-error'),
  cpuRun: document.getElementById('cpu-run'),
  cpuStep: document.getElementById('cpu-step'),
  cpuReset: document.getElementById('cpu-reset'),
  cpuGantt: document.getElementById('cpu-gantt'),
  cpuGanttAxis: document.getElementById('cpu-gantt-axis'),
  cpuTbody: document.getElementById('cpu-tbody'),
  cpuMetrics: document.getElementById('cpu-metrics'),
  cpuOrderBlock: document.getElementById('cpu-order-block'),
  cpuExecOrder: document.getElementById('cpu-exec-order'),
  cpuCompleteOrder: document.getElementById('cpu-complete-order'),
  cpuStepHint: document.getElementById('cpu-step-hint'),
  cpuCompareBtn: document.getElementById('cpu-compare-btn'),
  cpuCompareOut: document.getElementById('cpu-compare-out'),
  cpuSave: document.getElementById('cpu-save'),
  cpuLoad: document.getElementById('cpu-load'),
  cpuExport: document.getElementById('cpu-export-print'),
  formDisk: document.getElementById('form-disk'),
  diskAlgo: document.getElementById('disk-algo'),
  diskQueue: document.getElementById('disk-queue'),
  diskHead: document.getElementById('disk-head'),
  diskMax: document.getElementById('disk-max'),
  diskDir: document.getElementById('disk-dir'),
  diskError: document.getElementById('disk-error'),
  diskRun: document.getElementById('disk-run'),
  diskStep: document.getElementById('disk-step'),
  diskReset: document.getElementById('disk-reset'),
  diskSequence: document.getElementById('disk-sequence'),
  diskTotal: document.getElementById('disk-total'),
  diskVisitOrder: document.getElementById('disk-visit-order'),
  diskSeekHighlight: document.getElementById('disk-seek-highlight'),
  diskTotalSeek: document.getElementById('disk-total-seek'),
  diskAvgSeek: document.getElementById('disk-avg-seek'),
  diskChartCaption: document.getElementById('disk-chart-caption'),
  diskCanvas: /** @type {HTMLCanvasElement} */ (document.getElementById('disk-canvas')),
  diskCompareBtn: document.getElementById('disk-compare-btn'),
  diskCompareOut: document.getElementById('disk-compare-out'),
  diskSave: document.getElementById('disk-save'),
  diskLoad: document.getElementById('disk-load'),
  diskExport: document.getElementById('disk-export-print'),
  printRoot: document.getElementById('print-root'),
  bankN: document.getElementById('bank-n'),
  bankM: document.getElementById('bank-m'),
  formBankerSize: document.getElementById('form-banker-size'),
  bankApplySize: document.getElementById('bank-apply-size'),
  bankLoadExample: document.getElementById('bank-load-example'),
  bankMatrixWrap: document.getElementById('banker-matrix-wrap'),
  bankRun: document.getElementById('bank-run'),
  bankStep: document.getElementById('bank-step'),
  bankReset: document.getElementById('bank-reset'),
  bankStepHint: document.getElementById('bank-step-hint'),
  bankerError: document.getElementById('banker-error'),
  bankerBanner: document.getElementById('banker-banner'),
  bankerNeedHead: document.getElementById('banker-need-head'),
  bankerNeedBody: document.getElementById('banker-need-body'),
  bankerRuntime: document.getElementById('banker-runtime'),
  bankerTrace: document.getElementById('banker-trace'),
  formBankerRequest: document.getElementById('form-banker-request'),
  bankReqP: document.getElementById('bank-req-p'),
  bankReqVec: document.getElementById('bank-req-vec'),
};

/** @type {{ gantt: GanttSeg[], processes: any[], algo: string, stepIdx: number } | null} */
let cpuState = null;
/** @type {{ path: number[], seeks: any[], total: number, stepIdx: number, algo: string, maxCyl: number } | null} */
let diskState = null;
/** @type {{ trace: any[], stepIdx: number, safe: boolean, sequence: number[] | null } | null} */
let bankState = null;

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('dcps_theme', theme);
  } catch {
    /* ignore */
  }
}

function initTheme() {
  let t = 'light';
  try {
    t = localStorage.getItem('dcps_theme') || 'light';
  } catch {
    t = 'light';
  }
  if (t !== 'light' && t !== 'dark') t = 'light';
  applyTheme(t);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

function switchTab(name) {
  const isCpu = name === 'cpu';
  const isDisk = name === 'disk';
  const isBank = name === 'banker';
  els.panelCpu.hidden = !isCpu;
  els.panelDisk.hidden = !isDisk;
  els.panelBanker.hidden = !isBank;
  els.panelCpu.classList.toggle('active', isCpu);
  els.panelDisk.classList.toggle('active', isDisk);
  els.panelBanker.classList.toggle('active', isBank);
  els.tabCpu.classList.toggle('active', isCpu);
  els.tabDisk.classList.toggle('active', isDisk);
  els.tabBanker.classList.toggle('active', isBank);
  els.tabCpu.setAttribute('aria-selected', String(isCpu));
  els.tabDisk.setAttribute('aria-selected', String(isDisk));
  els.tabBanker.setAttribute('aria-selected', String(isBank));
}

/** @param {string} algo */
function cpuAlgoNeedsPriority(algo) {
  return algo === 'priority' || algo === 'priority-p';
}

/**
 * Sync visible fields: main algorithm + compare checkboxes can require priority / quantum.
 */
function syncCpuFormUi() {
  const algo = els.cpuAlgo.value;
  const comparePri = Array.from(document.querySelectorAll('input[name="cpu-compare"]:checked')).some(
    (cb) => cb.value === 'priority' || cb.value === 'priority-p'
  );
  const compareQ = Array.from(document.querySelectorAll('input[name="cpu-compare"]:checked')).some(
    (cb) => cb.value === 'rr'
  );

  const showPri = cpuAlgoNeedsPriority(algo) || comparePri;
  const showQ = algo === 'rr' || compareQ;

  if (els.cpuQuantumWrap) {
    els.cpuQuantumWrap.hidden = !showQ;
    els.cpuQuantum.setAttribute('aria-required', showQ ? 'true' : 'false');
  }

  els.cpuProcessFields.querySelectorAll('.proc-field-priority').forEach((el) => {
    el.hidden = !showPri;
  });

  const thPri = document.getElementById('cpu-th-priority');
  if (thPri) thPri.hidden = !showPri;
}

function buildCpuProcessInputs(n) {
  clearEl(els.cpuProcessFields);
  for (let i = 1; i <= n; i++) {
    const row = document.createElement('div');
    row.className = 'proc-row';
    row.innerHTML = `
      <label>PID ${i}<input type="number" data-pid="${i}" value="${i}" readonly class="pid-input" /></label>
      <label>Arrival<input type="number" data-field="arrival" data-pid="${i}" min="0" max="${LIMITS.maxArrival}" value="0" inputmode="numeric" autocomplete="off" /></label>
      <label>Burst<input type="number" data-field="burst" data-pid="${i}" min="1" max="${LIMITS.maxBurst}" value="${3 + i}" inputmode="numeric" autocomplete="off" /></label>
      <label class="proc-field-priority">Priority<input type="number" data-field="priority" data-pid="${i}" min="0" max="${LIMITS.maxPriority}" value="${i}" inputmode="numeric" autocomplete="off" /></label>
    `;
    els.cpuProcessFields.appendChild(row);
  }
  syncCpuFormUi();
}

/**
 * @param {{ forCompare?: boolean }} [opts]
 * @returns {{ ok: true, processes: Proc[], quantum: number } | { ok: false, error: string }}
 */
function readCpuInputs(opts) {
  const forCompare = Boolean(opts && opts.forCompare);
  const algo = els.cpuAlgo.value;

  const needsQuantum = forCompare
    ? Array.from(document.querySelectorAll('input[name="cpu-compare"]:checked')).some((cb) => cb.value === 'rr')
    : algo === 'rr';

  const needsPriority = forCompare
    ? Array.from(document.querySelectorAll('input[name="cpu-compare"]:checked')).some(
        (cb) => cb.value === 'priority' || cb.value === 'priority-p'
      )
    : cpuAlgoNeedsPriority(algo);

  const nRes = parseBoundedInt(els.cpuN.value, LIMITS.minProcesses, LIMITS.maxProcesses);
  if (!nRes.ok) return { ok: false, error: nRes.error };
  const n = nRes.value;
  /** @type {Proc[]} */
  const processes = [];
  for (let i = 1; i <= n; i++) {
    const aEl = els.cpuProcessFields.querySelector(`[data-field="arrival"][data-pid="${i}"]`);
    const bEl = els.cpuProcessFields.querySelector(`[data-field="burst"][data-pid="${i}"]`);
    const pEl = els.cpuProcessFields.querySelector(`[data-field="priority"][data-pid="${i}"]`);
    if (!aEl || !bEl) return { ok: false, error: 'Process fields are out of sync. Reset and try again.' };
    const a = parseBoundedInt(aEl.value, 0, LIMITS.maxArrival);
    if (!a.ok) return { ok: false, error: `Process ${i}: ${a.error}` };
    const b = parseBoundedInt(bEl.value, 1, LIMITS.maxBurst);
    if (!b.ok) return { ok: false, error: `Process ${i}: ${b.error}` };

    let priority = 0;
    if (needsPriority) {
      if (!pEl) return { ok: false, error: 'Priority inputs missing. Apply process count again.' };
      const pr = parseBoundedInt(pEl.value, 0, LIMITS.maxPriority);
      if (!pr.ok) return { ok: false, error: `Process ${i}: ${pr.error}` };
      priority = pr.value;
    }

    processes.push({ pid: i, arrival: a.value, burst: b.value, priority });
  }

  let quantum = 1;
  if (needsQuantum) {
    const raw = String(els.cpuQuantum.value ?? '').trim();
    if (raw === '') {
      return { ok: false, error: 'Time quantum is required for Round Robin (enter a positive integer).' };
    }
    const qRes = parseBoundedInt(raw, LIMITS.minQuantum, LIMITS.maxQuantum);
    if (!qRes.ok) return { ok: false, error: `Time quantum: ${qRes.error}` };
    quantum = qRes.value;
  }

  const maxEnd =
    processes.reduce((s, p) => s + p.burst, 0) + Math.max(0, ...processes.map((p) => p.arrival));
  if (maxEnd > LIMITS.maxTime) return { ok: false, error: 'Combined workload is too large for safe simulation in-browser.' };
  return { ok: true, processes, quantum };
}

function showCpuError(msg) {
  if (msg) {
    els.cpuError.hidden = false;
    setText(els.cpuError, msg);
  } else {
    els.cpuError.hidden = true;
    setText(els.cpuError, '');
  }
}

function runCpuSimulation() {
  showCpuError('');
  const rd = readCpuInputs();
  if (!rd.ok) {
    showCpuError(rd.error);
    return;
  }
  const algo = els.cpuAlgo.value;
  const res = runCPU(rd.processes, algo, rd.quantum);
  cpuState = { gantt: res.gantt, processes: res.processes, algo, stepIdx: -1 };
  els.cpuStepHint.hidden = false;
  renderGantt(res.gantt, els.cpuGantt, els.cpuGanttAxis, undefined);
  renderCPUTable(els.cpuTbody, res.processes, cpuAlgoNeedsPriority(algo));
  const avgTat = res.processes.reduce((s, p) => s + p.tat, 0) / res.processes.length;
  const avgWt = res.processes.reduce((s, p) => s + p.wt, 0) / res.processes.length;
  renderCPUMetrics(els.cpuMetrics, res.processes, avgTat, avgWt);
  renderCPUOrderBlock(res.gantt, res.processes, els.cpuOrderBlock, els.cpuExecOrder, els.cpuCompleteOrder);
}

function cpuStep() {
  if (!cpuState || !cpuState.gantt.length) {
    showCpuError('Run a simulation first.');
    return;
  }
  cpuState.stepIdx = (cpuState.stepIdx + 1) % cpuState.gantt.length;
  renderGantt(cpuState.gantt, els.cpuGantt, els.cpuGanttAxis, cpuState.stepIdx);
}

function readDiskInputs() {
  const q = parseDiskQueue(els.diskQueue.value);
  if (!q.ok) return { ok: false, error: q.error };
  const head = parseBoundedInt(els.diskHead.value, 0, LIMITS.maxCylinder);
  if (!head.ok) return { ok: false, error: head.error };
  const maxC = parseBoundedInt(els.diskMax.value, 1, LIMITS.maxCylinder);
  if (!maxC.ok) return { ok: false, error: maxC.error };
  for (const r of q.value) {
    if (r > maxC.value) return { ok: false, error: 'A request exceeds max cylinder.' };
  }
  return { ok: true, queue: q.value, head: head.value, maxC: maxC.value, goRight: els.diskDir.value === 'right' };
}

function showDiskError(msg) {
  if (msg) {
    els.diskError.hidden = false;
    setText(els.diskError, msg);
  } else {
    els.diskError.hidden = true;
    setText(els.diskError, '');
  }
}

function renderDiskSequence(seeks, highlightStep) {
  clearEl(els.diskSequence);
  seeks.forEach((s, i) => {
    const li = document.createElement('li');
    if (i === highlightStep) li.classList.add('current-step');
    li.textContent = `${s.from} → ${s.to}  (${s.dist} seeks)`;
    els.diskSequence.appendChild(li);
  });
}

/**
 * @param {number[]} path
 * @param {number} total
 * @param {{ dist: number }[]} seeks
 */
function renderDiskResultSummary(path, total, seeks) {
  const orderText = path.length ? path.join(' → ') : '—';
  setText(els.diskVisitOrder, `Cylinder visit order (head path): ${orderText}`);
  els.diskSeekHighlight.hidden = false;
  setText(els.diskTotalSeek, String(total));
  const n = seeks.length;
  const avg = n > 0 ? total / n : 0;
  setText(
    els.diskAvgSeek,
    n > 0
      ? `Average seek per movement: ${avg.toFixed(2)} (${n} physical movement${n === 1 ? '' : 's'})`
      : 'No movements.'
  );
  els.diskTotal.hidden = true;
}

function runDiskSimulation() {
  showDiskError('');
  const rd = readDiskInputs();
  if (!rd.ok) {
    showDiskError(rd.error);
    return;
  }
  const algo = els.diskAlgo.value;
  const res = runDisk(rd.queue, rd.head, rd.maxC, algo, rd.goRight);
  diskState = {
    path: res.path,
    seeks: res.seeks,
    total: res.total,
    stepIdx: -1,
    algo,
    maxCyl: rd.maxC,
  };
  renderDiskSequence(res.seeks, -1);
  renderDiskResultSummary(res.path, res.total, res.seeks);
  drawDiskChart(els.diskCanvas, res.path, res.seeks, rd.maxC, els.diskChartCaption);
}

function diskStep() {
  if (!diskState || !diskState.seeks.length) {
    showDiskError('Run disk simulation first.');
    return;
  }
  diskState.stepIdx = (diskState.stepIdx + 1) % diskState.seeks.length;
  renderDiskSequence(diskState.seeks, diskState.stepIdx);
}

function cpuCompare() {
  showCpuError('');
  const rd = readCpuInputs({ forCompare: true });
  if (!rd.ok) {
    showCpuError(rd.error);
    return;
  }
  const boxes = document.querySelectorAll('input[name="cpu-compare"]:checked');
  if (!boxes.length) {
    showCpuError('Select at least one algorithm to compare.');
    return;
  }
  clearEl(els.cpuCompareOut);
  const table = document.createElement('table');
  table.className = 'compare-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Algorithm</th><th>Avg TAT</th><th>Avg WT</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  boxes.forEach((cb) => {
    const algo = cb.value;
    const res = runCPU(rd.processes, algo, rd.quantum);
    const avgTat = res.processes.reduce((s, p) => s + p.tat, 0) / res.processes.length;
    const avgWt = res.processes.reduce((s, p) => s + p.wt, 0) / res.processes.length;
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = algo;
    const td2 = document.createElement('td');
    td2.textContent = avgTat.toFixed(2);
    const td3 = document.createElement('td');
    td3.textContent = avgWt.toFixed(2);
    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  els.cpuCompareOut.appendChild(table);
}

function diskCompareAll() {
  showDiskError('');
  const rd = readDiskInputs();
  if (!rd.ok) {
    showDiskError(rd.error);
    return;
  }
  clearEl(els.diskCompareOut);
  const algos = ['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook'];
  const table = document.createElement('table');
  table.className = 'compare-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Algorithm</th><th>Total seek</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const a of algos) {
    const res = runDisk(rd.queue, rd.head, rd.maxC, a, rd.goRight);
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = a;
    const td2 = document.createElement('td');
    td2.textContent = String(res.total);
    tr.appendChild(td1);
    tr.appendChild(td2);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  els.diskCompareOut.appendChild(table);
}

function saveCpu() {
  const rd = readCpuInputs();
  if (!rd.ok) {
    showCpuError(rd.error);
    return;
  }
  const prev = safeStorageGet() || { v: LIMITS.storageVersion };
  prev.cpu = {
    algo: els.cpuAlgo.value,
    n: rd.processes.length,
    quantum: rd.quantum,
    rows: rd.processes.map((p) => ({
      pid: p.pid,
      arrival: p.arrival,
      burst: p.burst,
      priority: p.priority,
    })),
  };
  prev.v = LIMITS.storageVersion;
  if (safeStorageSet(prev)) alert('CPU configuration saved locally.');
  else alert('Could not save (storage full or disabled).');
}

function loadCpu() {
  const data = safeStorageGet();
  if (!data || !data.cpu || !Array.isArray(data.cpu.rows)) {
    showCpuError('No saved CPU data.');
    return;
  }
  const rows = data.cpu.rows;
  const n = Math.min(Math.max(rows.length, 1), LIMITS.maxProcesses);
  els.cpuN.value = String(n);
  buildCpuProcessInputs(n);
  els.cpuAlgo.value = ['fcfs', 'sjf-np', 'sjf-p', 'priority', 'priority-p', 'rr'].includes(data.cpu.algo)
    ? data.cpu.algo
    : 'fcfs';
  if (isSafeInt(data.cpu.quantum)) els.cpuQuantum.value = String(data.cpu.quantum);
  else els.cpuQuantum.value = '';
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    if (!r || !isSafeInt(r.arrival) || !isSafeInt(r.burst)) continue;
    const aEl = els.cpuProcessFields.querySelector(`[data-field="arrival"][data-pid="${i + 1}"]`);
    const bEl = els.cpuProcessFields.querySelector(`[data-field="burst"][data-pid="${i + 1}"]`);
    const pEl = els.cpuProcessFields.querySelector(`[data-field="priority"][data-pid="${i + 1}"]`);
    if (aEl) aEl.value = String(Math.min(r.arrival, LIMITS.maxArrival));
    if (bEl) bEl.value = String(Math.min(Math.max(r.burst, 1), LIMITS.maxBurst));
    if (pEl && isSafeInt(r.priority)) pEl.value = String(Math.min(r.priority, LIMITS.maxPriority));
  }
  showCpuError('');
  syncCpuFormUi();
}

function saveDisk() {
  const rd = readDiskInputs();
  if (!rd.ok) {
    showDiskError(rd.error);
    return;
  }
  const prev = safeStorageGet() || { v: LIMITS.storageVersion };
  prev.disk = {
    algo: els.diskAlgo.value,
    queue: rd.queue.join(', '),
    head: rd.head,
    max: rd.maxC,
    dir: els.diskDir.value,
  };
  prev.v = LIMITS.storageVersion;
  if (safeStorageSet(prev)) alert('Disk configuration saved locally.');
  else alert('Could not save (storage full or disabled).');
}

function loadDisk() {
  const data = safeStorageGet();
  if (!data || !data.disk) {
    showDiskError('No saved disk data.');
    return;
  }
  const d = data.disk;
  if (typeof d.queue === 'string' && d.queue.length <= LIMITS.maxQueueStringLen) els.diskQueue.value = d.queue;
  if (isSafeInt(d.head)) els.diskHead.value = String(Math.min(d.head, LIMITS.maxCylinder));
  if (isSafeInt(d.max)) els.diskMax.value = String(Math.min(Math.max(d.max, 1), LIMITS.maxCylinder));
  if (d.dir === 'left' || d.dir === 'right') els.diskDir.value = d.dir;
  if (['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook'].includes(d.algo)) els.diskAlgo.value = d.algo;
  showDiskError('');
}

function printReport(kind) {
  clearEl(els.printRoot);
  const wrap = document.createElement('div');
  const h = document.createElement('h1');
  h.textContent = 'DCPS Scheduling Simulator — Report';
  wrap.appendChild(h);
  const p = document.createElement('p');
  p.textContent = new Date().toISOString();
  wrap.appendChild(p);
  if (kind === 'cpu' && cpuState) {
    const h2 = document.createElement('h2');
    h2.textContent = `CPU — ${cpuState.algo}`;
    wrap.appendChild(h2);
    const ord1 = document.createElement('p');
    ord1.textContent = `Execution order: ${executionOrderFromGantt(cpuState.gantt)}`;
    wrap.appendChild(ord1);
    const ord2 = document.createElement('p');
    ord2.textContent = `Completion order: ${completionOrderFromProcesses(cpuState.processes)}`;
    wrap.appendChild(ord2);
    const avgTat =
      cpuState.processes.reduce((s, p) => s + p.tat, 0) / cpuState.processes.length;
    const avgWt =
      cpuState.processes.reduce((s, p) => s + p.wt, 0) / cpuState.processes.length;
    const av = document.createElement('p');
    av.textContent = `Average TAT: ${avgTat.toFixed(2)}  Average WT: ${avgWt.toFixed(2)}`;
    wrap.appendChild(av);
    cpuState.processes.forEach((r) => {
      const line = document.createElement('p');
      line.textContent = `P${r.pid} AT=${r.arrival} BT=${r.burst} Pri=${r.priority} CT=${r.completion} TAT=${r.tat} WT=${r.wt}`;
      wrap.appendChild(line);
    });
  } else if (kind === 'disk' && diskState) {
    const h2 = document.createElement('h2');
    h2.textContent = `Disk — ${diskState.algo}`;
    wrap.appendChild(h2);
    const path = document.createElement('p');
    path.textContent = `Cylinder visit order: ${diskState.path.join(' → ')}`;
    wrap.appendChild(path);
    const tot = document.createElement('p');
    tot.textContent = `Total seek time: ${diskState.total}`;
    wrap.appendChild(tot);
    const n = diskState.seeks.length;
    if (n > 0) {
      const avg = document.createElement('p');
      avg.textContent = `Average seek per movement: ${(diskState.total / n).toFixed(2)} (${n} moves)`;
      wrap.appendChild(avg);
    }
  } else {
    const note = document.createElement('p');
    note.textContent = 'Run a simulation in this tab first, then print.';
    wrap.appendChild(note);
  }
  els.printRoot.appendChild(wrap);
  window.print();
}

function resetCpuView() {
  cpuState = null;
  els.cpuStepHint.hidden = true;
  els.cpuOrderBlock.hidden = true;
  setText(els.cpuExecOrder, '');
  setText(els.cpuCompleteOrder, '');
  clearEl(els.cpuGantt);
  clearEl(els.cpuGanttAxis);
  setText(els.cpuGanttAxis, '');
  clearEl(els.cpuTbody);
  clearEl(els.cpuMetrics);
  showCpuError('');
}

function resetDiskView() {
  diskState = null;
  clearEl(els.diskSequence);
  setText(els.diskVisitOrder, '');
  els.diskSeekHighlight.hidden = true;
  setText(els.diskTotalSeek, '');
  setText(els.diskAvgSeek, '');
  setText(els.diskTotal, '');
  els.diskTotal.hidden = true;
  setText(els.diskChartCaption, '');
  const ctx = els.diskCanvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, els.diskCanvas.width, els.diskCanvas.height);
  showDiskError('');
}

function onCpuNChange() {
  const nRes = parseBoundedInt(els.cpuN.value, LIMITS.minProcesses, LIMITS.maxProcesses);
  const n = nRes.ok ? nRes.value : LIMITS.minProcesses;
  els.cpuN.value = String(n);
  buildCpuProcessInputs(n);
}

// --- Banker's UI ---

function showBankerError(msg) {
  if (msg) {
    els.bankerError.hidden = false;
    setText(els.bankerError, msg);
  } else {
    els.bankerError.hidden = true;
    setText(els.bankerError, '');
  }
}

/**
 * @param {number} n
 * @param {number} m
 * @param {{ max?: number[][], alloc?: number[][], avail?: number[] } | null} preset
 */
function buildBankerMatrix(n, m, preset) {
  clearEl(els.bankMatrixWrap);
  const wrap = document.createElement('div');
  wrap.className = 'banker-grid';

  function addSection(title, tableEl) {
    const h = document.createElement('h4');
    h.className = 'subheading';
    h.textContent = title;
    wrap.appendChild(h);
    wrap.appendChild(tableEl);
  }

  function cellVal(kind, i, j, def) {
    if (!preset) return def;
    if (kind === 'avail' && preset.avail) return preset.avail[j] ?? def;
    if (kind === 'max' && preset.max && preset.max[i]) return preset.max[i][j] ?? def;
    if (kind === 'alloc' && preset.alloc && preset.alloc[i]) return preset.alloc[i][j] ?? def;
    return def;
  }

  function makePmTable(kind, label) {
    const table = document.createElement('table');
    table.className = 'data-table banker-table';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    const thEmpty = document.createElement('th');
    thEmpty.textContent = '';
    trh.appendChild(thEmpty);
    for (let j = 0; j < m; j++) {
      const th = document.createElement('th');
      th.textContent = 'R' + j;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (let i = 0; i < n; i++) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = 'P' + i;
      tr.appendChild(th);
      for (let j = 0; j < m; j++) {
        const td = document.createElement('td');
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.max = String(LIMITS.bankMaxCell);
        inp.className = 'banker-cell';
        inp.dataset.kind = kind;
        inp.dataset.i = String(i);
        inp.dataset.j = String(j);
        inp.value = String(cellVal(kind, i, j, 0));
        inp.autocomplete = 'off';
        inp.inputMode = 'numeric';
        td.appendChild(inp);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    addSection(label, table);
  }

  makePmTable('max', 'Maximum demand (Max)');
  makePmTable('alloc', 'Current allocation (Allocation)');

  const avTable = document.createElement('table');
  avTable.className = 'data-table banker-table banker-avail-row';
  const avTr = document.createElement('tr');
  const thLab = document.createElement('th');
  thLab.scope = 'row';
  thLab.textContent = 'Avail';
  avTr.appendChild(thLab);
  for (let j = 0; j < m; j++) {
    const td = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.max = String(LIMITS.bankMaxCell);
    inp.className = 'banker-cell';
    inp.dataset.kind = 'avail';
    inp.dataset.j = String(j);
    inp.value = String(cellVal('avail', 0, j, 0));
    inp.autocomplete = 'off';
    inp.inputMode = 'numeric';
    td.appendChild(inp);
    avTr.appendChild(td);
  }
  avTable.appendChild(avTr);
  addSection('Available (free resources)', avTable);

  els.bankMatrixWrap.appendChild(wrap);
}

function readBankerMatrices() {
  const nR = parseBoundedInt(els.bankN.value, LIMITS.bankMinN, LIMITS.bankMaxN);
  const mR = parseBoundedInt(els.bankM.value, LIMITS.bankMinM, LIMITS.bankMaxM);
  if (!nR.ok || !mR.ok) return { ok: false, error: nR.ok ? mR.error : nR.error };
  const n = nR.value;
  const m = mR.value;
  /** @type {number[][]} */
  const max = [];
  const alloc = [];
  for (let i = 0; i < n; i++) {
    max[i] = [];
    alloc[i] = [];
    for (let j = 0; j < m; j++) {
      const elMax = els.bankMatrixWrap.querySelector(`input[data-kind="max"][data-i="${i}"][data-j="${j}"]`);
      const elA = els.bankMatrixWrap.querySelector(`input[data-kind="alloc"][data-i="${i}"][data-j="${j}"]`);
      if (!elMax || !elA) return { ok: false, error: 'Matrix inputs are out of sync. Apply size again.' };
      const a = parseBoundedInt(elMax.value, 0, LIMITS.bankMaxCell);
      const b = parseBoundedInt(elA.value, 0, LIMITS.bankMaxCell);
      if (!a.ok) return { ok: false, error: `Max P${i} R${j}: ${a.error}` };
      if (!b.ok) return { ok: false, error: `Alloc P${i} R${j}: ${b.error}` };
      max[i][j] = a.value;
      alloc[i][j] = b.value;
    }
  }
  const avail = [];
  for (let j = 0; j < m; j++) {
    const el = els.bankMatrixWrap.querySelector(`input[data-kind="avail"][data-j="${j}"]`);
    if (!el) return { ok: false, error: 'Available row missing.' };
    const av = parseBoundedInt(el.value, 0, LIMITS.bankMaxCell);
    if (!av.ok) return { ok: false, error: `Available R${j}: ${av.error}` };
    avail.push(av.value);
  }
  return { ok: true, max, alloc, avail, n, m };
}

function renderBankerNeed(need) {
  clearEl(els.bankerNeedHead);
  clearEl(els.bankerNeedBody);
  if (!need || !need.length) return;
  const trh = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.textContent = '';
  trh.appendChild(th0);
  for (let j = 0; j < need[0].length; j++) {
    const th = document.createElement('th');
    th.textContent = 'R' + j;
    trh.appendChild(th);
  }
  els.bankerNeedHead.appendChild(trh);
  need.forEach((row, i) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = 'P' + i;
    tr.appendChild(th);
    row.forEach((v) => {
      const td = document.createElement('td');
      td.textContent = String(v);
      tr.appendChild(td);
    });
    els.bankerNeedBody.appendChild(tr);
  });
}

function renderBankerBanner(safe, sequence, extraNote) {
  els.bankerBanner.hidden = false;
  clearEl(els.bankerBanner);
  const div = document.createElement('div');
  div.className = safe ? 'banker-banner banker-banner--safe' : 'banker-banner banker-banner--unsafe';
  if (extraNote) {
    const note = document.createElement('p');
    note.className = 'banker-banner-note';
    note.textContent = extraNote;
    div.appendChild(note);
  }
  const h = document.createElement('strong');
  h.className = 'banker-banner-title';
  h.textContent = safe ? 'SAFE STATE' : 'UNSAFE STATE';
  div.appendChild(h);
  const p = document.createElement('p');
  p.className = 'banker-banner-desc';
  if (safe && sequence && sequence.length) {
    p.textContent = `A safe completion order exists. Example: ${sequence.map((x) => 'P' + x).join(' → ')}.`;
  } else if (safe) {
    p.textContent = 'Safe.';
  } else {
    p.textContent =
      'No completion order guarantees all processes finish. Deadlock may occur if processes block. This is not the same as “deadlocked now” — only that the state is not provably safe.';
  }
  div.appendChild(p);
  els.bankerBanner.appendChild(div);
}

function renderBankerTraceList(trace) {
  clearEl(els.bankerTrace);
  trace.forEach((step, idx) => {
    const li = document.createElement('li');
    li.textContent = formatBankerTraceLine(step);
    li.dataset.stepIdx = String(idx);
    if (bankState && idx === bankState.stepIdx) li.classList.add('current-step');
    els.bankerTrace.appendChild(li);
  });
}

function renderBankerRuntimeStep() {
  if (!bankState) return;
  clearEl(els.bankerRuntime);
  if (bankState.requestNote) {
    const note = document.createElement('p');
    note.className = 'banker-runtime-note';
    note.textContent = bankState.requestNote;
    els.bankerRuntime.appendChild(note);
  }
  const step = bankState.trace[bankState.stepIdx];
  if (!step) return;
  const p = document.createElement('p');
  p.className = 'banker-runtime-text';
  p.textContent = formatBankerTraceLine(step);
  els.bankerRuntime.appendChild(p);
  const lis = els.bankerTrace.querySelectorAll('li');
  lis.forEach((li, idx) => {
    li.classList.toggle('current-step', idx === bankState.stepIdx);
  });
}

function runBankerSafetyCheck() {
  showBankerError('');
  const rd = readBankerMatrices();
  if (!rd.ok) {
    showBankerError(rd.error);
    return;
  }
  const res = bankersSafety(rd.alloc, rd.max, rd.avail);
  if (!res.ok) {
    showBankerError(res.error);
    return;
  }
  bankState = {
    trace: res.trace,
    stepIdx: 0,
    safe: res.safe,
    sequence: res.sequence,
    need: res.need,
    requestNote: '',
  };
  renderBankerNeed(res.need);
  renderBankerBanner(res.safe, res.sequence || [], '');
  renderBankerTraceList(res.trace);
  renderBankerRuntimeStep();
  els.bankStepHint.hidden = false;
}

function bankerNextStep() {
  if (!bankState || !bankState.trace.length) {
    showBankerError('Run safety check first.');
    return;
  }
  bankState.stepIdx = (bankState.stepIdx + 1) % bankState.trace.length;
  renderBankerRuntimeStep();
}

function resetBankerView() {
  bankState = null;
  els.bankStepHint.hidden = true;
  clearEl(els.bankerRuntime);
  clearEl(els.bankerTrace);
  clearEl(els.bankerNeedHead);
  clearEl(els.bankerNeedBody);
  els.bankerBanner.hidden = true;
  clearEl(els.bankerBanner);
  showBankerError('');
}

function loadBankerExample() {
  els.bankN.value = '5';
  els.bankM.value = '3';
  buildBankerMatrix(5, 3, BANKER_EXAMPLE_5x3);
  resetBankerView();
  showBankerError('');
}

function applyBankerSize(e) {
  if (e) e.preventDefault();
  const nR = parseBoundedInt(els.bankN.value, LIMITS.bankMinN, LIMITS.bankMaxN);
  const mR = parseBoundedInt(els.bankM.value, LIMITS.bankMinM, LIMITS.bankMaxM);
  if (!nR.ok || !mR.ok) {
    showBankerError(!nR.ok ? nR.error : mR.error);
    return;
  }
  buildBankerMatrix(nR.value, mR.value, null);
  resetBankerView();
  showBankerError('');
}

function runBankerRequestTest(e) {
  e.preventDefault();
  showBankerError('');
  const rd = readBankerMatrices();
  if (!rd.ok) {
    showBankerError(rd.error);
    return;
  }
  const pi = parseBoundedInt(els.bankReqP.value, 0, rd.n - 1);
  if (!pi.ok) {
    showBankerError('Process index must match an existing process (0 … n−1).');
    return;
  }
  const parts = els.bankReqVec.value.split(/[\s,]+/).filter(Boolean);
  if (parts.length !== rd.m) {
    showBankerError(`Enter exactly ${rd.m} non-negative integers for the request vector.`);
    return;
  }
  /** @type {number[]} */
  const req = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) {
      showBankerError('Request vector: use digits only, comma or space separated.');
      return;
    }
    const v = parseInt(p, 10);
    if (v > LIMITS.bankMaxCell) {
      showBankerError(`Each request value must be ≤ ${LIMITS.bankMaxCell}.`);
      return;
    }
    req.push(v);
  }
  const res = bankersRequestGrantSafe(rd.alloc, rd.max, rd.avail, pi.value, req);
  if (!res.ok) {
    showBankerError(res.error);
    return;
  }
  const note = `Hypothetical: grant request [${req.join(', ')}] to P${pi.value}, then run safety check on the new state.`;
  bankState = {
    trace: res.trace,
    stepIdx: 0,
    safe: res.safe,
    sequence: res.sequence,
    need: res.need,
    requestNote: note,
  };
  renderBankerNeed(res.need);
  renderBankerBanner(res.safe, res.sequence || [], '');
  renderBankerTraceList(res.trace);
  renderBankerRuntimeStep();
  els.bankStepHint.hidden = false;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
initTheme();
buildCpuProcessInputs(parseInt(els.cpuN.value, 10) || 3);
buildBankerMatrix(5, 3, BANKER_EXAMPLE_5x3);

els.btnTheme.addEventListener('click', toggleTheme);
els.tabCpu.addEventListener('click', () => switchTab('cpu'));
els.tabDisk.addEventListener('click', () => switchTab('disk'));
els.tabBanker.addEventListener('click', () => switchTab('banker'));
els.cpuAlgo.addEventListener('change', syncCpuFormUi);
document.querySelectorAll('input[name="cpu-compare"]').forEach((el) => {
  el.addEventListener('change', syncCpuFormUi);
});

els.formCpu.addEventListener('submit', (e) => {
  e.preventDefault();
  runCpuSimulation();
});
els.cpuStep.addEventListener('click', cpuStep);
els.cpuReset.addEventListener('click', () => {
  resetCpuView();
});
els.cpuN.addEventListener('change', onCpuNChange);
els.cpuCompareBtn.addEventListener('click', cpuCompare);
els.cpuSave.addEventListener('click', saveCpu);
els.cpuLoad.addEventListener('click', loadCpu);
els.cpuExport.addEventListener('click', () => printReport('cpu'));

els.formDisk.addEventListener('submit', (e) => {
  e.preventDefault();
  runDiskSimulation();
});
els.diskStep.addEventListener('click', diskStep);
els.diskReset.addEventListener('click', resetDiskView);
els.diskCompareBtn.addEventListener('click', diskCompareAll);
els.diskSave.addEventListener('click', saveDisk);
els.diskLoad.addEventListener('click', loadDisk);
els.diskExport.addEventListener('click', () => printReport('disk'));

window.addEventListener('resize', () => {
  if (diskState && diskState.path.length) {
    drawDiskChart(
      els.diskCanvas,
      diskState.path,
      diskState.seeks,
      diskState.maxCyl,
      els.diskChartCaption
    );
  }
});

// Optional: block middle-click paste of huge strings into disk queue (soft limit)
els.diskQueue.addEventListener('input', () => {
  if (els.diskQueue.value.length > LIMITS.maxQueueStringLen) {
    els.diskQueue.value = els.diskQueue.value.slice(0, LIMITS.maxQueueStringLen);
  }
});

els.formBankerSize.addEventListener('submit', applyBankerSize);
els.bankLoadExample.addEventListener('click', loadBankerExample);
els.bankRun.addEventListener('click', runBankerSafetyCheck);
els.bankStep.addEventListener('click', bankerNextStep);
els.bankReset.addEventListener('click', resetBankerView);
els.formBankerRequest.addEventListener('submit', runBankerRequestTest);
