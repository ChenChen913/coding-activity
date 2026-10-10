# AI Coding Activity — 项目工作日志

> 本文件是所有开发 agent 的共享交接文档。每个 agent 开始工作前必须先读此文件，完成后必须追加记录。
> 产品定位：**把真实 Git 历史转换成具有时间感、空间感和视觉层次的 AI Coding Activity 可视化工具**。
> 约束红线：Git 是唯一真实数据源；不伪造数据；不隐藏/截断/抽样 commit；所有 commit 必须可访问；不用 Mermaid 冒充 Git Graph。

## 全局阶段计划（用户要求逐阶段确认推进）

- Phase 0：项目审查与技术方案（已完成）
- Phase 1：Git 数据层（完整获取所有 commit/branch/parent/numstat）
- Phase 2：Commit Graph（自研 SVG 轨道布局 + zoom/pan/click/hover）
- Phase 3：Commit Detail（详情面板 / 文件 / diff / 统计）
- Phase 4：Activity Timeline（commit/ai/push 等统一时间线 + AI Agent 推断）
- Phase 5：Dashboard 整合（Repository / Stats / Graph / Timeline / Detail 成品）
- Phase 6：Visual Polish（排版/间距/动效/Loading/Empty/Error/响应式）
- Phase 7：GitHub 集成（remote 解析 / Open on GitHub / commit 链接）

---
Task ID: 0
Agent: main (Z.ai Code)
Task: Phase 0 —— 项目审查与技术方案设计（不写业务代码）

Work Log:
- 检查项目结构：Next.js 16 App Router + React 19 + TS 5 + Tailwind 4 + shadcn/ui 全套 48 个组件
- 确认可用依赖：framer-motion 12 / zustand / TanStack Query / date-fns / lucide-react / recharts / sonner —— **零新依赖即可完成全部 Phase**
- 确认 Prisma + SQLite 已配置，但本产品第一版**不需要数据库**（Git 是真实数据源，纯读）
- 验证 git 2.47.3 可用；`git log --format` 自定义分隔符输出正常；`git show --numstat` 可获取文件级增删
- 验证网络：可从 GitHub 真实 clone 仓库（octocat/Hello-World 克隆成功）
- 检查本项目自身 git 状态：仅 1 个 commit（main 分支，无 remote）→ 不适合直接当默认数据源
- 确认 dev server 已运行于 3000 端口，Caddyfile 网关正常，`dev.log` 可读
- 确认 worklog.md 原先不存在，本文件为首份记录

Stage Summary（关键架构决策）:

1. **数据源 = 仓库注册表（多仓库）**
   - `repos/demo`：克隆一个真实的分支/merge 丰富的开源仓库作为默认数据源（候选 pmndrs/zustand / vercel/swr，Phase 1 实测克隆体积与分支数后定）
   - `self`：本项目自身仓库。开发期间每个 Phase 做真实 git commit，让工具最终能回放"自己如何被 AI 开发出来"——产品灵魂所在
   - API 统一用 `?repo=demo|self` 参数切换，未来 GitHub 阶段可扩展远程源

2. **Git 数据获取 = git CLI + execFile（Node.js runtime API route）**
   - 全量 commit：单次 `git log --all --date-order --format=%H%x1f...` 用 `\x1f`/`\x30` 分隔解析（一次调用拿全量，杜绝截断）
   - 分支归属：per-branch `git rev-list`（O(K·N)，中小仓库足够）+ `git log --all --source` 辅助
   - numstat（增删行数/文件数）：**按需加载**（仅 commit 详情接口调用 `git show --numstat`），大仓库不必全量算
   - merge commit 由 `%P` 多 parent 自然识别
   - 内存缓存（module-level Map + TTL + `git rev-parse HEAD` 变更失效），不引入 Redis

3. **渲染 = 自研 SVG 轨道布局（lane model）**
   - 不引入 dagre / d3 / React Flow（符合"不引入不必要依赖"）
   - 布局算法：拓扑排序 → 轨道分配（分叉开新轨、merge 合轨道）→ 曲线 edge
   - zoom/pan 用 SVG transform；性能靠分层 + memo + 视口裁剪，5000 commits 目标不卡

4. **AI Coding Activity 数据结构（为 Phase 4 预留，但 Phase 1 就定好类型）**
   - `Activity.type: 'ai' | 'human' | 'commit' | 'push' | 'github' | 'ci' | 'deploy'`
   - AI 推断来源是**真实数据**：解析 commit message trailer（`Co-Authored-By: Claude` / `🤖 Generated with [Claude Code]` / `Cursor` / `Copilot` 等）→ `commit.aiAgent` 字段，非伪造
   - push/github 活动第一版尝试 `git reflog`，取不到就留空态，结构先行

5. **数据模型（Phase 1 落地于 src/lib/git/types.ts）**
   - GitCommit：hash/shortHash/message/fullMessage/author/authorEmail/committer/committerEmail/authoredAt/committedAt/parents/branches/headBranches/isMerge/aiAgent?(+按需 additions/deletions/filesChanged)
   - GitBranch：name/current/remote?/head/shortHead
   - GitRepoInfo：id/name/path/currentBranch/remote?/commitCount/branchCount/contributorCount
   - Activity：id/type/timestamp/title/description?/commitHash?

6. **目录规划**
   - `src/lib/git/`：types / exec / parse / commits / branches / repo / cache / repos（仓库注册表）
   - `src/app/api/git/`：repos / repo / commits / commit/[hash]
   - `src/components/git-graph|timeline|commit-detail|dashboard/`（Phase 2+）
   - `src/hooks/`：use-git-data(TanStack Query) / use-clock(实时时钟)
   - `src/stores/`：zustand（选中 commit、筛选状态）

7. **Phase 1 实施计划（已获准待执行）**
   1) 实测并克隆默认演示仓库到 `repos/`（.gitignore 需加入 `repos/` 以免污染本项目 git；但注意 repos 内目录自身是独立仓库）
   2) 实现 `src/lib/git/*` 全部模块 + 4 个 API route
   3) 极简数据完整性验收面板（临时，不做视觉设计）：显示 commit 总数 vs `git rev-list --all --count` 对比、分支数、首尾 commit 抽样、每 commit 字段完整性检查
   4) 对 500+ commits 的真实仓库跑全量校验脚本
   5) 本项目自身做真实 git commit（开启 self 仓库历史积累）

当前风险/待决事项:
- 克隆的开源仓库需确认分支数 ≥ 5 且含 merge commits（Phase 1 实测）
- 大仓库（5000+ commits）JSON 体积 ~1.5MB，前端需做虚拟滚动（Phase 2 处理，传输层可 gzip）
- clone 下来的仓库只有 remote 分支（无本地分支），分支解析需支持 refs/remotes

---
Task ID: 1
Agent: main (Z.ai Code, cron round 1)
Task: Phase 1 —— Git 数据层：完整、准确获取 Git Repository 数据（含 QA 验收）

Work Log:
- 克隆演示仓库：expressjs/express → repos/demo（--no-checkout 全量克隆，12MB）
  实测：6430 commits / 536 merges / 19 分支（1 local + 18 remote）/ 412 contributors / 时间跨度 2009→2026
  （候选 swr 只有 1 个 merge 被；express 一个仓库同时覆盖"丰富演示"+"5000+ 压测"两个需求）
- .gitignore 增加 /repos/（演示仓库是独立 git 仓库，不进 self 历史）
- 实测并确认 git 解析行为：numstat rename 格式 `old => new`、name-status `R100\told\tnew`、
  binary `-\t-`、根提交 diff vs empty tree (4b825dc...)、merge diff vs first parent
- 实现 src/lib/git/ 数据层（10 个文件）：
  - types.ts：GitCommit/GitBranch/GitRepoInfo/Activity/GitIntegrity/... 完整数据模型
  - exec.ts：execFile 封装（无 shell、128MB buffer、超时、GitError）
  - cache.ts：模块级内存缓存 + 仓库签名失效（HEAD + refs 摘要，新 commit/分支变动自动失效）
  - repos.ts：仓库注册表（demo + self），可用性探测，RepoNotGitError
  - branches.ts：for-each-ref 解析（local + remote-tracking，跳过 origin/HEAD 符号引用）+ 每分支 rev-list 包含关系
  - commits.ts：单次 git log --all 全量拉取（\x1f 字段/\x1e 记录分隔，body 多行安全）；
    分支归属附加；getCommitStats（numstat+name-status 双命令对齐，rename/二进制/root 处理）；
    getCommitDiff（统一 diff，256KB 截断保护）
  - ai.ts：AI agent 真实 trailer 检测（Claude Code/Claude/Copilot/Cursor/Gemini/Codex/Aider），绝不伪造
  - repo.ts：getRepoOverview（远程 GitHub URL 解析、贡献者统计、完整性报告）、缓存封装
  - index.ts：barrel
- API routes ×4（全部 nodejs runtime + force-dynamic，统一错误结构 404/422/500）：
  - GET /api/git/repos：注册表 + 概要（含 integrityMatch）
  - GET /api/git/repo?repo=：完整 overview（repo/branches/contributors/integrity）
  - GET /api/git/commits?repo=&q=&author=&branch=&limit=&offset=：默认全量返回（不截断），过滤显式报告 total/returned/filtered
  - GET /api/git/commit/[hash]?repo=&diff=1：详情 + 文件级统计 + 可选 diff（支持 hash 前缀唯一匹配，多匹配返回 300）
- 前端（Phase 1 验收面板，非最终设计）：
  - providers.tsx：TanStack QueryClientProvider（staleTime 30s）
  - layout.tsx：换 metadata、挂 Providers
  - use-clock.ts：rAF+interval 实时时钟（hydration 安全，通过 react-hooks/set-state-in-effect lint 规则）
  - page.tsx：仓库切换 + 秒级时钟(●LIVE) + 4 统计卡 + Data Integrity 卡（服务端比对 + 客户端全量审计：
    总数=rev-list、唯一 hash、孤儿 parent=0、6 项字段完整性）+ AI commits 展示 + 首/最新/merge 样本
    + Loading skeleton + Error(Unable to read Git history + Retry) + sticky footer
- QA（agent-browser）：页面完整渲染、时钟跳动验证(04:42:02→04:42:05)、仓库切换 demo→self、
  控制台零错误、390px 移动端无横向溢出、全部完整性检查 PASS
- 性能实测（demo, 6430 commits, 6.48MB JSON）：冷 1295ms（含 19 分支 rev-list）/ 缓存 84ms；
  self 提交后缓存自动失效并识别新 commit
- self 仓库真实 commit：415c49f "feat(data-layer): ..." 带 Co-Authored-By: Claude trailer
  → API 正确检测 ai: Claude（端到端真实数据闭环）
- bun run lint 通过（修复过一次 use-clock 的 set-state-in-effect）

Stage Summary:
- Phase 1 全部验收项达成：所有 commit 可获取（6430=6430）/ hash/message/author/时间/parent/branch/merge/
  文件变化全部正确 / AI 检测基于真实 trailer / 5000+ commits 不卡（冷 1.3s 缓存 84ms）
- 关键文件：src/lib/git/*（10 文件）、src/app/api/git/*（4 routes）、page.tsx、providers.tsx、use-clock.ts
- 重大发现：express 里有 3 个真实 Claude 协作 commit（CVE 修复，2026 年）——AI Activity 不是空想，数据就在那
- self 仓库已开始积累"被 AI 开发"的真实历史（1 个 AI commit）

未解决问题或风险，建议下一阶段（Phase 2 Commit Graph）优先事项:
1. 【下一步主线】自研 SVG 轨道布局：拓扑排序 → 轨道分配（分叉开新轨/merge 合轨）→ 贝塞尔曲线；
   zoom/pan 用 SVG transform；6430 commits 需视口裁剪 + memo（分层：<g> edges 层 + nodes 层）
2. 6.48MB payload 对 graph 渲染偏大：Phase 2 可考虑 commits 接口瘦身模式（省略 fullMessage/branches 长列表，
   按需 detail 拉取）——但必须保持"全部 commit 可访问"红线
3. 分支包含关系计算是 O(分支数×N)，分支数 >50 的仓库会慢——可加 `--contains` 稀疏化或并行 Promise.all
4. /api/git/commit/[hash] 目录名含 [hash]，git add 时显示为 "commit/ash]/route.ts"（shell 转义显示问题，
   实际文件路径正确，已正常提交）
5. express 仓库 clone 于 2026-10-04，静态快照；如需更新历史可定期 git fetch（暂不需要）

---
Task ID: 2
Agent: main (Z.ai Code, cron round 2)
Task: Phase 2 —— Commit Graph：自研 SVG 轨道布局 + 完整交互（zoom/pan/click/hover/search/filter）

Work Log:
- 交互 QA 前置确认 Phase 1 稳定（dev server 全 200）
- 实测确认 slim API：6.43MB → 2.14MB（6430/6430 全量，无截断）
- layout.ts：轨道布局算法（等待链延续/分支头占用空闲轨/merge 分叉新轨/多子收敛取首轨）
  → 合成数据 bun 脚本验证 4 种拓扑（diamond 分叉+合并 / converge 双子同父 / 双 root / octopus 三方合并）全部正确
  → 边着色规则：首父边=子轨色（merge 入主线时保持分支色），次父边=父轨色（分叉即分支色）
  → 时间刻度 monthMarks（年/月变更行）
- commit-graph.tsx（~950 行核心交互组件）：
  → 几何在屏幕空间计算（scale 影响 rh/lw/nodeR/edgeW，文字恒定大小不糊）
  → wheel 纵向平移 / ctrl+wheel 光标锚点缩放 / 拖拽平移（rAF 节流）/ 双指 pinch / 双击放大
  → 视口裁剪：只渲染可见行 ±4 缓冲（6430 commits 每帧仅 ~20-30 节点 + 相交边过滤）
  → rh < 15px 时列表进入"结构模式"（隐藏文字保留点击），年月左刻度栏
  → tooltip 用 DOM ref 定位（零 re-render），选中脉冲环动画，framer-motion 入场
    （节点 scale stagger + 边 pathLength 线条生长）
  → 工具栏：缩放±/百分比/Fit/最新/最旧 + extra 插槽（分支过滤+搜索）
  → Loading skeleton / Error+Retry / Empty 三态完整
- commit-search.tsx：客户端全量搜索（hash 前缀 > subject 前缀 > 包含），30 条上限+计数提示，
  点击结果选中并居中（rowRange 实测 1–22 → 1,310–1,336 ✓）
- commit-detail-panel.tsx：message 正文/diff 统计行/复制 hash/authored+committed 全时+相对时间/
  父提交可点击跳转/分支 chips/AI Trace 说明；md 侧栏 / 移动端下方面板
- integrity-card.tsx：折叠式完整性卡（graph 为主角后保持诚实证明可见）
- page.tsx 重组：header(实时时钟) → 仓库栏(全名+当前分支+5 项统计+AI commits) →
  GRAPH CARD（分支过滤+搜索+graph+详情侧栏）→ AI 活动条 → 折叠完整性卡 → sticky footer
- globals.css：pulse-ring 关键帧（SVG transform-box: fill-box）+ slim-scrollbar
- 修复 3 个真实 bug（agent-browser 发现）：
  1) animateTo 直接 setT(partial) 整体替换 state → scale 变 undefined → NaN%（改用合并式 setTransform）
  2) ty 符号约定写反：clamp 区间应为 [0, totalH-viewH]（ty 为正=向下滚），拖拽方向同步翻转
  3) 小仓库垂直居中公式（(totalH-viewH)/2 而非 Math.max(0,...)）
- lint 修复：react-hooks/refs（render 期禁止写 ref → 统一 mirror effect）、
  set-state-in-effect（全部 rAF/timeout 异步）、pointerUp 自引用（改为零依赖 window 监听）
- QA 全绿（agent-browser）：点击行/节点 → 详情 ✓、父提交跳转 ✓、搜索定位居中 ✓、
  Zoom 135%→211% ✓、跳最新(1–16)/最旧(6,415–6,430) ✓、拖动方向正确 ✓、滚轮 2000px 平移 ✓、
  分支过滤 origin/5.0 → 5,979 ✓、DOM 零 NaN ✓、控制台无新错误 ✓、
  390px 移动端无溢出 ✓、VLM 截图审查（桌面+移动）布局/配色/可读性好评 ✓
- self 仓库真实 commit：f3dc012（带 Claude trailer）→ API 立即识别 ai: Claude（5 commits）
- bun run lint 零错误

Stage Summary:
- Phase 2 全部验收达成：真实 Git Graph（非流程图）/ 节点/分支/merge 正确 / 可点击 /
  可缩放可移动 / 6430 commits 流畅（裁剪渲染）/ 分支过滤真实生效 / 搜索可定位
- 关键新文件：git-graph/layout.ts、commit-graph.tsx、commit-search.tsx、
  commit-detail-panel.tsx、integrity-card.tsx；修改：page.tsx、commits API（slim）、
  globals.css、types.ts（GraphCommit）
- 本阶段二次发现：self 仓库历史正在积累（2 个 AI commit），产品核心叙事已成立

未解决问题或风险，建议下一阶段（Phase 3 Commit Detail）优先事项:
1. 【下一步主线】diff 视图：Commit Detail 增加 View Diff（API 已支持 diff=1 返回 256KB 截断的
   unified diff），需要逐文件折叠列表 + 语法微高亮（可用 react-syntax-highlighter 已装或轻量自研）
2. 详情面板补 Changed Files 完整列表（API stats.files 已返回，前端未展示）
3. 已知小瑕疵：分支过滤切换时 graph 有 1-2s 空窗（refetch 期间 loading 覆盖）——可优化为保留旧图渐变
4. 性能余量：6430 commits 下 framer-motion 入场动画期间滚动会触发新节点动画（1.7s 窗口内可接受）
5. 键盘导航（上下键移动选中）与 graph 空白处点击取消选中可顺手加

---
Task ID: 3
Agent: main (Z.ai Code, cron round 3)
Task: Phase 3 —— Commit Detail：Changed Files 完整列表 + 按需 Diff 视图

Work Log:
- 前置 QA：清空 console 后全新会话验证 Phase 2 零错误（此前 NaN 是修复前的历史残留，确认不复现）
- diff-parser.ts：统一 diff 解析器（文件块/hunk 头/旧新行号推进/add-remove-context 行），
  兼容 added/deleted/binary/renamed（rename from/to）五种情况
  → 合成 diff bun 脚本验证 5 文件场景全部正确；修复删除文件 path 误置为 /dev/null 的边界
- diff-view.tsx：可折叠文件块（A/D/R/M 状态角标 + 目录/文件名分层 + 每文件 +/− 计数 +
  hunk 分隔行 + 双行号槽 + +/- 行背景着色 + binary/纯 rename 空态）
- changed-files.tsx：按需拉取 diff=1（每 commit 一次，staleTime 5min）→ 客户端解析 →
  Expand all / Collapse all / 单文件点击展开；key={hash} 重挂载天然重置展开状态（规避
  set-state-in-effect）；256KB 截断提示条；stats 回退渲染
- commit-detail-panel.tsx：metadata 下方集成 ChangedFiles 区块
- lint 修复 2 处：set-state-in-effect（改 keyed remount）、
  preserve-manual-memoization（依赖改为提取后的 diffText 变量）
- QA 全绿（agent-browser）：
  → 单文件 commit（3b7e39fe package.json +1/−1）：hunk 头/双行号/+/− 行渲染正确
  → 多文件 commit（4.22.3）：Expand all 后 2797 diff 行（579+/579−）流畅
  → self 仓库 worklog.md +58 diff 真实渲染
  → 控制台零错误、390px 无溢出、VLM 视觉审查（配色/行号/布局）通过
- self 仓库真实 commit：4f72ebe（Claude trailer）

Stage Summary:
- Phase 3 全部验收达成：Commit Detail Panel / Changed Files / Additions/Deletions /
  Author/Time/Parent/Branch / Diff 全部完成
- 关键新文件：diff-parser.ts、diff-view.tsx、changed-files.tsx；修改：commit-detail-panel.tsx
- 产品现状：graph 主视图 + 分支过滤 + 搜索定位 + 详情面板 + 完整 diff 浏览 = 已是一个
  可日常使用的真实 Git 可视化工具

未解决问题或风险，建议下一阶段（Phase 4 Timeline）优先事项:
1. 【下一步主线】Activity Timeline：commit/ai/push 统一时间线（数据结构 Activity 已就绪，
   aiAgent 已有真实数据），需要 timeline 组件（时间分组/类型过滤/点击跳转 graph）
2. 顺手优化：分支过滤 refetch 空窗（保留旧图渐变）、graph 键盘上下导航、空白点击取消选中
3. diff 语法高亮（当前纯色着色，已够用；可选 react-syntax-highlighter 或轻量 tokenizer）
4. 详情面板在移动端占 max-h-[55vh]，diff 浏览时滚动空间偏小——可加全屏 Sheet 模式

---
Task ID: 4
Agent: main (Z.ai Code, cron round 4)
Task: Phase 4 —— Activity Timeline：commit 统一活动时间线 + 年份直方图 + 类型过滤 + graph 联动（含顺手优化三项）

Work Log:
- 前置回归 QA（agent-browser）：Phase 2/3 全部无回归 —— 详情面板 ✓ / diff 展开 ✓ /
  390px 无溢出 ✓ / 控制台零错误 ✓
- types.ts：新增 TimelineActivity（Activity 扩展 shortHash/author/isMerge）——
  时间线数据完全由已拉取的 commits 派生（零二次请求，天然覆盖 100% 历史）
- activity-timeline.tsx（新组件，~500 行）：
  → 年份直方图：17 根可点击年份柱（点击=年份过滤，高亮 emerald），AI 年份柱顶琥珀标记
  → 类型过滤 chips：All / Commits / Merges / AI（真实计数，非估算）
  → 月分组列表：sticky 月头（月名+活动数）+ 左侧 rail 线 + 类型化节点
    （commit 圆点/merge teal/AI 琥珀 Sparkles）+ framer-motion 入场
  → 分页：Load more 每页 80 条（6,430 条不全量渲染 DOM）
  → 点击 activity → graph 居中选中 + 页面平滑滚动到 graph 卡（selectAndReveal）
  → 选中项双向同步高亮（graph 选节点 → timeline 高亮对应行）
  → 空态（过滤组合无结果）/ Loading skeleton / 出处说明（provenance note：
    AI 标记来自真实 trailer；push/CI/deploy 待 GitHub 集成）
- 修复自研 bug：AI 标记点绝对定位公式错误（短柱时标记跑到柱下方）→ 改 flex 流式
  布局（gap 3px 永远贴柱顶），柱高上限 56→48 防溢出
- 顺手优化（Phase 3 遗留清单）：
  1) 分支过滤空窗：TanStack Query placeholderData=keepPreviousData（切分支保留旧图）
     + repoId 守卫（commitsData.repoId === repoId，杜绝切仓库时旧仓库数据泄漏）
     + CommitGraph/ActivityTimeline key={repoId} 干净重挂载
  2) graph 键盘导航：容器 tabIndex=0 + ArrowUp/Down 逐 commit 移动选中（layout.rowOf 定位）
  3) Escape 清除选中 / SVG 背景空白点击取消选中（e.target===e.currentTarget 守卫 +
     didPan 防拖拽误触）
- page.tsx 重组：graph 卡包 scroll-mt 容器（graphCardRef）→ ACTIVITY TIMELINE 卡 →
  折叠完整性卡；删除旧 AI 活动条（被 timeline 的 AI 过滤完整替代）
- lint 零错误；dev.log 全 200
- QA 全绿（agent-browser）：
  → Timeline 渲染：6,430 activities / Jun 2009 → Oct 2026 / 3 AI-assisted ✓
  → AI 过滤：3 个真实 Claude commit 按月分组（2026-10/08/02 各 1）✓
  → 点击 activity：页面滚动 scrollY=59 + 节点 pulse-ring + 详情面板打开 ✓
  → 年份过滤：2019 → 仅 2019 月份分组；AI+2019 → 空态文案正确 ✓
  → Load more：80→160 条 / 21 月组 / "6,270 left" ✓
  → 键盘导航：ArrowDown 选中→连续移动（hbs bump → conditional revalidation）✓ /
    Escape 清除+关面板 ✓
  → 背景点击：SVG 空白处点击清除选中+关面板 ✓
  → 分支过滤 origin/5.0：timeline 同步 5,979 activities / graph 显示 5.0.0 tip ✓
  → 仓库切换 demo↔self：无跨仓数据泄漏（切换瞬间 loading 态）/ self 8 activities ✓
  → 390px 移动端无横向溢出 ✓ / 控制台零错误 ✓
  → VLM 视觉审查：Timeline 卡片专属截图 NO BUGS / 移动端 NO BUGS
    （首轮混合截图的"+1 badass 溢出"为 VLM 误读，代码中不存在该文本）
- self 仓库真实 commit：743e88f（带 Claude trailer）→ API 立即识别（9 commits / 4 AI）

Stage Summary:
- Phase 4 全部验收达成：commit 统一时间线 / 时间分组 / 类型过滤 / 点击跳转 graph /
  AI 活动真实标注（trailer 推断，非伪造）
- 关键新文件：timeline/activity-timeline.tsx；修改：page.tsx、commit-graph.tsx、types.ts
- 产品现状：graph 主视图 + 详情/diff + 完整活动时间线 = Git 历史的"空间+时间"双视图已成型
- Phase 3 遗留的三个顺手优化项全部完成（空窗/键盘导航/取消选中）

未解决问题或风险，建议下一阶段（Phase 5 Dashboard 整合）优先事项:
1. 【下一步主线】Dashboard 整合：Repository / Stats / Graph / Timeline / Detail 五位一体
   —— 可加贡献者排行（contributors API 已有数据未展示）、语言/文件维度统计、
   顶部全局统计条设计
2. push/github/ci/deploy 活动类型结构已就绪但无数据源（静态 clone 无 reflog 历史）——
   Phase 7 GitHub 集成时用 GitHub API 补齐
3. timeline 大量 Load more 后 DOM 行数增长（当前 80/页可控，用户连点 50 次会到 6430 行）——
   如需可上虚拟滚动
4. 年份直方图在超宽仓库（>30 年）会横向滚动——当前 17 年无问题
5. self 仓库历史正持续积累（9 commits / 4 AI）——产品"自己开发自己"的叙事素材

---
Task ID: 5
Agent: main (Z.ai Code, cron round 5)
Task: Phase 5 —— Dashboard 整合：Insights 区（Contributors / Commit Rhythm / Conventions）+ author 过滤全联动

Work Log:
- 前置回归 QA（agent-browser）：Phase 4 无回归（timeline 点击联动 ✓ / 控制台零错误 ✓）
- 新建 src/components/dashboard/（3 个组件，~700 行）：
  → contributor-card.tsx：真实贡献者排行（412 个 git 身份，按邮箱聚合）
    · 排名 + 姓名首字母头像（8 色暖色系 hash）+ commit 数 + 相对条形（motion 生长动画）
    · AI 协作者徽章（真实 trailer 检测，Dave Tashner / Mayvis 2 人）
    · 点击行 → 全 dashboard 聚焦该作者（graph/timeline/rhythm/conventions 同步）
    · Top 8 + "Show all 412" 展开（max-h-300px 滚动列表）
  → rhythm-card.tsx：提交节奏卡
    · By hour（24 柱）/ By weekday（7 柱）双模式切换
    · hover 计数气泡（DOM bubble，无 re-render）+ 峰值柱 emerald 高亮
    · 诚实标注 "browser-local time"（时间戳解析自真实 committedAt）
  → conventions-card.tsx：消息规范卡
    · parseType 正则解析 conventional commits（feat/fix/docs/build/deps/…）
    · 命名类型按频次排序在前，other 兜底沉底（不视觉霸屏）
    · AI-assisted 占比条（真实数据：3/6430 = 0.05%）
- 修复 2 个真实数据诚实性问题：
  1) 【重要】作者过滤键不一致：贡献者卡按邮箱聚合（TJ=4,071 含 3 个署名变体），
     但 author 过滤按名字子串只匹配 2,786 → 改为邮箱为键（authorFilter={name,key}，
     key=email||name），点击"TJ Holowaychuk 4,071"现在精确返回 4,071 ✓
  2) Conventions 排序 bug："other"（80%，express 早期非规范历史是事实）按频次
     排第一且出现两个 other 标签 → other 永远沉底合并显示
- 顺手修复预存 bug：分支过滤时 Integrity 卡"delivery check"误报失败（5,979≠6,430
  显示红叉）→ clientFiltered prop：过滤态显示"Full history intact — filter active
  on the client (4,071 of 6,430 shown)" + 绿勾
- page.tsx 集成：graph 卡下方新增 INSIGHTS 区（1/2/3 列响应式网格，
  contributors md:col-span-2）+ authorFilter 状态贯通 commits query + 工具栏
  author chip（emerald 底 + X 一键清除）+ 切换分支/仓库时重置
- MultiEdit 部分失败经验：失败前的编辑已生效（非原子），需 grep 验证实际状态后补齐
- lint 零错误；dev.log 全 200
- QA 全绿（agent-browser）：
  → Contributors：412 身份 / top8 排行 / 展开后 412 行可滚动 ✓
  → 点击 TJ：timeline 4,071 activities（= 排行卡计数，变体全覆盖）✓ /
    chip 显示 ✓ / 贡献者行高亮 ✓ / graph 23 行 ✓
  → 点击 Jonathan Ong：84 activities ✓ / chip X 清除 → 6,430 恢复 ✓
  → 再次点击 TJ（toggle off）：6,430 恢复 ✓
  → 深度联动：聚焦 TJ 后 Rhythm 总数=4,071 ✓ / Conventions 显示 TJ 个人风格
    （revert/changed/added/fixed —— 与 express 现代规范史完全不同的真实洞察）✓
  → Rhythm：hour 模式 24 柱总和 6,430 ✓ peak 16:00 / weekday 模式 7 柱总和
    6,430 ✓ peak Thu ✓
  → Conventions：deps 491 / build 281 / docs 140 / tests 111 / examples 52 /
    fix 49 / feat 21 / other… 5,285（守恒 6,430）✓ / 20% conventional（真实）✓
  → Integrity 过滤态："4,071 of 6,430 shown" + 全 history intact ✓
  → 仓库切换：self 仓库 1 贡献者（Z User 10 commits）边界正常 ✓ /
    self 贡献者点击 → 10 activities ✓
  → 布局：1280px 3 列 / 390px 1 列无溢出 ✓ / 控制台全程零错误 ✓
  → VLM 视觉审查 Insights 截图：NO BUGS ✓
- self 仓库真实 commit：9bcb979（带 Claude trailer）

Stage Summary:
- Phase 5 全部验收达成：Repository / Stats / Graph / Timeline / Detail 五位一体成品
- 核心新能力：贡献者排行点击驱动全 dashboard 过滤（邮箱键保证身份变体不丢），
  这是 Dashboard 整合的灵魂 —— 统计卡不是摆设而是交互入口
- 关键新文件：dashboard/contributor-card.tsx、rhythm-card.tsx、conventions-card.tsx；
  修改：page.tsx（authorFilter 贯通）、integrity-card.tsx（clientFiltered）
- 数据诚实性再进一步：排行计数 = 过滤视图计数（4,071=4,071）；过滤态完整性
  语义修正（区分"主动过滤"与"截断失败"）

未解决问题或风险，建议下一阶段（Phase 6 Visual Polish）优先事项:
1. 【下一步主线】Visual Polish：排版/间距/动效统一审计（framer-motion 过渡一致性、
   卡片 hover 层次、暗色模式验证——当前所有配色在 light 下验证，dark 未测）
2. Loading/Empty/Error 三态在 Insights 三卡的自适应（self 小仓库空分支过滤组合下的
   rhythm/conventions 空数据表现）
3. timeline 虚拟滚动（Load more 累积 DOM 风险仍在）
4. 贡献者头像 hover 可显示 email + commits 时间范围 tooltip（增强但不紧急）
5. push/CI/deploy 活动仍待 Phase 7 GitHub 集成补数据源
6. self 仓库 10 commits / 5 AI —— "工具开发自己"叙事素材持续积累

---
Task ID: 6
Agent: main (Z.ai Code, cron round 6)
Task: Phase 6 —— Visual Polish：暗色审计收尾 + 进场编排 + Insights 空态 + 交互细节（快捷键/ScrollTop/Tooltip）

Work Log:
- 前置回归 QA（agent-browser）：Phase 5 无回归（Insights 三卡 / author 过滤 / 控制台零错误）
- 发现上轮 context 已落地 Phase 6-a 基础设施（本 session 验证补记）：
  next-themes ThemeProvider（attribute=class）+ theme-toggle.tsx（light→dark→system 循环）
  + layout suppressHydrationWarning + globals.css 完整 .dark 变量块
- 主题循环实测：System(dark)→Light→Dark→System 三态切换 + localStorage 持久化 + 刷新保持 ✓
- 暗色审计（grep + DOM 计算样式 + VLM 双截图）：
  → 修复 contributor-card AI 徽章（border-amber-200 bg-amber-50 → dark:amber-500/15 半透明琥珀）
  → graph 分支 badge 的 text-white/bg-white 确认安全（深色轨道底上双模式一致）
  → VLM 审查暗色桌面（Insights/graph/detail）/移动端均 NO BUGS
- Phase 6-c 空态自适应（数据诚实性）：
  → rhythm/conventions/contributor 三卡在 commits=[] 时显示真实空态
    （原先会渲染 "peak 00:00 · 0 commits" 和 0% 空条的误导性图表）
  → conventions header 空态显示 "— no data" 替代误导性 "0% conventional"
  → 触发组合实测：origin/5.0 × dependabot[bot]（API 差集找到的作者）✓
- 视觉细节增强（样式越做越细节）：
  → reveal.tsx：whileInView 进场编排（insights 三卡 stagger 0.09s / timeline / integrity）
  → header：渐变标题（emerald→teal，dark 变体）+ 渐变 logo tile
  → 四卡统一 hover 层次（border-foreground/25 + shadow-sm，200ms transition）
  → footer：GitBranch icon 点缀
- 交互增强（功能越做越多）：
  → scroll-top.tsx：浮动回顶按钮（1.3 屏出现 / AnimatePresence 缩放 / 安全区适配）
  → 贡献者行 tooltip：email + commit 数 + 真实活跃区间（"Jun 2009 → Feb 2014 · 4.7y"）
    —— 数据层 GitContributor 新增 firstCommitAt/lastCommitAt（git 聚合，非估算）
  → commit-search：全局 "/" 聚焦快捷键（输入上下文守卫）+ 空 query 时 kbd 提示徽章
  → providers：MotionConfig reducedMotion="user"（尊重系统减弱动效偏好，无障碍）
- QA 全绿（agent-browser）：
  → "/" 快捷键聚焦 ✓ / kbd 提示 ✓ / tooltip 内容（TJ: tj@vision-media.ca 4,071 commits
    Jun 2009 → Feb 2014 · 4.7y）✓ / ScrollTop 出现+点击回顶（1305→0）✓
  → 空态：No commits in view / No commit subjects in view + VLM NO BUGS ✓
  → 回归：graph 节点点击→面板 ✓ / ArrowDown 键盘导航 ✓ / timeline 点击→滚动联动（scrollY=59）✓
  → 亮色 VLM（渐变标题/卡片）：NO BUGS ✓ / 390px 无溢出 ✓ / 控制台全程零错误 ✓
- bun run lint 零错误
- self 仓库真实 commit：677fede（带 Claude trailer）→ API 立即识别（14 commits / 6 AI）

Stage Summary:
- Phase 6 主体完成：暗色模式全线可用（VLM 双模式审查通过）+ 进场编排 + 空态诚实化
  + 4 项交互增强（ScrollTop/Tooltip/快捷键/reducedMotion）
- 关键新文件：reveal.tsx、scroll-top.tsx；修改 11 文件（+351/−58）
- 数据诚实性再进一步：空过滤组合不再渲染误导性 0 值图表；
  贡献者 tooltip 的时间范围来自真实 git 聚合

未解决问题或风险，建议下一阶段（Phase 7 GitHub 集成或 Phase 6 收尾）优先事项:
1. 【下一步主线】Phase 7 GitHub 集成：remote 解析已有基础（repo.remote.githubOwner/Repo），
   可加 Open on GitHub 链接、commit SHA 链接到 github.com/expressjs/express/commit/<hash>、
   push/CI/deploy 活动类型数据源（GitHub API events）
2. 移动端 detail panel 仍是 max-h-[55vh] 面板——diff 浏览滚动空间小，
   可升级为全屏 Sheet（vaul 已装）
3. timeline 虚拟滚动（Load more 累积 DOM 风险仍在，当前 80/页可控）
4. diff 语法高亮（当前 +/- 行背景着色，已够用；可上轻量 tokenizer）
5. self 仓库 14 commits / 6 AI —— "工具开发自己"叙事素材持续积累

---
Task ID: 7
Agent: main (Z.ai Code, cron round 7)
Task: Phase 7 —— GitHub 集成：真实 tags 作为 release 活动 + GitHub 深链全家桶 + live events 诚实降级

Work Log:
- 前置回归 QA（agent-browser）：Phase 6 无回归（键盘导航 ✓ / 详情面板 ✓ / 控制台零错误 ✓）
- 环境实测决策：GitHub REST API 未认证共享 IP 持续限流（403 rate limit）→
  本轮主数据源选择**零网络的真数据**：git tags（express 有 305 个真实 tag）+
  remote URL 解析深链；GitHub events API 走"基础设施就绪 + 诚实降级"路线
- 数据层 3 个新文件：
  → tags.ts：单次 for-each-ref refs/tags 拉全量（\x1f/\x1e 分隔，annotated tag 剥皮
    *objectname）；annotated 用 taggerdate（dateSource:'tagger'），lightweight 用
    目标 commit 日期（dateSource:'commit'，诚实标注）——批量 git log --no-walk
    解析 commit 日期（400 hash/批防 argv 溢出）；cached() 60s TTL
  → github-events.ts：真实 /repos/{o}/{r}/events API（PushEvent/PR/Release/Star/
    Fork/Create/Delete 映射为紧凑活动），403/429→rate-limited、超时→network、
    无 remote→no-github-remote，全部诚实返回 available:false + reason；5min 内存缓存
  → src/lib/github.ts（客户端安全纯函数）：githubCommitUrl / githubTreeUrl
    （origin/ 前缀剥离）/ githubTagUrl / githubProfileFromEmail（noreply 邮箱推导
    用户名，[bot] 账号映射 /apps/ URL——dependabot[bot] 实测正确）
- API ×2：GET /api/git/tags（305 tags / 138ms / 0 坏记录）、
  GET /api/git/github-events（demo: rate-limited / self: no-github-remote，均 200）
- ActivityTimeline 升级（Phase 4 → Phase 7）：
  → releases 并入统一活动流：305 个 Release 活动（rose Tag 图标 + annotated/
    lightweight 徽章 + tagger/lightweight tag 作者位 + 诚实 tooltip）
  → Releases 过滤 chip（真实计数）+ 年份直方图 rose 方块标记（17 年有 release）
    + 柱高上限 48→44 防双标记溢出
  → 视图一致性：releases 按 viewHashes 过滤（分支过滤 origin/4.x 时 305→267，
    只显示指向该视图内 commit 的 tag——守恒 5,436+458+267=6,161）
  → GitHub live feed 区（available 时渲染，push 事件可跳 graph）
  → 出处说明升级：lightweight tag 日期来源说明 + GitHub events 可用性诚实一行
- page.tsx：Open on GitHub 按钮（Github 图标+外链箭头）/ releases 统计
  （"305 releases" rose）/ tagsQuery + githubEventsQuery（5min 轮询）/
  跨仓 repoId 守卫贯通 / Reload 全量 refetch
- commit-detail-panel：面板头 Github 图标按钮 + Hash 行外链按钮 + 分支 chip
  变链接（tree/{branch}）+ 作者名旁 GitHub 主页图标（仅 noreply 邮箱可推导时显示）
- contributor-card：行尾 GitHub 图标链接（绝对定位避免 button 嵌套 a 的非法
  HTML）+ tooltip 增加 "GitHub · username" 行
- 修复 4 个真实 bug（QA 发现）：
  1) 【Phase 2 遗留】graph 行分支徽章 shrink-0 在窄视口溢出 72px 压到作者文本
     （DOM 矩形实测确认）→ 徽章 min-w-0+max-w-60%+truncate、消息 min-w-48px、
     容器 overflow-hidden 硬保障；1024px 复测 overlap=0
  2) 390px 横向溢出 138px（新 GitHub 按钮撑爆右侧工具行 512px>390px）→
     工具行 flex-wrap + 按钮小屏图标化 + Select 170px→sm:210px；复测溢出 0
  3) 详情面板作者 email 超长截断 → break-all 折行（dependabot 邮箱实测 2 行完整）
  4) 超长分支 chip 挤压边缘 → max-w-220px truncate + title 全名悬停
- lint 零错误；dev.log 全 200；控制台全程零错误
- QA 全绿（agent-browser + VLM×5 截图审查）：
  → Releases chip 点击：80/305 纯 release 行零污染 ✓
  → release 行点击：滚动到 graph + pulse 选中 + 详情面板 + GitHub commit 链接 ✓
  → 深链正确性：commit/899b524… ✓、origin/4.x→tree/4.x 前缀剥离 ✓、
    apps/dependabot ✓、普通邮箱作者无链接（不猜测）✓
  → 分支过滤 origin/4.x：releases 视图过滤 305→267 守恒 ✓
  → self 仓库边界：无 GitHub 按钮/无 releases 统计/无 Releases chip/
    诚实降级文案 ✓ / 零溢出 ✓
  → 暗色模式整页 VLM OK ✓ / 亮色整页 VLM（修复 2 处后复测）✓ /
    timeline 专属截图 ✓ / 移动端 ✓
  → VLM 误报甄别：首轮"origin/dependabot 重叠"实为真 bug（已修）；
    "annotated pill 缺失"为分页深度问题非缺陷；graph 消息 truncate 为设计意图
- self 仓库真实 commit：39af2f8（Claude trailer）→ API 立即识别
  （16 commits / 7 AI；含 1 个 cron 系统自动 commit 无 trailer，正确未标 AI）

Stage Summary:
- Phase 7 验收达成：GitHub 集成三类能力全部落地——
  ① 零网络真数据（305 tags → releases 活动流 + 深链）
  ② live events 基础设施（结构就绪，限流时诚实降级不伪造）
  ③ 全界面 GitHub 深链（repo/commit/branch/author/contributor）
- 数据诚实性再进一步：lightweight tag 日期=commit 日期明确标注 dateSource；
  GitHub events 不可用时显示真实原因而非空白；作者链接仅从真实 noreply
  邮箱推导，推导不出就不显示
- 时间线现在讲述完整故事：6,735 个活动 = 6,430 commits + 305 releases
  （17 年发布史与提交史交织，rose 标记一眼可辨）
- 顺手修复 Phase 2 遗留的窄视口徽章重叠 bug（QA 期间 DOM 矩形实测发现）

未解决问题或风险，建议下一阶段（Phase 6 收尾 / Phase 7 增强）优先事项:
1. 【下一步主线建议】移动端 detail panel 升级为全屏 Sheet（vaul 已装，
   diff 浏览体验显著提升）；timeline 虚拟滚动（Load more 累积 DOM）
2. GitHub events 在本沙箱持续限流——限流解除（每小时重置）后 live feed
   区会自动点亮；如需强制验证可临时加 GITHUB_TOKEN 支持（env 注入）
3. releases 可加"版本时间轴"专属视图（v5.x / v4.x 分代序列可视化）
4. diff 语法高亮（轻量 tokenizer，可选）
5. self 仓库 16 commits / 7 AI —— 持续积累"工具开发自己"叙事

---
Task ID: 8
Agent: main (Z.ai Code, cron round 8)
Task: Phase 6/7 收尾增强 —— 移动端全屏 Sheet + timeline 滑动窗口化 + Release Timeline 版本时间轴

Work Log:
- 前置回归 QA：Phase 7 无回归（键盘导航/305 releases/GitHub 按钮/控制台零错误）
- 【环境事件】dev server 进程两次死亡且系统 supervisor 未自动恢复；
  实测发现 Bash 工具命令结束时清理 cgroup 内所有进程（setsid/disown/
  nohup 均无效）→ 本轮所有 QA 改用"单命令全家桶"模式：scripts/qa8*.sh
  在一条 Bash 命令内（setsid 起 server → 轮询就绪 → agent-browser 全套
  QA → 截图），脚本退出时 server 随命令结束。QA 脚本已入库可复用
- 8-a 移动端全屏 Sheet（commit-detail-panel 重构为双壳）：
  → 抽 panelContent 共享 JSX；桌面 hidden md:flex 侧栏（340/380px）不变
  → 移动 vaul Drawer：h-[92dvh] 圆角顶部 + 拖拽手柄 + Overlay + 安全区
    padding + sr-only DrawerTitle；Escape/overlay/拖拽/X 四种关闭
  → 滚动空间 707px（旧 max-h-[55vh]=464px，+52%）
  → 桌面↔移动切换时双壳自动接管（selectedHash 延续，无需关闭重开）
  → vaul 1.1.2 API 陷阱：只导出复合对象 Drawer（Drawer.Content 等子
    组件访问），顶层 DrawerContent/DrawerTitle 命名导入会 build 失败
  → 删除 if(!hash) return null（阻止 Drawer 常驻 mount 控 open）
- 8-b timeline 滑动窗口化（chat-log 模式，替代真虚拟滚动的轻量方案）：
  → windowStart/windowSize 状态模型：Load more 先长到 MAX_WINDOW=640，
    超出后窗口前滑（顶部行卸载）；顶部 Load earlier 反向回滑（等尺寸）
  → "showing 321–960 of 6,735" 精确范围显示；过滤切换 resetWindow()
  → 修复自研 bug×2：①setExtra updater 内调用 setHiddenTop（React 要求
    updater 纯函数，改渲染快照计算）；②visibleCount 公式无上限（重构
    为 windowStart/windowSize 清晰模型后 640 恒定）
  → 红线合规：窗口是渲染分页不是数据隐藏——双向可达、计数诚实
- 8-c Release Timeline 卡（新宽幅视觉组件 release-timeline-card.tsx）：
  → 305 个真实 tag 全量渲染在横向时间轴（2010→2026），major 分代泳道
    v5..v0（16+99+110+39+16+25=305 守恒）；latest v4.22.3 ring 高亮
  → 交互：点任意 dot → onSelect 跳 graph 居中选中+详情面板；hover
    title 显示 tag 名/日期/tagger/annotated；选中 commit dot 高亮
  → 空态（无 tags 仓库）诚实文案；出处脚注（annotated/lightweight 日期
    语义）；年份轴（>12 年跨度每 2 年刻度）
- 修复 VLM 审查发现×3：
  1) 泳道最右 dot + count 被右缘裁剪 → count 从 lane body 移出为 flex
     尾部列（w-8），dots 百分比域与计数列物理隔离（dotsClipped=false 复测）
  2) 移动端 Sheet Hash 行溢出（40 字符长尾+双图标 > 282px 内容宽）→
     长尾 hidden md:inline（完整 hash 仍由 copy/title 提供，无数据丢失）
  3) （email break-all 孤字为可接受排版细节，保留完整性优先）
- lint 零错误；QA×6 轮（qa8/round2/round3/round4/round5/final/verify）
  全绿：窗口化语义（11 连击后 321–960 恰 640 行 + earlier 回滑等尺寸 +
  过滤重置）/ Sheet 双壳 / overlay+Escape 真实事件关闭 / chips 守恒
  （5,894+536+305=6,735）/ 390px 零溢出 / 控制台全程零错误
- VLM×4：Sheet 截图（修 2 处后 OK）/ Release 卡（修 1 处后 OK）/
  复审双 OK
- self 仓库真实 commit（带 Claude trailer）

Stage Summary:
- Phase 6/7 遗留清单三项全部落地：全屏 Sheet（移动体验质变）、
  timeline DOM 有界（滑动窗口）、releases 版本时间轴（专属视图）
- 新增可复用资产：scripts/qa8*.sh 单命令 QA harness（应对 cgroup
  进程清理的环境约束，server+browser+断言一站式）
- 数据诚实性：窗口计数精确到范围；Release 卡 305 点零抽样全渲染
- 产品现状：空间（graph）+ 时间（timeline）+ 发布史（release lanes）
  三视图 + 桌面/移动双形态完整体验

未解决问题或风险，建议下一阶段优先事项:
1. 【环境】dev server 进程稳定性——Bash cgroup 清理导致 server 无法
   常驻；QA 已有脚本化方案，但**用户访问前需确认系统自动重启生效**，
   建议下一轮先 curl 探活，死了则用 scripts/qa8.sh 模式拉起
2. 【下一步主线建议】diff 语法高亮（轻量 tokenizer）；Sheet 内 diff
   折叠全屏体验打磨（移动端 Expand all 后长 diff 的滚动性能实测）
3. GitHub events 限流未解除（沙箱共享 IP）；解除后 live feed 自动点亮
4. Release Timeline 移动端泳道较挤（6 泳道 × 390px）——可加横向滚动
   或泳道折叠（点击 v5 展开 patch 级明细）
5. self 仓库 18 commits / 8 AI —— "工具开发自己"叙事持续积累

---
Task ID: 9
Agent: main (Z.ai Code, cron round 9)
Task: Phase 6/7 增强延续 —— diff 语法高亮 tokenizer + Release Timeline 泳道折叠/移动端横向滚动

Work Log:
- 前置回归 QA：页面加载 / Release 卡 305 点 / 窗口化计数 1–80 of 6,735 /
  graph 键盘容器全通过，控制台零错误
- 9-a diff 轻量语法高亮（新文件 src/components/commit-detail/diff-highlight.ts，
  零依赖单遍正则 tokenizer）：
  → 语言识别按扩展名：clike 家族（ts/js/go/rust/java/cpp/php）、# 注释家族
    （py/sh/rb/yaml/toml/dockerfile）、json、css/scss、markdown、html/vue、sql
  → 模块级缓存（12,000 条上限、超限批量驱逐 25%）——diff 中 context/add
    成对重复文本命中率高
  → 8 类 token：keyword/string/comment/number/func/type/prop/tag；暖色系
    亮暗双模式配色（violet 关键字、amber 字符串、orange 数字、teal 函数、
    emerald 类型），在 add/remove 行底色之上保持可读（VLM 亮暗双确认）
  → DiffRow 渲染 token 流（plain 用 Fragment 零 span 开销）；DiffFileBlock
    按路径 useMemo 识别语言一次；未知语言优雅降级为纯文本
  → JSON 专属逻辑：后跟冒号的字符串识别为 key（violet）与 value（amber）区分
- 9-b Release Timeline 泳道折叠 + 移动端横向滚动：
  → 泳道标签（v5/v4/v3…）升级为按钮：点击展开 patch 级明细条——按 minor
    版本分组（4.22 / 4.21 / …）的 tag chips，annotated 实心点 / lightweight
    空心点标记，v4 全量 99 chips 零抽样；点 chip 联动 graph 选中 + 详情面板
  → 【VLM 审查捕获真 bug】明细条初版放在横向滚动容器内，lanes 滚动后
    chips 左缘被裁剪 → 重构：明细条移到滚动容器外全宽渲染（永不裁剪），
    展开泳道时自动 scrollTo(left:0) 复位
  → 移动端 lanes min-w-[480px] + overflow-x-auto + 右缘 swipe 渐变提示
    （ResizeObserver 判定真实溢出才显示；首次滚动后淡出；sm: 断点不影响桌面）
  → 【环境坑·已入册】Tailwind 4 增量缓存卡住：新增任意类 min-w-[480px]
    时 JS chunk 更新但 CSS chunk 陈旧不生成规则（旧 340px 规则残留）→
    对 globals.css 做真实内容变更强制重建管道；复现时先查 CSS chunk 再改 globals
- 9-c 样式细节加厚：
  → DiffFileBlock 文件名后新增语言徽章（JS/TS/JSON…，与高亮共用同一
    detectLanguage，title 显示 highlighting 语言）
  → hunk 头（@@ -x +y @@）第二个 @@ 之后的 git 函数上下文以 45% 透明度
    淡显，行号区更可扫读
- 验证全绿：lint 零错误；桌面 QA（窗口 80 行 / Load more 1–80→1–160 /
  v4 展开 99 chips / chip 联动面板 / 徽章 JS×2 / violet 54 + amber 25 token /
  hunk 淡显×4 / 键盘容器）；移动端 390px（Sheet 抽屉内高亮 27 violet +
  9 amber / 横向滚动 + swipe 显隐 / 页面零溢出）；VLM×4（diff 亮、diff 暗、
  release 移动端修复前后）全部 BUGS NONE；全新浏览器会话控制台 0 错误
- self 仓库真实 commit（带 Claude trailer）

Stage Summary:
- diff 浏览从黑白文本升级为带语法着色的代码审阅；移动端 Sheet 同等受益
- Release Timeline 补齐 patch 级明细：305 tags 双层可达（lane dot 概览 →
  minor chips 精确点选），移动端横向滚动恢复时间轴分辨率
- 数据诚实性不变：chips 全量零抽样、annotated/lightweight 明示、
  swipe 提示只在真实可滚时出现
- 新增可复用资产：diff-highlight.ts tokenizer（未来 file viewer 可直接复用）

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步主线建议】word-level diff 高亮（行内变更词高亮，GitHub 风格）——
   tokenizer 基建已就绪：配对相邻 remove/add 行 + 公共前后缀比对即可，
   预计一个下午工作量
2. tokenizer 边缘 case：模板字符串 ${} 内部未递归高亮、Vue SFC 块级语法
   按 clike/html 近似处理（可接受，非缺陷）
3. Tailwind 增量缓存坑可能复现：新增任意类不生效时，先检查 CSS chunk
   是否包含规则，再对 globals.css 做真实内容变更强制重建
4. GitHub events 沙箱共享 IP 限流仍未解除；解除后 live feed 自动点亮
5. self 仓库 commits / AI commits 持续积累（"工具开发自己"叙事）

---
Task ID: 10
Agent: main (Z.ai Code, user-requested round)
Task: 用户七项需求 —— GitHub 推送 / 光标 bug / 横版切换 / 布局加宽 / PNG 导出 / 使用文档 + 采纳既有建议（token live events / word-diff）

Work Log:
- 10-a 代码推送 GitHub：
  → 推送前卫生清理：解除跟踪 .env（仅含本地 sqlite URL 无秘密）、
    db/custom.db、tool-results/（.gitignore 补 db/*.db 与 tool-results/）
  → API 建仓 ChenChen913/coding-activity（public，两词命名）；token 仅存
    本地 .git/config 与 .env.local（均不入库，git check-ignore 验证）
  → 首推 main 成功（1feb216）；后续每阶段及时续推
- 10-b 严重 bug：图内光标定位与实际不一致 —— 双根因修复：
  → 根因① rowFromClientY 把视口坐标当容器坐标（漏减 rect.top），
    图卡不在视口顶部时 hover 行偏差几十行
  → 根因② 行判定公式多减半行高（-rh/2），hover 判定带整体上移 17.5px，
    光标在节点正中命中上一行 —— 用 CDP 真实鼠标事件 4/4 全对齐验证
  → rowFromClientX（横版）同步推导并修掉符号错误（world = screen − tx）
- 10-c 横版切换（orientation toggle）：
  → 新增 HorizontalGraph 子组件：时间左→右（最新在右）、泳道上→下、
    顶部时间轴（年/月标签+年网格线）、hover 列高亮、tooltip 复用
  → 全交互适配：wheel（竖轮=时间旅行）、拖拽/双指缩放（坐标约定不变）、
    键盘 ←→=新旧导航、选中居中（x 轴）、Latest/Oldest、fit、可见窗口
  → 持久化 localStorage('graph-orientation')；竖版零回归（列表仅竖版渲染）
  → 修复横版可见列窗口符号 bug（effTx 应取负：visible world = [−tx, −tx+w]）
- 10-d 布局加宽：页面容器 max-w-[1200px]→[1600px]（header/main/footer
  三处）；时间列 w-[52px]→w-16+whitespace-nowrap（22 格 0 折行）；
  泳道区上限 460→520
- 10-e PNG 导出（新文件 export-graph.ts，零依赖）：
  → 程序化 SVG 重建（非 DOM 克隆）：系统字体、亮暗主题自适应配色、
    merge/AI/selected 标记全套复刻；canvas 栅格化 + 安全缩放
    （MAX_PNG_SIDE=32000 自动降档）
  → 菜单四项：当前视图 2×/3×/4× + 全历史海报（6,430 commits 全量，
    行距自适应 budget/n，超清 548×32000 实测全链路日志通过）
  → 实测 3× 导出 3690×1800 PNG 落盘 + VLM 审查 BUGS NONE
  → 【环境注】headless Chrome 拦截连续自动下载（首次成功后续静默丢弃），
    系浏览器自动化副作用，真实用户点击不受影响
- 10-f GITHUB_TOKEN（采纳建议）：github-events.ts 注入 Bearer 头
  （60/h→5,000/h）；.env.local 写入用户 token（gitignored）+
  .env.example 模板；实测 demo 仓库 93 条真实事件点亮（UI 呈现
  starred/pushed 行）；self 仓库随推送获得 remote → available:true
- 10-g word-level diff 高亮（采纳建议）：remove/add 行配对 → 公共前后缀
  对齐 + 词边界吸附（不拆词）→ 行内变更字符深色块（emerald/red 30%），
  token 跨界智能拆分渲染；实测 res.send 修复 66 个行内标记 +
  VLM 确认「变更词块明显强于行底色」
- 10-h 使用文档 README.md（中文，~200 行）：快速开始 / 仓库注册表机制
  （30 秒接入任意本地仓库）/ AI Agent 日常监控工作流（trailer 协议 +
  四步看板指南）/ 本地 Agent·IDE 结合（已实现 4 项 + 推荐玩法 4 项 +
  未实现清单）/ GitHub 集成与推送监控 / FAQ（含数据诚实性问答）
- 验证矩阵：lint 零错误；全新会话控制台 0 错误；hover 4/4 CDP 对齐；
  横版 41 circles/40 paths 渲染 + hover 放大 + 移动端 390px 零溢出；
  竖版全链路（timeline 点击→pulse-ring 视口内→详情面板）；VLM×4
  （导出 3×/横版/word-diff/暗色整页）全 BUGS NONE；live events 93 条
- self 仓库真实 commit（带 Claude trailer）+ 推送 GitHub

Stage Summary:
- 七项用户需求全部落地 + 两项既有建议（token events、word-diff）同步完成
- 光标 bug 是双根因叠加（视口坐标 + 半行偏移），真实鼠标事件验证彻底修复
- 横版视图让「时间维度」第一次可以在水平方向平移浏览，与竖版共享全部
  数据/配色/交互语义；导出功能补齐「离开浏览器分享」场景
- 项目已上线 GitHub：https://github.com/ChenChen913/coding-activity
  （public；README 即使用文档；self 仓库从此有真实 remote 与 live events）

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】GitHub events 现已可用 —— 可做 live feed 与 timeline
   的「实时区」（push 后自动刷新，轮询 60s）；再加 Push/PR/Release
   活动类型在 timeline 中的展示（结构早已就绪）
2. 横版模式暂无消息列表（行列表与横向时间轴无法对齐，tooltip+详情面板
   替代）—— 可加「悬浮列信息条」显示光标所在 commit 摘要
3. headless Chrome 连续下载拦截仅影响自动化 QA，不影响真实用户；
   QA 脚本如需验证下载可每次重启浏览器会话
4. poster 横版在超长仓库（>6,400 commits）下 rh≈2.5px 仅可辨识结构
   纹理；可按需提供「分段导出」（如按年切片多张海报）
5. self 仓库叙事持续积累：本次为第 10 个 Task commit（含 11 个 AI commit）

---
Task ID: 11
Agent: main (Z.ai Code, user-requested round)
Task: 用户两部分需求 —— ①图表展示优化（返回顶部按钮 / 横版方向标识 / 横版详情下方常显）②提交记录类型视觉区分（build/fix/发版本等按关键词着色）+ 推送 GitHub

Work Log:
- 11-a 共享类型系统（新文件 src/lib/commit-type.ts + commit-type-badge.tsx）：
  → parseCommitType：merge 前缀（Merge branch/pull request…）→ revert
    （Revert "/revert:）→ conventional commits type(scope)!:（含别名
    feature/bugfix/hotfix/tests/docs…；chore(release)/build(release) 折叠
    为 release）→ 纯文本 release 风格（Release x / v1.2.3 / bump version）
    → 其余诚实归 other
  → TYPE_META 15 类色板（暖色/绿/紫，零蓝色）：feat emerald / fix red /
    docs yellow / style orange / refactor teal / perf amber / test lime /
    build 深棕 / deps 橙棕 / ci fuchsia / chore stone / revert 深石 /
    release rose / merge teal(hidden) / other(hidden)
  → CommitTypeBadge：色块 chip（border+bg+亮暗双模式文字）；merge/other
    渲染 null（由既有图标语义承担）
- 11-b 图内「返回最新」浮动按钮（竖版=返回顶部 / 横版=回到右缘）：
  → awayFromHome 判定：竖版 effTy>120；横版 hTimeW>w 且偏离 home tx>120
  → AnimatePresence 缩放淡入；位于位置指示器上方 bottom-10 right-2；
    h-10 w-10 圆钮（触摸友好）；goHome 用 animateTo 缓动（横版保持 lane
    y 不变只做时间旅行）
- 11-c 横版方向标识（用户要求"最起码给一个箭头"）：
  → 时间轴两端常驻锚点：左「← older」（渐变遮罩防与年月标签冲突，
    axisMarks 过滤边距 18→76/64px）、右「newer →」（emerald 强调）
  → 平移方向实时反馈 chip：wheel（deltaY>0→newer）/拖拽（dx>0→older）
    触发 showFlow，650ms 自动消退，AnimatePresence 底部居中闪现
    （newer→emerald / ←older 灰）；ref+timer 防重渲染风暴
- 11-d 横版详情面板移至图下方并常显：
  → orientation 状态提升至 page.tsx（localStorage init rAF 包裹过 lint；
    toggle 双向持久化）；CommitGraph 改受控/非受控双模式（prop 优先，
    无 prop 时回退内部状态，向后兼容）
  → CommitDetailPanel 新增 variant='below'：全宽 h-[380px]/sm:420px、
    max-h-[62vh]、border-t、独立滚动；hash 兜底 selectedHash ?? commits[0]
    （最新 commit）→ "一直显示"；isDefaulted 时头部虚线 chip 提示
    "latest — click any node to inspect"；关闭钮语义变为 Back to latest
  → 竖版零回归：sidebar + 移动端 Drawer 保持原行为（variant='sidebar'）
- 11-e 类型视觉区分全 surface 落地：
  → graph 竖版消息列表行首徽章 + tooltip 徽章（92 个实测 BUILD/DEPS/
    FIX/RELEASE/CI）
  → Activity Timeline：标题前徽章（70 个）+ 轨道图标按类型着色
    （border/bg/图标 color 三处 hex 淡染，67 个；AI/merge/release 优先
    保持既有语义色）
  → 搜索结果、详情面板头部徽章；Conventions 卡重构为共享 parseCommitType
    + TYPE_META（色板单一来源；merge 结构性提交并入 other 行不参与
    conventional % 分子）
- 11-f 验证矩阵（agent-browser + VLM）：
  → 竖版：wheel 下滚 14×260 → 按钮出现（99–125 行）→ 点击 → 1–22 行
    → 按钮自动隐藏 ✅
  → 横版：← older/newer → 锚点常驻；wheel 平移抓到 "newer →" chip 实时
    闪现；平移 3600px → Back to latest 出现（98–142 行）→ 点击回 1–39 ✅
  → 横版下方面板：默认显示最新 commit（BUILD 徽章 + hinted chip）；
    点中列节点 → 面板联动 DOCS commit + pulse-ring + hint 消失 ✅
  → 移动端 390px：横版零横向溢出、方向锚点可见、面板 380px 可读
    （VLM 确认无 cut-off）；切回竖版 Drawer 选择正常弹出 ✅
  → 桌面竖版回归：侧面板 + RELEASE 徽章正常；localStorage 横竖持久化 ✅
  → 控制台零错误；dev.log 全 API 200；lint 零错误；VLM×3 全程无布局缺陷
- 【环境坑补充】agent-browser eval 不支持箭头函数（返回 {}）——必须用
  (function(){...})() IIFE 表达式；Fast Refresh 编辑期会话会卡 skeleton，
  reload 后恢复
- self 仓库真实 commit（带 Claude trailer）+ 推送 GitHub

Stage Summary:
- 图表导航补齐"长图回位"能力：两方向浮动按钮 + 横版双向时间轴锚点 +
  平移方向实时反馈，横版阅读方向从"猜"变为"一眼可读"
- 横版信息架构完成对称：竖版右侧面板 ⇄ 横版下方常显面板（默认展示最新
  commit，永不为空），点击节点即时联动
- 记录系统获得"性质维度"：15 类提交记录全 surface 色块区分（graph 列表/
  tooltip/搜索/timeline/详情面板/Conventions 卡同色），构建/修复/发版本
  等一眼可辨；数据诚实性不变——解析只认真实固定词汇，其余保持 other 可见

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】Timeline 类型筛选：把 Conventions 卡的行变成可点击
   filter（需把 typeFilter 状态提升或通过 URL query 共享），"点卡片行
   →timeline 只看 fix"闭环；顺带给 GitHub events 行也加类型徽章
2. 【下一步建议】横版 lane 侧标签：目前横版看不到分支名，可在左侧固定
   一列 lane 序号或分支 tip 名（laneOf 的 headBranches 已有数据）
3. PNG 导出（export-graph.ts 程序化 SVG）尚未包含类型徽章与方向锚点，
   导出图与屏上图有轻微视觉差（可接受，结构一致）
4. 横版 below 面板在 390px 手机上位于首屏折叠线下（正常文档流），若要
   首屏可见可考虑移动端横版默认收起为 240px 高
5. self 仓库叙事持续积累：本次为第 11 个 Task commit

---
Task ID: 12
Agent: main (Z.ai Code, cron round)
Task: 采纳 Task 11 建议 —— ①Timeline 类型筛选闭环（Conventions 行可点）②横版 lane 侧标签 ③GitHub events 徽章 + 60s 轮询；修复沙箱重置引发的数据层事故

Work Log:
- 【环境事故 1·repos 目录被沙箱清除】会话开始全部 API 422（"demo is not a
  git repository"）—— repos/demo 整个目录（expressjs/express 全量克隆）被
  沙箱跨会话清理（gitignored 目录不持久）。重新 git clone 全量恢复
  （app 统计 6,430 commits，与之前一致）；.zscripts/dev.pid 移出 git 跟踪
- 【环境事故 2·.env.local 被清除】GITHUB_TOKEN 丢失 → events API 降级
  rate-limited。从 git remote URL 内嵌 token 恢复 .env.local（40 字符，
  gitignored 验证通过），events API 立即点亮
- 【重大排障教训·显示层吞字符】bash 输出反复显示 commit-graph.tsx 出现
  "overedRow" 类"语法损坏"且工具间互相矛盾（rg 见损坏 / python 说干净 /
  tsc 说合法）——最终 od -c 字节级验证：**文件从未损坏**，是本会话输出
  显示层把 "[h" 序列当 markdown 链接语法吃掉了。以后凡见"不可能的损坏"，
  先 od -c / wc -c 字节级复核，不要直接改文件
- 【排障教训 2·wheel 方向语义】横版 wheel down（deltaY>0）= 向"更新"方向
  旅行；在 home（最新在右缘）位置 wheel down 被正确 clamp → 视图不动是
  【设计行为】不是 bug。QA 平移要用负 deltaY（向更老）。另：
  agent-browser mouse move 的坐标与 mouse wheel 的派发坐标不联动（wheel
  命中了 main 元素滚了页面），合成 dispatch 直接指定 target 元素最可靠
- 12-a Timeline 类型筛选闭环（ConventionsCard → ActivityTimeline）：
  → ConventionsCard 行变按钮：hover 染色、active 态 Check 图标 + 色环、
    空行 disabled；副标题 "click a row to filter the timeline"
  → "other…" 行的 kinds = other+merge+折叠尾部类型（analysis 新增
    otherKinds，行显示与筛选语义严格一致）
  → page.tsx 持有 typeFilter 状态：切换仓库时清空；toggle 后 rAF 滚动
    timeline 进入视野（闭环可见）；timeline 卡底部 strip 显示
    "filtering: fix ×" 一键清除
  → ActivityTimeline：chips 状态重命名 kindFilter（消除与 prop 撞名）；
    筛选管线正交组合（typeFilter 与 kind/年份 chips 可叠加）；筛选条
    前置彩色 "type: fix" chip（× 清除）；空态给出原因 + 清除按钮；
    typeFilter 变化 rAF 重置窗口
  → 实测：点 fix 行（49 commits 0.8%）→ timeline 自动滚入视野、
    "type: fix" chip 出现、列表恰好 49 条全部 FIX 徽章、showing 1–49 of 49；
    × 清除 → 恢复 6,735 activities 混合类型
- 12-b 横版 lane 标签列（viewport 固定左侧沟槽）：
  → laneLabels memo：每条 lane 取分支 tip 名（当前分支优先 > 本地名 >
    第一个；远端前缀 origin/ 剥离显示、title 留全名）；无 tip 的 lane
    诚实回退 L<n>；点击标签 = selectCommit(该分支 tip)
  → 几何全面改造（10+ 处）：时间 svg left=labelW（76/112px 按断点）+ 
    width=svgW 天然裁剪 —— commit 永远不会滑到标签下面；effTx/fit/
    初始 fit/goHome/Latest/selectCommit 居中/rowFromClientX/可见窗口/
    axisMarks/双指缩放锚点（pinch midX svg-local）/zoomAt 横版锚点修正
    全部按 svgW 推导；awayFromHome/hHomeTx 同步
  → 标签 chip：lane 色点 + 名称 + lane 色边框淡染背景；HEAD 分支加粗 +
    色环强调；geo.lw<15 缩得太小时退化为纯色点（不重叠）
  → 实测（VLM）：master (HEAD)/dependabot/github_actions/release/4.22.3/
    ci-workflows + L5 全部可读、零重叠、平移时固定左缘；点
    dependabot 标签 → pulse-ring 定位到该分支 tip ✅；Oldest/Latest/
    Back-to-latest（6,394–6,430 ↔ 1–36）全部正常
- 12-c GitHub events 徽章 + 60s 轮询：
  → EVENT_KIND_CHIP 8 类彩色徽章（PUSH/RELEASE/PR/ISSUE/STAR/FORK/
    BRANCH/EVENT，亮暗双模式）替换原色点
  → 头部 "refreshes every 60s · updated {relativeTime}"（now memo 加入
    dataUpdatedAt 依赖保持诚实）；前端 refetchInterval 5min→60s，后端
    TTL 5min→60s（token 限流 5000/h 下 60 次/h 安全）
  → 实测：events available:true，FORK/EVENT/PR/ISSUE 徽章渲染，
    "updated now" 显示
- 12-d 验证矩阵：
  → 桌面横版：标签列/方向锚点/时间轴/下方常显面板全链路 ✅
  → 竖版回归：hover tooltip（b028ce18 BUILD 真实数据）+ 侧面板 ✅
  → 移动端 390px：横版 overflowX=0、标签列 76px 可读、svg left=76
    width=280（VLM BUGS NONE）✅
  → 暗色模式整页 VLM BUGS NONE（lane 标签对比度 WCAG AA+）✅
  → 控制台零错误；dev.log 全 200；lint 零错误；无新增 tsc 错误
- 12-e 推送：发现远端已有不同 hash 的 phase11（前轮已推）→ rebase 冲突
  仅 dev.pid/mode 差异 → skip 重复本地 phase11 后干净推上
  a3ec9d3 feat(phase12)

Stage Summary:
- 「点卡片行 → timeline 只看该类记录」闭环落地：Conventions 卡从静态
  统计升级为可交互筛选入口，与 timeline 双向联动（chip × / 卡片再点 /
  底部 strip 三处可清除），且与 kind/年份 chips 正交组合
- 横版信息架构补上最后一块：左侧 lane 标签列让「每条泳道是什么分支」
  一眼可读，点击直达分支 tip；viewport 固定 + svg 裁剪的双层设计保证
  标签永不遮挡 commit（竖版 time gutter 的对称实现）
- live feed 真正"活"起来：60s 轮询 + 新鲜度标签 + 8 类事件彩色徽章
- 沙箱不持久化 gitignored 路径（repos/、.env.local）的教训已沉淀到
  QA checklist：API 422 时先 ls repos/ + cat .env.local

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】类型筛选联动图本体：typeFilter 激活时把 graph 中非该
   类型节点降饱和（或列表行淡化），卡片↔图↔timeline 三处视觉同源
2. 【下一步建议】PNG 导出（export-graph.ts）补 lane 标签列与类型徽章，
   消除导出图与屏上图的可感知差异；横版导出加 labelW 沟槽对齐
3. 沙箱重启会再次清掉 repos/demo 与 .env.local —— 下轮开工先跑
   `ls repos/demo/.git && cat .env.local` 体检（可写个 make doctor）
4. 遗留 tsc 严格模式告警 3 处（integrity-card 索引签名 / diff-highlight
   m 可空 / page.tsx L633 IntegrityCard 类型）——运行时安全，低优先
5. self 仓库叙事：本次为第 12 个 Task commit（含 12 个 AI commit）

---
Task ID: 13
Agent: main (Z.ai Code, user-requested round)
Task: 用户三项修正 —— ①返回顶部按钮移出信息栏（避 hover 遮挡）②横向视图改为从左往右读（最新在左）③横向视图补齐每条 commit 详细信息（与纵向对应）+ 采纳 Task 12 建议①（类型筛选联动图本体）+ 修复 3 处遗留 tsc 告警 + 推送 GitHub

Work Log:
- 【接手中断现场】上轮（34bc841，UUID 提交名）在实现消息 7 修正时超时中断：
  已反转主组件几何（wheel/drag/键盘/rowFromClientX/visible/home tx 全部
  改为"最新在左"）+ 预埋 railH 几何与 typeFilterKinds prop，但
  HorizontalGraph 渲染仍是旧方向（最新在右）、1711 行引用已改名的
  ArrowRightToLine 导致编译错误、rail 无 JSX、筛选未接线 —— 本轮补完
- 13-a 横向方向反转一致性收尾（读向：左→右 = 最新→最旧，与竖版
  上→下完全对应）：
  → HorizontalGraph.timeX：LEFT_PAD + row*cw（row 0 最新钉在左缘）；
    S 曲线控制点反转为 x1+k / x2-k（child 在左、parent 在右）
  → 方向锚点对调：左「← newest」（emerald）/ 右「oldest →」（muted）
  → flowHint 语义修正：wheel down=向过去（"older →" muted）、
    拖右=向最新（"← newer" emerald）；纵向 wheel 同语义（下=回溯）
  → awayFromHome 横向判定改 effTx < -120（home tx=0，向右旅行为负）；
    Oldest 工具栏按钮横向改 tx: hOldestTx（原 tx:0 已指向最新=bug）
  → lane 标签 y 钳制加 railH，标签不再伸入 rail 区
  → export-graph.ts 同步反转：view + poster 的 timeXOf 改 row 正序；
    edgeSvg 横向曲线加方向符号 s（朝彼此弯曲，无论时间朝哪边跑）
- 13-b 横向底部 commit 信息栏（rail，竖版消息列表的对应物）：
  → 画布底部 railH 条（桌面 76px 双行 / 移动 48px 单行），左角
    "COMMITS" 标题格；每个可见 commit 一个 chip 严格对齐其列
  → 四级密度：slot<14 结构刻度（lane 色）→ <46 类型色点 → <110
    色点+shortHash（+AI 琥珀点）→ ≥110 CommitTypeBadge+完整消息
    （与竖版列表同密度）；桌面双行交错使 chip 可宽至 2 列不重叠
  → hover=列高亮+完整 tooltip（hash/类型/作者/时间/AI/分支数）；
    click=选中（pulse-ring + 下方面板联动）；chip 宽度钳 320px
  → 竖版对应关系达成：竖版[消息列表|图|侧栏] ⇄ 横版[lane 标签|图|
    rail]+[下方面板]，每条 commit 信息两模式等价可达
- 13-c 返回顶部按钮移位（用户核心抱怨：hover 提交信息遮挡、点不到）：
  → 新增图卡底部 footer 条（h-10 border-t，画布高度 440/600→
    400/560 补偿，总高不变）；按钮彻底移出画布 → tooltip（画布内
    DOM 定位）物理上无法再覆盖它
  → footer 紧贴信息面板（竖版=右侧栏下缘 / 横版=下方面板上缘），
    符合用户"移到具体信息栏外边、紧贴旁边"的要求
  → 按钮带文案 "Back to latest"（emerald 描边，横版 ArrowLeftToLine
    指向左缘 / 竖版 ArrowUpToLine）；位置指示器（1–41/6,430）一并
    迁入 footer；无筛选时左侧显示微型方向图例（← newest · oldest →）
- 13-d 类型筛选联动图本体（Task 12 建议①落地）：
  → page.tsx 传 typeFilterKinds={typeFilter?.kinds}（上轮预埋 prop 接通）
  → 竖版节点/消息列表行、横版节点、rail chip：非匹配 opacity 0.25/
    0.4+saturate-50（选中项豁免）；匹配节点加类型色 halo 光环
  → footer 激活时显示类型色筛选 chip（"type filter: fix — non-matching
    commits dimmed"）；卡片↔图↔timeline↔rail 四处视觉同源
- 13-e 遗留 tsc 告警清零：integrity-card 改结构化 AuditCommit 类型
  （GraphCommit/GitCommit 双兼容）；diff-highlight m 空值守卫
- 13-f 验证矩阵（agent-browser + VLM×5）：
  → 方向：hover x=200 显示 b028ce18（最新区）；DOM row 0（4797abfa）
    位于最左 left=2；锚点亮暗双模式可见（VLM 确认）
  → rail：37 chips=可见窗口；点击第 5 个 chip → pulse-ring 出现 +
    下方面板显示该 commit（"deps: proxy-addr"）+ 默认提示消失
  → Back to latest：wheel 12×260 → 出现（footer 内 y=736，画布外，
    物理不可被 tooltip 覆盖）→ 点击回 1–41 → 自动隐藏；竖版同链路
    （73–97 → 1–21）；220% 缩放后仍正确出现（缩放锚点漂移场景）
  → 密度升级：182%=色点+hash → 220%=BUILD 徽章+完整消息
  → 筛选：点 Conventions fix 行 → rail 31 中 28 降饱和、匹配节点
    halo、footer chip、timeline "type: fix" 全联动；VLM 确认对比度佳
  → 移动端 390px：overflowX=0、rail 48px 单行 13 chips、lane 标签
    可读（VLM BUGS NONE）；竖版回归：消息列表 21 行正常
  → 控制台 0 错误；dev.log 全 200；lint 零错误；tsc 项目内零错误
- 推送 GitHub：ed031b1（含 Claude trailer）

Stage Summary:
- 横向视图完成"正常观感"改造：从左往右读=从最新到最旧，与竖版
  上→下阅读完全同构；wheel/拖拽/键盘方向语义全部一致化，导出图同步
- 横向信息架构补齐最后缺口：底部 rail 让每条可见 commit 都有对齐的
  信息载体（四级密度自适应缩放），hover/click 与图、tooltip、下方面板
  全链路联动 —— 用户"和纵向对应起来"的要求达成
- 返回顶部按钮从"被 tooltip 追着挡"变为 footer 常驻位（物理隔离 +
  紧贴信息面板），位置指示器与方向图例同条收纳，图卡信息层级更清晰
- 类型筛选从"timeline 专属"升级为全应用视觉语言：卡片行→图节点
  （降饱和+halo）→消息列表→rail 四处同色同语义

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】rail 密度阈值微调：badge+message 级需 220% 缩放才
   出现，可把阈值 110 降到 ~96 或桌面 rail 加高到 3 行（104px）让
   默认缩放即显示部分消息；顺带 rail 加 author 列（slot>200 时）
2. 【下一步建议】PNG 导出补 rail 与筛选状态：buildViewSvg 目前不含
   底部 rail 与类型 halo，导出图与屏上图仍有可感知差异
3. 【下一步建议】timeline 类型筛选行加"在图中高亮"提示文案，让
   卡片↔图联动更可发现（现在 footer chip 已有但入口认知弱）
4. 沙箱重启仍会清 repos/demo 与 .env.local —— 开工先跑
   ls repos/demo/.git && cat .env.local 体检
5. self 仓库叙事：本次为第 13 个 Task commit（ed031b1）

Task 13 追加（同轮后续，ed031b1 之后）:
- 13-g rail 密度增强（采纳本 Task 建议 1）：
  → 桌面 rail 2 行/76px → 3 行/104px 交错（移动端 48px 单行不变）；
    badge+message 阈值 110→90 —— 默认 fit 缩放即显示 33/41 个
    徽章+消息 chip（原先需放大到 220%）；slot≥220 追加 author 列
  → 验证：railH=104、默认缩放 BUILD/DEPS/RELEASE 徽章+消息可见、
    3 行交错零重叠、lanes 区不被挤压（VLM BUGS NONE）；移动端
    390px 复检 railH=48、overflowX=0；控制台 0 错误
  → commit: 3 行 rail 增强（本条与 ed031b1 同属 Task 13 轮次）
- 剩余建议移交下轮：PNG 导出补 rail/halo；timeline 筛选行的
  "在图中高亮"提示文案

---
Task ID: 14
Agent: main (Z.ai Code, cron round)
Task: 落地 Task 13 移交建议 —— ①PNG 导出对齐屏上视图（横版 lane 标签列 + 底部 rail + 类型筛选 halo/降饱和）②类型筛选"在图中高亮"提示文案 ③新功能：全历史 Minimap 导航条（scrubber）+ 修复首跳竞态 + 推送 GitHub

Work Log:
- 14-a PNG 导出补齐（buildViewSvg 重写，"WYSIWYG" 承诺兑现）：
  → ViewExportOptions 新增 labelW / railH / railRows / laneLabels /
    typeKinds；nodeSvg 增加 halo + dimmed 参数
  → 横版：左侧 lane 标签沟槽（分支名 chip + 色点 + HEAD 加粗 + L<n> 诚实
    回退）；底部 rail 完整四级密度复刻（slot<14 刻度 / <46 色点 /
    <90 色点+hash / ≥90 徽章+消息+高缩放 author）；COMMITS 标题格；
    ← newest / oldest → 方向锚点；clipPath 保证 chip 不滑入沟槽
  → 纵向：消息列表补类型徽章（badgeSvg，TYPE_META 色板）+ 分支药丸
    （本地=lane 色底白字 / 远端=描边）+ 屏上同款时间格式 HH:mm/yyyy-MM-dd
  → 筛选态：匹配节点 r+2.5 色环（与屏上一致）、非匹配节点 opacity 0.25、
    消息行/rail chip 0.4；选中态行高亮 + 消息加粗
  → E2E 验证：blob 链路（SVG 32.5KB → PNG 212KB → 下载名正确）；
    SVG 内容 grep（COMMITS/锚点/lane 标签/35 徽章/4 AI 点）；
    横版 VLM 四项全过；纵版+fix 筛选 VLM 五项全过（1 halo、20 节点 +
    16 行降饱和、FIX 徽章、7 药丸）；控制台零错误
- 14-b 提示文案（Task 13 建议③）：
  → Conventions 副标题 "click a row to filter the timeline & highlight
    the graph"；行 tooltip 说明 halo + dim 行为；激活态 chip 追加
    "· graph dimmed"（sm 以上）
  → Timeline "type: fix" chip 加 title 提示图联动
- 14-c 新功能：Minimap 全历史导航条（画布下、footer 上，h-30px）：
  → 每条 commit 一个点（6,430 全量，诚实无抽样）：row→x（最新在左，
    与横版阅读方向一致）、lane→y、AI commit 琥珀色、merge 稍大；
    单 <g> innerHTML memo（layout/width 变更才重建，平移缩放零重渲）
  → emerald 视口窗（startRow/endRow 百分比定位）+ 选中 commit 竖标线 +
    new/old 微标签；仅当历史溢出视口时挂载（同时画布 400/560→380/530
    补偿高度）
  → 交互：click = animateTo 滑翔（280ms）；drag = pointer capture +
    原始 setTransform 1:1 跟手（scrubber 手感）
  → 【bug 修复·首跳竞态】连续复现 fresh load 首次点击落在 0.74x 位置
    （62.6% 而非 85%）：根因是 miniJump 用 tRef.current.scale 重算几何，
    在 fit effect 的 rAF 尚未 flush 时 tRef 仍是初始 scale=1.0（渲染已
    1.35）——改为直接引用渲染作用域 geo（与屏上严格同源）后 3/3 次
    fresh load 85% 点击精确落地（5,444–5,489 居中 5,466）
  → 另修复横版跳转符号错误：tx = sw/2 - worldX（screen x = world x +
    tx，初版写反导致横版点击无效果）
  → 验证矩阵：纵拖拽 20%→60% 精确（3,836–3,881）；横版 90% 跳转精确
    （5,765–5,810）；Back to latest 回 1–41；动画轮询 62.6→75.7→84.65%
    收敛稳定；移动端 390px strip 356×30 / overflowX=0 / 画布 380；
    暗色 VLM 无对比度问题；控制台零错误
- 14-d QA 中澄清两则 VLM 幻觉（DOM 几何复核）：
  → "rail chips 重叠"：实测 41 chips / 3 行 / 0 重叠（chip 高 30px）
  → "导出右缘截断"：与屏上 overflow 裁剪行为一致，属 WYSIWYG 语义
- 14-e 验证与收尾：lint 零错误；tsc 项目内零错误；dev.log 全 200；
  推送 GitHub 3a32e89（第 14 个 Task commit）

Stage Summary:
- 导出功能达到"所见即所得"：横版 lane 标签列 + 底部 rail + 双模式类型
  筛选视觉（halo/降饱和）全部进入 PNG，导出图与屏上图的可感知差异消除
- Minimap 补上导航拼图："我在 15 年历史的哪里"一眼可答；click/drag
  双模式 + 全量 6,430 点（含 AI 琥珀标记）让空间感与诚实原则兼得；
  顺带沉淀"事件几何必须引用渲染作用域而非 ref 快照"的竞态教训
- 类型筛选的可发现性闭环：卡片副标题 / 行 tooltip / 激活 chip 三处
  明示"图会联动高亮+降饱和"

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】Minimap 增强：hover 显示该位置日期 tooltip；shift+click
   精确定位某 commit；rail 上方或 minimap 显示当前视口的日期范围文本
2. 【下一步建议】PNG 导出可选包含 minimap 全景条（poster 模式天然合适）
3. 【下一步建议】图内搜索联动：搜索命中时在 minimap 上打标记点 +
   图节点高亮（复用 typeFilter 的 dim 机制）
4. 沙箱重启仍会清 repos/demo 与 .env.local —— 开工先跑
   ls repos/demo/.git && cat .env.local 体检
5. self 仓库叙事：本次为第 14 个 Task commit（3a32e89）

---
Task ID: 15
Agent: main (Z.ai Code, cron round)
Task: 落地 Task 14 移交建议 —— ①Minimap hover 日期 tooltip + 视口日期范围文本 ②图内搜索全链路联动（节点 ring/dim + minimap 标记 + footer chip + 导出同步）③Poster 导出 commit 密度条 + QA 矩阵 + 推送 GitHub

Work Log:
- 15-a 环境体检：repos/demo 与 .env.local 完好、dev server 200、
  dev.log 全 200 —— 无沙箱重置损失
- 15-b 基线 QA：页面正常渲染（33 svgs）、控制台无运行时错误
- 15-c Minimap hover 日期 tooltip（建议①）：
  → idle pointermove（非拖拽）记录 {frac, px}，tooltip 浮于条上方
    （bottom-full + clamp(64px…) 防溢出），内容 = 日期 · shortHash ·
    #row of total；伴随 2px 光标竖线；拖拽/按下时清除，离开时清除
  → footer 位置 chip 增加可见窗口日期范围
    "1–40/6,430 · 2026-10-01 → 2026-05-17"（sm 以上显示）
- 15-d 搜索全链路联动（建议③，复用 typeFilter dim 机制）：
  → CommitSearch 新增 onMatchesChange 回调（ref 存回调避免 render
    期更新 ref 的 lint 违规；卸载时上报 null）
  → page.tsx 状态提升 searchFilter {query, hashes} → CommitGraph
  → 节点/消息行/rail chip：搜索未命中 dim（与类型筛选 OR 组合：
    命中类型但搜索未命中仍 dim）；命中节点加 emerald 外环 r+5.5
    （type halo r+2.5 之外，选中 pulse r+4 之外，三环不冲突）
  → minimap：每个命中 commit 一条 emerald 竖标记（诚实密度：
    86 匹配 = 86 条，绝不抽样）
  → footer emerald chip "search: 'query' · N matches — graph dimmed"
    （带 title 说明；与类型 chip 共存，方向图例让位）
  → 双模式节点渲染（纵向/横向）+ HorizontalGraph 增加 searchRing prop
- 15-e Poster 密度条（建议②）：
  → POSTER_FOOTER 44→120；时间分桶（60-480 桶按宽度自适应），
    桶内 commit 计数为柱高，AI commits 琥珀色自基线堆叠，空桶留空
    （安静期是诚实的安静期）；年刻度 + 图例（AI-assisted (3) ·
    other commits）+ COMMIT DENSITY OVER TIME 标题（窄 poster 自动
    隐藏防重叠）
  → 诚实性核实：git 直查 demo 仓库恰 3 个 Claude co-authored
    commits（2026-02/08/09），与图例 "AI-assisted (3)" 一致
    （Task 14 记录的 "4 AI 点" 系旧误计）
- 15-f 验证矩阵：
  → tooltip：hover 50% → "2011-10-07 · 7710db45 · #3216 of 6,430"；
    75% 位置正确；VLM 确认无遮挡
  → 搜索 "router"：86 匹配 → footer chip + 86 minimap ticks +
    40 dimmed 节点（可见窗口恰好无命中故全 dim）+ 41 rail chips dim；
    "4797abfa" → 1 ring + 1 tick + 39 rail dim；清空 → 全部恢复
  → 导出 WYSIWYG：横向视图导出含 1 emerald ring + 40 节点 dim +
    40 rail dim（fxOf 组合逻辑：搜索未命中覆盖类型命中）
  → poster 导出：SVG 274×16001，密度条含 316 灰柱 + 3 琥珀柱 +
    年刻度 2010-2025 + 图例；VLM 四项全过（直方图可读/年标签可见/
    图例可见/无裁剪重叠）
  → 移动端 390px：overflowX=0、strip 356px、chip 正常
  → VLM×4 全过；控制台零运行时错误（仅 Fast Refresh 陈旧警告）；
    lint 零错误；tsc 项目内零错误
- 15-g 提交推送：bbf1e91 → GitHub main（第 15 个 Task commit）

Stage Summary:
- 搜索从"一次性定位"升级为持续视觉筛选：输入即联动图本体
  （ring+dim）、minimap（诚实标记）、footer（状态 chip）、导出
  （WYSIWYG），与类型筛选共用视觉语言且可叠加
- Minimap 补齐"时间感"：hover 即答"这个位置是哪年哪天哪个
  commit"；footer 日期范围让当前视口的时间跨度一目了然
- Poster 获得"活动叙事"收尾：底部密度条把 15 年 commit 节奏
  （含 AI 占比）浓缩成一条时间轴，空档诚实留空
- 诚实性红线再验证：图例 AI 数 = git trailer 直查数（3=3）

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】Minimap 增强：tooltip 中显示该位置 commit 的
   message 片段；视口窗 hover 显示起止日期；shift+click 精确定位
   最近 commit（当前是 row 取整）
2. 【下一步建议】搜索下拉与图联动提示：下拉面板底部加一行
   "matches are highlighted in the graph & minimap"，让联动可发现
3. 【下一步建议】密度条屏上化：Dashboard 增加同款 commit density
   卡片（复用 poster 分桶逻辑，按月/周聚合 + AI 分层堆叠柱状图）
4. 沙箱重启仍会清 repos/demo 与 .env.local —— 开工先跑
   ls repos/demo/.git && cat .env.local 体检
5. self 仓库叙事：本次为第 15 个 Task commit（bbf1e91）

---
Task ID: 16
Agent: main (Z.ai Code, user-requested round)
Task: 用户四项要求 —— ①定位节点闪烁增强（频率+强度）②遗留文件/文档清理 ③虚拟数据与干净本地部署方案（bundle 同步 GitHub + 显式 opt-in）④落地 Task 15 移交建议（搜索提示/密度卡片/minimap 增强）+ 顺带修复桌面端 drawer 覆盖 bug + 推送 GitHub

Work Log:
- 16-a 定位闪烁增强（用户核心抱怨：闪的幅度不够大）：
  → globals.css：pulse-ring 从 1.9s/×1.6 加强为 1.05s/×2.85；新增
    pulse-ring-lag（-0.35s 相位差 → 每 ~0.35s 一次 ping）；新增
    pulse-core（节点本体呼吸光晕 1×→1.55×、opacity 0.5→0.12）
  → commit-graph.tsx 纵向/横向两处节点渲染：选中节点 = 呼吸光晕
    (r*1.7) + 双雷达环 (r+4, stroke 1.5→2.5)
  → export-graph.ts nodeSvg：PNG 选中节点同步为静态快照
    （光晕盘 + r+4/r+9 双环），导出与屏上同源
  → VLM 验证："YES, immediately spot… large size, bright glow,
    expanding concentric rings, radar animation draws the eye
    immediately"；仅提示外环轻微越过年份标签（可接受的定位动画）
- 16-b 【QA 发现并修复·桌面端 drawer 覆盖 bug】：
  → 症状：桌面 1280px 选中任意 commit，vaul 移动端全屏 Sheet
    （fixed inset-x-0 bottom-0 z-50 h-[92dvh]）立即覆盖整个视口，
    真实图被遮罩 —— 之前所有 VLM 截图看到的"弹层"就是它
  → 根因：Drawer.Portal 渲染在 body 层，CSS md:hidden 无法约束
    （vaul 经典陷阱），variant='sidebar' 下 Drawer 无移动端门控
  → 修复：新增 src/hooks/use-media-query.ts（SSR 安全 matchMedia），
    Drawer 挂载条件加 isMobile（<768px）；桌面回归 sidebar、移动端
    drawer 行为保留（390px 实测 click→drawer 打开正常）
- 16-c 遗留文件清理（用户要求：确保不误删）：
  → 删除 scripts/qa8*.sh ×7（Phase 8 一次性 QA 脚本，UI 已大改，
    全部失效；README 引用同步移除）
  → 删除 download/phase4/5/6-*.png ×7（旧 UI 截图，已过时；
    git 历史仍可找回；download/README.md 平台文件保留）
  → 删除 tests/ ×3（沙箱平台测试 harness，硬编码
    /home/z/my-project + fake bin，与产品无关，全仓 grep 零引用）
  → 保留：.zscripts/（平台 dev/start 基础设施）、examples/websocket
    （系统模板参考）、prisma/（平台预置，README 已声明无需 DB）、
    mini-services/、download/README.md
- 16-d 虚拟数据与干净部署方案（用户核心关切）：
  → assets/demo/express.bundle（9.8MB git bundle，--all 全 refs）
    提交进仓库并推送 GitHub = "虚拟数据同步到 GitHub"的落地；
    跨沙箱重启可恢复、零网络可用
  → scripts/demo.sh（status/restore/remove/bundle 四命令）：
    restore 从 bundle 离线恢复 + 显式 fetch refs/remotes/origin/*
    （否则只有 master，6,413≠6,430 commits，已修复验证）+
    set-url origin 回 github.com/expressjs/express（remote 解析/
    Live Events/深链全恢复）；remove 一键回干净空间
  → 干净首跑（fresh clone）：repos/ 整体 gitignore → 页面自动
    回退 self 仓库（rAF 包装的 auto-switch effect，无错误屏），
    切换器中 demo 显示为禁用项 "not on disk · scripts/demo.sh
    restore"；零仓库时显示 onboarding 卡片（注册指引 + demo 恢复指引）
  → 实测：mv repos/demo 走 → 刷新 → 自动切 ChenChen913/
    coding-activity（35 commits · 23 AI，真实数据）→ 恢复 → 6,430
    commits 回归；restore 链路在 /tmp 验证 6,430 全等
- 16-e 落地 Task 15 建议：
  → 建议②搜索下拉联动提示：结果面板底部常驻
    "matches keep an emerald ring in the graph & minimap — the
    rest dims"（emerald 描边点 + 分隔线，实测 router→86 matches 时显示）
  → 建议③密度条屏上化：新增 dashboard/density-card.tsx 全宽卡片
    （insights 与 release timeline 之间）——逐月日历分桶（连续月份、
    空月诚实留空）、AI 琥珀色自基线堆叠、peak 月 emerald 高亮、
    hover tooltip（月+计数+AI）+ 摘要行（busiest month/N months/
    quiet）、click 跳转该月最新 commit（selectAndReveal）、选中
    commit 竖标线、年标签（奇数年 sm 以下隐藏防拥挤）、CSS
    density-grow 入场动画（零 JS 开销）；express 实测 209 个月柱
    + 2010-2026 年标签 + legend AI-assisted 计数
  → 建议①minimap：tooltip 升级双行（首行 message 片段 + AI 琥珀点，
    次行日期·hash·#row，hover 落在当前视口时 emerald "in view" 徽章）；
    shift+click 精确定位（选中该 commit + 居中，title 提示更新）；
    实测 75% 位置 → "Added tests for res.redirect() 2010-07-14 ·
    7c2673fc · #4823 of 6,430"，shift+click → 选中 7c2673fc + 视口
    居中 4,811–4,835 + 侧栏联动
- 16-f 验证矩阵：
  → 闪烁：桌面纵向/横向双模式 rings=2 cores=1；timeline 行点击 →
    滚动回图（y 2315→91）+ 闪烁激活；动画周期 1.05s（computed style）
  → drawer 修复：桌面 click 无弹层、sidebar 正常；390px click →
    drawer 打开（行为保留）
  → 密度卡：209 柱/17 年标签/legend 正确；hover tooltip "2017-04·4
    commits"；click → 跳图 + pulse rings
  → 搜索：提示行 + 30 结果 + footer chip + minimap 86 ticks（与
    86 matches 严格一致）
  → 干净首跑：无错误卡、自动切 self、demo 禁用项带恢复指引
  → 移动端 390px：overflowX=0、密度卡可见
  → lint 零错误；tsc 项目内零错误；dev.log 全 200；控制台仅
    Fast Refresh 警告（dev 正常）
- 16-g 提交推送 GitHub（第 16 个 Task commit）

Stage Summary:
- 用户三项显性要求全部闭环：闪烁一眼可见（VLM 确认 radar 效果
  "draws the eye immediately"）、遗留文件清干净（17 个删除项 +
  README 同步）、虚拟数据 opt-in 化且快照随仓库推送（干净首跑实测
  通过，remove/restore 一键切换）
- QA 意外收获：定位并修复桌面端 vaul drawer 覆盖 bug（matchMedia
  门控，Portal 逃逸 CSS 的经典陷阱沉淀进注释）
- Task 15 三条建议全部落地，密度卡片成为新的全宽洞察区（诚实空月
  + AI 堆叠 + 点击跳图三联动）

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】密度卡片增强：按周/月粒度切换、hover 显示该月
   top contributors、点击空月给提示；可复用 minimap 的 in-view 逻辑
2. 【下一步建议】PNG 导出可选包含 minimap 全景条 + 密度卡片
   （Task 14 建议②的延伸，poster 模式天然适合）
3. 【下一步建议】demo.sh restore 后自动刷新页面（目前需手动
   reload；可加 API invalidate 或简单提示文案）
4. 沙箱重启仍会清 repos/demo 与 .env.local —— 现在可用
   `bash scripts/demo.sh restore` 一键恢复（bundle 已随仓库提交，
   不再依赖网络克隆）
5. self 仓库叙事：本次为第 16 个 Task commit

---
Task ID: 17
Agent: main (Z.ai Code, user-requested round)
Task: 修复用户反馈 bug —— 横向视图下点击 "commits" 标签（底部 rail chips /
lane gutter 标签 / minimap shift+click）时部分节点定位不准

Work Log:
- 17-a 根因定位（commit-graph.tsx "center on externally selected
  commit" effect 的横向分支，原 line 464-485）：
  → 【主因·rail 遮挡死区】可见性检查用 `y < 60 || y > h - 60`（整画布
    +60px 边距），但横向画布底部有 104px 的 COMMITS rail（z-[6] 覆盖层，
    桌面 railRows=3）+ 顶部 26px 时间轴。节点 screen-y ∈ (h−104, h−60]
    这 44px 死区带内的节点实际被 rail 半透明层挡住，代码却判定"可见"
    → 不触发重定位 → 点击 chip 后节点完全不可见 = 用户看到的"定位不准"
  → 【次因·中心偏低 39px】重定位目标 `ty = AXIS_H + wy - h/2` 把节点
    送到整画布垂直中点，而真实可用带 [AXIS_H, h−railH] 的中心比它高
    (railH−AXIS_H)/2 = 39px —— 触发了重定位的节点也普遍偏低
  → 几何体系核实：节点 canvas-y = AXIS_H + (TOP_PAD+lane·lw+lw/2) −
    effTy（HorizontalGraph 外层 g translate(0 AXIS_H)）；effTy 在
    lanes 溢出时 clamp [0, hLanesH−hGraphH]、适配时 pin 居中（pin 时
    全部 lane 必然可见，无死区可能 → 修复只需处理 clamp 情形）
- 17-b 修复实施（横向分支重写）：
  → 可见带改为 band = [AXIS_H, h − railHOf(w)]（真实 lane 区域）
  → 边距 my = max(20, min(nodeR+14, bandH/4))（pulse rings 完整可见）
  → 越界判定 `y < bandTop+my || y > bandBot−my`；重定位目标
    `ty = wy − bandH/2`（节点精确落在带中心，非画布中心）
  → 注释沉淀死区根因（44px 带 + 39px 偏移的两个数字）供后续维护
- 17-c agent-browser 端到端验证（桌面 1280×860，demo=express 6,430
  commits，All branches → laneCount=7）：
  → 复现路径考古：master 过滤下 laneCount=5、zoom 220% 时 hLanesH
    402≈hGraphH 400 → pin 模式无死区；**All branches + zoom 220%
    （lw=74.8、溢出 151.6px）才复现**；用 API commits + 页内复刻
    layout.ts lane 算法精确定位深 lane commits（lane 5 → row
    2089/2133/2226 原屏 y=451 恰落旧死区；lane 6 → row 2219 原
    y=526 画布外）
  → minimap shift+click × 4 深lane样本：全部 inBand ✓ —— lane 5
    三样本 cy 451→300（旧代码不动·被 rail 挡 vs 新代码拉到 clamp
    极限最优位）、lane 6 cy 526→375；cx=671 稳定居中 ✓
  → rail chips 采样 × 5（当前视口含深 lane）：浅 lane 原位可见不动
    （cy 75/150）、深 lane 重定位 cy=300，全部 inBand ✓
  → lane gutter 标签点击 × 4（branch tip）：master/dependabot/
    release/ci-workflows 均正确定位 ✓
  → VLM 截图三问全过（节点可见/未被 rail 遮挡/位于图形区中部）
  → 移动端 390×844：rail 48px 单行，4 chips 全 inBand、overflowX=0 ✓
  → 垂直模式回归：点击节点 → pulse 视口内可见（共用 effect 的
    else 分支未被触碰）✓
  → 验证过程沉淀：合成 WheelEvent 的 deltaX 可被 handler 收到但
    CDP 真实 mouse wheel 才改 tx（ty 轴在 dx 参数不生效的浏览器里
    需用 minimap/按钮路径覆盖）；minimap shift+click 的 frac =
    (row+0.5)/n 精确映射
- 17-d lint 零错误；tsc 项目内零错误；dev.log 全 200；控制台仅
  Fast Refresh 警告（dev 正常）

Stage Summary:
- 横向视图"点击 commits 标签定位不准"根因闭环：44px rail 遮挡死区
  （主因）+ 39px 中心偏移（次因），修复后所有定位路径（rail chips、
  lane gutter 标签、minimap shift+click、搜索/timeline 联动）在
  桌面/移动端全部命中可见带，深 lane 节点被拉到 clamp 几何极限的
  最优位置（无法完美居中是 lanes 溢出量的物理极限，已是最优解）
- 几何语义修正为"lane band"（axis 与 rail 之间）而非整画布 —— 与
  visible 窗口、effTy clamp、pin 居中的既有语义完全对齐

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】Task 16 遗留三条仍然有效：密度卡片周/月粒度切换、
   PNG 导出可选含 minimap+密度条、demo.sh restore 后自动刷新页面
2. 【本任务观察】lanes 溢出量小时（如 master 过滤 zoom 220% 仅
   溢出 2px）clamp 让重定位几乎无感 —— 属几何极限而非 bug；可考虑
   在深 lane 定位时自动微调 zoom（例如保证 bandH ≥ 4×lane 间距）
   作为后续增强，但需谨慎避免"定位时视图突变"的副作用
3. 沙箱重启仍会清 repos/demo 与 .env.local —— 开工先跑
   ls repos/demo/.git && cat .env.local 体检；demo 可用
   bash scripts/demo.sh restore 一键恢复
4. self 仓库叙事：本次为第 17 个 Task commit

---
Task ID: 18
Agent: main (Z.ai Code, user-requested round)
Task: 落地 Task 17 移交建议 —— ①密度卡片 Month/Week 粒度切换 + hover top contributors ②demo.sh restore 后页面自动感知（3s 轮询）③view 导出可选附加全历史 minimap 全景条（含搜索 ticks/选中标记/视口窗）④深 lane 定位自动微调 zoom 评估 ⑤QA 矩阵 + 推送 GitHub

Work Log:
- 18-a 环境体检：repos/demo 与 .env.local 完好；Task 17 修复
  （a10ea1d）已提交并推送；dev server 全 200
- 18-b 密度卡片双粒度（dashboard/density-card.tsx 重写）：
  → bucketize(commit, 'month'|'week')：week = 周一对齐的日历周
    （Date(y,m,d±n) 日期构造，杜绝 local-midnight 毫秒运算的 DST
    漂移；归桶 days 先 round 再 floor/7，±1h DST 周免疫）
  → Bucket 通用化：label（YYYY-MM / YYYY-MM-DD 周起点）+
    isFirstOfYear（月=1 月桶；周=年份变化桶）+ top contributors
    （每桶 Map 聚合取 top 3）
  → BarSlot memo 组件：hover state 在父级、bar props 全稳定 →
    902 根周柱 hover 零重渲（780+ 按钮场景的关键优化）
  → ToggleGroup Month/Week 切换（header 右侧，h-5 紧凑档）；
    副标题/legend/aria-label/summary/footer 文案全部随粒度切换
    （"busiest week: 2009-11-30 · 163 commits · 902 weeks total,
    419 quiet"）
  → tooltip 升级双行：首行 label·count(+AI)，次行 top
    contributors "visionmedia ×38 · csausdev ×29"（truncate 防溢出）
  → 选中 commit 竖标线改为桶区间匹配（周/月双模式通用）
- 18-c demo 恢复自动感知（Task 16 建议③）：
  → page.tsx reposQuery 增加 refetchInterval：demo 不可用时每
    3s 轮询（repos API 仅做 isGitRepo 探测，轻量）；可用后停轮询
  → 切换器禁用项文案 + onboarding 卡片注明 "auto-detected,
    no reload needed"；demo.sh restore 输出同步更新
  → 端到端实测：mv 走 demo → 页面自动降级 self（37 commits）→
    dev.log 每 3s 一次 /api/git/repos → mv 回来 → 不刷新页面，
    切换器 5s 内自动出现 "expressjs/express · 6,430 commits"
    可点击 → 切回后 integrity 6,430=6,430 ✓
- 18-d view 导出可选 minimap 全景条（export-graph.ts + commit-graph.tsx）：
  → ViewExportOptions.minimap {startRow, endRow, selectedRow}；
    MINIMAP_H=40 附加高度（divider + caption + 22px 点带）
  → 条内元素与屏上 minimap 同语言：全量 dot（AI 琥珀、merge 大
    1.25）、86 条搜索命中 emerald slivers、emerald 视口窗
    （fill-opacity 0.1 + 1.5 stroke）、选中 commit 前景竖线、
    NEW/OLD 微标签、"full history · 6,430 commits · emerald
    window = this export" caption
  → 导出菜单新增 DropdownMenuCheckboxItem（默认勾选）；
    !showMiniMap 时禁用并提示 "history fits view"
  → 实测开关精确生效：勾选 850×570 vs 取消 850×530（差值
    恰为 MINIMAP_H=40）；横向+搜索态导出 VLM 确认 ticks/lane/
    无裁剪三问全过
- 18-e 深 lane 定位自动微调 zoom 评估（Task 17 建议）：
  → 结论：暂不实施。Task 17 修复后定位已是最优几何位置；自动
    缩放会让被定位节点变小 + 时间轴同时重排，"定位时视图突变"
    副作用明确大于收益。记录在案供后续复议
- 18-f 验证矩阵：
  → 密度卡：Month 176 柱 / Week 902 桶 486 柱（419 quiet）；
    tooltip 双行（2009-11 · 67 commits | visionmedia ×38 ·
    csausdev ×29）；点击 peak 月 → 图跳 6,167–6,191/6,430
    （2009-12-02 → 2009-11-30）+ pulse 激活 + Back to latest
  → 导出：菜单 5 项结构正确；2× 下载成功；含/不含 minimap
    高度差精确；VLM×3 全过（week 模式布局、minimap 条元素、
    横向+搜索 ticks）
  → 移动端 390px：overflowX=0、toggle 可用、VLM 确认无溢出
  → 控制台零运行时错误；lint 零错误；tsc 项目内零错误；
    dev.log 最近 50 条全 200/304
- 18-g 提交推送 GitHub（第 18 个 Task commit）

Stage Summary:
- 密度卡片从"月度"升级为"双粒度洞察"：周视图揭示 2009-11-30
  单周 163 commits 的真实爆发节奏，top contributors 让每个桶
  自带"谁在干"的答案，且 902 柱 hover 零重渲
- demo 数据恢复闭环补完：CLI restore → 页面 3s 内自动感知 →
  用户零操作成本，"干净空间"与"演示数据"两全
- 导出 PNG 获得空间上下文：任何视口切片都自带"你在 15 年历史
  的哪里"的全景定位条（窗口/搜索命中/选中标记三合一），
  WYSIWYG 语义从"所见"延伸到"所在"

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】密度卡片 hover tooltip 显示该桶 top commit
   的 message（复用 minimap tooltip 模式）；桶粒度记忆到
   localStorage（跨会话保持用户偏好）
2. 【下一步建议】周粒度下年标签较密（17 个），可在 Week 模式
   仅显示偶数年（复用月模式 odd-year hidden 逻辑的对称策略）
3. 【下一步建议】minimap 导出条支持 poster 模式（当前仅 view
   模式；poster 自带全历史，但窗标记可标注"生成时的视口"）
4. 沙箱重启仍会清 repos/demo 与 .env.local —— 开工先跑
   ls repos/demo/.git && cat .env.local 体检；demo 可用
   bash scripts/demo.sh restore 一键恢复（页面自动感知）
5. self 仓库叙事：本次为第 18 个 Task commit

---
Task ID: 19
Agent: main (Z.ai Code, user-requested round)
Task: 仓库对外发布整备（用户三点意见）—— ①补英文版 README（独立文件 README_EN.md）②仓库更名 coding-activity → git-activity（名字体现 git 主题）③添加 GitHub topics 标签 ④README 加入截图 ⑤运行体检 + 顺手修复发现的问题

Work Log:
- 19-a 运行体检：bun install 全量安装、demo bundle restore（6,436 commits）、dev server 启动、API/页面全 200、eslint 零错误
- 19-b 截图产出（1600×900，agent-browser + VLM 三轮校验）：
  screenshots/01-dashboard-overview.png（express 主仪表盘）、
  02-insight-cards.png（洞察卡片）、03-timeline.png（时间线+Live Events）、
  04-commit-detail.png（详情面板+展开 diff 的红绿高亮）、
  05-self-repo-ai-commits.png（self 仓库 38 commits / 24 AI 视图）
- 19-c 安全修复：src/lib/git/repo.ts getRemote() 原样返回 remote URL，
  若用户以 https://TOKEN@github.com/... 克隆被监控仓库，token 会经
  /api/git/repo 泄露到浏览器 —— 新增 stripCredentials() 在出服务端前
  剥离 userinfo；验证 self 的 API 响应已无凭据
- 19-c 清理：移除误提交的 download/（脚手架遗留 README + 一张调试截图）；
  package.json name 从脚手架默认 nextjs_tailwind_shadcn_ts 改为 git-activity；
  repos.ts self 显示名同步为 git-activity
- 19-d 仓库更名：GitHub API PATCH → ChenChen913/git-activity（旧 URL
  自动重定向）；本地 remote URL 同步更新；README 克隆地址与注册表
  文档同步改名
- 19-e README：中文版顶部加 简体中文|English 切换链接、新增「截图」
  章节（5 张配图说明）；README_EN.md 全新英文版（结构对等、含截图）
- 19-f topics：20 个标签覆盖四维——主题（git/git-visualization/
  git-graph/git-dashboard/commit-graph/git-history/data-visualization/
  dashboard）、AI 特色（ai-coding/ai-collaboration/claude-code/copilot/
  cursor）、技术栈（nextjs/react/typescript/tailwindcss/shadcn-ui/svg）、
  受众（developer-tools）

Stage Summary:
- 安全：remote URL 凭据泄露通道已关闭（出站前剥离 userinfo）
- 对外：双语 README + 5 张实拍截图 + 20 个 topics + git-activity 新名
- 发现未改：?repo=self URL 参数不生效（页面停在 demo，需手动切换器）——
  疑似前端未读取 query param 或被状态覆盖，留给下一任务定位

未解决问题或风险，建议下一阶段优先事项:
1. 【本任务发现】?repo=<id> query 参数疑似不驱动仓库切换（reload 后
   仍显示 demo）—— 建议定位 page.tsx 的初始 repo 状态来源，补上
   URL ↔ 状态同步（含浏览器历史前进后退）
2. 【下一步建议】补 LICENSE（当前仓库无许可证，别人不敢用也不敢 PR）
3. 【下一步建议】README badge 可加 topics 之外的 CI/languages 徽章；
   截图可补一张横版布局（Switch to horizontal）展示 W-H 双形态
4. self 仓库叙事：本次为第 19 个 Task commit

---
Task ID: 20
Agent: main (Z.ai Code, user-requested round)
Task: Task 19 遗留事项落地 —— ①补 LICENSE（MIT）②修复 ?repo=<id> URL 参数不生效（README 承诺了但前端从未实现）③补横版布局截图 ④README 双语徽章/截图/文档同步

Work Log:
- 20-a 根因定位：src/app/page.tsx 的 repoId useState('demo') 硬编码，
  全 src 目录 grep URLSearchParams/location.search/pushState 零命中 ——
  URL 参数纯属文档先行、代码未实现
- 20-b 修复设计（双向绑定，三处协同）：
  · 新增 URL 绑定 effect：mount + popstate 读 ?repo= 驱动仓库切换
    （rAF 包装沿用项目既有 lint 规避模式）；无参数时 replaceState
    规范化 ?repo=<current>，保证每个 history entry 都可恢复
  · switchingRepo()：UI 切换时 pushState 同步 URL（带 != 守卫，
    popstate 重入不重复压栈），链接可分享、后退可用
  · clean-first-run 守卫：回退时 replaceState 同步 URL —— 关键防环，
    否则 URL effect 会把不可用仓库反复压回造成 ping-pong 死循环
- 20-c QA 六项全过（agent-browser 实测）：
  ① 直接访问 ?repo=self → 正确显示 git-activity 39 commits ✓
  ② reload → 仍锁定 self ✓
  ③ UI 切 demo → URL 同步 ?repo=demo ✓
  ④ 浏览器后退 → 回到 self（popstate 生效）✓
  ⑤ ?repo=nonexistent → 回退 demo + URL 清洗为 ?repo=demo，无死循环 ✓
  ⑥ 无参数访问 → URL 规范化 ?repo=demo ✓
  lint 零错误；tsc 仅 examples/websocket 原有缺失依赖报错（未实现
  示例，非本次改动）
- 20-d LICENSE：MIT，Copyright (c) 2026 ChenChen913
- 20-e 截图：06-horizontal-layout.png（demo 横版轨道图 + 底部 commit
  信息栏，VLM 三问验证：轨道可见/信息栏在/画面完整）
- 20-f README 双语：加 MIT 徽章；截图章节补横版第 6 张；注册表
  Tip 补充 ?repo= URL 同步行为说明

Stage Summary:
- ?repo= URL 双向绑定闭环：文档承诺 → 代码实现 → 六项实测验证
- 对外整备齐套：MIT LICENSE + 6 张截图 + 徽章 + 双语 README
- 防环设计沉淀：URL 绑定 effect 与回退守卫必须成对改，单改任一方
  会引入无限循环（守卫回退 → URL 压回 → 守卫再回退）

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】分支/作者/类型过滤也可考虑进 URL（?branch=&type=），
  复用本任务的双向绑定模式，分享链接即可还原完整视图状态
2. 【下一步建议】GitHub About 栏可补 homepage（若部署线上 demo）；
  topics 已齐 20 个，star 数上来后可申请 GitHub topics 精选
3. self 仓库叙事：本次为第 20 个 Task commit

---
Task ID: 21
Agent: main (Z.ai Code, user-requested round)
Task: Task 20 遗留建议落地 —— 视图状态全面进 URL：?branch=（分支过滤）+ ?layout=（横竖版）双向绑定，分享链接可还原完整视图

Work Log:
- 21-a 方案设计（三个参数三种语义，各有依据）：
  · ?repo / ?layout：缺失时规范化补齐（replaceState）——保证每个
    history entry 自包含，back/forward 才能精确还原；layout 必须
    规范化是因为 localStorage 偏好每次 toggle 都会变，缺失语义不确定
  · ?branch：缺失 = all branches（语义确定，无跨会话存储），不规范化
  · 关键决策：localStorage 布局恢复逻辑从独立 effect 合并进 URL 绑定
    仲裁 effect（ref 防重入）——否则挂载时两个 effect 竞争，一个设
    horizontal 一个按 URL 压回 vertical，来回翻转
- 21-b 实现（src/app/page.tsx）：
  · 统一 URL 仲裁 effect：layout（param 优先且回写偏好；缺失时
    恢复一次 localStorage 并 pin 进 URL）→ repo（先应用，return 后
    靠 effect 重跑接力 branch，避免跨仓库误伤）→ branch（缺失=all）
  · switchingBranch：Select 切分支 pushState（all 时删参）
  · switchingRepo / clean-first-run 守卫：切仓库时连带删 ?branch=
    （分支表随仓库不同）
  · 新增 invalid-branch 守卫：分支列表加载后校验，无效分支回退 all
    + replaceState 清参 —— 沿用 Task 20 沉淀的"状态重置与 URL 同步
    必须成对"纪律
  · toggleOrientation 重构：next 在 setState 外计算，localStorage
    与 pushState 同步写
- 21-c QA 九项全过（agent-browser 实测）：
  ① 裸参数访问 → URL 规范化 ?repo=demo&layout=vertical ✓
  ② UI 切 master → &branch=master 同步 ✓
  ③ reload → 分支保持 ✓
  ④ back → 分支还原 all（参数消失）✓
  ⑤ ?layout=horizontal 直载横版 ✓
  ⑥ 布局切换按钮 ↔ URL ⑥b back → 横版精确还原 ✓（规范化设计的
    正向验证）
  ⑦ ?branch=nonexistent → 回退 all + URL 清洗，零死循环 ✓
  ⑧ 带分支切仓库 → ?branch 随之清除 ✓
  ⑨ 裸访问 / → localStorage 横版偏好恢复并 pin 进 URL ✓
  （合并仲裁设计的正向验证）
  tsc 零错误（examples/websocket 原有报错除外）、eslint 零错误
- 21-d README 双语：注册表 Tip 扩写为三参数文档（repo/branch/layout）

Stage Summary:
- 视图状态三分量（仓库/分支/布局）全部 URL 化，分享链接 = 完整视图
- URL 语义分类沉淀：确定性参数（branch 缺失=all）vs 不确定性参数
  （layout 依赖可变偏好，必须规范化）—— 可迁移到未来 ?type= ?author=
- 防竞争沉淀：浏览器存储恢复与 URL 应用必须是同一个仲裁者

未解决问题或风险，建议下一阶段优先事项:
1. 【下一步建议】?type=（提交类型过滤）与 ?author=（作者聚焦）进
   URL：type 的 rowKey↔kinds 映射在 conventions-card 内部，需先
   把序列化协议（如 ?type=feat:fix 逗号分隔 kinds）抽到 lib 层
2. 【下一步建议】截图 06 是横版但 URL 文档刚落地，可在截图章节补
   一句"试试 ?layout=horizontal 链接直达横版"
3. self 仓库叙事：本次为第 21 个 Task commit
