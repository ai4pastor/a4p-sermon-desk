import wasmInit, { GaruWasm } from "garu-ko/pkg/garu_wasm.js";
import { splitSentences } from "garu-ko";
import { KO_STOPWORDS } from "./stopwords";
// @ts-expect-error binary loader (esbuild) returns Uint8Array; package ships a real d.ts that masks our *.wasm declaration
import wasmBytes from "../../node_modules/garu-ko/pkg/garu_wasm_bg.wasm";
import baseModelBytes from "../../node_modules/garu-ko/models/base.gmdl";
import cnnModelBytes from "../../node_modules/garu-ko/models/cnn2.bin";

interface MorphToken {
	text: string;
	pos: string;
}

let analyzer: GaruWasm | null = null;
let loading: Promise<GaruWasm> | null = null;

async function loadAnalyzer(): Promise<GaruWasm> {
	if (analyzer) return analyzer;
	if (loading) return loading;
	loading = (async () => {
		await wasmInit({ module_or_path: wasmBytes as unknown as BufferSource });
		const inst = new GaruWasm(baseModelBytes, cnnModelBytes);
		analyzer = inst;
		return inst;
	})();
	return loading;
}

const KEEP_POS = new Set([
	"NNG",
	"NNP",
	"VV",
	"VA",
	"SL",
	"SH",
	"SN",
]);

const HANGUL_RE = /[\u3131-\u318E\uAC00-\uD7A3]/;
const NAIVE_RE = /[\p{L}\p{N}]+/gu;

export function hasHangul(s: string): boolean {
	return HANGUL_RE.test(s);
}

export async function tokenizeKorean(text: string): Promise<string[]> {
	if (!text) return [];
	const garu = await loadAnalyzer();
	const segments = splitSentences(text);
	const out: string[] = [];
	const sentences = segments.length > 0 ? segments : [{ text, offset: 0 }];
	for (const seg of sentences) {
		if (!seg.text) continue;
		const result = garu.analyze(seg.text) as { tokens?: MorphToken[] };
		const tokens = result?.tokens ?? [];
		for (const t of tokens) {
			if (!KEEP_POS.has(t.pos)) continue;
			const s = hasHangul(t.text) ? t.text : t.text.toLowerCase();
			if (s.length < 1) continue;
			if (KO_STOPWORDS.has(s)) continue;
			out.push(s);
		}
	}
	return out;
}

export function tokenizeNaive(text: string): string[] {
	return Array.from(text.matchAll(NAIVE_RE))
		.map((m) => m[0].toLowerCase())
		.filter((s) => s.length >= 2 && !KO_STOPWORDS.has(s));
}

export async function tokenize(text: string): Promise<string[]> {
	if (!text) return [];
	return hasHangul(text) ? tokenizeKorean(text) : tokenizeNaive(text);
}

export function isStopword(token: string): boolean {
	return KO_STOPWORDS.has(token);
}

export async function preloadMorpheme(): Promise<void> {
	await loadAnalyzer();
}

export function destroyMorpheme(): void {
	if (analyzer) {
		analyzer.free();
		analyzer = null;
	}
	loading = null;
}

export async function benchMorpheme(
	text: string,
	iters = 100,
): Promise<{ analyzeMs: number; tokenizeMs: number }> {
	const garu = await loadAnalyzer();
	garu.analyze(text);
	garu.tokenize(text);
	let t = performance.now();
	for (let i = 0; i < iters; i++) garu.analyze(text);
	const analyzeMs = (performance.now() - t) / iters;
	t = performance.now();
	for (let i = 0; i < iters; i++) garu.tokenize(text);
	const tokenizeMs = (performance.now() - t) / iters;
	return { analyzeMs, tokenizeMs };
}
