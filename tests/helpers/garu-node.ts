// garu-ko 형태소 분석기를 노드(vitest)에서 직접 초기화하는 헬퍼.
// src/morpheme/index.ts는 wasm/모델을 esbuild 바이너리 로더로 import하므로
// 노드에서 그대로 쓸 수 없다 — 여기서는 node_modules의 파일을 fs로 읽어
// 동일 파라미터로 초기화한다. garu 로딩은 전부 지연(dynamic import)이라
// 이 모듈을 import하는 것만으로는 비용이 없다(테스트 skip 시 안전).
import fs from "node:fs";
import path from "node:path";
import { KO_STOPWORDS } from "../../src/morpheme/stopwords";

// src/morpheme/index.ts의 KEEP_POS와 동일해야 실제 검색과 같은 토큰이 나온다.
const KEEP_POS = new Set(["NNG", "NNP", "VV", "VA", "SL", "SH", "SN"]);
const HANGUL_RE = /[ㄱ-ㆎ가-힣]/;
const NAIVE_RE = /[\p{L}\p{N}]+/gu;

interface MorphToken {
	text: string;
	pos: string;
}
interface GaruLike {
	analyze(text: string): { tokens?: MorphToken[] };
}
type SplitSentences = (text: string) => Array<{ text: string; offset: number }>;

let analyzer: GaruLike | null = null;
let splitSentences: SplitSentences | null = null;
let loading: Promise<void> | null = null;

async function loadGaru(): Promise<void> {
	if (analyzer) return;
	if (loading) return loading;
	loading = (async () => {
		const root = path.resolve(process.cwd(), "node_modules/garu-ko");
		const wasmMod = await import("garu-ko/pkg/garu_wasm.js");
		const mainMod = (await import("garu-ko")) as unknown as {
			splitSentences: SplitSentences;
		};
		splitSentences = mainMod.splitSentences;
		const wasmBytes = fs.readFileSync(path.join(root, "pkg/garu_wasm_bg.wasm"));
		await wasmMod.default({ module_or_path: wasmBytes });
		const base = fs.readFileSync(path.join(root, "models/base.gmdl"));
		const cnn = fs.readFileSync(path.join(root, "models/cnn2.bin"));
		analyzer = new wasmMod.GaruWasm(base, cnn) as unknown as GaruLike;
	})();
	return loading;
}

function hasHangul(s: string): boolean {
	return HANGUL_RE.test(s);
}

function tokenizeNaive(text: string): string[] {
	return Array.from(text.matchAll(NAIVE_RE))
		.map((m) => m[0].toLowerCase())
		.filter((s) => s.length >= 2 && !KO_STOPWORDS.has(s));
}

async function tokenizeKorean(text: string): Promise<string[]> {
	await loadGaru();
	if (!analyzer || !splitSentences) throw new Error("garu 초기화 실패");
	const segments = splitSentences(text);
	const out: string[] = [];
	const sentences = segments.length > 0 ? segments : [{ text, offset: 0 }];
	for (const seg of sentences) {
		if (!seg.text) continue;
		const result = analyzer.analyze(seg.text);
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

/** src/morpheme/index.ts의 tokenize와 동일 동작 (NFC 정규화 포함). */
export async function tokenizeReal(text: string): Promise<string[]> {
	if (!text) return [];
	const nfc = text.normalize("NFC");
	return hasHangul(nfc) ? tokenizeKorean(nfc) : tokenizeNaive(nfc);
}
