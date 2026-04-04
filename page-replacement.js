/**
 * DCPS Simulator - Page Replacement Module
 * Isolated completely from the rest of the application.
 * Logic strictly mirrors standard C array implementations.
 */
document.addEventListener('DOMContentLoaded', () => {
  // Check if we are on the page with the Page Replacement UI
  const formPage = document.getElementById('form-page');
  if (!formPage) return;

  // Local DOM Elements
  const els = {
    form: formPage,
    algo: document.getElementById('page-algo'),
    frames: document.getElementById('page-frames'),
    queue: document.getElementById('page-queue'),
    error: document.getElementById('page-error'),
    reset: document.getElementById('page-reset'),
    faultsOut: document.getElementById('page-faults-out'),
    hitsOut: document.getElementById('page-hits-out'),
    hitRatio: document.getElementById('page-hit-ratio'),
    tableWrap: document.getElementById('page-table-wrap'),
  };

  // Local Limits & State
  const MAX_QUEUE_LEN = 500;
  const MAX_REQUESTS = 100;
  const MAX_FRAMES = 20;
  let pageState = null;

  // Utility Functions
  function setText(el, text) { if (el) el.textContent = text; }
  function clearEl(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function parsePageQueue(str) {
    if (typeof str !== 'string' || str.length > MAX_QUEUE_LEN) {
      return { ok: false, error: 'Page string is too long.' };
    }
    const parts = str.split(/[\s,]+/).filter(Boolean);
    if (parts.length === 0) return { ok: false, error: 'Enter at least one page request.' };
    if (parts.length > MAX_REQUESTS) return { ok: false, error: `At most ${MAX_REQUESTS} requests.` };
    const out = [];
    for (const p of parts) {
      if (!/^\d+$/.test(p)) return { ok: false, error: 'Page string must contain only non-negative integers.' };
      out.push(parseInt(p, 10));
    }
    return { ok: true, value: out };
  }

  // ================= CORE ALGORITHM LOGIC (Mirrors C Code) =================
  function createPageTrace(pages, framesCount, algo) {
    let frames = new Array(framesCount).fill(-1); // Match C logic: -1 for empty frames
    let time = new Array(framesCount).fill(0);    // For LRU
    let counter = 0;                              // For LRU
    let next = 0;                                 // For FIFO
    let faults = 0;
    let hits = 0;
    let trace = [];

    for (let i = 0; i < pages.length; i++) {
      let p = pages[i];
      let isHit = false;
      let hitIdx = -1; // To track where the hit happened for UI highlights

      // 1. Check if page is already in a frame
      for (let j = 0; j < framesCount; j++) {
        if (frames[j] === p) {
          isHit = true;
          hitIdx = j;
          if (algo === 'lru') {
            counter++;
            time[j] = counter;
          }
          break;
        }
      }

      // If Hit, log it and move to next page
      if (isHit) {
        hits++;
        trace.push({ page: p, frames: [...frames], isHit: true, replaceIdx: hitIdx });
        continue;
      }

      // 2. Page Fault Occurred
      faults++;
      let replaceIdx = -1;

      if (algo === 'fcfs') {
        // FIFO Logic
        replaceIdx = next;
        frames[replaceIdx] = p;
        next = (next + 1) % framesCount;
      } 
      else if (algo === 'lru') {
        // LRU Logic
        replaceIdx = 0;
        for (let j = 1; j < framesCount; j++) {
          if (time[j] < time[replaceIdx]) {
            replaceIdx = j;
          }
        }
        frames[replaceIdx] = p;
        counter++;
        time[replaceIdx] = counter;
      } 
      else if (algo === 'optimal') {
        // Optimal Logic
        let farthest = -1;
        for (let j = 0; j < framesCount; j++) {
          let k;
          // Look ahead to find the next occurrence
          for (k = i + 1; k < pages.length; k++) {
            if (frames[j] === pages[k]) {
              break;
            }
          }

          // If the page is never used again (or if the frame is empty [-1])
          if (k === pages.length) {
            replaceIdx = j;
            break;
          }

          // Otherwise, find the one that is used farthest in the future
          if (k > farthest) {
            farthest = k;
            replaceIdx = j;
          }
        }
        frames[replaceIdx] = p;
      }

      trace.push({ page: p, frames: [...frames], isHit: false, replaceIdx: replaceIdx });
    }

    return { faults, hits, trace, algo, framesCount };
  }

  // ================= RENDERING LOGIC =================
  function renderPageTable(res, container) {
    clearEl(container);
    if (!res.trace || res.trace.length === 0) return;

    const table = document.createElement('table');
    table.className = 'data-table page-table';

    // Header
    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    const thReq = document.createElement('th');
    thReq.textContent = 'Ref String';
    trHead.appendChild(thReq);
    res.trace.forEach(step => {
      const th = document.createElement('th');
      th.textContent = String(step.page);
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);
    table.appendChild(thead);

    // Body (Frames)
    const tbody = document.createElement('tbody');
    for (let f = 0; f < res.framesCount; f++) {
      const tr = document.createElement('tr');
      const tdLabel = document.createElement('th');
      tdLabel.scope = 'row';
      tdLabel.textContent = `Frame ${f + 1}`;
      tr.appendChild(tdLabel);

      res.trace.forEach(step => {
        const td = document.createElement('td');
        const val = step.frames[f];
        
        // Match C logic print output: Print '-' if value is -1
        td.textContent = val !== -1 ? String(val) : '-';
        
        if (step.replaceIdx === f && !step.isHit) {
          td.classList.add('page-replaced');
          td.style.backgroundColor = 'var(--page-miss-bg, #fca5a5)';
          td.style.color = 'var(--page-miss-fg, #7f1d1d)';
        } else if (step.isHit && step.replaceIdx === f) {
          td.classList.add('page-hit-frame');
          td.style.backgroundColor = 'var(--page-hit-bg, #bbf7d0)'; 
          td.style.color = 'var(--page-hit-fg, #14532d)';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }

    // Body (Status Row)
    const trStatus = document.createElement('tr');
    const thStatus = document.createElement('th');
    thStatus.textContent = 'Status';
    trStatus.appendChild(thStatus);
    res.trace.forEach(step => {
      const td = document.createElement('td');
      if (step.isHit) {
        td.textContent = 'Hit';
        td.style.color = '#16a34a';
        td.style.fontWeight = 'bold';
      } else {
        td.textContent = 'Miss';
        td.style.color = '#dc2626';
        td.style.fontWeight = 'bold';
      }
      trStatus.appendChild(td);
    });
    tbody.appendChild(trStatus);

    table.appendChild(tbody);
    container.appendChild(table);
  }

  // ================= EVENT LISTENERS =================
  if (els.queue) {
    els.queue.addEventListener('input', () => {
      if (els.queue.value.length > MAX_QUEUE_LEN) {
        els.queue.value = els.queue.value.slice(0, MAX_QUEUE_LEN);
      }
    });
  }

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (els.error) { els.error.hidden = true; setText(els.error, ''); }
    
    const qRes = parsePageQueue(els.queue.value);
    if (!qRes.ok) { if (els.error) { els.error.hidden = false; setText(els.error, qRes.error); } return; }
    
    let framesVal = parseInt(els.frames.value, 10);
    if (isNaN(framesVal) || framesVal < 1 || framesVal > MAX_FRAMES) {
      if (els.error) { els.error.hidden = false; setText(els.error, `Frames must be between 1 and ${MAX_FRAMES}.`); } return;
    }

    const algo = els.algo ? els.algo.value : 'fcfs';
    const result = createPageTrace(qRes.value, framesVal, algo);
    pageState = result;

    if (els.tableWrap) renderPageTable(result, els.tableWrap);
    if (els.faultsOut) setText(els.faultsOut, String(result.faults));
    if (els.hitsOut) setText(els.hitsOut, String(result.hits));
    if (els.hitRatio) {
      const total = result.faults + result.hits;
      setText(els.hitRatio, total > 0 ? ((result.hits / total) * 100).toFixed(2) + '%' : '0%');
    }
  });

  if (els.reset) {
    els.reset.addEventListener('click', () => {
      pageState = null;
      clearEl(els.tableWrap);
      if (els.tableWrap) els.tableWrap.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">Run the simulation to view the memory trace.</p>';
      if (els.faultsOut) setText(els.faultsOut, '-');
      if (els.hitsOut) setText(els.hitsOut, '-');
      if (els.hitRatio) setText(els.hitRatio, '-');
      if (els.error) { els.error.hidden = true; setText(els.error, ''); }
    });
  }
});