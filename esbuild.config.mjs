import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";
const root = process.cwd();

// 产物默认输出到项目根目录（CI 与发版都走这条路）；
// 本地开发时用 dev.local.json 里的 pluginDir（或 OBSIDIAN_PLUGIN_DIR 环境变量）
// 指向 vault 的插件目录，构建后顺带把 manifest.json / styles.css 一起同步过去。
function readDevConfig() {
	const file = path.join(root, "dev.local.json");
	if (!fs.existsSync(file)) return {};
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return {};
	}
}

const devConfig = readDevConfig();
const configured = process.env.OBSIDIAN_PLUGIN_DIR ?? devConfig.pluginDir ?? "";
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

const nodeBuiltins = [
	...builtinModules,
	...builtinModules.map((name) => `node:${name}`),
];

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
		...nodeBuiltins,
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
