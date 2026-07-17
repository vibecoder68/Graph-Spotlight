const HEX_COLOR = /^#?[0-9a-f]{6}$/i;

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

interface Hsl {
	h: number;
	s: number;
	l: number;
}

export function normalizeHexColor(value: string): string | null {
	const trimmed = value.trim();
	if (!HEX_COLOR.test(trimmed)) return null;
	return `#${trimmed.replace("#", "").toLowerCase()}`;
}

export function parseColorPool(value: string): string[] {
	const parsed = value
		.split(/[\s,;]+/)
		.map((part) => normalizeHexColor(part))
		.filter((part): part is string => part !== null);

	return Array.from(new Set(parsed));
}

export function hexToRgb(hex: string): Rgb {
	const normalized = normalizeHexColor(hex) ?? "#ffffff";
	const value = Number.parseInt(normalized.slice(1), 16);
	return {
		r: (value >> 16) & 255,
		g: (value >> 8) & 255,
		b: value & 255,
	};
}

export function rgbToHex(rgb: Rgb): string {
	const r = clampChannel(rgb.r).toString(16).padStart(2, "0");
	const g = clampChannel(rgb.g).toString(16).padStart(2, "0");
	const b = clampChannel(rgb.b).toString(16).padStart(2, "0");
	return `#${r}${g}${b}`;
}

export function hexToPixiRgb(hex: string): number {
	const normalized = normalizeHexColor(hex) ?? "#ffffff";
	return Number.parseInt(normalized.slice(1), 16);
}

export function mixHexColors(colors: string[]): string {
	if (colors.length === 0) return "#ffffff";
	if (colors.length === 1) return normalizeHexColor(colors[0]) ?? "#ffffff";

	let x = 0;
	let y = 0;
	let saturation = 0;
	let lightness = 0;

	for (const color of colors) {
		const hsl = rgbToHsl(hexToRgb(color));
		const radians = (hsl.h / 360) * Math.PI * 2;
		x += Math.cos(radians) * hsl.s;
		y += Math.sin(radians) * hsl.s;
		saturation += hsl.s;
		lightness += hsl.l;
	}

	const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
	const averageSaturation = Math.min(0.96, saturation / colors.length + 0.12);
	const averageLightness = clamp(lightness / colors.length + 0.04, 0.36, 0.68);

	return rgbToHex(hslToRgb({ h: hue, s: averageSaturation, l: averageLightness }));
}

export function softenColor(hex: string, amount: number): string {
	return blendHex(hex, "#8a9099", clamp(amount, 0, 1));
}

export function blendHex(a: string, b: string, amount: number): string {
	const first = hexToRgb(a);
	const second = hexToRgb(b);
	const t = clamp(amount, 0, 1);
	return rgbToHex({
		r: first.r + (second.r - first.r) * t,
		g: first.g + (second.g - first.g) * t,
		b: first.b + (second.b - first.b) * t,
	});
}

export function pickVibrantColor(usedColors: string[], pool: string[]): string {
	const normalizedPool = pool
		.map((color) => normalizeHexColor(color))
		.filter((color): color is string => color !== null);

	if (normalizedPool.length === 0) return "#4d96ff";

	const used = new Set(
		usedColors
			.map((color) => normalizeHexColor(color))
			.filter((color): color is string => color !== null),
	);
	const unused = normalizedPool.filter((color) => !used.has(color));
	const candidates = unused.length > 0 ? unused : normalizedPool;
	const index = Math.floor(Math.random() * candidates.length);
	return candidates[index];
}

function rgbToHsl(rgb: Rgb): Hsl {
	const r = rgb.r / 255;
	const g = rgb.g / 255;
	const b = rgb.b / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;

	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = (g - b) / d + (g < b ? 6 : 0);
				break;
			case g:
				h = (b - r) / d + 2;
				break;
			default:
				h = (r - g) / d + 4;
				break;
		}
		h *= 60;
	}

	return { h, s, l };
}

function hslToRgb(hsl: Hsl): Rgb {
	const h = ((hsl.h % 360) + 360) % 360;
	const s = clamp(hsl.s, 0, 1);
	const l = clamp(hsl.l, 0, 1);

	if (s === 0) {
		const value = l * 255;
		return { r: value, g: value, b: value };
	}

	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const hk = h / 360;
	return {
		r: hueToRgb(p, q, hk + 1 / 3) * 255,
		g: hueToRgb(p, q, hk) * 255,
		b: hueToRgb(p, q, hk - 1 / 3) * 255,
	};
}

function hueToRgb(p: number, q: number, t: number): number {
	let value = t;
	if (value < 0) value += 1;
	if (value > 1) value -= 1;
	if (value < 1 / 6) return p + (q - p) * 6 * value;
	if (value < 1 / 2) return q;
	if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
	return p;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function clampChannel(value: number): number {
	return Math.round(clamp(value, 0, 255));
}
