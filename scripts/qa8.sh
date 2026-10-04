#!/bin/bash
# Phase 8 QA script — starts dev server, runs full agent-browser QA
cd /home/z/my-project

# start dev server (lives as long as this command runs)
(setsid bun run dev >> dev.log 2>&1 &)
sleep 30
echo "=== server: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000) ==="

# fresh browser session
agent-browser close --all >/dev/null 2>&1
agent-browser set viewport 1280 800 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 12
agent-browser console --action clear >/dev/null 2>&1

echo "=== 1. PAGE BASIC ==="
agent-browser eval "JSON.stringify({
  title: document.title,
  activities: [...document.querySelectorAll('main span')].find(s=>/activities$/.test(s.textContent.trim()) && /\\d/.test(s.textContent))?.textContent.trim(),
  releases: [...document.querySelectorAll('main span')].some(s=>/305 releases/.test(s.textContent)),
  releaseCard: !!([...document.querySelectorAll('.text-sm')].find(e=>/Release Timeline/.test(e.textContent||''))),
  releaseLanes: [...document.querySelectorAll('[aria-label*=\"Release timeline\"] .relative.h-6')].length,
  releaseDots: [...document.querySelectorAll('[aria-label*=\"Release timeline\"] button')].length,
  latestLabel: [...document.querySelectorAll('main span')].find(s=>/latest v/.test(s.textContent))?.textContent
})" 2>&1 | tail -1

echo "=== 2. RELEASE DOT CLICK -> GRAPH ==="
agent-browser eval "(() => { const dots=[...document.querySelectorAll('[aria-label*=\"Release timeline\"] button')]; const latest=dots[dots.length-1]; latest?.click(); return 'clicked:'+dots.length; })()" 2>&1 | tail -1
sleep 3
agent-browser eval "JSON.stringify({
  scrollY: Math.round(window.scrollY),
  panelOpen: !!document.querySelector('aside[aria-label=\"Commit details\"]'),
  panelTitle: document.querySelector('aside h3')?.textContent?.slice(0,40)
})" 2>&1 | tail -1

echo "=== 3. DESKTOP ASIDE (sidebar) ==="
agent-browser eval "JSON.stringify({
  asideW: Math.round(document.querySelector('aside[aria-label=\"Commit details\"]')?.getBoundingClientRect().width ?? 0),
  sheetInDom: !!document.querySelector('.fixed.z-50')
})" 2>&1 | tail -1

echo "=== 4. TIMELINE WINDOWING (8x load more) ==="
agent-browser eval "(async () => {
  const btn = () => [...document.querySelectorAll('button')].find(b=>/Load .*more/.test(b.textContent));
  for (let i=0;i<8;i++) { const b=btn(); if(!b) break; b.click(); await new Promise(r=>setTimeout(r,120)); }
  return 'done';
})()" 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify({
  loadEarlier: [...document.querySelectorAll('button')].find(b=>/Load .*earlier/.test(b.textContent))?.textContent.trim(),
  showing: [...document.querySelectorAll('.ml-auto')].map(e=>e.textContent).find(t=>/showing/.test(t))?.trim()
})" 2>&1 | tail -1

echo "=== 5. CONSOLE ERRORS ==="
agent-browser console 2>&1 | grep -c "^\[error\]"

echo "=== 6. MOBILE DRAWER (390px) ==="
agent-browser set viewport 390 844 >/dev/null 2>&1
sleep 3
agent-browser eval "document.querySelector('aside[aria-label=\"Commit details\"]') === null ? 'aside-gone' : 'aside-still'" 2>&1 | tail -1
agent-browser eval "(() => { const row=document.querySelector('[aria-label^=\"Commit \"]'); row?.click(); return row ? 'row-clicked' : 'no-row'; })()" 2>&1 | tail -1
sleep 3
agent-browser eval "JSON.stringify({
  sheetH: (()=>{const el=[...document.querySelectorAll('div')].find(d=>d.className?.toString().includes('92dvh')); return el ? Math.round(el.getBoundingClientRect().height) : 'NOT-FOUND';})(),
  dragHandle: !!document.querySelector('.h-1.w-10.rounded-full'),
  overlay: !!document.querySelector('.fixed.inset-0.z-40'),
  sheetTitle: document.querySelector('.fixed.z-50 h3')?.textContent?.slice(0,30),
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
})" 2>&1 | tail -1
agent-browser screenshot /home/z/my-project/scripts/phase8-mobile-sheet.png >/dev/null 2>&1
echo "mobile screenshot saved"

echo "=== 7. BACK TO DESKTOP + RELEASE CARD SHOT ==="
agent-browser set viewport 1280 800 >/dev/null 2>&1
sleep 2
agent-browser eval "(() => { const card=[...document.querySelectorAll('main .overflow-hidden')].find(c=>/Release Timeline/.test(c.textContent)); card?.scrollIntoView({block:'center'}); return 'ok'; })()" 2>&1 | tail -1
sleep 1
agent-browser screenshot /home/z/my-project/scripts/phase8-release-card.png >/dev/null 2>&1
echo "release card screenshot saved"

echo "=== 8. FINAL CONSOLE ==="
agent-browser console 2>&1 | grep -c "^\[error\]"
echo "=== QA SCRIPT DONE ==="
