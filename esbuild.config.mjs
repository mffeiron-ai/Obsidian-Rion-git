import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";
const root = process.cwd();

// 产物默认输出到项目根目录；
// 若 package.json 里配置了 obsidianPluginDir（或设置了 OBSIDIAN_PLUGIN_DIR 环境变量），
// 则直接写入该路径，并同步 manifest.json / styles.css，省去手动拷贝。
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const configured = process.env.OBSIDIAN_PLUGIN_DIR ?? pkg.obsidianPluginDir ?? "";
const pluginDir = configured ? path.resolve(configured) : root;

const assets = ["manifest.json", "styles.css"];

function copyAssets() {
	if (pluginDir === root) return;
	fs.mkdirSync(pluginDir, { recursive: true });
	for (const file of assets) {
		fs.copyFileSync(path.join(root, file), path.join(pluginDir, file));
	}
	console.log(`[rion-git] 已同步资源文件到 ${pluginDir}`);
}

const context = await esbuild.context({
	banner: {
		js: "/* Rion Git — 由 esbuild 生成的产物，请勿直接编辑。 */",
	},
	entryPoints: [path.join(root, "src/main.ts")],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2018",
	platform: "browser",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: false,
	outfile: path.join(pluginDir, "main.js"),
});

if (prod) {
	await context.rebuild();
	await context.dispose();
	copyAssets();
	console.log(`[rion-git] 构建完成 → ${path.join(pluginDir, "main.js")}`);
} else {
	await context.watch();
	copyAssets();
	console.log(`[rion-git] 监听中，输出目录：${pluginDir}`);
}
