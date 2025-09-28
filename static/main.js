(function(){
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // Suggested FX & metals starter watchlist
  const DEFAULT_SYMBOLS = [
    'EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF',
    'XAUUSD','XAGUSD','XPTUSD','XPDUSD'
  ];
  const PRESET_SYMBOLS = [
    // Majors
    'EURUSD','GBPUSD','USDJPY','USDCHF','USDCAD','AUDUSD','NZDUSD',
    // Popular crosses
    'EURJPY','EURGBP','EURCHF','GBPJPY','AUDJPY','CADJPY',
    // Precious metals
    'XAUUSD','XAGUSD','XPTUSD','XPDUSD'
  ];

  let offset = 0;
  let selected = null;
  let autoTimer = null;
  let chart = null; // chart removed from UI; keep stub to avoid errors
  let lastInsights = '';
  let lastQuote = null;
  let wlQuotes = new Map();
  let lastPlan = '';
  // Journal state (server-backed with local fallback)
  let journal = [];
  let journalBackendOK = false;

  // Chart removed: no plugin registration needed

  function fmtPrice(sym, p){
    // FX pairs often 4-5 decimals, JPY pairs 2-3; metals typically 2 decimals
    if(sym && sym.endsWith('JPY')) return p.toFixed(3);
    if(sym && sym.startsWith('XA')) return p.toFixed(2); // XAU, XAG, etc.
    if(sym && sym.length === 6) return p.toFixed(5); // generic FX pair
    return p.toFixed(4);
  }

  async function fetchPrices(params){
    const res = await fetch(`/prices?${new URLSearchParams(params).toString()}`);
    if(!res.ok) throw new Error('Failed to fetch prices');
    return res.json();
  }

  async function loadRecent(){
    const limit = parseInt($('#limit').value || '10', 10);
    const symbol = $('#filter-symbol').value.trim();
    const data = await fetchPrices({ limit: String(limit), offset: String(offset), ...(symbol?{symbol}:{}) });
    const tbody = $('#prices-table tbody');
    tbody.innerHTML = '';
    for(const row of data.items){
      const tr = document.createElement('tr');
      const asOfChips = tzChips(row.as_of);
      const crChips = tzChips(row.created_at);
      tr.innerHTML = `
        <td>${row.symbol}</td>
        <td>${fmtPrice(row.symbol, row.price)}</td>
        <td>${asOfChips || ''}</td>
        <td>${row.currency ?? ''}</td>
        <td>${row.source}</td>
        <td>${crChips || ''}</td>
      `;
      tbody.appendChild(tr);
    }
    $('#prev').disabled = (data.offset || 0) <= 0;
    $('#next').disabled = data.next_offset == null;
  }

  async function loadSymbolSeries(sym){
    // Pull last N rows for this symbol (newest first)
    const n = parseInt($('#range')?.value || '50', 10) || 50;
    const data = await fetchPrices({ symbol: sym, limit: String(n), offset: '0' });
    const items = Array.isArray(data.items) ? data.items : [];

    // Quote card
  const last = items[0]; // newest first
  const first = items[items.length-1]; // oldest within window
    const diff = (last && first) ? (last.price - first.price) : 0;
    const pct = (last && first && first.price !== 0) ? (diff/first.price*100) : 0;
    const tz = last ? tzChips(last.as_of) : '';
    const qc = $('#quote-card');
    if(qc) qc.innerHTML = last ? `
      <div class="d-flex align-items-baseline gap-2">
        <div class="display-6">${fmtPrice(sym, last.price)}</div>
        <div class="${diff>=0?'price-up':'price-down'} fw-semibold">${diff>=0?'+':''}${diff.toFixed(4)} (${pct.toFixed(2)}%)</div>
      </div>
      <div class="text-muted small d-flex align-items-center gap-2 flex-wrap">${tz}${tz?' • ':''}${last.source}</div>
    ` : `<div class="text-muted">No quotes found for ${sym}. Click Ingest or pick another symbol.</div>`;
    lastQuote = last || null;

    // Build chart
    // Chart removed: still update selected symbol for context and load other sections
  const selEl = $('#selected-symbol'); if(selEl) selEl.textContent = sym;

    // Load news and calendar in parallel
    loadNews(sym).catch(console.error);
    loadCalendar().catch(console.error);
    // Do NOT auto-analyze. Show a hint to the user instead.
    const el = $('#analysis-content');
    if(el){ el.textContent = 'Click "Ask GPT" to analyze this symbol.'; el.classList.add('text-muted'); }
  }

  async function loadNews(symbol){
    const res = await fetch(`/news${symbol?`?symbol=${encodeURIComponent(symbol)}`:''}`);
    if(!res.ok) return;
    const data = await res.json();
    const ul = $('#news-list');
    ul.innerHTML = '';
    $('#news-caption').textContent = symbol ? `for ${symbol}` : '';
    for(const n of data.items){
      const li = document.createElement('li');
      const impact = (n.impact||'low').toLowerCase();
      const chipClass = impact==='high'?'impact-high':impact==='medium'?'impact-medium':'impact-low';
      li.className = `mb-2 news-item ${impact}`;
      const tz = formatTimezones(n.published_at);
      li.innerHTML = `
        <span class="impact-chip ${chipClass}">${n.impact||'Low'}</span>
        <a href="${n.url}" target="_blank" class="link-info">${n.title}</a>
        <span class="text-muted">${n.source||''}</span>
        ${tz ? `<span class="tz-chip tz-pdt">PDT ${tz.pdt}</span><span class="tz-chip tz-est">EST ${tz.est}</span>` : ''}
      `;
      ul.appendChild(li);
    }
  }

  function formatTimezones(iso){
    try{
      if(!iso) return null;
      const d = new Date(iso);
      // PDT: UTC-7 (America/Los_Angeles in DST); EST: UTC-5 (America/New_York standard)
      // We’ll compute offsets manually to avoid dependencies; adjust based on current DST heuristics.
      const utc = d.getTime() + (d.getTimezoneOffset()*60000);
      const pdtOffset = -7; // hours
      const estOffset = -5; // hours
      const pdt = new Date(utc + pdtOffset*3600000);
      const est = new Date(utc + estOffset*3600000);
      const fmt = (x)=> x.toISOString().substring(11,16); // HH:MM from ISO
      return { pdt: fmt(pdt), est: fmt(est) };
    }catch{ return null; }
  }

  function tzChips(iso){
    const tz = formatTimezones(iso);
    return tz ? `<span class="tz-chip tz-pdt">PDT ${tz.pdt}</span><span class="tz-chip tz-est">EST ${tz.est}</span>` : '';
  }

  async function loadCalendar(){
    const res = await fetch('/calendar');
    if(!res.ok) return;
    const data = await res.json();
    const ul = $('#calendar-list');
    ul.innerHTML = '';
    for(const c of data.items){
      const li = document.createElement('li');
      const impact = (c.impact||'low').toLowerCase();
      const chipClass = impact==='high'?'impact-high':impact==='medium'?'impact-medium':'impact-low';
      li.className = `mb-2 news-item ${impact}`; // reuse news-item styles for left border
      const tz = tzChips(c.time);
      li.innerHTML = `
        <span class="impact-chip ${chipClass}">${c.impact||'Low'}</span>
        <span class="badge bg-secondary me-2">${c.country}</span>
        ${c.event}
        ${tz ? tz : ''}
      `;
      ul.appendChild(li);
    }
  }

  async function fetchInsights(symbol, horizon){
    const el = $('#analysis-content');
    if(el){ el.textContent = 'Loading insights…'; el.classList.add('text-muted'); }
    try{
      const res = await fetch('/insights', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbol, horizon }) });
      if(!res.ok){
        let msg = `Insights request failed (${res.status})`;
        try{
          const err = await res.json();
          if(err && (err.detail || err.message)){
            msg += `: ${err.detail || err.message}`;
          }
        }catch{}
        if(el){ el.textContent = msg; el.classList.remove('text-muted'); }
        return;
      }
      const data = await res.json();
      lastInsights = data.summary || '';
      if(el){ el.textContent = lastInsights || 'No insights available.'; el.classList.remove('text-muted'); }
      console.log('Insights:', lastInsights);
    }catch(err){
      console.warn('Insights error', err);
      if(el){ el.textContent = 'Error loading insights. Check server logs or API key.'; el.classList.remove('text-muted'); }
    }
  }

  function buildEntryPlan(sym){
    const n = parseInt($('#range').value, 10) || 50;
    if(!lastQuote){ return 'No quote available yet.'; }
    const px = lastQuote.price;
    const atrGuess = sym.endsWith('JPY') ? 0.3 : (sym.startsWith('XA') ? 10 : 0.005);
    const stop = sym.startsWith('XA') ? (px - atrGuess*2) : (px - atrGuess*2);
    const target = sym.startsWith('XA') ? (px + atrGuess*3) : (px + atrGuess*3);
    const plan = [
      `Symbol: ${sym}`,
      `Context: last ${n} points, latest=${fmtPrice(sym, px)}`,
      `Bias: ${lastInsights ? 'See analysis' : 'Neutral (await analysis)'}`,
      `Entry: market/limit near ${fmtPrice(sym, px)}`,
      `Stop: ${fmtPrice(sym, stop)}  (risk ~2x ATR guess)`,
      `Target: ${fmtPrice(sym, target)}  (reward ~3x ATR guess)`,
      `Risk:Reward ~ 1:1.5 (tune after volatility check)`
    ].join('\n');
    lastPlan = plan;
    // Update annotations if chart exists
    if(chart){ chart.options.plugins.annotation.annotations = buildAnnotations(sym); chart.update(); }
    return plan;
  }

  function parseLevelsFromText(sym, text){
    // Look for numbers like 1.2345 or 2450 and labels entry/stop/target
    if(!text) return {};
    const levels = {};
    const lines = String(text).split(/\n|\.|;/);
    for(const ln of lines){
      const t = ln.toLowerCase();
      const m = ln.match(/([0-9]+(?:\.[0-9]+)?)/g);
      if(!m) continue;
      const nums = m.map(parseFloat);
      if(t.includes('entry')) levels.entry = nums[0];
      if(t.includes('stop')) levels.stop = nums[0];
      if(t.includes('target') || t.includes('tp')) levels.target = nums[0];
      if(t.includes('resistance')) levels.resistance = nums[0];
      if(t.includes('support')) levels.support = nums[0];
      if(t.includes('risk') && !levels.stop) levels.stop = nums[0];
    }
    return levels;
  }

  function buildAnnotations(sym){
    // Merge levels from insights + plan and render as horizontal lines
    const a = {};
    const lv1 = parseLevelsFromText(sym, lastInsights);
    const lv2 = parseLevelsFromText(sym, lastPlan);
    const lv = Object.assign({}, lv1, lv2);
    const mkLine = (id, y, color, label)=> ({
      type: 'line',
      yMin: y, yMax: y,
      borderColor: color, borderWidth: 2,
      label: { display: true, content: label, position: 'start', backgroundColor: 'rgba(0,0,0,.5)', color: '#fff' }
    });
    if(lv.entry) a.entry = mkLine('entry', lv.entry, '#0dcaf0', 'Entry');
    if(lv.stop) a.stop = mkLine('stop', lv.stop, '#ff6b6b', 'Stop');
    if(lv.target) a.target = mkLine('target', lv.target, '#51cf66', 'Target');
    if(lv.support && !a.stop) a.support = mkLine('support', lv.support, '#94d2bd', 'Support');
    if(lv.resistance && !a.target) a.resistance = mkLine('resistance', lv.resistance, '#e9d8a6', 'Resistance');
    return a;
  }

  function renderWatchlist(symbols){
    const ul = $('#watchlist');
    ul.innerHTML = '';
    symbols.forEach((s, idx)=>{
      const q = wlQuotes.get(s);
      const price = q ? fmtPrice(s, q.price) : '—';
      const delta = q ? (q.delta>=0?`<span class="delta price-up">+${q.delta.toFixed(4)}</span>`:`<span class="delta price-down">${q.delta.toFixed(4)}</span>`) : '';
      const li = document.createElement('li');
      li.className = 'list-group-item d-flex justify-content-between align-items-center';
      li.draggable = true;
      li.innerHTML = `
        <div class="d-flex align-items-center gap-2">
          <span class="drag">⋮⋮</span>
          <div>
            <div class="symbol">${s}</div>
            <div class="text-muted small">${delta}</div>
          </div>
        </div>
        <div class="price">${price}</div>
      `;
      if(selected === s) li.classList.add('active');
      li.addEventListener('click', async ()=>{ await activateSymbol(s); });
      // Drag & drop reordering
      li.addEventListener('dragstart', (ev)=>{ ev.dataTransfer.setData('text/plain', String(idx)); });
      li.addEventListener('dragover', (ev)=>{ ev.preventDefault(); });
      li.addEventListener('drop', (ev)=>{
        ev.preventDefault();
        const from = parseInt(ev.dataTransfer.getData('text/plain'),10);
        const to = idx;
        if(isNaN(from)) return;
        const next = symbols.slice();
        const [moved] = next.splice(from,1);
        next.splice(to,0,moved);
        localStorage.setItem('watchlist', JSON.stringify(next));
        renderWatchlist(next);
      });
      ul.appendChild(li);
    });
  }

  async function refreshWatchlistQuotes(){
    const symbols = getWatchlist();
    // Pull last 1 per symbol and compute delta vs previous
    for(const s of symbols){
      try{
        const data = await fetchPrices({ symbol: s, limit: '2', offset: '0' });
        const items = data.items;
        if(items.length){
          const last = items[0];
          const prev = items[1];
          const delta = prev ? (last.price - prev.price) : 0;
          wlQuotes.set(s, { price: last.price, delta });
        }
      }catch{}
    }
    renderWatchlist(symbols);
  }

  function getWatchlist(){
    try{ const w = JSON.parse(localStorage.getItem('watchlist')||'[]'); return Array.isArray(w)?w:[]; }catch{ return []; }
  }

  async function activateSymbol(sym){
    const s = String(sym||'').toUpperCase();
    if(!s) return;
    selected = s; offset = 0; $('#filter-symbol').value = s;
    // Ensure existence and highlight in watchlist
    const w = getWatchlist();
    const next = w.includes(s) ? w : [...w, s];
    localStorage.setItem('watchlist', JSON.stringify(next));
    renderWatchlist(next);
    $$('#watchlist .list-group-item').forEach(el=>el.classList.remove('active'));
    const row = $$('#watchlist .list-group-item').find(el=> el.querySelector('.symbol')?.textContent === s);
    if(row) row.classList.add('active');
    await autoIngestOnSelect(s).catch(console.warn);
    await loadSymbolSeries(s);
    await loadRecent();
  }

  function setAutoRefresh(enabled){
    const INTERVAL_MS = 15000; // 15s
    if(autoTimer){ clearInterval(autoTimer); autoTimer = null; }
    if(enabled){ autoTimer = setInterval(async ()=>{ await loadRecent(); if(selected) await loadSymbolSeries(selected); await refreshWatchlistQuotes(); }, INTERVAL_MS); }
  }

  // Event bindings
  $('#refresh')?.addEventListener('click', async ()=>{ await loadRecent(); if(selected) await loadSymbolSeries(selected); });
  $('#prev').addEventListener('click', async ()=>{ offset = Math.max(0, offset - parseInt($('#limit').value||'10',10)); await loadRecent(); });
  $('#next').addEventListener('click', async ()=>{ const limit = parseInt($('#limit').value||'10',10); offset += limit; await loadRecent(); });
  $('#range')?.addEventListener('change', async ()=>{ if(selected) await loadSymbolSeries(selected); });
  $('#autorefresh').addEventListener('change', (e)=> setAutoRefresh(e.target.checked));
  $('#add-symbol-btn').addEventListener('click', ()=>{
    const s = $('#add-symbol').value.trim().toUpperCase();
    if(!s) return;
    const w = getWatchlist();
    if(!w.includes(s)){
      const next = [...w, s];
      localStorage.setItem('watchlist', JSON.stringify(next));
      renderWatchlist(next);
    }
    $('#add-symbol').value = '';
  });

  // Populate preset dropdown and handler
  (function initPresetDropdown(){
    const sel = document.getElementById('preset-symbol');
    if(!sel) return;
    sel.innerHTML = PRESET_SYMBOLS.map(s=>`<option value="${s}">${s}</option>`).join('');
    // Activate immediately when selection changes
    sel.addEventListener('change', async ()=>{
      const val = sel.value?.toUpperCase(); if(!val) return; await activateSymbol(val);
    });
    // Button alternative also activates
    document.getElementById('add-preset-btn')?.addEventListener('click', async ()=>{
      const val = sel.value?.toUpperCase(); if(!val) return; await activateSymbol(val);
    });
  })();

  $('#ingest-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputEl = $('#symbol');
    const raw = inputEl.value.trim().toUpperCase();
    const cleaned = raw.replace(/[^A-Z]/g, ''); // remove slashes/spaces etc.
    const isFxLike = /^[A-Z]{6}$/.test(cleaned) || /^X[A-Z]{2}USD$/.test(cleaned);
    const url = isFxLike ? '/ingest/fx' : '/ingest/alpha_vantage';
    const payload = isFxLike ? { pair: cleaned } : { symbol: raw };
    const btn = $('#ingest-btn'); const out = $('#ingest-result');
    if(btn){ btn.disabled = true; btn.textContent = 'Ingesting…'; }
    out.textContent = '';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(res.ok){
      const data = await res.json();
      const saved = data.saved || {};
      const s = saved.symbol || (isFxLike ? cleaned : raw);
      out.classList.remove('text-danger'); out.classList.add('text-muted');
      out.textContent = `Saved ${s} @ ${saved.price ?? ''}`;
      // Reflect normalized pair back into the form field
      inputEl.value = s;
      // Make the ingested symbol the active selection
      selected = s;
      // Immediately show in header to avoid any perception lag
      const selEl = $('#selected-symbol'); if(selEl) selEl.textContent = s;
      $('#filter-symbol').value = s;
      // Ensure watchlist contains the symbol and re-render
      const w = getWatchlist();
      const next = w.includes(s) ? w : [...w, s];
      localStorage.setItem('watchlist', JSON.stringify(next));
      renderWatchlist(next);
      // Show it on chart and refresh table
      await loadSymbolSeries(s);
      await loadRecent();
    } else {
      const err = await res.json().catch(()=>({}));
      out.classList.remove('text-muted'); out.classList.add('text-danger');
      out.textContent = `Error: ${err.detail || err.message || res.statusText} (${res.status})`;
    }
    if(btn){ btn.disabled = false; btn.textContent = 'Ingest'; }
  });

  $('#insights-refresh')?.addEventListener('click', async ()=>{
    if(!selected) return;
    const horizon = $('#insights-horizon').value || 'daily';
    await fetchInsights(selected, horizon);
    // Chart removed: annotations no longer applied
  });

  $('#plan-generate')?.addEventListener('click', ()=>{
    if(!selected) return;
    $('#entry-plan').textContent = buildEntryPlan(selected);
  });

  // Tabs: Dashboard / Journal
  const tabDashBtn = document.getElementById('tab-dashboard-btn');
  const tabJournalBtn = document.getElementById('tab-journal-btn');
  const tabDash = document.getElementById('tab-dashboard');
  const tabJournal = document.getElementById('tab-journal');
  tabDashBtn?.addEventListener('click', ()=>{ tabDashBtn.classList.add('active'); tabJournalBtn.classList.remove('active'); tabDash.classList.remove('d-none'); tabJournal.classList.add('d-none'); });
  tabJournalBtn?.addEventListener('click', ()=>{ tabJournalBtn.classList.add('active'); tabDashBtn.classList.remove('active'); tabJournal.classList.remove('d-none'); tabDash.classList.add('d-none'); renderJournal(); });

  // Journal helpers
  function loadJournalLocal(){ try{ return JSON.parse(localStorage.getItem('journal')||'[]'); }catch{ return []; } }
  function saveJournalLocal(){ localStorage.setItem('journal', JSON.stringify(journal)); }

  async function syncJournalFromServer(){
    try{
      const res = await fetch('/journal');
      if(!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const serverItems = Array.isArray(data.items) ? data.items : [];
      const localItems = loadJournalLocal();
      // Dedup by content signature to merge historical local entries with server ones
      const sig = (t)=> [t.symbol||'', (t.date||'').slice(0,16), t.direction||'', Number(t.entry||0), Number(t.exit||0)].join('|');
      const map = new Map();
      for(const it of serverItems){ map.set(sig(it), it); }
      for(const it of localItems){ if(!map.has(sig(it))) map.set(sig(it), it); }
      journal = Array.from(map.values());
      journalBackendOK = true;
      saveJournalLocal();
      // Backfill any local-only entries to server so they persist across restarts
      const serverSigs = new Set(serverItems.map(sig));
      for(const it of localItems){
        if(!serverSigs.has(sig(it))){
          try{ await saveJournalServer(it); }catch(err){ console.warn('Backfill failed', err); }
        }
      }
    }catch(err){
      // Fallback to local cache
      journal = loadJournalLocal();
      journalBackendOK = false;
      console.warn('Journal backend unavailable, using local storage');
    }
  }

  async function saveJournalServer(t){
    if(!journalBackendOK){
      // Local fallback
      const idx = journal.findIndex(x=>String(x.id)===String(t.id));
      if(idx>=0) journal[idx] = t; else journal.push(t);
      saveJournalLocal();
      return t;
    }
    // If id is non-numeric, let server assign one
    const payload = { ...t };
    if(payload.id != null && isNaN(Number(payload.id))) delete payload.id;
    const res = await fetch('/journal', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if(!res.ok) throw new Error(`Save failed ${res.status}`);
    const saved = await res.json();
    // Replace by id if present, otherwise dedup by signature
    const idx = saved.id != null ? journal.findIndex(x=>String(x.id)===String(saved.id)) : -1;
    if(idx>=0) journal[idx] = saved; else {
      const sig = (t)=> [t.symbol||'', (t.date||'').slice(0,16), t.direction||'', Number(t.entry||0), Number(t.exit||0)].join('|');
      const existingIdx = journal.findIndex(x=> sig(x) === sig(saved));
      if(existingIdx>=0) journal[existingIdx] = saved; else journal.push(saved);
    }
    saveJournalLocal();
    return saved;
  }

  function computePnL(t){
    const qty = Number(t.qty||0);
    const entry = Number(t.entry||0);
    const exit = Number(t.exit||0);
    const fees = Number(t.fees||0);
    const pnlRaw = (t.direction==='Long') ? (exit-entry)*qty : (entry-exit)*qty;
    return pnlRaw - fees;
  }
  function computeR(t){
    const riskPerUnit = Math.abs(Number(t.entry||0) - Number(t.stop||0));
    if(!riskPerUnit) return 0;
    const pnl = computePnL(t);
    const totalRisk = riskPerUnit * Math.abs(Number(t.qty||0));
    if(!totalRisk) return 0;
    return pnl / totalRisk;
  }
  function fmtDateLocal(iso){ try{ return new Date(iso).toISOString().slice(0,16).replace('T',' ');}catch{return iso||'';} }

  function computeFilteredRows(){
    const fSym = ($('#j-filter-symbol')?.value||'').trim().toUpperCase();
    const fDir = ($('#j-filter-dir')?.value)||'';
    const fTag = ($('#j-filter-tag')?.value||'').trim().toLowerCase();
    const fStart = $('#j-filter-start')?.value ? new Date($('#j-filter-start').value) : null;
    const fEnd = $('#j-filter-end')?.value ? new Date($('#j-filter-end').value) : null;
    return journal.filter(t=>{
      if(fSym && String(t.symbol||'').toUpperCase() !== fSym) return false;
      if(fDir && t.direction !== fDir) return false;
      if(fTag && !String(t.tags||'').toLowerCase().includes(fTag)) return false;
      if(fStart && new Date(t.date) < fStart) return false;
      if(fEnd && new Date(t.date) > fEnd) return false;
      return true;
    });
  }

  function renderJournal(){
    const rows = computeFilteredRows();

    // Stats
    const trades = rows.length;
    const wins = rows.filter(t=>computePnL(t) > 0).length;
    const winrate = trades ? Math.round(wins/trades*100) : 0;
    const pnlSum = rows.reduce((s,t)=> s + computePnL(t), 0);
    const rAvg = trades ? (rows.reduce((s,t)=> s + computeR(t),0)/trades) : 0;
    $('#j-stat-trades').textContent = String(trades);
    $('#j-stat-winrate').textContent = `${winrate}%`;
    $('#j-stat-pnl').textContent = pnlSum.toFixed(2);
    $('#j-stat-ravg').textContent = rAvg.toFixed(2);
    $('#j-overview-caption').textContent = fSym ? `Filtered: ${fSym}` : '';

    // Table
    const tbody = $('#j-trades-table tbody');
    tbody.innerHTML = '';
    rows.sort((a,b)=> new Date(b.date) - new Date(a.date));
    for(const t of rows){
      const tr = document.createElement('tr');
      const pnl = computePnL(t);
      const r = computeR(t);
      const tags = (t.tags||'').split(',').map(s=>s.trim()).filter(Boolean).map(x=>`<span class="badge bg-secondary me-1">${x}</span>`).join('');
      tr.innerHTML = `
        <td>${fmtDateLocal(t.date)}</td>
        <td>${t.symbol||''}</td>
        <td>${t.direction||''}</td>
        <td>${t.entry||''}</td>
        <td>${t.stop||''}</td>
        <td>${t.exit||''}</td>
        <td>${t.qty||''}</td>
        <td class="${pnl>=0?'price-up':'price-down'}">${pnl.toFixed(2)}</td>
        <td>${r.toFixed(2)}</td>
        <td>${tags}</td>
        <td><button class="btn btn-sm btn-outline-secondary" data-id="${t.id}">Edit</button></td>
      `;
      tr.querySelector('button')?.addEventListener('click', ()=> editTrade(t.id));
      tbody.appendChild(tr);
    }

    // Charts
  try{ renderEquityChart(rows); }catch(err){ console.warn('Equity chart error', err); }
  try{ renderPnlHist(rows); }catch(err){ console.warn('PnL hist error', err); }

    // Attach AI review handler (idempotent binding)
    const runBtn = document.getElementById('j-ai-run');
    if(runBtn && !runBtn.dataset.bound){
      runBtn.dataset.bound = '1';
      runBtn.addEventListener('click', async ()=>{
        await runAiReview(rows);
      });
    }
  }

  function renderEquityChart(rows){
    const ctx = document.getElementById('equity-chart'); if(!ctx) return;
    const seq = rows.slice().sort((a,b)=> new Date(a.date) - new Date(b.date));
    let acc = 0;
    const labels = seq.map(t=> fmtDateLocal(t.date));
    const data = seq.map(t=> { acc += computePnL(t); return acc; });
    if(window._equityChart){ try{ window._equityChart.destroy(); }catch{} }
    window._equityChart = new Chart(ctx.getContext('2d'), {
      type: 'line', data: { labels, datasets: [{ label:'Equity', data, borderColor:'#51cf66', pointRadius:0, tension:.2 }] },
      options: { responsive:true, maintainAspectRatio:false, scales:{ x:{ type:'category' }, y:{} }, plugins:{ legend:{display:false} } }
    });
  }
  function renderPnlHist(rows){
    const ctx = document.getElementById('pnl-hist-chart'); if(!ctx) return;
    const arr = rows.map(computePnL);
    // simple binning into 10 bins
    const n = arr.length; if(!n){ if(window._pnlHist){ try{ window._pnlHist.destroy(); }catch{} } return; }
    const min = Math.min(...arr), max = Math.max(...arr);
    const bins = 10; const step = (max-min)/bins || 1;
    const counts = Array.from({length:bins}, ()=>0);
    for(const v of arr){ const idx = Math.min(bins-1, Math.max(0, Math.floor((v-min)/step))); counts[idx]++; }
    const labels = counts.map((_,i)=> `${(min+i*step).toFixed(0)}–${(min+(i+1)*step).toFixed(0)}`);
    if(window._pnlHist){ try{ window._pnlHist.destroy(); }catch{} }
    window._pnlHist = new Chart(ctx.getContext('2d'), {
      type: 'bar', data: { labels, datasets: [{ label:'PnL', data: counts, backgroundColor:'rgba(13,110,253,.4)' }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } }
    });
  }

  function editTrade(id){
    const t = journal.find(x=>x.id===id); if(!t) return;
    $('#j-id').value = t.id;
    $('#j-symbol').value = t.symbol||'';
    $('#j-date').value = (t.date||'').slice(0,16);
    $('#j-direction').value = t.direction||'Long';
    $('#j-qty').value = t.qty||'';
    $('#j-entry').value = t.entry||'';
    $('#j-stop').value = t.stop||'';
    $('#j-exit').value = t.exit||'';
    $('#j-fees').value = t.fees||0;
    $('#j-tags').value = t.tags||'';
    $('#j-notes').value = t.notes||'';
    // Switch to journal tab for editing
    document.getElementById('tab-journal-btn')?.click();
  }

  function resetTradeForm(){ $('#j-form').reset(); $('#j-id').value=''; }

  $('#j-reset')?.addEventListener('click', resetTradeForm);
  $('#j-form')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const t = {
      id: $('#j-id').value || String(Date.now()),
      symbol: $('#j-symbol').value.trim().toUpperCase(),
      date: $('#j-date').value ? new Date($('#j-date').value).toISOString() : new Date().toISOString(),
      direction: $('#j-direction').value,
      qty: Number($('#j-qty').value||0),
      entry: Number($('#j-entry').value||0),
      stop: Number($('#j-stop').value||0),
      exit: Number($('#j-exit').value||0),
      fees: Number($('#j-fees').value||0),
      tags: $('#j-tags').value,
      notes: $('#j-notes').value,
    };
    try{
      const saved = await saveJournalServer(t);
      resetTradeForm(); renderJournal();
    }catch(err){ console.error('Journal save failed', err); }
  });

  // Filters and import/export
  $('#j-filter-symbol')?.addEventListener('input', renderJournal);
  $('#j-filter-dir')?.addEventListener('change', renderJournal);
  $('#j-filter-start')?.addEventListener('change', renderJournal);
  $('#j-filter-end')?.addEventListener('change', renderJournal);
  $('#j-filter-tag')?.addEventListener('input', renderJournal);
  $('#j-export')?.addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(journal, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'journal.json'; a.click();
  });
  $('#j-import')?.addEventListener('change', async (e)=>{
    try{
      const file = e.target.files?.[0]; if(!file) return;
      const text = await file.text(); const data = JSON.parse(text);
      if(Array.isArray(data)){
        // Try to persist to server if available, else store locally
        if(journalBackendOK){
          for(const t of data){
            try{ await saveJournalServer(t); }catch(err){ console.warn('Import save failed', err); }
          }
        } else {
          journal = data; saveJournalLocal();
        }
        renderJournal();
      }
    }catch(err){ console.error('Import failed', err); }
  });

  // Bind AI button outside render as a safety net
  document.getElementById('j-ai-run')?.addEventListener('click', async ()=>{
    const rows = computeFilteredRows();
    await runAiReview(rows);
  });

  async function runAiReview(rows){
    const out = document.getElementById('j-ai-output');
    const scope = (document.getElementById('j-ai-scope')?.value)||'filtered';
    const notes = (document.getElementById('j-ai-notes')?.value)||'';
    if(out){ out.textContent = 'Analyzing…'; out.classList.add('text-muted'); }
    try{
      let useRows = rows.slice();
      if(scope === 'last20'){
        const byDate = journal.slice().sort((a,b)=> new Date(b.date)-new Date(a.date));
        useRows = byDate.slice(0,20);
      } else if(scope === 'all'){
        useRows = journal.slice();
      }

      // Build a compact dataset and a profound coaching prompt
      const sample = useRows.map((t, i)=>({
        i,
        d: t.date,
        s: t.symbol,
        dir: t.direction,
        q: t.qty,
        e: t.entry,
        st: t.stop,
        x: t.exit,
        f: t.fees,
        tags: t.tags,
        pnl: Number(computePnL(t).toFixed(4)),
        r: Number(computeR(t).toFixed(4)),
      }));
      const stats = {
        n: sample.length,
        wins: sample.filter(t=>t.pnl>0).length,
        wr: sample.length ? Number((sample.filter(t=>t.pnl>0).length/sample.length*100).toFixed(2)) : 0,
        ravg: sample.length ? Number((sample.reduce((s,t)=>s+t.r,0)/sample.length).toFixed(2)) : 0,
        pnl: Number(sample.reduce((s,t)=>s+t.pnl,0).toFixed(2))
      };
      const symbolHint = (sample[0]?.s) || (selected || 'MULTI');
      const prompt = [
        'You are an elite trading coach. Analyze my journal and provide blunt, actionable feedback.',
        'Rules:',
        '- Identify the 3-5 biggest issues holding me back (with evidence from the data).',
        '- Propose 3-7 concrete, measurable changes I can implement next week.',
        '- Highlight best setups (what to do more of) and worst behaviors (what to stop).',
        '- Evaluate risk discipline: stops, R multiples, position sizing, overtrading.',
        '- Include a short “If I only did these 3 things…” checklist.',
        '',
        'Data schema: [{i,d,s,dir,q,e,st,x,f,tags,pnl,r}] with i=index, d=datetime ISO, s=symbol, dir=Long|Short, q=qty, e=entry, st=stop, x=exit, f=fees.',
        `Summary stats: ${JSON.stringify(stats)}`,
        `Trades: ${JSON.stringify(sample)}`,
        notes ? `Focus: ${notes}` : ''
      ].filter(Boolean).join('\n');

      const res = await fetch('/insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbolHint, horizon: 'weekly', notes: prompt })
      });
      if(!res.ok){
        let msg = `AI review failed (${res.status})`;
        try{ const err = await res.json(); if(err?.detail||err?.message){ msg += `: ${err.detail||err.message}`; } }catch{}
        if(out){ out.textContent = msg; out.classList.remove('text-muted'); }
        return;
      }
      const data = await res.json();
      if(out){ out.textContent = data.summary || 'No feedback.'; out.classList.remove('text-muted'); }
    }catch(err){
      if(out){ out.textContent = 'Error analyzing journal. Check server logs or API key.'; out.classList.remove('text-muted'); }
    }
  }

  // Initial boot
  (async function init(){
    // Check insights status
    try{
      const s = await fetch('/insights/status').then(r=>r.ok?r.json():{enabled:false});
      const alert = $('#insights-alert');
      if(s && s.enabled === false && alert){ alert.classList.remove('d-none'); }
      $('#insights-alert-close')?.addEventListener('click', ()=> alert?.classList.add('d-none'));
    }catch{}

  // Journal: pull from server (fallback to local)
  await syncJournalFromServer();

  const w = getWatchlist();
    const symbols = w.length ? w : DEFAULT_SYMBOLS;
    if(!w.length) localStorage.setItem('watchlist', JSON.stringify(symbols));
    await refreshWatchlistQuotes();
    selected = symbols[0];
    $('#filter-symbol').value = selected;
    await autoIngestOnSelect(selected).catch(console.warn);
    await loadSymbolSeries(selected);
    await loadRecent();
  })();

  // Refresh journal when opening the tab
  tabJournalBtn?.addEventListener('click', async ()=>{ await syncJournalFromServer(); renderJournal(); });

  async function autoIngestOnSelect(sym){
    // For FX/metals pairs, use the FX ingest endpoint to fetch a fresh quote
    const pair = String(sym || '').toUpperCase();
    if(!pair) return;
    // Only trigger for FX/metals-looking symbols
    const isFxLike = /^[A-Z]{6}$/.test(pair) || /^X[A-Z]{2}USD$/.test(pair);
    if(!isFxLike) return;
    try{
      const res = await fetch('/ingest/fx', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pair }) });
      if(!res.ok){
        // Don’t block UX if ingest fails; just log
        const err = await res.json().catch(()=>({}));
        console.warn('Auto-ingest FX failed', res.status, err.detail||res.statusText);
      }
    }catch(err){
      console.warn('Auto-ingest FX error', err);
    }
  }
})();
