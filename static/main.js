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
  // Recent series (oldest->newest) for ICT analysis
  let recentSeries = [];
  // Wealth state
  let selectedPortfolioId = null;
  let portfoliosCache = [];
  // News/Calendar caches for AI context
  let newsCache = [];
  let calendarCache = [];

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

  async function loadRecent(){ /* recent table removed */ }

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

  // Cache series for ICT analysis (convert to oldest -> newest)
  recentSeries = items.slice().reverse();

  // Load news and calendar in parallel
    loadNews(sym).catch(console.error);
    loadCalendar().catch(console.error);
    // Do NOT auto-analyze. Show a hint to the user instead.
    const el = $('#analysis-content');
    if(el){ el.textContent = 'Click "Ask GPT" to analyze this symbol.'; el.classList.add('text-muted'); }
    try{ refreshPlanHistory(); }catch{}
  }

  async function loadNews(symbol){
    const res = await fetch(`/news${symbol?`?symbol=${encodeURIComponent(symbol)}`:''}`);
    if(!res.ok) return;
    const data = await res.json();
    newsCache = Array.isArray(data.items) ? data.items : [];
    const ul = $('#news-list');
    ul.innerHTML = '';
    $('#news-caption').textContent = symbol ? `for ${symbol}` : '';
    for(const n of newsCache){
      const li = document.createElement('li');
      const impact = (n.impact||'low').toLowerCase();
      const chipClass = impact==='high'?'impact-high':impact==='medium'?'impact-medium':'impact-low';
      li.className = `mb-2 news-item ${impact}`;
      const tz = formatTimezones(n.published_at);
      const date = formatDateISO(n.published_at);
      // Fallback: if API doesn't include a real URL, open a Google News search for the title (and symbol if present)
      const href = (n.url && n.url !== '#')
        ? n.url
        : `https://news.google.com/search?q=${encodeURIComponent((n.title||'') + (symbol?` ${symbol}`:''))}&hl=en-US&gl=US&ceid=US:en`;
      li.innerHTML = `
        <span class="impact-chip ${chipClass}">${n.impact||'Low'}</span>
        <a href="${href}" target="_blank" rel="noopener noreferrer" class="link-info">${n.title}</a>
        <span class="text-muted">${n.source||''}</span>
        ${date ? `<span class="tz-chip tz-date">${date}</span>` : ''}
        ${tz ? `<span class="tz-chip tz-pdt">PDT ${tz.pdt}</span><span class="tz-chip tz-est">EST ${tz.est}</span>` : ''}
      `;
      ul.appendChild(li);
    }
  }

  function formatTimezones(iso){
    try{
      if(!iso) return null;
      const d = new Date(iso);
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

  function formatDateISO(iso){
    try{
      if(!iso) return '';
      const d = new Date(iso);
      return d.toISOString().slice(0,10); // YYYY-MM-DD (UTC)
    }catch{ return ''; }
  }

  function formatDay(iso){
    try{
      if(!iso) return '';
      const d = new Date(iso);
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      return days[d.getUTCDay()];
    }catch{ return ''; }
  }

  async function loadCalendar(){
    const res = await fetch('/calendar');
    if(!res.ok) return;
    const data = await res.json();
    calendarCache = Array.isArray(data.items) ? data.items : [];
    const ul = $('#calendar-list');
    ul.innerHTML = '';
    for(const c of calendarCache){
      const li = document.createElement('li');
      const impact = (c.impact||'low').toLowerCase();
      const chipClass = impact==='high'?'impact-high':impact==='medium'?'impact-medium':'impact-low';
      li.className = `mb-2 news-item ${impact}`; // reuse news-item styles for left border
      const tzHtml = tzChips(c.time);
      const date = formatDateISO(c.time);
      const day = formatDay(c.time);
      li.innerHTML = `
        <span class="impact-chip ${chipClass}">${c.impact||'Low'}</span>
        <span class="badge bg-secondary me-2">${c.country}</span>
        ${c.event}
        ${day ? `<span class="tz-chip tz-day">${day}</span>` : ''}
        ${date ? `<span class="tz-chip tz-date">${date}</span>` : ''}
        ${tzHtml || ''}
      `;
      ul.appendChild(li);
    }
  }

  function buildContextNotes(symbol){
    // Summarize recent news and upcoming macro for the AI prompt and entry plan.
    const lines = [];
    const sym = String(symbol||'').toUpperCase();
    if(newsCache && newsCache.length){
      const top = newsCache.slice(0,5).map(n=>{
        const t = n.title || '';
        const src = n.source ? ` (${n.source})` : '';
        const imp = n.impact ? ` [${n.impact}]` : '';
        const when = n.published_at ? ` @ ${n.published_at}` : '';
        return `- ${t}${src}${imp}${when}`;
      });
      lines.push('Recent news:', ...top);
    }
    if(calendarCache && calendarCache.length){
      const up = calendarCache.slice(0,5).map(c=>{
        const imp = c.impact ? ` [${c.impact}]` : '';
        const cc = c.country ? ` (${c.country})` : '';
        const when = c.time ? ` @ ${c.time}` : '';
        return `- ${c.event || 'Event'}${cc}${imp}${when}`;
      });
      lines.push('Upcoming macro:', ...up);
    }
    return lines.join('\n');
  }

  // ===== ICT helpers (approximate using close-only series) =====
  function toPrices(series){ return Array.isArray(series) ? series.map(x=> Number(x.price||0)) : []; }
  function toTimes(series){ return Array.isArray(series) ? series.map(x=> x.as_of) : []; }
  function sma(arr, period){
    const n = Math.max(1, Math.min(period, arr.length));
    const out = [];
    let sum = 0;
    for(let i=0;i<arr.length;i++){
      sum += arr[i];
      if(i>=n) sum -= arr[i-n];
      out.push(i>=n-1 ? (sum/n) : NaN);
    }
    return out;
  }

  // ===== Alternative strategies (fallback when ICT unavailable) =====
  function getAtrGuess(sym){ return sym.endsWith('JPY') ? 0.3 : (sym.startsWith('XA') ? 10 : 0.005); }
  function stddev(arr){ if(arr.length<2) return 0; const m=arr.reduce((s,x)=>s+x,0)/arr.length; const v=arr.reduce((s,x)=>s+(x-m)*(x-m),0)/(arr.length-1); return Math.sqrt(v); }
  function rollingStd(arr, n){ const out=[]; for(let i=0;i<arr.length;i++){ const a=arr.slice(Math.max(0,i-n+1), i+1); out.push(stddev(a)); } return out; }
  function rollingMin(arr, n){ const out=[]; for(let i=0;i<arr.length;i++){ const a=arr.slice(Math.max(0,i-n+1), i+1); out.push(Math.min(...a)); } return out; }
  function highest(arr, n){ const L=arr.length; if(!L) return {v:NaN,i:-1}; const start=Math.max(0,L-n); let v=-Infinity, idx=start; for(let i=start;i<L;i++){ if(arr[i]>v){ v=arr[i]; idx=i; } } return {v, i:idx}; }
  function lowest(arr, n){ const L=arr.length; if(!L) return {v:NaN,i:-1}; const start=Math.max(0,L-n); let v=Infinity, idx=start; for(let i=start;i<L;i++){ if(arr[i]<v){ v=arr[i]; idx=i; } } return {v, i:idx}; }
  function buildAltStrategies(sym){
    const px = toPrices(recentSeries);
    const L = px.length; if(L<5) return [];
    const last = px[L-1];
    const ma20 = sma(px, Math.min(20, L));
    const ma50 = sma(px, Math.min(50, L));
    const slope20 = ma20[L-1] - ma20[Math.max(0,L-3)];
    const slope50 = ma50[L-1] - ma50[Math.max(0,L-6)];
    const trendUp = slope20>0 && slope50>=0;
    const trendDown = slope20<0 && slope50<=0;
    const atr = getAtrGuess(sym);
    const hi20 = highest(px, Math.min(20,L)).v;
    const lo20 = lowest(px, Math.min(20,L)).v;
    const sd14 = rollingStd(px, Math.min(14,L));
    const minsd14 = rollingMin(sd14, Math.min(14,L))[L-1];
    const lowVol = sd14[L-1] <= minsd14 * 1.05; // within 5% of recent min

    const out = [];
    // 1) Trend pullback to MA
    if(trendUp){
      const entry = ma20[L-1] || last;
      const stop = entry - 2*atr;
      const tgt = last + 3*atr;
      out.push([
        'Trend Pullback (Long):',
        `- Bias: uptrend (MA20/50 rising).`,
        `- Entry: pullback to MA20 near ${fmtPrice(sym, entry)} after a bullish candle.`,
        `- Stop: ${fmtPrice(sym, stop)} (below pullback low).`,
        `- Targets: ${fmtPrice(sym, tgt)} and trail under higher lows.`,
      ].join('\n'));
    } else if(trendDown){
      const entry = ma20[L-1] || last;
      const stop = entry + 2*atr;
      const tgt = last - 3*atr;
      out.push([
        'Trend Pullback (Short):',
        `- Bias: downtrend (MA20/50 falling).`,
        `- Entry: pullback to MA20 near ${fmtPrice(sym, entry)} after a bearish candle.`,
        `- Stop: ${fmtPrice(sym, stop)} (above pullback high).`,
        `- Targets: ${fmtPrice(sym, tgt)} and trail above lower highs.`,
      ].join('\n'));
    }

    // 2) Range breakout
    {
      const buffer = atr * 0.5;
      const longTrig = hi20 + buffer;
      const shortTrig = lo20 - buffer;
      const stopLong = lo20 - atr;
      const stopShort = hi20 + atr;
      out.push([
        'Range Breakout:',
        `- Setup: trade a break from the 20-period range (${fmtPrice(sym, lo20)}–${fmtPrice(sym, hi20)}).`,
        `- Long: stop order ${fmtPrice(sym, longTrig)} | Stop: ${fmtPrice(sym, stopLong)} | Scale at +2R/+3R.`,
        `- Short: stop order ${fmtPrice(sym, shortTrig)} | Stop: ${fmtPrice(sym, stopShort)} | Scale at +2R/+3R.`,
      ].join('\n'));
    }

    // 3) Volatility contraction breakout (NR-style)
    if(lowVol){
      const up = last + 1.5*atr;
      const dn = last - 1.5*atr;
      out.push([
        'Volatility Contraction Breakout:',
        `- Setup: compression near recent low volatility; look for expansion.`,
        `- Long: above ${fmtPrice(sym, up)} with stop ${fmtPrice(sym, last - 1*atr)}.`,
        `- Short: below ${fmtPrice(sym, dn)} with stop ${fmtPrice(sym, last + 1*atr)}.`,
      ].join('\n'));
    }

    // 4) Momentum continuation
    if(Math.abs(slope20) > 0 && Math.abs(slope50) > 0){
      const dir = slope20>0 ? 'Long' : 'Short';
      const entry = slope20>0 ? (last - 1*atr) : (last + 1*atr);
      const stop = slope20>0 ? (entry - 2*atr) : (entry + 2*atr);
      const tgt = slope20>0 ? (last + 3*atr) : (last - 3*atr);
      out.push([
        'Momentum Continuation:',
        `- Bias: ${dir.toLowerCase()} momentum (MA slopes aligned).`,
        `- Entry: ${dir} on minor pullback near ${fmtPrice(sym, entry)}.`,
        `- Stop: ${fmtPrice(sym, stop)} | Target: ${fmtPrice(sym, tgt)}.`,
      ].join('\n'));
    }

    return out;
  }
  function lastLocalHighs(arr){
    const highs = [];
    for(let i=1;i<arr.length-1;i++){
      if(arr[i] >= arr[i-1] && arr[i] >= arr[i+1]) highs.push({i, v:arr[i]});
    }
    return highs;
  }
  function lastLocalLows(arr){
    const lows = [];
    for(let i=1;i<arr.length-1;i++){
      if(arr[i] <= arr[i-1] && arr[i] <= arr[i+1]) lows.push({i, v:arr[i]});
    }
    return lows;
  }
  function analyzeICT(series){
    const px = toPrices(series);
    const tm = toTimes(series);
    const L = px.length;
    if(L < 10) return { ok:false, reason:'Insufficient data' };
    const last = px[L-1];
    // Recent range
    const hi = Math.max(...px);
    const lo = Math.min(...px);
    const mid = (hi+lo)/2;
    const pd = last >= mid ? 'premium' : 'discount';
    // Trend via SMA slopes
    const maShort = sma(px, Math.min(10, L));
    const maLong = sma(px, Math.min(20, L));
    const shortSlope = maShort[L-1] - maShort[Math.max(0, L-3)];
    const longSlope = maLong[L-1] - maLong[Math.max(0, L-6)];
    const bias = (shortSlope>0 && longSlope>0) ? 'bullish' : (shortSlope<0 && longSlope<0) ? 'bearish' : 'neutral';
    // Equal highs/lows detection (simple tolerance)
    const highs = lastLocalHighs(px);
    const lows = lastLocalLows(px);
    const tol = 0.0005; // ~5 pips for majors; metals will be looser proportionally
    const nearEq = (a,b)=> Math.abs(a-b) <= tol * ((a+b)/2);
    let eqHighs=false, eqLows=false;
    if(highs.length>=2){ const a = highs[highs.length-1].v, b = highs[highs.length-2].v; eqHighs = nearEq(a,b); }
    if(lows.length>=2){ const a = lows[lows.length-1].v, b = lows[lows.length-2].v; eqLows = nearEq(a,b); }
    // Last impulse leg (rough): between last significant low->high (if bullish) or high->low (if bearish)
    const lastHigh = highs[highs.length-1] || {i:px.indexOf(hi), v:hi};
    const lastLow = lows[lows.length-1] || {i:px.indexOf(lo), v:lo};
    let legStart = lastLow, legEnd = lastHigh;
    if(bias==='bearish'){ legStart = lastHigh; legEnd = lastLow; }
    if(legStart.i > legEnd.i){ // ensure chronological
      const t = legStart; legStart = legEnd; legEnd = t;
    }
    const legLen = Math.max(1, Math.abs(legEnd.v - legStart.v));
    // OTE retracement zone (62% - 79%) from legEnd back towards legStart
    const r62 = legEnd.v - 0.62*(legEnd.v - legStart.v);
    const r79 = legEnd.v - 0.79*(legEnd.v - legStart.v);
    const oteLow = Math.min(r62, r79);
    const oteHigh = Math.max(r62, r79);
    return {
      ok:true,
      last, hi, lo, mid, pd, bias,
      eqHighs, eqLows,
      legStart, legEnd,
      oteLow, oteHigh,
      timeLast: tm[L-1]
    };
  }

  async function fetchInsights(symbol, horizon){
    const el = $('#analysis-content');
    if(el){ el.textContent = 'Loading insights…'; el.classList.add('text-muted'); }
    try{
      // Build context notes from News and Calendar
      const notes = buildContextNotes(symbol);
      const res = await fetch('/insights', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbol, horizon, notes }) });
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
    const n = parseInt($('#range')?.value || '50', 10) || 50;
    if(!lastQuote){ return 'No quote available yet.'; }
    const ict = analyzeICT(recentSeries);
    const px = lastQuote.price;
    const parts = [];
    parts.push(`Symbol: ${sym}`);
    parts.push(`Context: last ${n} points, latest=${fmtPrice(sym, px)}`);
    if(ict.ok){
      parts.push(`Bias: ${ict.bias} | PD Array: ${ict.pd} (mid ${fmtPrice(sym, ict.mid)})`);
      // Liquidity narrative
      const liq = [];
      if(ict.eqHighs) liq.push('equal highs (buy-side liquidity)');
      if(ict.eqLows) liq.push('equal lows (sell-side liquidity)');
      parts.push(`Liquidity: ${liq.length? liq.join(', ') : 'mixed; look for resting pools above/below recent extremes'}`);
      // OTE zone
      parts.push(`OTE zone: ${fmtPrice(sym, ict.oteLow)} – ${fmtPrice(sym, ict.oteHigh)} (62–79% of last impulse)`);
      // Entry approach based on bias
      if(ict.bias==='bullish'){
        parts.push(`Entry: wait for a sweep of sell-side liquidity (below recent lows), displacement up, then refine entry in OTE (${fmtPrice(sym, ict.oteLow)}–${fmtPrice(sym, ict.oteHigh)}) towards a FVG/CE.`);
        parts.push(`Stop: below recent swing low ${fmtPrice(sym, ict.legStart.v)} (beyond liquidity).`);
        parts.push(`Targets: take buy-side liquidity at ${fmtPrice(sym, ict.legEnd.v)} and partials at CE/previous highs.`);
      } else if(ict.bias==='bearish'){
        parts.push(`Entry: wait for a sweep of buy-side liquidity (above recent highs), displacement down, then refine entry in OTE (${fmtPrice(sym, ict.oteLow)}–${fmtPrice(sym, ict.oteHigh)}) into a bearish FVG/OB.`);
        parts.push(`Stop: above recent swing high ${fmtPrice(sym, ict.legStart.v)} (beyond liquidity).`);
        parts.push(`Targets: take sell-side liquidity at ${fmtPrice(sym, ict.legEnd.v)} and partials at CE/previous lows.`);
      } else {
        parts.push(`Bias unclear: consider waiting for a market structure shift and displacement before engaging. Use OTE ${fmtPrice(sym, ict.oteLow)}–${fmtPrice(sym, ict.oteHigh)} once bias forms.`);
      }
      // Risk guidance
      parts.push(`Risk: 0.5–1.0% per idea; partials at 1R/2R; move stop to breakeven after liquidity take.`);
      // Killzones
      parts.push(`Killzones (EST): London 2:00–5:00 | NY 7:00–10:00 (news-sensitive around 8:30).`);
    } else {
      // Fallback: propose alternative high-probability strategies
      parts.push('Bias: neutral (insufficient data for ICT metrics)');
      parts.push('Alternative strategies:');
      const alts = buildAltStrategies(sym);
      if(alts.length){
        parts.push('');
        parts.push(alts.join('\n\n'));
      } else {
        const atrGuess = getAtrGuess(sym);
        const stop = px - atrGuess*2;
        const target = px + atrGuess*3;
        parts.push(`- Simple R:R anchor — Stop: ${fmtPrice(sym, stop)} | Target: ${fmtPrice(sym, target)} | ~1:1.5`);
      }
    }
    // Macro/news context
    const context = buildContextNotes(sym);
    if(context){
      parts.push('');
      parts.push('Context notes (news & macro):');
      parts.push(context);
    }
    const plan = parts.join('\n');
    lastPlan = plan;
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
  selected = s; offset = 0; try{ $('#filter-symbol').value = s; }catch{}
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
  }

  function setAutoRefresh(enabled){
    const INTERVAL_MS = 15000; // 15s
    if(autoTimer){ clearInterval(autoTimer); autoTimer = null; }
  if(enabled){ autoTimer = setInterval(async ()=>{ if(selected) await loadSymbolSeries(selected); await refreshWatchlistQuotes(); }, INTERVAL_MS); }
  }

  // Event bindings
  $('#refresh')?.addEventListener('click', async ()=>{ if(selected) await loadSymbolSeries(selected); });
  $('#prev')?.addEventListener('click', async ()=>{});
  $('#next')?.addEventListener('click', async ()=>{});
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

  $('#ingest-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
  const inputEl = $('#symbol'); if(!inputEl) return;
    const raw = inputEl.value.trim().toUpperCase();
    const cleaned = raw.replace(/[^A-Z]/g, ''); // remove slashes/spaces etc.
    const isFxLike = /^[A-Z]{6}$/.test(cleaned) || /^X[A-Z]{2}USD$/.test(cleaned);
    const url = isFxLike ? '/ingest/fx' : '/ingest/alpha_vantage';
    const payload = isFxLike ? { pair: cleaned } : { symbol: raw };
  const btn = $('#ingest-btn'); const out = $('#ingest-result');
    if(btn){ btn.disabled = true; btn.textContent = 'Ingesting…'; }
  if(out) out.textContent = '';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if(res.ok){
      const data = await res.json();
      const saved = data.saved || {};
      const s = saved.symbol || (isFxLike ? cleaned : raw);
  if(out){ out.classList.remove('text-danger'); out.classList.add('text-muted'); out.textContent = `Saved ${s} @ ${saved.price ?? ''}`; }
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
  if(out){ out.classList.remove('text-muted'); out.classList.add('text-danger'); out.textContent = `Error: ${err.detail || err.message || res.statusText} (${res.status})`; }
    }
    if(btn){ btn.disabled = false; btn.textContent = 'Ingest'; }
  });

  $('#insights-refresh')?.addEventListener('click', async ()=>{
    if(!selected) return;
    const horizon = $('#insights-horizon').value || 'daily';
    await fetchInsights(selected, horizon);
    // Chart removed: annotations no longer applied
  });

  $('#plan-generate')?.addEventListener('click', async ()=>{
    const out = $('#entry-plan');
    if(!selected){ if(out) out.textContent = 'Select a symbol first.'; return; }
    try{
      const plan = buildEntryPlan(selected);
      if(out) out.textContent = plan;
      // Persist if different from latest
      try{
        const latest = await fetch(`/entry_plans?symbol=${encodeURIComponent(selected)}&limit=1`).then(r=>r.ok?r.json():{items:[]});
        const lastText = latest?.items?.[0]?.text || '';
        if(String(lastText) !== String(plan)){
          await fetch('/entry_plans', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbol: selected, text: plan, horizon: ($('#insights-horizon')?.value||'daily'), source: 'local', notes: buildContextNotes(selected), images: 0 }) });
          try{ refreshPlanHistory(); }catch{}
        }
      }catch{}
    }catch(err){ if(out){ out.textContent = 'Failed to generate plan (see console).'; } console.error('Entry plan error', err); }
  });

  // Vision-assisted ICT plan
  const fileInput = document.getElementById('plan-images');
  const previewWrap = document.getElementById('plan-image-previews');
  const clearBtn = document.getElementById('plan-images-clear');
  async function filesToDataUrls(files){
    const arr = [];
    const max = Math.min(files.length, 5);
    for(let i=0;i<max;i++){
      const f = files[i];
      const url = await new Promise((resolve, reject)=>{
        const reader = new FileReader(); reader.onload = ()=> resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(f);
      });
      arr.push(String(url));
    }
    return arr;
  }
  fileInput?.addEventListener('change', ()=>{
    if(!previewWrap) return;
    previewWrap.innerHTML = '';
    const files = fileInput.files || [];
    const max = Math.min(files.length, 5);
    for(let i=0;i<max;i++){
      const img = document.createElement('img');
      const url = URL.createObjectURL(files[i]);
      img.src = url;
      img.style.maxWidth = '120px'; img.style.maxHeight = '80px'; img.className = 'rounded border';
      img.onload = ()=>{ try{ URL.revokeObjectURL(url); }catch{} };
      previewWrap.appendChild(img);
    }
  });

  clearBtn?.addEventListener('click', ()=>{
    try{ fileInput.value = ''; }catch{}
    if(previewWrap) previewWrap.innerHTML = '';
  });

  document.getElementById('plan-generate-vision')?.addEventListener('click', async ()=>{
    const out = $('#entry-plan');
    if(!selected){ if(out) out.textContent = 'Select a symbol first.'; return; }
    if(out){ out.textContent = 'Analyzing screenshots with ICT…'; out.classList.add('text-muted'); }
    try{
      const images = fileInput?.files?.length ? await filesToDataUrls(fileInput.files) : [];
      // Build a concise coaching note with context
      const notes = [
        'Use ICT concepts: liquidity (SSL/BSL), displacement, PD arrays, OTE (62-79%), FVG/OB, and killzones.',
        buildContextNotes(selected)
      ].filter(Boolean).join('\n');
      const res = await fetch('/insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selected, horizon: 'daily', notes, images })
      });
      if(!res.ok){
        let msg = `Vision plan failed (${res.status})`;
        try{ const err = await res.json(); if(err?.detail||err?.message){ msg += `: ${err.detail||err.message}`; } }catch{}
        if(out){ out.textContent = msg; out.classList.remove('text-muted'); }
        return;
      }
      const data = await res.json();
  const plan = data.summary || 'No plan generated.';
  if(out){ out.textContent = plan; out.classList.remove('text-muted'); }
      // Persist if different from latest
      try{
        const latest = await fetch(`/entry_plans?symbol=${encodeURIComponent(selected)}&limit=1`).then(r=>r.ok?r.json():{items:[]});
        const lastText = latest?.items?.[0]?.text || '';
        if(String(lastText) !== String(plan)){
          await fetch('/entry_plans', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ symbol: selected, text: plan, horizon: 'daily', source: 'vision', notes: buildContextNotes(selected), images: (fileInput?.files?.length||0) }) });
          try{ refreshPlanHistory(); }catch{}
        }
      }catch{}
    }catch(err){
      if(out){ out.textContent = 'Error generating plan with screenshots.'; out.classList.remove('text-muted'); }
      console.error('Vision plan error', err);
    }
  });

  async function refreshPlanHistory(){
    try{
      const ul = document.getElementById('entry-plan-history'); if(!ul) return;
      const url = selected ? `/entry_plans?symbol=${encodeURIComponent(selected)}&limit=20` : '/entry_plans?limit=20';
      const res = await fetch(url); if(!res.ok) return;
      const data = await res.json();
      const items = Array.isArray(data.items)?data.items:[];
      ul.innerHTML = '';
      for(const it of items){
        const li = document.createElement('li');
        li.className = 'list-group-item';
        const id = `plan-item-${it.id || Math.random().toString(36).slice(2)}`;
        const ts = (it.created_at||'').replace('T',' ').slice(0,16);
        li.innerHTML = `
          <div class="d-flex align-items-baseline gap-2">
            <button class="btn btn-sm btn-outline-light" data-toggle="${id}">Toggle</button>
            <span class="badge bg-secondary">${it.source||'local'}</span>
            <span class="text-muted">${ts}</span>
            <span class="ms-auto text-muted">${it.horizon||''}</span>
          </div>
          <div id="${id}" class="mt-2 d-none" style="white-space:pre-wrap">${(it.text||'')}</div>
        `;
        // Toggle collapsible
        li.querySelector(`[data-toggle="${id}"]`)?.addEventListener('click', ()=>{
          const body = document.getElementById(id); if(!body) return;
          body.classList.toggle('d-none');
        });
        // Clicking non-button area loads into main plan
        li.addEventListener('click', (ev)=>{
          if(ev.target.closest('button')) return; // ignore button clicks
          const out=$('#entry-plan'); if(out) out.textContent = it.text||'';
        });
        ul.appendChild(li);
      }
    }catch{}
  }
  document.getElementById('plan-history-refresh')?.addEventListener('click', refreshPlanHistory);
  document.getElementById('plan-history-expand-all')?.addEventListener('click', ()=>{
    document.querySelectorAll('#entry-plan-history > li > div[id]').forEach(el=> el.classList.remove('d-none'));
  });
  document.getElementById('plan-history-collapse-all')?.addEventListener('click', ()=>{
    document.querySelectorAll('#entry-plan-history > li > div[id]').forEach(el=> el.classList.add('d-none'));
  });

  // Tabs: Dashboard / Journal / Wealth
  const tabDashBtn = document.getElementById('tab-dashboard-btn');
  const tabJournalBtn = document.getElementById('tab-journal-btn');
  const tabWealthBtn = document.getElementById('tab-wealth-btn');
  const tabDash = document.getElementById('tab-dashboard');
  const tabJournal = document.getElementById('tab-journal');
  const tabWealth = document.getElementById('tab-wealth');
  function showTab(name){
    const tabs = { dashboard: tabDash, journal: tabJournal, wealth: tabWealth };
    const btns = { dashboard: tabDashBtn, journal: tabJournalBtn, wealth: tabWealthBtn };
    Object.values(tabs).forEach(el=> el?.classList.add('d-none'));
    Object.values(btns).forEach(el=> el?.classList.remove('active'));
    tabs[name]?.classList.remove('d-none');
    btns[name]?.classList.add('active');
    if(name === 'journal'){
      renderJournal();
    } else if(name === 'wealth'){
      initWealthTab();
    }
  }
  tabDashBtn?.addEventListener('click', ()=> showTab('dashboard'));
  tabJournalBtn?.addEventListener('click', ()=> showTab('journal'));
  tabWealthBtn?.addEventListener('click', ()=> showTab('wealth'));

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
  try{ $('#filter-symbol').value = selected; }catch{}
    await autoIngestOnSelect(selected).catch(console.warn);
  await loadSymbolSeries(selected);
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

  // ===== Wealth management helpers =====
  async function wmFetchPortfolios(){
    const res = await fetch('/portfolios');
    if(!res.ok) throw new Error('Failed to load portfolios');
    const data = await res.json();
    portfoliosCache = Array.isArray(data.items) ? data.items : [];
    return portfoliosCache;
  }

  function wmRenderPortfolios(){
    const ul = document.getElementById('wm-portfolio-list'); if(!ul) return;
    ul.innerHTML = '';
    portfoliosCache.forEach(p=>{
      const li = document.createElement('li');
      li.className = 'd-flex align-items-center justify-content-between py-1 border-bottom';
      li.innerHTML = `
        <div class="d-flex flex-column">
          <strong>${p.name}</strong>
          <span class="text-muted small">Base: ${p.base_currency || '—'}</span>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-outline-primary" data-act="select">Open</button>
          <button class="btn btn-sm btn-outline-danger" data-act="delete">Delete</button>
        </div>
      `;
      li.querySelector('[data-act="select"]').addEventListener('click', ()=> wmSelectPortfolio(p.id));
      li.querySelector('[data-act="delete"]').addEventListener('click', async ()=>{
        if(!confirm(`Delete portfolio "${p.name}"?`)) return;
        await fetch(`/portfolios/${p.id}`, { method:'DELETE' });
        await wmFetchPortfolios();
        if(selectedPortfolioId === p.id){ selectedPortfolioId = null; document.getElementById('wm-portfolio-caption').textContent = '—'; wmRenderTransactions([]); wmRenderPositions([]); }
        wmRenderPortfolios();
      });
      ul.appendChild(li);
    });
  }

  async function wmSelectPortfolio(pid){
    selectedPortfolioId = pid;
    const p = portfoliosCache.find(x=>x.id===pid);
    const cap = document.getElementById('wm-portfolio-caption'); if(cap) cap.textContent = p ? `${p.name}` : `#${pid}`;
    await Promise.all([wmLoadTransactions(), wmLoadPositions()]);
  }

  async function wmLoadTransactions(){
    const tbody = document.querySelector('#wm-txn-table tbody'); if(!tbody || !selectedPortfolioId){ if(tbody) tbody.innerHTML=''; return; }
    const res = await fetch(`/portfolios/${selectedPortfolioId}/transactions`);
    if(!res.ok){ tbody.innerHTML = ''; return; }
    const data = await res.json();
    wmRenderTransactions(data.items || []);
  }

  function wmRenderTransactions(items){
    const tbody = document.querySelector('#wm-txn-table tbody'); if(!tbody) return;
    tbody.innerHTML = '';
    items.sort((a,b)=> new Date(b.date) - new Date(a.date));
    for(const t of items){
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${(t.date||'').slice(0,10)}</td>
        <td>${t.symbol||''}</td>
        <td>${t.type||''}</td>
        <td>${t.qty ?? ''}</td>
        <td>${t.price ?? ''}</td>
        <td>${t.fees ?? ''}</td>
        <td><button class="btn btn-sm btn-outline-danger">Delete</button></td>
      `;
      tr.querySelector('button')?.addEventListener('click', async ()=>{
        await fetch(`/transactions/${t.id}`, { method:'DELETE' });
        await Promise.all([wmLoadTransactions(), wmLoadPositions()]);
      });
      tbody.appendChild(tr);
    }
  }

  async function wmLoadPositions(){
    const tbody = document.querySelector('#wm-pos-table tbody'); if(!tbody || !selectedPortfolioId){ if(tbody) tbody.innerHTML=''; return; }
    const res = await fetch(`/portfolios/${selectedPortfolioId}/positions`);
    if(!res.ok){ tbody.innerHTML = ''; return; }
    const data = await res.json();
    wmRenderPositions(data.items || []);
  }

  function wmRenderPositions(items){
    const tbody = document.querySelector('#wm-pos-table tbody'); if(!tbody) return;
    tbody.innerHTML = '';
    for(const p of items){
      const tr = document.createElement('tr');
      const last = (p.last ?? '—');
      const mv = (p.market_value ?? '—');
      tr.innerHTML = `
        <td>${p.symbol}</td>
        <td>${(p.qty ?? 0).toFixed ? (Number(p.qty).toFixed(4)) : p.qty}</td>
        <td>${Number(p.avg_cost ?? 0).toFixed(4)}</td>
        <td>${typeof last==='number'? Number(last).toFixed(4) : last}</td>
        <td>${typeof mv==='number'? Number(mv).toFixed(2) : mv}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  // Bind portfolio form
  document.getElementById('wm-portfolio-form')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('wm-portfolio-name').value.trim();
    const base = document.getElementById('wm-portfolio-base').value.trim().toUpperCase() || null;
    if(!name) return;
    const payload = { name, base_currency: base };
    const res = await fetch('/portfolios', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if(res.ok){
      await wmFetchPortfolios();
      wmRenderPortfolios();
      const saved = await res.json().catch(()=>null);
      if(saved?.id){ await wmSelectPortfolio(saved.id); }
      // reset
      document.getElementById('wm-portfolio-name').value = '';
      document.getElementById('wm-portfolio-base').value = '';
    }
  });

  // Bind transaction form
  document.getElementById('wm-txn-form')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(!selectedPortfolioId) return;
    const date = document.getElementById('wm-txn-date').value || new Date().toISOString().slice(0,10);
    const symbol = document.getElementById('wm-txn-symbol').value.trim().toUpperCase();
    const type = document.getElementById('wm-txn-type').value;
    const qty = Number(document.getElementById('wm-txn-qty').value || 0);
    const price = Number(document.getElementById('wm-txn-price').value || 0);
    const fees = Number(document.getElementById('wm-txn-fees').value || 0);
    const notes = document.getElementById('wm-txn-notes').value || null;
    if(!symbol || !type) return;
    const payload = { portfolio_id: selectedPortfolioId, date, symbol, type, qty, price, fees, notes };
    const res = await fetch(`/portfolios/${selectedPortfolioId}/transactions`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if(res.ok){
      await Promise.all([wmLoadTransactions(), wmLoadPositions()]);
      // reset some fields
      document.getElementById('wm-txn-symbol').value = '';
      document.getElementById('wm-txn-qty').value = '';
      document.getElementById('wm-txn-price').value = '';
      document.getElementById('wm-txn-fees').value = '';
      document.getElementById('wm-txn-notes').value = '';
    }
  });

  async function initWealthTab(){
    try{
      await wmFetchPortfolios();
      wmRenderPortfolios();
      if(!selectedPortfolioId && portfoliosCache[0]){
        await wmSelectPortfolio(portfoliosCache[0].id);
      } else {
        await Promise.all([wmLoadTransactions(), wmLoadPositions()]);
      }
    }catch(err){ console.warn('Wealth init failed', err); }
  }
})();
