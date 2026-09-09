import wasmInit, { GaruWasm } from "garu-ko/pkg/garu_wasm.js";
import { splitSentences } from "garu-ko";
import { KO_STOPWORDS } from "./stopwords";
import { topUpProtected } from "./protected";
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

// 보호 단어(교리 키워드·동의어·직접 추가) — main.ts가 설정 로드/저장 시 주입한다.
let protectedTerms: readonly string[] = [];

export function setProtectedTerms(terms: readonly string[]): void {
	protectedTerms = terms;
}

export function getProtectedTerms(): readonly string[] {
	return protectedTerms;
}

export async function tokenize(text: string): Promise<string[]> {
	if (!text) return [];
	// NFD(iCloud 등 외부 동기화) 텍스트가 섞여도 색인·쿼리 토큰이 일치하도록 통일.
	const nfc = text.normalize("NFC");
	const base = hasHangul(nfc)
		? await tokenizeKorean(nfc)
		: tokenizeNaive(nfc);
	// garu가 쪼개거나 떨어뜨린 보호 단어를 보충(색인·쿼리 공통 → 토큰 일치).
	return topUpProtected(base, nfc, protectedTerms);
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
