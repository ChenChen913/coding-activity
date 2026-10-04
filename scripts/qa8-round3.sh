#!/bin/bash
# Phase 8 QA round 3 — windowing semantics + aside + mobile sheet regression
cd /home/z/my-project
(setsid bun run dev >> dev.log 2>&1 &)
sleep 30
echo "=== server: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000) ==="

agent-browser close --all >/dev/null 2>&1
agent-browser set viewport 1280 800 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 12
agent-browser console --action clear >/dev/null 2>&1

echo "=== 1. WINDOWING: 11x LOAD MORE (cap 640, then slide) ==="
agent-browser eval "(async () => {
  const btn = () => [...document.querySelectorAll('button')].find(b=>/Load .*more/.test(b.textContent));
  for (let i=0;i<11;i++) { const b=btn(); if(!b) break; b.click(); await new Promise(r=>setTimeout(r,150)); }
  return 'done';
})()" 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify({
  showing: [...document.querySelectorAll('.ml-auto')].map(e=>e.textContent).find(t=>/showing/.test(t))?.trim(),
  loadEarlier: [...document.querySelectorAll('button')].find(b=>/Load .*earlier/.test(b.textContent))?.textContent.trim()
})" 2>&1 | tail -1

echo "=== 2. LOAD EARLIER x2 (slide back, same size) ==="
agent-browser eval "(async () => {
  const btn = () => [...document.querySelectorAll('button')].find(b=>/Load .*earlier/.test(b.textContent));
  for (let i=0;i<2;i++) { const b=btn(); if(!b) break; b.click(); await new Promise(r=>setTimeout(r,150)); }
  return 'done';
})()" 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify({
  showing: [...document.querySelectorAll('.ml-auto')].map(e=>e.textContent).find(t=>/showing/.test(t))?.trim()
})" 2>&1 | tail -1

echo "=== 3. FILTER RESETS WINDOW ==="
agent-browser eval "[...document.querySelectorAll('[aria-pressed]')].find(b=>/Merges/.test(b.textContent))?.click(); 'merge'" 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify({
  showing: [...document.querySelectorAll('.ml-auto')].map(e=>e.textContent).find(t=>/showing/.test(t))?.trim(),
  noLoadEarlier: ![...document.querySelectorAll('button')].some(b=>/Load .*earlier/.test(b.textContent))
})" 2>&1 | tail -1
agent-browser eval "[...document.querySelectorAll('[aria-pressed]')].find(b=>/^All/.test(b.textContent))?.click(); 'reset'" 2>&1 | tail -1
sleep 1

echo "=== 4. DESKTOP ASIDE VIA GRAPH ROW CLICK ==="
agent-browser eval "(() => { const rows=[...document.querySelectorAll('[aria-label^=\"Commit \"]')].filter(r=>r.getAttribute('role')==='button'); rows[rows.length-1]?.click(); return 'clicked-'+rows.length; })()" 2>&1 | tail -1
sleep 2
agent-browser eval "JSON.stringify({
  asideW: (()=>{const a=document.querySelector('aside[aria-label=\"Commit details\"]'); return a ? Math.round(a.getBoundingClientRect().width) : 'NONE';})(),
  asideTitle: document.querySelector('aside[aria-label=\"Commit details\"] h3')?.textContent?.slice(0,40)
})" 2>&1 | tail -1

echo "=== 5. MOBILE SHEET REGRESSION (390px) ==="
agent-browser set viewport 390 844 >/dev/null 2>&1
sleep 3
agent-browser eval "JSON.stringify({
  asideDisplay: (()=>{const a=document.querySelector('aside[aria-label=\"Commit details\"]'); return a ? getComputedStyle(a).display : 'not-in-dom';})(),
  sheetNow: (()=>{const el=[...document.querySelectorAll('div')].find(d=>d.className?.toString().includes('92dvh')); return el ? {h: Math.round(el.getBoundingClientRect().height), display: getComputedStyle(el).display} : 'closed';})()
})" 2>&1 | tail -1

echo "=== 6. CLOSE SHEET (overlay click) ==="
agent-browser eval "document.querySelector('.fixed.inset-0.z-40')?.click(); 'overlay-clicked'" 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify({
  sheetGone: ![...document.querySelectorAll('div')].some(d=>d.className?.toString().includes('92dvh') && getComputedStyle(d).display!=='none')
})" 2>&1 | tail -1

echo "=== 7. CONSOLE ==="
agent-browser console 2>&1 | grep -c "^\[error\]"
echo "=== DONE ==="
