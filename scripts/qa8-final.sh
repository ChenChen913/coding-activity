#!/bin/bash
# Phase 8 QA FINAL — wait-for-ready + real events + VLM screenshots
cd /home/z/my-project
(setsid bun run dev >> dev.log 2>&1 &)
sleep 30
echo "=== server: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000) ==="

agent-browser close --all >/dev/null 2>&1

# ---------- MOBILE ----------
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1

# poll until commit rows are interactive
for i in $(seq 1 30); do
  N=$(agent-browser eval "document.querySelectorAll('[aria-label^=\"Commit \"]').length" 2>/dev/null | tail -1 | tr -d '"')
  if [ "$N" -gt 5 ] 2>/dev/null; then echo "rows ready: $N (after ${i}x2s)"; break; fi
  sleep 2
done
agent-browser console --action clear >/dev/null 2>&1

echo "=== M1. OPEN SHEET ==="
agent-browser eval "(() => { const rows=[...document.querySelectorAll('[aria-label^=\"Commit \"]')].filter(r=>r.getAttribute('role')==='button'); rows[rows.length-1].click(); return 'ok'; })()" 2>&1 | tail -1
sleep 2
agent-browser eval "JSON.stringify({ sheetOpen: !!document.querySelector('.fixed.z-50'), sheetH: (()=>{const el=[...document.querySelectorAll('div')].find(d=>d.className?.toString().includes('92dvh')); return el ? Math.round(el.getBoundingClientRect().height) : 0;})() })" 2>&1 | tail -1

echo "=== M2. BODY SCROLL SPACE (vs old 55vh=464px) ==="
agent-browser eval "JSON.stringify({ scrollable: (()=>{const el=[...document.querySelectorAll('.overflow-y-auto')].find(d=>d.closest('.fixed.z-50')); return el ? {clientH: el.clientHeight, scrollH: el.scrollHeight} : 'none';})() })" 2>&1 | tail -1
agent-browser screenshot /home/z/my-project/scripts/phase8-sheet-open.png >/dev/null 2>&1
echo "sheet screenshot saved"

echo "=== M3. REAL OVERLAY TAP CLOSES ==="
agent-browser click ".fixed.inset-0.z-40" 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify({ closed: ![...document.querySelectorAll('div')].some(d=>d.className?.toString().includes('92dvh') && getComputedStyle(d).display!=='none') })" 2>&1 | tail -1

echo "=== M4. REOPEN + ESC CLOSES ==="
agent-browser eval "(() => { const rows=[...document.querySelectorAll('[aria-label^=\"Commit \"]')].filter(r=>r.getAttribute('role')==='button'); rows[rows.length-1].click(); return 'ok'; })()" 2>&1 | tail -1
sleep 2
agent-browser press Escape >/dev/null 2>&1
sleep 1
agent-browser eval "JSON.stringify({ escClosed: ![...document.querySelectorAll('div')].some(d=>d.className?.toString().includes('92dvh') && getComputedStyle(d).display!=='none') })" 2>&1 | tail -1

echo "=== M5. OVERFLOW + CONSOLE ==="
agent-browser eval "document.documentElement.scrollWidth - document.documentElement.clientWidth" 2>&1 | tail -1
agent-browser console 2>&1 | grep -c "^\[error\]"

# ---------- DESKTOP ----------
agent-browser set viewport 1280 800 >/dev/null 2>&1
sleep 3

echo "=== D1. RELEASE CARD VISIBLE + LANES ==="
agent-browser eval "(() => { const card=[...document.querySelectorAll('main .overflow-hidden')].find(c=>/Release Timeline/.test(c.textContent)); card?.scrollIntoView({block:'center'}); return 'ok'; })()" 2>&1 | tail -1
sleep 1
agent-browser screenshot /home/z/my-project/scripts/phase8-release-card.png >/dev/null 2>&1
echo "release card shot saved"

echo "=== D2. FINAL CONSOLE ==="
agent-browser console 2>&1 | grep -c "^\[error\]"
echo "=== DONE ==="
