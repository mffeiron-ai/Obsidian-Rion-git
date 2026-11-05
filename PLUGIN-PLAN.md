# 自研 Obsidian Git 插件 — 设计方案（MVP）

> 参考实现：[vinzent03/obsidian-git](https://github.com/vinzent03/obsidian-git)（v2.43.0，MIT）
> 本文档只讨论设计，不含实现。

## 0. 决策记录

| 项 | 决策 | 说明 |
|---|---|---|
| 平台范围 | **仅桌面端** | `manifest.json` 中 `isDesktopOnly: true` |
| Git 内核 | **调用系统 `git` CLI** | `child_process.execFile`，不引入 `isomorphic-git` |
| 功能范围 | 手动 commit/push/pull、自动提交、自动推送、状态栏 + Ribbon、变更文件弹窗、冲突处理 | 全量 MVP |
| 不做的部分 | 行内作者标注、hunk 级 stage/diff、历史图谱、多仓库、移动端 | 见 §11 |

---

## 1. 目标

在 Obsidian vault 内提供一个「够用」的 Git 版本控制闭环：

1. 打开 Obsidian 就能看到仓库当前状态；
2. 改动会在几秒到几分钟内自动备份成本地提交；
3. 需要时一键推到远端，换设备时一键拉回；
4. 拉取产生冲突时，能就地选择「保留本地 / 保留远端」并完成收尾；
5. 出错时给出能自己排查的提示，而不是静默失败。

### 非目标

- 不做 IDE 级的逐行/逐 hunk 版本浏览；
- 不替代终端，不提供任意 git 命令执行入口；
- 不管理多个仓库（vault 根目录即唯一仓库）；
- 不支持移动端（架构上不封死，见 §11）。

---

## 2. 技术选型

### 2.1 Git 内核对比

| 方案 | 能力覆盖 | 凭据 | 性能 | 体积 | 结论 |
|---|---|---|---|---|---|
| **系统 git + `execFile`** | 完整（rebase/LFS/hooks/submodule 全可用） | 复用系统 credential helper、SSH agent | 原生 | 0 | ✅ **采用** |
| `simple-git` | 同上（本质上还是 spawn） | 同上 | 同上 | ~100KB | 可选封装，非必须 |
| `isomorphic-git` | 子集（无 hooks、LFS 支持弱） | 需自建 token 存储 | 纯 JS，大库明显慢 | 数百 KB + 多个 polyfill | ⏭ 仅移动端才值得 |

选 `execFile` 而不是 `exec`：参数以数组传递，**不经过 shell**，天然规避空格、中文路径、引号转义问题（Windows 尤其重要）。

### 2.2 运行环境事实

- Obsidian 桌面版渲染进程开启 `nodeIntegration`，可以直接 `require("child_process")`。
- 打包时 `child_process`、`fs`、`os` 必须保持为外部依赖（esbuild `external`），不能打进 bundle。
- vault 的绝对路径通过 `(app.vault.adapter as FileSystemAdapter).getBasePath()` 获取。

### 2.3 工具链

| 用途 | 选择 |
|---|---|
| 语言 | TypeScript（strict） |
| 打包 | esbuild → 单文件 `main.js`（CJS，`platform: "node"`） |
| 类型 | `obsidian`（仅 types，运行时由宿主提供） |
| 测试 | vitest，只测纯函数（status 解析、消息模板、路径过滤） |
| 发布产物 | `main.js` + `manifest.json` + `styles.css` |

---

## 3. 架构

```mermaid
graph TB
    subgraph Plugin["main.ts (Plugin)"]
        L[onload / onunload]
        S[settings]
    end

    subgraph Git["src/git"]
        Q[exec.ts<br/>串行队列 + execFile]
        R[repo.ts<br/>路径/仓库检测/身份检测]
        ST[status.ts<br/>porcelain 解析]
        OP[ops.ts<br/>commit/push/pull/init/冲突]
    end

    subgraph Auto["src/autoCommit.ts"]
        T[定时器]
        E[vault 事件 + debounce]
        F[路径过滤]
    end

    subgraph UI["src/ui"]
        SB[statusBar.ts]
        CM[changesModal.ts]
        CF[conflictModal.ts]
    end

    L --> T & E & SB
    T & E --> F --> OP
    OP --> Q
    ST --> Q
    R --> Q
    SB --> ST
    CM --> ST
    CF --> OP
    S --> T & E
```

**分层原则**：`ui/` 只读取数据、发出意图；`autoCommit.ts` 只做调度决策；`git/ops.ts` 是唯一知道「一次操作由哪几条 git 命令组成」的地方；`exec.ts` 是唯一真正 fork 子进程的地方。这样后面换内核（例如接 `isomorphic-git`）只需替换 `exec.ts` + `ops.ts`。

---

## 4. 目录结构

工程位于 `D:\PlanAndLife\Enginer\Obsidian-Rion-git`（源码），构建产物输出到
`<vault>/.obsidian/plugins/rion-git/`（Obsidian 实际加载的插件目录）。

```
Obsidian-Rion-git/
├── manifest.json
├── versions.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── styles.css
├── src/
│   ├── main.ts
│   ├── settings.ts
│   ├── commands.ts
│   ├── types.ts
│   ├── git/
│   │   ├── exec.ts
│   │   ├── repo.ts
│   │   ├── status.ts
│   │   └── ops.ts
│   ├── autoCommit.ts
│   └── ui/
│       ├── statusBar.ts
│       ├── changesModal.ts
│       └── conflictModal.ts
└── tests/
    ├── status.test.ts
    └── template.test.ts
```

预估 900–1300 行 TS，约为 obsidian-git 的 1/10，但功能闭环。

---

## 5. 模块设计

### 5.1 `manifest.json`

```json
{
  "id": "rion-git",
  "name": "Rion Git",
  "version": "0.1.0",
  "minAppVersion": "1.4.0",
  "description": "轻量版 Git 版本控制：自动备份、推送与拉取。",
  "author": "Rion",
  "isDesktopOnly": true
}
```

`isDesktopOnly: true` 会让插件在移动端直接不可安装，避免用户装上后才在运行时报错。

### 5.2 `main.ts` — 生命周期

```ts
export default class RionGit extends Plugin {
    settings!: RionGitSettings;
    private queue!: GitQueue;
    private repoPath!: string;
    private statusBar!: GitStatusBar;
    private auto!: AutoCommitManager;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new RionGitSettingTab(this.app, this));

        this.repoPath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
        this.queue = new GitQueue();
        this.statusBar = new GitStatusBar(this);
        this.auto = new AutoCommitManager(this);
        this.auto.start();

        registerCommands(this);
        await this.refreshStatus();
    }

    onunload() {
        this.auto.stop();   // 兜底；正常应通过 registerInterval/registerEvent 自动清理
        this.statusBar.remove();
    }
}
```

**必须遵守**：定时器用 `this.registerInterval(window.setInterval(...))`，事件用 `this.registerEvent(...)`。直接 `setInterval` 会导致插件热重载后残留多个定时器，出现「一次改动提交 N 次」。

### 5.3 `src/git/exec.ts` — 执行器与串行队列

```ts
export interface GitResult { code: number; stdout: string; stderr: string; }

export function runGit(
    cwd: string,
    gitPath: string,
    args: string[],
    opts: { timeoutMs?: number } = {}
): Promise<GitResult> {
    return new Promise((resolve) => {
        const child = execFile(gitPath, args, {
            cwd,
            maxBuffer: 32 * 1024 * 1024,
            windowsHide: true,
            timeout: opts.timeoutMs ?? 30_000,
            env: {
                ...process.env,
                GIT_TERMINAL_PROMPT: "0",  // 无 TTY，禁止交互式要密码
                GIT_OPTIONAL_LOCKS: "0",   // 只读命令不抢 index.lock
            },
        }, (err: any, stdout, stderr) =>
            resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr })
        );
        // 超时由 execFile 的 timeout 负责，此处不额外 kill
        void child;
    });
}

export class GitQueue {
    private tail: Promise<unknown> = Promise.resolve();
    add<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.tail.then(fn, fn);
        this.tail = run.catch(() => {});
        return run;
    }
}
```

要点：

- **所有** git 调用都必须走 `queue.add()`。git 的 `index.lock` 是全局的，任何一次并发（哪怕是自动提交撞上用户点推送）都会失败并留下锁文件。
- 网络类操作（push/pull/clone）单独传更长的 `timeoutMs`（如 120s），本地操作 30s 足够。
- 错误对象里的 `code` 可能是字符串（如 `"ENOENT"`，表示 git 不存在），需要在 `repo.ts` 里区分「git 未安装」和「git 返回非 0」。

### 5.4 `src/git/repo.ts` — 前置检测

启动时按顺序检查，任何一步失败都直接禁用自动提交并给出可操作提示：

| 检查 | 命令 | 失败处理 |
|---|---|---|
| git 是否可用 | `git --version` | Notice：请在设置里填写 git 路径 |
| 是否 git 仓库 | `git rev-parse --is-inside-work-tree` | Notice + 提供「初始化仓库」按钮 |
| 是否有提交身份 | `git config user.name` / `user.email` | Notice 给出 `git config --global user.name "..."` 提示 |
| 是否有远端 | `git remote -v` | 推送时再提示，不阻塞启动 |
| 当前分支 | `git rev-parse --abbrev-ref HEAD` | 记录到状态栏 tooltip |

### 5.5 `src/git/status.ts` — 状态解析

统一使用：

```
git status --porcelain=v1 -z --untracked-files=all
```

`-z` 用 NUL 分隔，文件名中的空格、换行、中文都不会破坏解析（按 `\n` 切分是常见 bug 来源）。

解析产出：

```ts
export interface RepoStatus {
    branch: string | null;
    changedFiles: FileChange[];   // { path, index, worktree }
    changedCount: number;
    hasConflicts: boolean;
    aheadBehind?: { ahead: number; behind: number };
}
```

- `index` / `worktree` 是两个状态字符（`M`/`A`/`D`/`R`/`?`/`U`）。
- `hasConflicts`：任一文件的 `index+worktree` 落在 `UU, AA, DD, AU, UA, DU, UD` 之一。
- ahead/behind 用 `git rev-list --left-right --count HEAD...@{upstream}`（无 upstream 时跳过，不要报错）。
- 变更文件数超过 `MAX_LIST`（如 500）时，弹窗只显示前 100 条 + 「还有 N 个文件」，避免 UI 卡死。

### 5.6 `src/autoCommit.ts` — 自动备份状态机

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Dirty: vault modify/create/delete/rename（路径通过过滤）
    Dirty --> Dirty: 继续有变更（重置 debounce）
    Dirty --> Pending: debounce 到期（5s）
    Pending --> Committing: 距上次提交 > minInterval
    Pending --> Idle: 未到最小间隔（保留 dirty 标记）
    Committing --> Pushing: 自动推送开启
    Committing --> Idle: 无改动则跳过
    Pushing --> Idle
```

规则：

1. **事件过滤**（第一行就做，成本最低收益最大）：
   ```ts
   private isRelevant(path: string): boolean {
       if (path.startsWith(".git/")) return false;                  // 防自激循环
       if (path.startsWith(".obsidian/plugins/rion-git/")) return false; // 自身产物
       if (path.endsWith(".obsidian/workspace.json")) return false;
       if (path.startsWith(".trash/")) return false;
       return !this.settings.ignoreGlobs.some(g => globMatch(g, path));
   }
   ```
   `.git/` 下每次 git 操作都会产生大批文件事件，不过滤会造成「提交 → 事件 → 提交」死循环，并显著拖慢 Obsidian 索引。

2. **debounce**：`modify` 事件在一次输入中会触发几十次，必须等 3–5 秒静默后再提交。

3. **最小间隔**：`autoCommitInterval`（分钟）不为 0 时作为节流上限；为 0 表示「只在定时器触发时提交」。两种模式共存：事件负责「及时」，定时器负责「兜底」。

4. **空提交跳过**：执行前先跑 `status`，`changedCount === 0` 直接返回，**不要**用 `--allow-empty`。

5. **消息模板**：默认 `vault backup: {{date}}`，`{{date}}` 用 Obsidian 自带的 `moment()` 按用户设置格式化（跟随 App 语言/区域）。

6. **失败退避**：本地提交失败（如 identity 未配置）时停止自动提交并提示，不要每分钟重试刷屏。

### 5.7 `src/git/ops.ts` — 操作组合

| 操作 | 命令序列 | 备注 |
|---|---|---|
| commitAll | `add -A` → `commit -m <msg>` | `add -A` 会包含删除；如失败但 status 为空则视为成功 |
| push | 检查 upstream → `push` 或 `push -u origin <branch>` | 无远端/无网络时给出明确文案 |
| pull | `pull --no-rebase --no-edit` | 用 merge 而非 rebase，避免 ours/theirs 语义反转 |
| init | `init` → 写入默认 `.gitignore` | 只允许在空仓库执行 |
| 冲突解决 | `checkout --ours/--theirs <f>` → `add <f>` | 全部解决后自动 `commit --no-edit` |
| 变更列表 | `status` + `log -1 --format=...` | 只读 |

**自动推送的前置条件**：`autoPush` 开启 + 存在 remote + 上一次 push 成功。任意一次网络失败后自动推送进入冷却期（如 5 分钟），避免离线时频繁弹错。

### 5.8 冲突处理（精简版）

不做三栏 CodeMirror 合并编辑器（那是 obsidian-git 里最重的一块）。MVP 流程：

```mermaid
sequenceDiagram
    participant U as 用户/自动任务
    participant P as 插件
    participant G as git
    U->>P: 拉取
    P->>G: pull --no-rebase --no-edit
    G-->>P: code != 0
    P->>G: status --porcelain
    G-->>P: 含 UU/AA/... 的文件
    P->>U: 冲突弹窗（文件列表 + 两个按钮）
    U->>P: 全部用本地 / 全部用远端 / 逐文件
    P->>G: checkout --ours|--theirs <f> && add <f>
    P->>G: commit --no-edit
    P->>U: 完成提示
```

- 因为用 `--no-rebase` 拉取，`--ours` 恒等于「本地」，`--theirs` 恒等于「远端」，语义稳定。
- 弹窗里必须提供「打开文件手动解决」入口（后续手动 `add` + `commit`）。
- 若用户选择放弃：`merge --abort`，回到拉取前状态。

### 5.9 UI

**状态栏**（点击 = 立即推送）：

| 状态 | 文案 | 触发 |
|---|---|---|
| idle-clean | `Git ✓` | 无改动、与远端一致 |
| idle-dirty | `Git • 3` | 有 3 个未提交改动 |
| syncing | `Git ⟳ 推送中` | 操作进行中（禁用点击） |
| error | `Git ⚠` | 上次操作失败，tooltip 显示原因 |

**Ribbon**：一个图标，`onClick` 打开变更弹窗（菜单式：提交 / 推送 / 拉取 / 查看改动）。

**变更弹窗**（`changesModal.ts`）：只读列表（路径 + 状态字符 + 中文状态标签），底部三个按钮：提交全部 / 推送 / 拉取。逐文件 stage 留到 v2。

**通知**：成功用 `new Notice("已提交 3 个文件")`，静默成功（自动提交）不用 Notice，只更新状态栏，避免打扰。

### 5.10 设置项

| key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `gitPath` | string | `"git"` | 从桌面图标启动时 PATH 可能不含 git |
| `autoCommitInterval` | number(min) | `10` | 0 = 关闭定时提交 |
| `autoCommitOnChange` | boolean | `true` | 文件变更后自动提交 |
| `changeDebounceSeconds` | number(s) | `5` | 静默多久后提交 |
| `commitMessageTemplate` | string | `vault backup: {{date}}` | 支持 `{{date}}`、`{{hostname}}`、`{{files}}` |
| `dateFormat` | string | `YYYY-MM-DD HH:mm:ss` | moment 格式 |
| `autoPush` | boolean | `false` | 自动提交后推送 |
| `pullBeforePush` | boolean | `false` | 推送前先拉取 |
| `ignoreGlobs` | string[] | `[".obsidian/workspace.json", ".obsidian/workspace-mobile.json", ".trash/**"]` | 不触发自动提交 |
| `showStatusBar` | boolean | `true` | |
| `confirmBeforeDestructive` | boolean | `true` | 冲突解决/丢弃前确认 |

---

## 6. 关键坑与规避

按踩坑成本排序：

| # | 问题 | 规避 |
|---|---|---|
| 1 | GUI 里 git 无 TTY，push 卡死在密码提示 | `GIT_TERMINAL_PROMPT=0` + `timeout`；文案引导用户先在终端配好 credential helper / SSH key |
| 2 | 从快捷方式启动的 Obsidian，PATH 里没有 git | 设置项 `gitPath`；启动时 `--version` 探测；`ENOENT` 单独给提示 |
| 3 | 仓库未配 `user.name/user.email`，commit 必失败 | 启动即检测并提示配置命令 |
| 4 | `.git/` 事件导致自激循环 | 事件过滤 `.git/` 前缀（§5.6） |
| 5 | `workspace.json` 每次开关都变，制造噪音提交 | 默认忽略 + 默认 `.gitignore` |
| 6 | 大附件把仓库撑爆 | 设置项忽略附件目录 + 文档提示 Git LFS |
| 7 | 并发导致 `index.lock` | 所有调用走单一串行队列 |
| 8 | 热重载后定时器叠加，一次改动提交多次 | 只用 `registerInterval` / `registerEvent` |
| 9 | vault 放在 OneDrive/iCloud 里再叠 git，`.git` 被同步 → 仓库损坏 | 文档明确警告；启动时可检测路径是否在已知同步目录下并提示 |
| 10 | 文件名含中文/空格/换行 | `-z` 解析 + `execFile` 数组传参 |
| 11 | 日志里打印 remote URL 泄露 token | 日志脱敏：`https://user:***@host/...` |
| 12 | 网络操作风控/超时 | 网络命令单独 120s 超时；失败后自动推送进入冷却期 |

---

## 7. 里程碑

| 阶段 | 交付 | 验收方式 |
|---|---|---|
| **M0** 脚手架 | `manifest.json` / `package.json` / `esbuild.config.mjs` / `main.ts`（`onload` 打 Notice） | 构建产物放进 `.obsidian/plugins/rion-git/` 后能被启用，控制台无报错 |
| **M1** 内核 | `exec.ts` + `repo.ts` + `status.ts` + `ops.ts`；命令：提交全部 / 推送 / 拉取 | 命令面板逐个执行，`git log`、`git status` 结果与预期一致 |
| **M2** 自动化 | `autoCommit.ts`（事件 + debounce + 定时 + 过滤）+ 设置页 | 改一个 md 等 5s 出现提交；关掉开关后不再提交 |
| **M3** 界面 | 状态栏 + Ribbon + 变更弹窗 | 状态随时间/操作正确变化；点状态栏能推送 |
| **M4** 冲突与健壮性 | 冲突弹窗、错误文案、冷却期、空提交跳过 | 手动制造冲突 → 选择「用本地」后仓库干净 |
| **M5** 打磨 | 操作日志（可导出）、脱敏、README、发布脚本 | 全量手动回归清单通过 |

每个里程碑结束都能独立使用，不是「全部做完才有价值」。

---

## 8. 测试策略

**自动化（vitest，只测纯逻辑）**

- `status.ts`：给定 `porcelain -z` 原始字符串（含中文名、含 rename、含冲突标记）→ 断言解析结果；
- 消息模板渲染：`{{date}}` 替换、未知占位符保留、空模板回退默认值；
- 路径过滤：`.git/`、插件目录、ignoreGlobs 命中/不命中。

**手动回归清单（每次发版跑一遍）**

1. 非仓库 vault 启动 → 给出初始化提示，不崩溃；
2. 改动 3 个文件 → 5s 后自动提交，状态栏显示 `Git ✓`；
3. 关掉自动提交 → 改动后不提交；
4. 无网络时点推送 → 30s 内失败并给出可读提示，不卡死；
5. 制造冲突 → 拉取 → 选择「用远端」→ 冲突消失且文件内容正确；
6. 插件热重载 5 次 → 一次改动仍只产生 1 次提交（验证没有定时器泄漏）；
7. 删除文件 → 提交后 `git status` 干净。

---

## 9. 开发与调试

1. 在 vault 里建软链或直接把构建产物输出到 `Vault/.obsidian/plugins/rion-git/`；
2. `esbuild.config.mjs` 用 `context()` + `watch()`，`outfile` 直指插件目录；
3. 迭代时用命令面板的 `Reload app without saving`，或装社区的 Hot Reload 插件；
4. 调试日志统一走一个 `Logger`（生产构建时 `console.debug` 被移除），不要裸 `console.log` 散落。

---

## 10. 发布

- 版本号三处同步：`manifest.json`、`package.json`、`versions.json`；
- GitHub Release 附 `main.js`、`manifest.json`、`styles.css` 三个文件；
- `versions.json` 记录「插件版本 → 最低 App 版本」，供社区商店判断兼容性。

---

## 11. 后续可扩展（明确不在 MVP）

| 方向 | 代价 | 说明 |
|---|---|---|
| 移动端支持 | 高 | 需引入 `isomorphic-git` + FS polyfill + 自建 token 存储；`ops.ts` 抽象已在，理论上只需替换 `exec.ts` 实现 |
| 行内署名 / gutter 标记 | 中高 | 依赖 CodeMirror 扩展 + 逐行 blame 缓存，obsidian-git 里占了 `src/editor/` 整个目录 |
| hunk 级 stage/discard | 中 | 需要 diff 解析 + 编辑器内按钮 |
| 历史 / 图谱视图 | 中 | 需要 UI 框架（Svelte / 原生 DOM） |
| 多仓库 | 低中 | 设置里加仓库列表 + 命令加 target 参数 |

---

## 12. 与 obsidian-git 的取舍总结

**借鉴**：`GitManager` 抽象 + 串行队列、`status --porcelain` 的解析方式、状态栏状态机、vault 事件过滤策略、设置项命名。

**不借鉴**：Svelte UI 层、CodeMirror 行内标注与 hunk 操作、双内核（`simpleGit` + `isomorphicGit`）的 adapter 体系、Svelte 分层 diff 视图 —— 这些都是为「覆盖移动端 + IDE 级体验」付出的成本，MVP 阶段全是负担。

---

_文档版本：2026-11-05 · 对应插件版本 v0.1.0 设计基线_
