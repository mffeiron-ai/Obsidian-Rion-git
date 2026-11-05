import { ItemView, setIcon } from "obsidian";
import type { ViewStateResult, WorkspaceLeaf } from "obsidian";
import type RionGitPlugin from "../main";
import {
	aggregateByWeek,
	aggregateDaily,
	shiftDays,
	todayString,
	weekdayIndex,
} from "../git/historyData";
import type { DailyStat, WeeklyStat } from "../git/historyData";

export const VIEW_TYPE_RION_GIT_STATS = "rion-git-stats";

export interface StatsViewState extends Record<string, unknown> {
	weeks: number;
}

const WEEK_OPTIONS = [13, 26, 52];
const WEEKDAY_LABELS: Record<number, string> = { 0: "一", 2: "三", 4: "五", 6: "日" };

function svgEl<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
	const el = createSvg(tag);
	for (const [key, value] of Object.entries(attrs)) {
		el.setAttribute(key, String(value));
	}
	return el;
}

/** 让坐标轴上限落在 1/2/2.5/5 的整数倍上，刻度数字更好读。 */
function niceMax(value: number, divisions = 4): number {
	if (value <= 0) return divisions;

	const rough = value / divisions;
	const exponent = Math.floor(Math.log10(rough));
	const base = 10 ** exponent;
	const normalized = rough / base;
	const step = [1, 2, 2.5, 5, 10].find((candidate) => normalized <= candidate) ?? 10;

	return step * base * divisions;
}

export class StatsView extends ItemView {
	private weeks = 26;
	private renderToken = 0;
	private resizeTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: RionGitPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_RION_GIT_STATS;
	}

	getDisplayText(): string {
		return "历史统计";
	}

	getIcon(): string {
		return "activity";
	}

	getState(): StatsViewState {
		return { weeks: this.weeks };
	}

	async setState(state: StatsViewState, result: ViewStateResult): Promise<void> {
		const weeks = Number(state?.weeks);
		if (WEEK_OPTIONS.includes(weeks)) this.weeks = weeks;
		await super.setState(state, result);
		await this.render();
	}

	async onOpen(): Promise<void> {
		this.registerDomEvent(window, "resize", () => {
			if (this.resizeTimer !== null) window.clearTimeout(this.resizeTimer);
			this.resizeTimer = window.setTimeout(() => {
				this.resizeTimer = null;
				void this.render();
			}, 250);
		});
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	async render(): Promise<void> {
		const token = ++this.renderToken;
		const el = this.contentEl;
		el.empty();
		el.addClass("rion-git-stats-view");

		this.renderHeader(el);

		const body = el.createEl("div", { cls: "rion-git-stats-body" });
		body.createEl("div", { cls: "rion-git-empty", text: "统计中…" });

		const commits = await this.plugin.loadHistoryStats();
		if (token !== this.renderToken) return;

		const today = todayString();
		const start = shiftDays(today, -(this.weeks * 7 - 1));
		const daily = aggregateDaily(commits, start, today);

		const totalCommits = daily.reduce((sum, day) => sum + day.commits, 0);
		const totalLines = daily.reduce((sum, day) => sum + day.lines, 0);
		const totalFiles = daily.reduce((sum, day) => sum + day.files, 0);

		body.empty();

		if (totalCommits === 0) {
			body.createEl("div", {
				cls: "rion-git-empty",
				text: "这段时间没有提交记录。",
			});
			return;
		}

		body.createEl("div", {
			cls: "rion-git-stats-summary",
			text: `近 ${this.weeks} 周：${totalCommits} 次提交 · ${totalLines} 行改动 · ${totalFiles} 个文件`,
		});

		body.createEl("div", { cls: "rion-git-stats-section", text: "提交日历" });
		const heatmap = body.createEl("div", { cls: "rion-git-heatmap" });
		this.renderHeatmap(heatmap, daily);

		body.createEl("div", { cls: "rion-git-stats-section", text: "改动趋势（按周）" });
		const chart = body.createEl("div", { cls: "rion-git-line-chart" });
		this.renderLineChart(chart, aggregateByWeek(daily));
	}

	private renderHeader(el: HTMLElement): void {
		const header = el.createEl("div", { cls: "rion-git-stats-header" });
		header.createEl("span", { cls: "rion-git-stats-title", text: "历史统计" });

		const select = header.createEl("select", { cls: "dropdown" });
		for (const weeks of WEEK_OPTIONS) {
			const option = select.createEl("option", { text: `近 ${weeks} 周` });
			option.value = String(weeks);
			option.selected = weeks === this.weeks;
		}
		select.onchange = () => {
			this.weeks = Number(select.value);
			void this.render();
		};

		const refresh = header.createEl("button", { cls: "clickable-icon" });
		refresh.setAttribute("aria-label", "重新统计");
		refresh.setAttribute("title", "重新统计");
		setIcon(refresh, "refresh-cw");
		refresh.onclick = () => void this.render();
	}

	private renderHeatmap(container: HTMLElement, daily: DailyStat[]): void {
		const first = daily[0];
		if (!first) return;

		const LEFT = 22;
		const TOP = 18;
		const GAP = 3;

		const firstWeekday = weekdayIndex(first.date);
		const columns = Math.ceil((firstWeekday + daily.length) / 7);

		// 单元格随容器宽度伸缩，避免宽标签页里右侧留一大片空白。
		const available = Math.max(320, container.clientWidth || 640);
		const CELL = Math.max(9, Math.min(26, Math.floor((available - LEFT - GAP) / columns) - GAP));

		const width = LEFT + columns * (CELL + GAP) + GAP;
		const height = TOP + 7 * (CELL + GAP);

		const svg = svgEl("svg", {
			viewBox: `0 0 ${width} ${height}`,
			width,
			height,
			class: "rion-git-heatmap-svg",
		});

		for (const [rowText, label] of Object.entries(WEEKDAY_LABELS)) {
			const row = Number(rowText);
			const text = svgEl("text", {
				x: 0,
				y: TOP + row * (CELL + GAP) + CELL - 1,
				class: "rion-git-heatmap-label",
			});
			text.textContent = label;
			svg.appendChild(text);
		}

		const maxCommits = Math.max(1, ...daily.map((day) => day.commits));
		let lastMonth = "";

		daily.forEach((day, index) => {
			const column = Math.floor((firstWeekday + index) / 7);
			const row = weekdayIndex(day.date);
			const x = LEFT + column * (CELL + GAP);
			const y = TOP + row * (CELL + GAP);

			const level =
				day.commits === 0
					? 0
					: Math.min(4, Math.max(1, Math.ceil((day.commits / maxCommits) * 4)));

			const rect = svgEl("rect", {
				x,
				y,
				width: CELL,
				height: CELL,
				rx: 2,
				class: `rion-git-heat-cell level-${level}`,
			});
			const title = svgEl("title");
			title.textContent = `${day.date}：${day.commits} 次提交，${day.lines} 行，${day.files} 个文件`;
			rect.appendChild(title);
			svg.appendChild(rect);

			const month = day.date.slice(0, 7);
			if (month !== lastMonth) {
				lastMonth = month;
				const label = svgEl("text", {
					x,
					y: TOP - 6,
					class: "rion-git-heatmap-month",
				});
				label.textContent = `${Number(day.date.slice(5, 7))}月`;
				svg.appendChild(label);
			}
		});

		container.appendChild(svg);

		const legend = container.createEl("div", { cls: "rion-git-heatmap-legend" });
		legend.createEl("span", { text: "少" });
		for (let level = 0; level <= 4; level++) {
			legend.createEl("span", { cls: `rion-git-heat-cell level-${level}` });
		}
		legend.createEl("span", { text: "多" });
	}

	private renderLineChart(container: HTMLElement, weeks: WeeklyStat[]): void {
		if (weeks.length === 0) return;

		const W = 760;
		const H = 240;
		const padL = 52;
		const padR = 56;
		const padT = 16;
		const padB = 28;
		const plotW = W - padL - padR;
		const plotH = H - padT - padB;

		const maxLines = niceMax(Math.max(1, ...weeks.map((week) => week.lines)));
		const maxFiles = niceMax(Math.max(1, ...weeks.map((week) => week.files)));

		const svg = svgEl("svg", {
			viewBox: `0 0 ${W} ${H}`,
			class: "rion-git-line-svg",
		});

		const xAt = (index: number): number =>
			padL +
			(weeks.length <= 1 ? plotW / 2 : (index / (weeks.length - 1)) * plotW);
		const yLines = (value: number): number =>
			padT + plotH - (value / maxLines) * plotH;
		const yFiles = (value: number): number =>
			padT + plotH - (value / maxFiles) * plotH;

		for (let step = 0; step <= 4; step++) {
			const y = padT + (plotH / 4) * step;
			svg.appendChild(
				svgEl("line", {
					x1: padL,
					y1: y,
					x2: padL + plotW,
					y2: y,
					class: "rion-git-grid-line",
				})
			);

			const leftLabel = svgEl("text", {
				x: padL - 8,
				y: y + 4,
				class: "rion-git-axis-label",
				"text-anchor": "end",
			});
			leftLabel.textContent = String(Math.round(maxLines - (maxLines / 4) * step));
			svg.appendChild(leftLabel);

			const rightLabel = svgEl("text", {
				x: padL + plotW + 8,
				y: y + 4,
				class: "rion-git-axis-label",
				"text-anchor": "start",
			});
			rightLabel.textContent = String(Math.round(maxFiles - (maxFiles / 4) * step));
			svg.appendChild(rightLabel);
		}

		const buildPath = (
			values: number[],
			scale: (value: number) => number
		): string =>
			values
				.map(
					(value, index) =>
						`${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)},${scale(value).toFixed(1)}`
				)
				.join(" ");

		svg.appendChild(
			svgEl("path", {
				d: buildPath(
					weeks.map((week) => week.lines),
					yLines
				),
				class: "rion-git-line-series series-lines",
			})
		);
		svg.appendChild(
			svgEl("path", {
				d: buildPath(
					weeks.map((week) => week.files),
					yFiles
				),
				class: "rion-git-line-series series-files",
			})
		);

		const labelStep = Math.max(1, Math.ceil(weeks.length / 8));
		weeks.forEach((week, index) => {
			if (index % labelStep !== 0) return;
			const text = svgEl("text", {
				x: xAt(index),
				y: H - 8,
				class: "rion-git-axis-label",
				"text-anchor": "middle",
			});
			text.textContent = `${Number(week.weekStart.slice(5, 7))}/${Number(week.weekStart.slice(8, 10))}`;
			svg.appendChild(text);
		});

		container.appendChild(svg);

		const legend = container.createEl("div", { cls: "rion-git-chart-legend" });
		legend.createEl("span", { cls: "dot series-lines" });
		legend.createEl("span", { text: "提交行数（左轴）" });
		legend.createEl("span", { cls: "dot series-files" });
		legend.createEl("span", { text: "提交文件数（右轴）" });
	}
}
