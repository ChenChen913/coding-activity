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
