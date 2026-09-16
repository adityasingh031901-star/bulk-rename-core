// Core filename logic for Bulk File Rename.
//
// This module is a dependency-free extraction of the pure functions used by
// the website's in-browser workbench (reading selected files, generating new
// names, applying rename rules, and de-duplicating ZIP paths).
//
// Design constraints (kept identical to the website):
// - Everything runs locally in the browser. These functions never perform
//   network requests, never touch analytics, and never read API keys.
// - File *contents* are never inspected here — only file *names* and small
//   metadata (last-modified date for the {filedate} token) are used.
// - The website passes real File objects around these functions; the actual
//   bytes are only read when the user clicks Download, and the resulting ZIP
//   is generated in memory in the browser (via JSZip on the site).

export type TextCase = "none" | "lower" | "upper" | "title" | "kebab";

export interface RenameOptions {
	/** Raw naming pattern typed by the user, e.g. "Photo 001" or "trip_{name}". */
	pattern: string;
	/** Literal (non-regex) find string applied to original names first. */
	find?: string;
	/** Replacement for `find`. */
	replace?: string;
	/** First number of a generated sequence. */
	startAt?: number;
	/** Minimum digit width for auto-numbering (0 = no padding). */
	minDigits?: number;
	/** Letter-casing rule applied to generated names. */
	textCase?: TextCase;
	/** "keep" preserves each file's own extension; otherwise forces one. */
	extensionMode?: string;
	/** "Today" for the {date} token (defaults to current date). */
	today?: Date;
	/** Per-file last-modified timestamps for the {filedate} token. */
	fileDates?: Array<number | undefined>;
	/** Per-file stable random strings for the {random} token. */
	randomSeeds?: string[];
}

export function getExtension(name: string): string {
	const dot = name.lastIndexOf(".");
	if (dot > 0 && dot < name.length - 1) return name.slice(dot);
	return "";
}

export function getBaseName(name: string): string {
	const dot = name.lastIndexOf(".");
	if (dot > 0) return name.slice(0, dot);
	return name;
}

/** Strip characters illegal on Windows/macOS, trim trailing dots/spaces,
 *  guard reserved device names, and cap length so ZIP entries stay portable. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeBase(base: string): string {
	let s = (base ?? "").replace(/[<>:\"/\\|?*\x00-\x1f]/g, "");
	s = s.replace(/[\s.]+$/g, "").trim();
	if (WINDOWS_RESERVED.test(s)) s = "_" + s;
	if (s.length > 180) s = s.slice(0, 180).trim();
	if (!s) s = "unnamed";
	return s;
}

/** Literal (non-regex) replace-all applied to the ORIGINAL base name
 *  before any naming pattern runs. */
export function applyFindReplace(base: string, find: string, replace: string): string {
	if (!find) return base;
	return base.split(find).join(replace);
}

export function toISODate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function toTitleCase(s: string): string {
	return s.replace(/[\wÀ-ÿ]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function applyCase(base: string, mode: TextCase = "none"): string {
	if (mode === "lower") return base.toLowerCase();
	if (mode === "upper") return base.toUpperCase();
	if (mode === "title") return toTitleCase(base);
	if (mode === "kebab") return base.toLowerCase().replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-");
	return base;
}

function resolveExtension(original: string, mode: string): string {
	if (!mode || mode === "keep") return getExtension(original);
	return "." + mode.toLowerCase();
}

/**
 * Naming rules (same as the website workbench):
 * 1) "{n}" / "{n:03}" -> sequential numbers starting at `startAt`.
 * 2) Trailing number like "Photo 1" / "Photo 001" -> continue the sequence.
 * 3) "{name}" template -> per-file original name, never auto-numbered.
 * 4) Plain name -> "Name 1", "Name 2", ... (single file stays plain).
 * Returns null when no rename applies (keep the original name).
 */
export function computeBaseFor(
	index: number,
	total: number,
	original: string,
	opts: RenameOptions,
): string | null {
	const raw = (opts.pattern ?? "").trim();
	const startAt = Math.min(9999, Math.max(1, Math.floor(opts.startAt ?? 1) || 1));
	const minDigits = Math.min(4, Math.max(0, Math.floor(opts.minDigits ?? 0) || 0));
	const today = toISODate(opts.today ?? new Date());
	const ts = opts.fileDates?.[index];
	const fileDate =
		typeof ts === "number" && Number.isFinite(ts) && ts > 0
			? toISODate(new Date(ts))
			: today;
	const rnd = opts.randomSeeds?.[index] ?? "file";
	const originalBase = applyFindReplace(getBaseName(original), opts.find ?? "", opts.replace ?? "");

	if (!raw) {
		if ((opts.find ?? "") !== "" && originalBase !== getBaseName(original)) {
			return applyCase(originalBase, opts.textCase);
		}
		return null;
	}

	const hasSeq = /{[nN](?::\d+)?}/.test(raw);
	const trailing = raw.match(/^(.*?)(\s*[-_#]*\s*)(\d+)\s*$/);

	const expand = (s: string, num: string) =>
		s
			.replace(/{[nN](?::\d+)?}/g, num)
			.replace(/{date}/gi, today)
			.replace(/{filedate}/gi, fileDate)
			.replace(/{random}/gi, rnd)
			.replace(/{name}/gi, originalBase)
			.trim();

	if (hasSeq) {
		const padMatch = raw.match(/\{[nN]:(\d+)\}/);
		const pad = padMatch ? Math.max(parseInt(padMatch[1], 10), minDigits) : minDigits;
		return expand(raw, String(startAt + index).padStart(pad, "0"));
	}

	if (trailing) {
		const base = trailing[1].trim();
		const sep = trailing[2] === "" ? " " : trailing[2];
		const digits = trailing[3];
		const num = String(parseInt(digits, 10) + index).padStart(digits.length, "0");
		return expand(base === "" ? num : `${base}${sep}${num}`, num);
	}

	if (/{name}/i.test(raw)) {
		return expand(raw, "");
	}

	const withDate = raw
		.replace(/{date}/gi, today)
		.replace(/{filedate}/gi, fileDate)
		.replace(/{random}/gi, rnd);
	if (total <= 1) return withDate;
	return `${withDate} ${String(startAt + index).padStart(minDigits, "0")}`;
}

/** Full new filename for one file: sanitized base + resolved extension. */
export function applyRename(original: string, index: number, total: number, opts: RenameOptions): string {
	const base = computeBaseFor(index, total, original, opts);
	if (base === null || base === "") return original;
	const cased = applyCase(base, opts.textCase);
	const safe = sanitizeBase(cased);
	if (!safe) return original;
	return `${safe}${resolveExtension(original, opts.extensionMode ?? "keep")}`;
}

/** Rename a whole batch; index order decides numbering. */
export function renameBatch(originals: string[], opts: RenameOptions): string[] {
	return originals.map((name, i) => applyRename(name, i, originals.length, opts));
}

/** Case-insensitive duplicate detection over results; returns colliding indexes. */
export function detectCollisions(results: string[]): Set<number> {
	const seen = new Map<string, number[]>();
	results.forEach((r, i) => {
		const key = r.toLowerCase();
		if (!seen.has(key)) seen.set(key, []);
		seen.get(key)!.push(i);
	});
	const out = new Set<number>();
	seen.forEach((idxs) => {
		if (idxs.length > 1) idxs.forEach((i) => out.add(i));
	});
	return out;
}

/**
 * De-duplicate ZIP paths (same folder + same name) by appending " (2)",
 * " (3)", ... so an archive never silently overwrites a file.
 * Returns a stateful mapper; create one per export.
 */
export function createZipPathMapper(): (dir: string, name: string) => string {
	const used = new Set<string>();
	let autoFixed = 0;
	return (dir: string, name: string) => {
		const safeDir = (dir || "")
			.split("/")
			.map((s) => sanitizeBase(s))
			.filter((s) => s && s !== "unnamed")
			.join("/");
		const base = sanitizeBase(getBaseName(name));
		const ext = getExtension(name)
			.replace(/[<>:\"/\\|?*\x00-\x1f]/g, "")
			.slice(0, 24);
		let candidate = base + ext;
		let i = 1;
		while (used.has(((safeDir ? safeDir + "/" : "") + candidate).toLowerCase())) {
			i++;
			candidate = `${base} (${i})${ext}`;
		}
		const full = (safeDir ? safeDir + "/" : "") + candidate;
		used.add(full.toLowerCase());
		if (i > 1) autoFixed++;
		return full;
	};
}
