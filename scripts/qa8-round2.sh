#!/bin/bash
# Phase 8 QA round 2 — windowing fix + drawer visibility
cd /home/z/my-project
(setsid bun run dev >> dev.log 2>&1 &)
sleep 30
echo "=== server: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000) ==="

agent-browser close --all >/dev/null 2>&1
agent-browser set viewport 1280 800 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 12
agent-browser console --action clear >/dev/null 2>&1

echo "=== 1. DRAWER HIDDEN ON DESKTOP (before any selection) ==="
agent-browser eval "JSON.stringify({
  drawerNode: (()=>{const el=[...document.querySelectorAll('div')].find(d=>d.className?.toString().includes('92dvh')); return el ? {exists:true, display:getComputedStyle(el).display, visible: el.getBoundingClientRect().height>10} : {exists:false};})(),
  overlayVisible: (()=>{const o=document.querySelector('.fixed.inset-0.z-40'); return o ? {exists:true, display:getComputedStyle(o).display} : {exists:false};})()
})" 2>&1 | tail -1

echo "=== 2. SELECT COMMIT -> DESKTOP ASIDE + DRAWER STILL HIDDEN ==="
agent-browser eval "(() => { const row=document.querySelector('[aria-label^=\"Commit \"]'); row?.click(); return 'clicked'; })()" 2>&1 | tail -1
sleep 2
agent-browser eval "JSON.stringify({
  asideVisible: (()=>{const a=document.querySelector('aside[aria-label=\"Commit details\"]'); return a ? Math.round(a.getBoundingClientRect().width) : 'none';})(),
  drawerDisplay: (()=>{const el=[...document.querySelectorAll('div')].find(d=>d.className?.toString().includes('92dvh')); return el ? getComputedStyle(el).display : 'not-in-dom';})()
})" 2>&1 | tail -1

echo "=== 3. WINDOWING: 10x LOAD MORE ==="
agent-browser eval "(async () => {
  const btn = () => [...document.querySelectorAll('button')].find(b=>/Load .*more/.test(b.textContent));
  for (let i=0;i<10;i++) { const b=btn(); if(!b) break; b.click(); await new Promise(r=>setTimeout(r,150)); }
  return 'done';
})()" 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify({
  showing: [...document.querySelectorAll('.ml-auto')].map(e=>e.textContent).find(t=>/showing/.test(t))?.trim(),
  loadEarlier: [...document.querySelectorAll('button')].find(b=>/Load .*earlier/.test(b.textContent))?.textContent.trim(),
  rowCap: [...document.querySelectorAll('main li')].filter(l=>/ago$/.test(l.textContent.trim().slice(-3)) || /^Release/.test(l.textContent)).length
})" 2>&1 | tail -1

echo "=== 4. LOAD EARLIER (walk back up) ==="
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/Load .*earlier/.test(x.textContent)); b?.click(); return b ? 'clicked' : 'missing'; })()" 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify({
  showing: [...document.querySelectorAll('.ml-auto')].map(e=>e.textContent).find(t=>/showing/.test(t))?.trim(),
  loadEarlier: [...document.querySelectorAll('button')].find(b=>/Load .*earlier/.test(b.textContent))?.textContent.trim()
})" 2>&1 | tail -1

echo "=== 5. CONSOLE ==="
agent-browser console 2>&1 | grep -c "^\[error\]"
echo "=== DONE ==="
