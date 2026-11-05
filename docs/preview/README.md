# README 预览图

`sidebar.png` 与 `diff.png` 不是实机截图，而是用**插件真实的 DOM 结构 + 真实的 `styles.css`** 在浏览器里渲染后再截取的等效画面，配色取 Obsidian 默认深色主题（`#1e1e1e`、强调色 `hsl(254, 80%, 68%)` 等）。

`preview/` 下的两个 HTML 直接引用仓库根目录的 `styles.css`，只补充了 Obsidian 的基础控件样式（按钮、图标、CSS 变量）作为渲染环境。面板内容为示例数据。

## 重新生成

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$root = "D:\PlanAndLife\Enginer\Obsidian-Rion-git"

& $chrome --headless=new --disable-gpu --hide-scrollbars --no-first-run `
  --user-data-dir="$env:TEMP\rion-shot-1" --force-device-scale-factor=2 `
  --window-size=340,470 --screenshot="$root\docs\sidebar.png" `
  "file:///$($root.Replace('\','/'))/docs/preview/sidebar.html"

& $chrome --headless=new --disable-gpu --hide-scrollbars --no-first-run `
  --user-data-dir="$env:TEMP\rion-shot-2" --force-device-scale-factor=2 `
  --window-size=900,430 --screenshot="$root\docs\diff.png" `
  "file:///$($root.Replace('\','/'))/docs/preview/diff.html"
```

`--force-device-scale-factor=2` 即 2 倍图。两次截图使用不同的 `--user-data-dir`，否则第二次可能复用已运行的实例而不会重新落盘。

## 历史统计预览

`stats.png` 更进一步：`stats-preview.ts` 在浏览器里**直接运行 `src/ui/statsView.ts` 的渲染代码**，只把 `obsidian` 模块换成 `obsidian-stub.ts`（提供最小 `ItemView`、`setIcon`，以及 Obsidian 注入到 `HTMLElement` 上的 `createEl` / `empty` / `addClass`）。数据是按固定种子生成的样例。

```powershell
$root = "D:\PlanAndLife\Enginer\Obsidian-Rion-git"
Set-Location $root

# 1. 打包预览脚本（把 obsidian 换成替身）
& ".\node_modules\.bin\esbuild.cmd" docs/preview/stats-preview.ts --bundle `
  --format=esm --platform=browser --target=es2020 `
  --alias:obsidian=./docs/preview/obsidian-stub.ts `
  --outfile=docs/preview/stats-preview.js

# 2. 截图
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
& $chrome --headless=new --disable-gpu --hide-scrollbars --no-first-run `
  --user-data-dir="$env:TEMP\rion-shot-stats" --force-device-scale-factor=2 `
  --window-size=900,700 --screenshot="$root\docs\stats.png" `
  "file:///$($root.Replace('\','/'))/docs/preview/stats.html"
```

`docs/preview/*.js` 是构建产物，已在 `.gitignore` 中忽略。