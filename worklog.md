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
