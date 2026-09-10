// deriveNoteKeys — 노트 메타데이터 → (렉시콘, 키)·태그 키 규칙 (PR-B B-3).
import { describe, it, expect } from "vitest";
import {
	deriveNoteKeys,
	toIndexLexicons,
	type NoteKeyInput,
} from "../src/indexer/note-keys";

const DOCTRINE = toIndexLexicons([
	{ id: "doctrine", fields: ["doctrine"], keywords: ["칭의", "성화", "✝️ 은혜"] },
]);
const CONCEPT = toIndexLexicons([
	{ id: "concept", fields: ["concept", "tags"], keywords: ["정렬", "칭의"] },
]);

function input(partial: Partial<NoteKeyInput>): NoteKeyInput {
	return {
		frontmatter: {},
		inlineTags: [],
		links: [],
		frontmatterLinks: [],
		...partial,
	};
}
const lexOf = (r: ReturnType<typeof deriveNoteKeys>, id: string) =>
	r.lexiconKeys.filter((k) => k.lexiconId === id).map((k) => k.key).sort();

describe("deriveNoteKeys", () => {
	it("(1) 매핑 필드의 frontmatter 값 — 스칼라·배열·위키링크·이모지 접두, 쉼표는 분리 안 함", () => {
		const scalar = deriveNoteKeys(
			input({ frontmatter: { doctrine: "[[100/칭의|의롭다]]" } }),
			DOCTRINE,
		);
		expect(lexOf(scalar, "doctrine")).toEqual(["100/칭의", "칭의"]);
		const arr = deriveNoteKeys(
			input({ frontmatter: { doctrine: ["✝️ 은혜", "성화, 칭의"] } }),
			DOCTRINE,
		);
		// 문자열 배열 원소는 그대로 한 키(구 doctrine 동작 유지) — "성화, 칭의"는 분리되지 않는다.
		expect(lexOf(arr, "doctrine")).toEqual(["성화, 칭의", "은혜"]);
		expect(arr.tagKeys).toEqual([]);
	});

	it("(2) frontmatter tags(배열·쉼표 문자열)와 인라인 태그는 tagKeys", () => {
		const a = deriveNoteKeys(
			input({ frontmatter: { tags: ["감사", "#기도"] }, inlineTags: ["#설교/청소년"] }),
			DOCTRINE,
		);
		// 인라인 태그는 normalizeTag만(경로 basename 변형 없음 — 구 parseFile 동작 유지).
		expect(a.tagKeys.sort()).toEqual(["감사", "기도", "설교/청소년"]);
		expect(a.lexiconKeys).toEqual([]);
		const b = deriveNoteKeys(input({ frontmatter: { tags: "감사, 기도" } }), DOCTRINE);
		expect(b.tagKeys.sort()).toEqual(["감사", "기도"]);
	});

	it("(3) 본문 링크 — 렉시콘 키면 렉시콘, 아니면 태그", () => {
		const r = deriveNoteKeys(
			input({ links: ["칭의#정의", "로마서 9장", "교리/성화"] }),
			DOCTRINE,
		);
		expect(lexOf(r, "doctrine")).toEqual(["성화", "칭의"]);
		// "교리/성화"의 정규화 키 자체는 렉시콘에 없어 태그로, basename "성화"는 렉시콘으로.
		expect(r.tagKeys.sort()).toEqual(["교리/성화", "로마서 9장"]);
	});

	it("(3) 같은 링크 키를 두 렉시콘이 가지면 양쪽에 행이 생긴다", () => {
		const both = [...DOCTRINE, ...CONCEPT];
		const r = deriveNoteKeys(input({ links: ["칭의"] }), both);
		expect(r.lexiconKeys).toEqual([
			{ lexiconId: "doctrine", key: "칭의" },
			{ lexiconId: "concept", key: "칭의" },
		]);
		expect(r.tagKeys).toEqual([]);
	});

	it("(4)(5) fields에 tags가 있는 렉시콘은 태그 중 키워드를 승격하고 tagKeys에서 뺀다", () => {
		const r = deriveNoteKeys(
			input({ frontmatter: { tags: ["정렬", "감사"] }, inlineTags: ["#칭의"] }),
			CONCEPT,
		);
		expect(lexOf(r, "concept")).toEqual(["정렬", "칭의"]);
		expect(r.tagKeys).toEqual(["감사"]);
		// tags 폴백이 없는 렉시콘은 태그를 승격하지 않는다.
		const d = deriveNoteKeys(input({ inlineTags: ["#칭의"] }), DOCTRINE);
		expect(d.lexiconKeys).toEqual([]);
		expect(d.tagKeys).toEqual(["칭의"]);
	});

	it("(1) frontmatterLinks는 key 루트로 분류 — 매핑 필드 → 렉시콘, tags → 태그, 그 외 무시", () => {
		const r = deriveNoteKeys(
			input({
				frontmatterLinks: [
					{ key: "doctrine.0", link: "칭의" },
					{ key: "tags.1", link: "감사" },
					{ key: "related", link: "다른노트" },
				],
			}),
			DOCTRINE,
		);
		expect(lexOf(r, "doctrine")).toEqual(["칭의"]);
		expect(r.tagKeys).toEqual(["감사"]);
	});

	it("렉시콘이 없으면 전부 태그, 중복 없음; 렉시콘 순서대로 출력", () => {
		const r = deriveNoteKeys(
			input({
				frontmatter: { doctrine: "칭의", tags: ["감사"] },
				inlineTags: ["#감사"],
				links: ["칭의", "감사"],
			}),
			[],
		);
		expect(r.lexiconKeys).toEqual([]);
		// doctrine 필드는 매핑하는 렉시콘이 없으므로 무시된다.
		expect(r.tagKeys.sort()).toEqual(["감사", "칭의"]);
		const ordered = deriveNoteKeys(
			input({ frontmatter: { concept: "정렬", doctrine: "성화" } }),
			[...CONCEPT, ...DOCTRINE],
		);
		expect(ordered.lexiconKeys.map((k) => k.lexiconId)).toEqual(["concept", "doctrine"]);
	});
});
