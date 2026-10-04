#!/bin/bash
# Phase 8 QA round 5 — diagnose mobile sheet open failure
cd /home/z/my-project
(setsid bun run dev >> dev.log 2>&1 &)
sleep 30
echo "=== server: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000) ==="

agent-browser close --all >/dev/null 2>&1
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 12

echo "=== 1. WHAT COMMIT ROWS EXIST AT 390px? ==="
agent-browser eval "JSON.stringify({
  ariaRows: document.querySelectorAll('[aria-label^=\"Commit \"]').length,
  roleBtnRows: [...document.querySelectorAll('[aria-label^=\"Commit \"]')].filter(r=>r.getAttribute('role')==='button').length,
  graphH: document.querySelector('[aria-label*=\"Commit graph\"]')?.getBoundingClientRect().height,
  sampleLabel: document.querySelector('[aria-label^=\"Commit \"]')?.getAttribute('aria-label')?.slice(0,50)
})" 2>&1 | tail -1

echo "=== 2. CLICK FIRST ROW, CHECK SELECTION SIDE-EFFECTS ==="
agent-browser eval "(() => {
  const rows=[...document.querySelectorAll('[aria-label^=\"Commit \"]')].filter(r=>r.getAttribute('role')==='button');
  if (rows.length===0) return 'NO-ROWS';
  const r = rows[rows.length-1];
  const rect = r.getBoundingClientRect();
  r.click();
  return JSON.stringify({clicked: r.getAttribute('aria-label').slice(0,40), rowRect:{y:Math.round(rect.y), h:Math.round(rect.height)}});
})()" 2>&1 | tail -1
sleep 2
agent-browser eval "JSON.stringify({
  selectedRowBg: [...document.querySelectorAll('[aria-label^=\"Commit \"]')].some(r=>r.className.includes('bg-accent')),
  sheetEl: !!document.querySelector('.fixed.z-50'),
  drawerContentInDom: [...document.querySelectorAll('div')].filter(d=>d.className?.toString().includes('92dvh')).length,
  bodyChildren: document.body.children.length
})" 2>&1 | tail -1

echo "=== 3. REAL TAP VIA agent-browser click (ref-based) ==="
agent-browser snapshot 2>&1 | grep -oE 'button "Commit [0-9a-f]{8}[^"]{0,20}" \[ref=e[0-9]+\]' | head -3
echo "=== DONE ==="
