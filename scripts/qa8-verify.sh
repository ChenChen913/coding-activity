#!/bin/bash
# Phase 8 QA verify-final — confirm VLM fixes + full regression sweep
cd /home/z/my-project
(setsid bun run dev >> dev.log 2>&1 &)
sleep 30
echo "=== server: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000) ==="

agent-browser close --all >/dev/null 2>&1
agent-browser set viewport 1280 800 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
for i in $(seq 1 30); do
  N=$(agent-browser eval "document.querySelectorAll('[aria-label^=\"Commit \"]').length" 2>/dev/null | tail -1 | tr -d '"')
  if [ "$N" -gt 5 ] 2>/dev/null; then echo "rows ready: $N"; break; fi
  sleep 2
done
agent-browser console --action clear >/dev/null 2>&1

echo "=== 1. RELEASE CARD: count no longer clipped, dots within lane ==="
agent-browser eval "(() => { const card=[...document.querySelectorAll('main .overflow-hidden')].find(c=>/Release Timeline/.test(c.textContent)); card?.scrollIntoView({block:'center'}); return 'ok'; })()" 2>&1 | tail -1
sleep 1
agent-browser eval "JSON.stringify((() => {
  const card=[...document.querySelectorAll('main .overflow-hidden')].find(c=>/Release Timeline/.test(c.textContent));
  const lanes=[...card.querySelectorAll('.relative.h-6')];
  const counts=[...card.querySelectorAll('span.w-8')];
  const clipped = lanes.some(l => {
    const lr = l.getBoundingClientRect();
    return [...l.querySelectorAll('button')].some(b => {
      const r = b.getBoundingClientRect();
      return r.right > lr.right + 1 || r.left < lr.left - 1;
    });
  });
  const countsFits = counts.every(c => { const r = c.getBoundingClientRect(); const lane = c.previousElementSibling?.getBoundingClientRect(); return !lane || r.left >= lane.right - 1; });
  return { lanes: lanes.length, counts: counts.map(c=>c.textContent.trim()), dotsClipped: clipped, countsClearOfLanes: countsFits };
})())" 2>&1 | tail -1
agent-browser screenshot /home/z/my-project/scripts/phase8-release-fixed.png >/dev/null 2>&1

echo "=== 2. MOBILE HASH ROW FITS ==="
agent-browser set viewport 390 844 >/dev/null 2>&1
sleep 2
agent-browser eval "(() => { const rows=[...document.querySelectorAll('[aria-label^=\"Commit \"]')].filter(r=>r.getAttribute('role')==='button'); rows[rows.length-1].click(); return 'ok'; })()" 2>&1 | tail -1
sleep 3
agent-browser eval "JSON.stringify((() => {
  const sheet=[...document.querySelectorAll('div')].find(d=>d.className?.toString().includes('92dvh'));
  const sheetR = sheet?.getBoundingClientRect();
  // hash row: the div containing the code element
  const code = sheet?.querySelector('code');
  const row = code?.parentElement;
  const rr = row?.getBoundingClientRect();
  const kids = row ? [...row.children].map(k => ({w: Math.round(k.getBoundingClientRect().width), right: Math.round(k.getBoundingClientRect().right)})) : [];
  return { sheetW: sheetR ? Math.round(sheetR.width) : 0, hashRowRight: rr ? Math.round(rr.right) : 0, kids, fits: rr && sheetR ? rr.right <= sheetR.right - 12 : false };
})())" 2>&1 | tail -1
agent-browser screenshot /home/z/my-project/scripts/phase8-sheet-fixed.png >/dev/null 2>&1

echo "=== 3. CORE REGRESSION (graph click / releases / timeline chips) ==="
agent-browser set viewport 1280 800 >/dev/null 2>&1
sleep 2
agent-browser eval "JSON.stringify({
  activities: [...document.querySelectorAll('main span')].find(s=>/activities$/.test(s.textContent.trim()) && /\\d/.test(s.textContent))?.textContent.trim(),
  chips: [...document.querySelectorAll('[aria-pressed]')].map(b=>b.textContent.trim()).filter(t=>/All|Commits|Merges|Releases|AI/.test(t)),
  releaseCardDots: [...document.querySelectorAll('[aria-label*=\"Release timeline\"] button')].length
})" 2>&1 | tail -1

echo "=== 4. CONSOLE ==="
agent-browser console 2>&1 | grep -c "^\[error\]"
echo "=== DONE ==="
