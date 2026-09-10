// 팝업 보기 앵커 선택 — 스크린샷 사례(헤딩 없는 글머리표 노트 = 청크 1개) 기준.
import { describe, it, expect } from "vitest";
import { pickAnchor, type AnchorBlock } from "../src/anchor";

const B = (tag: string, text: string): AnchorBlock => ({ tag, text });

// 노트 전체가 청크 하나인 경우(indexer의 [태그: …] 접두 포함).
const CHUNK = `[태그: 로마서, 예정] - 알미니안들은 로마서 9장이 **이스라엘 민족**에 대해 이야기한다고 본다
- 칼빈주의자들은 9:10-24절만 인용하기 좋아하지만 **9-11장 전체 맥락**으로 읽어야 한다
- [[롬9_1]]·3-5 - 바울이 서두에서 자신이 **국가로서의 이스라엘**을 말하고 있음을 드러냄
- → 9-11장 전체에 걸쳐 다뤄지는 것은 국가 이스라엘 — 바울은 **단 한 번도 개인의 예정에 대해 이야기하지 않는다**`;

const BLOCKS: AnchorBlock[] = [
	B("li", "알미니안들은 로마서 9장이 이스라엘 민족에 대해 이야기한다고 본다"),
	B("li", "칼빈주의자들은 9:10-24절만 인용하기 좋아하지만 9-11장 전체 맥락으로 읽어야 한다"),
	B("li", "롬9_1·3-5 - 바울이 서두에서 자신이 국가로서의 이스라엘을 말하고 있음을 드러냄"),
	B("li", "→ 9-11장 전체에 걸쳐 다뤄지는 것은 국가 이스라엘 — 바울은 단 한 번도 개인의 예정에 대해 이야기하지 않는다"),
];

describe("pickAnchor — 검색어 기반", () => {
	it("서로 다른 검색어를 가장 많이 담은 블록을 고른다 (첫 블록 아님)", () => {
		const pick = pickAnchor(BLOCKS, {
			terms: ["국가", "예정", "이스라엘"],
			chunkText: CHUNK,
			heading: null,
		});
		expect(pick).toEqual({ index: 3, reason: "terms" });
	});

	it("동점이면 앞쪽 블록", () => {
		const pick = pickAnchor(BLOCKS, {
			terms: ["이스라엘"],
			chunkText: CHUNK,
			heading: null,
		});
		expect(pick).toEqual({ index: 0, reason: "terms" });
	});

	it("같은 검색어의 대소문자 변형은 한 번만 센다", () => {
		const blocks = [
			B("p", "Grace grace GRACE 세 번"),
			B("p", "grace and faith"),
		];
		const chunk = "Grace grace GRACE 세 번\n\ngrace and faith";
		const pick = pickAnchor(blocks, {
			terms: ["grace", "faith"],
			chunkText: chunk,
			heading: null,
		});
		expect(pick).toEqual({ index: 1, reason: "terms" });
	});

	it("청크 밖 블록은 검색어가 많아도 제외한다 (같은 노트의 다른 청크)", () => {
		const blocks = [
			B("p", "예정에 대한 개인 구원 논쟁 정리 — 다른 섹션의 문단"),
			...BLOCKS,
		];
		const pick = pickAnchor(blocks, {
			terms: ["예정", "구원", "논쟁"],
			chunkText: CHUNK,
			heading: null,
		});
		expect(pick).toEqual({ index: 4, reason: "terms" });
	});

	it("<br>·소프트 줄바꿈으로 공백이 사라진 렌더 텍스트도 청크 범위로 인정한다", () => {
		const blocks = [B("p", "가나다라 마바사아자차카 타파하")];
		const pick = pickAnchor(blocks, {
			terms: ["타파하"],
			chunkText: "가나다라 마바사<br>아자차카 타파하",
			heading: null,
		});
		expect(pick).toEqual({ index: 0, reason: "terms" });
	});

	it("1글자·불용어 검색어는 무시한다 → 검색어 없음으로 처리", () => {
		const pick = pickAnchor(BLOCKS, {
			terms: ["것", "이", "우리"],
			chunkText: CHUNK,
			heading: null,
		});
		expect(pick).toEqual({ index: 0, reason: "chunk" });
	});
});

describe("pickAnchor — 폴백", () => {
	const SECTION_CHUNK = "본문 첫 문단입니다 여기서 시작\n\n둘째 문단은 다른 이야기";
	const SECTION_BLOCKS = [
		B("pre", "created: 2026-09-10\ntags: [a]"),
		B("h2", "본론"),
		B("p", "본문 첫 문단입니다 여기서 시작"),
		B("p", "둘째 문단은 다른 이야기"),
	];

	it("검색어가 안 맞으면 청크 헤딩(h1~h6, 인라인 마크 제거 후 동등)", () => {
		const pick = pickAnchor(SECTION_BLOCKS, {
			terms: ["없는말"],
			chunkText: SECTION_CHUNK,
			heading: "**본론**",
		});
		expect(pick).toEqual({ index: 1, reason: "heading" });
	});

	it("헤딩도 없으면 청크 범위 첫 블록 (프론트매터 pre는 건너뜀)", () => {
		const pick = pickAnchor(SECTION_BLOCKS, {
			terms: [],
			chunkText: SECTION_CHUNK,
			heading: null,
		});
		expect(pick).toEqual({ index: 2, reason: "chunk" });
	});

	it("청크 범위 블록이 하나도 없으면 전체를 후보로 검색어만 본다", () => {
		const pick = pickAnchor(
			[B("p", "렌더가 전혀 달라진 문단 은혜"), B("p", "두 번째 문단")],
			{ terms: ["은혜"], chunkText: "원문과 무관한 청크 텍스트", heading: null },
		);
		expect(pick).toEqual({ index: 0, reason: "terms" });
	});

	it("검색어·헤딩·청크 범위 모두 없으면 null (하이라이트 없음)", () => {
		expect(
			pickAnchor([B("p", "전혀 다른 문단")], {
				terms: [],
				chunkText: "원문과 무관한 청크 텍스트",
				heading: null,
			}),
		).toBeNull();
		expect(pickAnchor([], { terms: ["a"], chunkText: "x", heading: "h" })).toBeNull();
	});
});
