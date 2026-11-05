/**
 * 仅用于离线预览的 obsidian 模块替身：提供 ItemView 与 setIcon 的最小实现，
 * 并补上 Obsidian 注入到 HTMLElement 上的 createEl / empty / addClass 等辅助方法。
 */

export class ItemView {
	contentEl: HTMLElement;
	containerEl: HTMLElement;

	constructor(public leaf: unknown) {
		this.containerEl = document.createElement("div");
		this.contentEl = document.createElement("div");
		this.containerEl.appendChild(this.contentEl);
	}

	setState(_state: unknown, _result: unknown): Promise<void> {
		return Promise.resolve();
	}
}

const ICON_PATHS: Record<string, string> = {
	"refresh-cw":
		'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
};

export function setIcon(el: HTMLElement, name: string): void {
	const paths = ICON_PATHS[name] ?? "";
	el.innerHTML = `<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/** Obsidian 的全局辅助函数，预览时补一份最小实现。 */
(globalThis as unknown as {
	createSvg: (tag: string) => SVGElement;
}).createSvg = (tag: string) =>
	document.createElementNS("http://www.w3.org/2000/svg", tag);

interface ElOptions {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
}

function applyOptions(el: HTMLElement, options?: ElOptions | string): void {
	if (!options) return;
	if (typeof options === "string") {
		el.className = options;
		return;
	}
	if (options.cls) el.className = options.cls;
	if (options.text !== undefined) el.textContent = options.text;
	if (options.attr) {
		for (const [key, value] of Object.entries(options.attr)) {
			el.setAttribute(key, value);
		}
	}
}

type ElWithHelpers = HTMLElement & {
	createEl?: unknown;
};

const proto = HTMLElement.prototype as unknown as ElWithHelpers;

if (!proto.createEl) {
	const helpers = {
		createEl(this: HTMLElement, tag: string, options?: ElOptions | string) {
			const el = document.createElement(tag);
			applyOptions(el, options);
			this.appendChild(el);
			return el;
		},
		createSpan(this: HTMLElement, options?: ElOptions | string) {
			return (this as never as { createEl: (t: string, o?: unknown) => HTMLElement }).createEl("span", options);
		},
		empty(this: HTMLElement) {
			while (this.firstChild) this.removeChild(this.firstChild);
		},
		addClass(this: HTMLElement, cls: string) {
			this.classList.add(cls);
		},
		setText(this: HTMLElement, text: string) {
			this.textContent = text;
		},
		setAttr(this: HTMLElement, key: string, value: string) {
			this.setAttribute(key, value);
		},
	};

	Object.assign(HTMLElement.prototype, helpers);
}
