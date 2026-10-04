#!/bin/bash
# Phase 8 QA round 4 — real pointer events: overlay close + escape close
cd /home/z/my-project
(setsid bun run dev >> dev.log 2>&1 &)
sleep 30
echo "=== server: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000) ==="

agent-browser close --all >/dev/null 2>&1
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 12

echo "=== 1. OPEN SHEET (tap a commit row) ==="
agent-browser eval "(() => { const rows=[...document.querySelectorAll('[aria-label^=\"Commit \"]')].filter(r=>r.getAttribute('role')==='button'); rows[rows.length-1]?.click(); return 'ok'; })()" 2>&1 | tail -1
sleep 2
agent-browser eval "JSON.stringify({ sheetOpen: !!document.querySelector('.fixed.z-50') })" 2>&1 | tail -1

echo "=== 2. REAL CLICK ON OVERLAY ==="
agent-browser click ".fixed.inset-0.z-40" 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify({ sheetGone: ![...document.querySelectorAll('div')].some(d=>d.className?.toString().includes('92dvh') && getComputedStyle(d).display!=='none') })" 2>&1 | tail -1

echo "=== 3. REOPEN + ESCAPE CLOSE ==="
agent-browser eval "(() => { const rows=[...document.querySelectorAll('[aria-label^=\"Commit \"]')].filter(r=>r.getAttribute('role')==='button'); rows[rows.length-1]?.click(); return 'ok'; })()" 2>&1 | tail -1
sleep 2
agent-browser press Escape 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify({ sheetGoneAfterEsc: ![...document.querySelectorAll('div')].some(d=>d.className?.toString().includes('92dvh') && getComputedStyle(d).display!=='none') })" 2>&1 | tail -1

echo "=== 4. SHEET BODY SCROLLS (diff browse space) ==="
agent-browser eval "(() => { const rows=[...document.querySelectorAll('[aria-label^=\"Commit \"]')].filter(r=>r.getAttribute('role')==='button'); rows[rows.length-1]?.click(); return 'ok'; })()" 2>&1 | tail -1
sleep 3
agent-browser eval "JSON.stringify({
  scrollable: (()=>{const el=[...document.querySelectorAll('.overflow-y-auto')].find(d=>d.closest('.fixed.z-50')); return el ? {clientH: el.clientHeight, scrollH: el.scrollHeight} : 'none';})()
})" 2>&1 | tail -1

echo "=== 5. CONSOLE ==="
agent-browser console 2>&1 | grep -c "^\[error\]"
echo "=== DONE ==="
