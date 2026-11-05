# Obsidian 插件上架规范与发布指南

一份面向 Obsidian 社区插件（Community plugins）的**规范速查 + 上线操作手册**，可直接复制到任意插件项目使用。

- 依据：Obsidian 官方开发者文档（Manifest / Submission requirements / Developer policies / Plugin guidelines / Release with GitHub Actions / Community directory）
- 核对时间：2026-11。规则可能变化，提交前建议复核 <https://docs.obsidian.md>

---

## 0. 一句话流程

```
写插件 → 仓库达标（README/LICENSE/manifest）→ 升 version
      → 打同名 tag → Release 上传 main.js + manifest.json + styles.css
      → community.obsidian.md 提交 → 自动扫描 → 修错 → Publish
      → 通过后用户可在 Obsidian 内搜索安装
      → 以后更新只发新 Release，无需再审核
```

⚠️ 最重要的一条：**用户安装时，Obsidian 会按 `manifest.json` 里的 `version` 去仓库找"同名的、已发布（Published）的" GitHub Release，并从那里下载 `main.js` / `manifest.json` / `styles.css`。** 三者任一不对，就会报「no GitHub release with that version has been published yet」。

---

## 1. 仓库必备文件

| 文件 | 要求 | 说明 |
| --- | --- | --- |
| `manifest.json` | 必需 | 字段规则见第 2 节 |
| `README.md` | 必需 | **必须包含英文**（目录以英语为主）；会被抓取首段作为列表页摘要，相对图片/链接会自动改写 |
| `LICENSE` | 必需 | 没有许可证会审核不通过 |
| 源码 | 必需 | 目录扫描器会读源码，代码需可读（**不得混淆**） |
| `main.js` | **不要提交进仓库** | 构建产物，只作为 Release 附件上传 |
| `styles.css` | 可选 | 有样式才需要提供 |

推荐 `.gitignore`：

```gitignore
node_modules/
main.js
*.map
data.json          # 用户本地设置，绝不能提交
.vscode/
.DS_Store
```

---

## 2. `manifest.json` 字段规范

```json
{
  "id": "my-plugin-id",
  "name": "My Plugin Name",
  "version": "1.0.0",
  "minAppVersion": "1.13.0",
  "description": "Show definitions from your own Markdown files on hover.",
  "author": "YourName",
  "authorUrl": "https://github.com/you",
  "isDesktopOnly": false
}
```

| 字段 | 必需 | 规则（**踩了就退回**） |
| --- | --- | --- |
| `id` | ✅ | 只能小写字母和连字符；**不能**以 `plugin` 结尾；**不能**包含 `obsidian` |
| `name` | ✅ | 优先英文 + Basic Latin；标点只允许连字符、加号、括号；不能有 emoji；不能叫 `Obsidian` / `Obsi-` / `-sidian`；不能是核心功能名（如 `Live Preview`、`Bases`）；全局唯一；不能含 `Plugin` / `Theme` |
| `version` | ✅ | 严格 `x.y.z` 语义化版本 |
| `minAppVersion` | ✅ | 设成**实际**最低兼容版本；用了新版 API 就要抬到对应版本；不确定就填最新稳定版 |
| `description` | ✅ | ≤ 250 字符；**必须以 `.` 结尾**；不用 emoji/特殊字符；以动词短语开头（"Import notes from…"），不要写 "This is a plugin" |
| `author` | ✅ | 会公开展示在插件市场 |
| `isDesktopOnly` | ✅ | 用了 Node/Electron API（`fs`/`crypto`/`os` 等）**必须** `true` |
| `authorUrl` | ❌ | 官网/仓库链接 |
| `fundingUrl` | ❌ | **只有收赞助才填**；不收就删除该字段 |

其他硬性小规定：

- **命令 id 不要带插件 id 前缀**，Obsidian 会自动加。
- 开发期 `id` 最好与插件文件夹名一致，否则 `onExternalSettingsChange` 之类的方法不会被调用。
- 提交给模板仓库的示例代码要全部删干净。

---

## 3. 政策红线（Developer policies）

违反会被**直接下架**。

### 禁止

- 混淆代码以隐藏用途
- 插入联网加载的动态广告
- 在插件自身界面之外插入静态广告
- 包含**客户端**遥测
- 自我安装或自我更新（含更新自身依赖）
- （主题）从网络加载资源

### 必须在 README 明确披露才能做

- 付费才能完整使用
- 需要账号才能完整使用
- **联网**（说明用了哪些远程服务、为什么需要）
- 访问 Vault 之外的文件（说明原因）
- 插件界面内的静态广告（banner、弹窗）
- **服务端**遥测（必须附隐私政策链接）
- 闭源（case by case 处理）

### 许可与商标

- 必须有 LICENSE，遵守所引用代码的原始许可并在 README 致谢
- 不得用 "Obsidian" 商标制造"官方出品"的误解

### Fork

Fork 默认不允许上架，除非满足其一：原作者**公开可验证的书面同意**；或原作者失联且项目 ≥ 6 个月未更新，联系后给出 30 天回应期仍无回应。两种情况下都必须致谢原作者。功能上要"另起炉灶"的，请新建仓库、不要 fork。

---

## 4. 代码规范（审核最常打回的几点）

### 通用

- 不用全局 `app` / `window.app`，用 `this.app`
- 默认配置下**控制台只应有错误输出**；给用户的反馈用 `Notice`，不要 `console.log/info`
- 类名别留 `MyPlugin` / `MyPluginSettings` 这类模板占位名
- 多文件就用文件夹组织

### 移动端

- 不能依赖 Node/Electron API（否则 `isDesktopOnly: true`）
  - `crypto` → `crypto.subtle`
  - 剪贴板 → `navigator.clipboard.readText/writeText`
- 正则**不能用 lookbehind**（移动端 WebView 不支持）

### UI 文案

- 只用 sentence case（英文 UI）
- 设置页只有**一个分组**时不要加标题；标题里不要出现 "settings"
- 不要手写 `<h1>/<h2>`，用 `new Setting(el).setName('...').setHeading()`

### 安全

- 禁止 `innerHTML` / `outerHTML` / `insertAdjacentHTML`
- 用 `createEl()` / `createDiv()` / `createSpan()` 或 DOM API 构建；清空用 `el.empty()`
- 跨窗口类型判断用 `node.instanceOf(Text)`，不要 `node instanceof Text`

### 资源管理

- 事件/定时器/视图等用 `registerEvent()` / `addCommand()` / `registerDomEvent()` 托管
- **不要在 `onunload` 里 detach leaves**（更新插件时会乱位）

### 命令

- 不要设置默认快捷键
- 无条件用 `callback`；有条件用 `checkCallback`；需要编辑器用 `editorCallback` / `editorCheckCallback`

### 工作区 / Vault

- 不用 `workspace.activeLeaf`，用 `getActiveViewOfType()` 等
- 不要自己持有自定义视图的引用，交给 `getLeavesOfType()`
- 改当前笔记用 **Editor API**，不要 `Vault.modify`
- 后台改文件用 `Vault.process`，改 frontmatter 用 `FileManager.processFrontMatter`（都是原子操作）
- 优先 `app.vault` 而不是 `app.vault.adapter`
- **不要遍历所有文件找路径**，用 `getFileByPath` / `getFolderByPath` / `getAbstractFileByPath`
- 用户输入或拼接的路径一律过 `normalizePath()`

### 编辑器扩展

- 注册后要改扩展：**保持数组引用不变**（`arr.length = 0` 再 push），最后 `workspace.updateOptions()`

### 样式

- 不写死颜色/尺寸，用 class + Obsidian CSS 变量（`--text-normal`、`--background-primary`、`--interactive-accent`…）
- 硬编码样式会破坏主题适配，无法被用户 snippets 覆盖

### TypeScript

- 用 `const` / `let`，不用 `var`
- 用 `async/await`，不要长链 `.then()`

### 设置面板（1.13.0+）

`display()` 与 `setWarning()` 已废弃，改用声明式 API：

```ts
class MySettingTab extends PluginSettingTab {
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "list",                     // 可增删的集合
        heading: "词典文件",
        emptyState: "尚未选择文件。",
        items: this.plugin.settings.files.map((path) => ({ name: path, desc: "…" })),
        addItem: { name: "添加文件", action: () => new MyPickerModal(this.app).open() },
        onDelete: (index) => {
          this.plugin.settings.files.splice(index, 1);
          void this.plugin.applyChange();  // 保存 + 刷新
          this.update();
        },
      },
      { name: "启用某功能", desc: "…", control: { type: "toggle", key: "enabled" } },
      { name: "某数值", desc: "…", control: { type: "number", key: "limit", min: 1,
        validate: (v) => (Number.isInteger(v) && v >= 1 ? undefined : "请输入 ≥ 1 的整数。") } },
      { name: "忽略列表", desc: "…", control: { type: "textarea", key: "ignored" } },
      { name: "立即重载", desc: "…", action: () => void this.plugin.reload() },
    ];
  }
}
```

要点：

- `control.key` **就是** settings 上的字段名，`PluginSettingTab` 默认的 `getControlValue`/`setControlValue` 会读写并持久化 `this.plugin.settings`
- 数据变了要调 `this.update()` 重新渲染与索引搜索
- 用了这套 API，就要把 `minAppVersion` 提到 `1.13.0`（否则请在旧版上保留 `display()` 兜底）
- 声明式的好处：设置项能被 Obsidian 的**设置搜索**索引到

### 依赖声明

- 代码里直接 `import` 的包必须写进 `dependencies`（不是 `devDependencies`）
- 典型例子：`@codemirror/state`、`@codemirror/view` 应从 `obsidian` 包的 peer 版本对齐，避免 peer 冲突警告：

```json
"dependencies": {
  "@codemirror/state": "6.7.6",
  "@codemirror/view": "6.43.13"
}
```

- 打包时把它们标记为 `external`（Obsidian 已内置）：

```js
external: ["obsidian", "@codemirror/state", "@codemirror/view"]
```

- **不要开 minify**：混淆/压缩后的产物会被视为"隐藏用途"

---

## 5. 发布：GitHub Release 三件套

### 5.1 版本号与 tag 必须一致

```
manifest.json: "version": "1.2.3"
git tag:                1.2.3      ← 不要写成 v1.2.3
```

一致性是**唯一**的发现机制，写错就等于没发布。

### 5.2 手动发布

1. 改 `manifest.json` 的 `version` → commit → push（目录读默认分支 HEAD 的 manifest）
2. 新建 Release，tag 与 version 完全一致
3. 附件上传 `main.js`、`manifest.json`、`styles.css`（**单独文件，不要 zip**）
4. **点 Publish release**（草稿对外不可见，Obsidian 也检测不到）

### 5.3 用 GitHub Actions 自动发（推荐）

`.github/workflows/release.yml`：

```yaml
name: Release Obsidian plugin

on:
  push:
    tags:
      - "*"

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
      attestations: write
    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20.x"

      - name: Build plugin
        run: |
          npm install
          npm run build

      - name: Generate artifact attestation
        uses: actions/attest@v4
        with:
          subject-path: |
            main.js
            manifest.json
            styles.css

      - name: Create release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          tag="${GITHUB_REF#refs/tags/}"
          gh release create "$tag" --title="$tag" --draft \
            main.js manifest.json styles.css
```

配套操作：

- 仓库 **Settings → Actions → General → Workflow permissions** 选 **Read and write**，否则建不了 Release
- 触发：`git tag -a 1.2.3 -m "1.2.3"` → `git push origin 1.2.3`
- 想全自动上线就把 `--draft` 去掉；保留 `--draft` 则每次要去网页点 **Publish**
- 附件签名（attestation）是官方推荐做法，能提升目录审核通过率

---

## 6. 提交到社区目录

1. 打开 <https://community.obsidian.md>，用 **Obsidian 账号**登录（不是 GitHub 账号）
2. 在个人资料里**关联 GitHub 账号**（用于确认仓库归属）
3. 添加插件：填仓库地址、描述、分类等
4. 提交后**自动扫描**会给出错误与警告：
   - **Error** → 在修好并重新发布前，插件**无法**从 Obsidian 内安装
   - **Warning** → 不阻塞安装，但建议全部清掉（审核通过率和用户观感都更好）
   - **Recommendation** → 最佳实践建议
5. 按提示改 → **升 version → 发新 Release**
6. 描述与分类随时可改；确认无误后 **Publish**

上架后可继续维护：

- 更新只需发新 Release，**不需要**再走审核
- 条目可由组织共享所有权（Organizations），也可转让
- 长期不维护或严重损坏会被下架

### 想在正式上架前给别人试用

官方不支持 beta 通道，推荐用 **BRAT**（`obsidian42-brat`）让测试者直接从 GitHub 仓库安装。

---

## 7. 高频踩坑清单（真实踩过的）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| Obsidian 提示 `no GitHub release with that version has been published yet` | Release 还是**草稿**；或 tag ≠ version | 网页点 Publish；核对 tag 与 `manifest.json` |
| 同上，但 Release 明明已发布 | tag 写成 `v1.0.0` | tag 不要带 `v` |
| 用户装了却是旧功能 | 改了代码但没升 `version`、没重发 Release | 每次发版必升 version |
| 安装报错 / 下载 404 | 忘了把 `main.js` 作为 Release 附件 | 三件套必须挂在 Release 上 |
| Actions 建 Release 失败 `Resource not accessible by integration` | Workflow 权限是只读 | Settings → Actions → Read and write |
| Actions 建 Release 失败 `HTTP 500` | GitHub 服务端故障 | 等恢复后 Re-run all jobs，无需改代码 |
| `git push` tag 报 `Internal Server Error` / `fatal error in commit_refs` | 同上，GitHub 侧故障 | 稍后重试（脚本里加重试循环） |
| 审核说依赖缺失 | 直接 import 的包写在 devDependencies | 移到 `dependencies` |
| 审核说 README 没有英文 | 目录面向英语用户 | README 用英文，或 `README.md`(英) + `README.zh-CN.md`(中) 互链 |
| 审核说描述缺少句号 | `description` 未以 `.` 结尾 | 补 `.`，并 ≤ 250 字符 |
| 设置项搜不到 | 用了旧的 `display()` | 迁移到 `getSettingDefinitions()`（1.13+） |
| `setWarning` / `display` 废弃告警 | 新版 API 替代 | 用 `setDestructive()` / `getSettingDefinitions()` |
| 手机端白屏或报错 | 用了 Node API 或正则 lookbehind | 改 Web API，或设 `isDesktopOnly: true` |
| 设置被同步/提交到仓库 | `data.json` 未忽略 | 加进 `.gitignore` |

---

## 8. 提交前自测清单

功能

- [ ] 桌面端 + 移动端都能正常启用、无报错
- [ ] 卸载/更新插件后，界面无残留、无报错
- [ ] 浅色 / 深色主题下样式都正常（无硬编码颜色）

代码

- [ ] 控制台默认无 `console.log/info` 噪音
- [ ] 无 `innerHTML` / `document.createElement` / `instanceof`（用 Obsidian 替代 API）
- [ ] 无模板示例残留（`MyPlugin`、`sample` 等）
- [ ] 所有监听器都有对应的注册/清理方式

元数据

- [ ] `manifest.json`：`id` / `name` / `version` / `minAppVersion` / `description` / `author` / `isDesktopOnly` 全部合规
- [ ] `description` 以 `.` 结尾且 ≤ 250 字符
- [ ] `README.md` 含英文说明 + 截图
- [ ] `LICENSE` 存在
- [ ] 若联网/收费/遥测等，README 有明确披露
- [ ] `data.json`、`main.js`、`node_modules/` 未被提交

发布

- [ ] tag 名 === `manifest.json` 的 `version`
- [ ] Release 已 **Published**（不是草稿）
- [ ] Release 附件含 `main.js`、`manifest.json`（有样式则加 `styles.css`）

---

## 9. 参考链接

- 提交插件：<https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin>
- 提交要求：<https://docs.obsidian.md/community-directory/submission-requirements-for-plugins>
- 开发者政策：<https://docs.obsidian.md/community-directory/developer-policies>
- 代码指南：<https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>
- manifest 字段：<https://docs.obsidian.md/Reference/Manifest>
- GitHub Actions 发布：<https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions>
- 社区目录：<https://community.obsidian.md>
