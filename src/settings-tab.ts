import {
	App,
	PluginSettingTab,
	Setting,
	ButtonComponent,
	TextComponent,
	Notice,
} from "obsidian";
import type WeightedRecallPlugin from "./main";
import {
	WEIGHT_MIN,
	WEIGHT_MAX,
	WEIGHT_STEP,
	DEFAULT_WEIGHT,
	DEFAULT_SETTINGS,
	GroupId,
	FolderEntry,
	parseDoctrineRaw,
	foldersFingerprint,
} from "./settings";
import { FolderSuggest } from "./folder-suggest";
import {
	embedDoctrineKeys,
	embedTagKeys,
	type LexiconProgress,
} from "./embedder/embed-lexicon";
import {
	generateDoctrineSynonyms,
	type SynonymProgress,
} from "./embedder/generate-synonyms";
import {
	getEmbeddedKeys,
	getDistinctTagKeys,
	getMaxEmbeddedAt,
} from "./db/embeddings";
import { getMeta, FOLDERS_FP_KEY } from "./db/meta";
import { EMBEDDING_MODEL, MissingApiKeyError } from "./embedder/openai";

interface GroupMeta {
	icon: string;
	title: string;
	desc: string;
}

const GROUP_META: Record<GroupId, GroupMeta> = {
	internal: {
		icon: "📝",
		title: "내부 자료",
		desc: "직접 작성하거나 정리해 둔 메모. 검색 결과 상단(2/3 영역)에 표시됩니다.",
	},
	external: {
		icon: "🔗",
		title: "외부 자료",
		desc: "스크랩·인박스 등 외부에서 들어온 가공 안 된 자료. 하단(1/3 영역)에 표시됩니다.",
	},
};

export class WeightedRecallSettingTab extends PluginSettingTab {
	plugin: WeightedRecallPlugin;

	constructor(app: App, plugin: WeightedRecallPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "A4P Sermon Desk" });

		this.renderApiKey(containerEl);
		this.renderOnboarding(containerEl);

		containerEl.createEl("h3", { text: "📂 검색 대상 폴더 (필수)" });
		containerEl.createEl("p", {
			text: "내부/외부 두 그룹에 폴더를 넣고, 각 폴더의 중요도를 0~10점으로 정하세요. 점수가 높을수록 검색 결과 위로 올라옵니다. 0점이면 그 폴더는 검색에서 빠집니다.",
			cls: "setting-item-description",
		});

		this.renderSyncBanner(containerEl);
		this.renderGroup(containerEl, "internal");
		this.renderGroup(containerEl, "external");
		this.renderExcludedFolders(containerEl);

		containerEl.createEl("h3", { text: "🔎 선택: 태그 검색 강화" });
		containerEl.createEl("p", {
			text: "아래는 선택 사항입니다. 신학 분류로 태그 검색을 더 똑똑하게 만들고 싶을 때 ① → ② → ③ 순서로 설정하세요. 쓰지 않으면 건너뛰어도 검색은 됩니다.",
			cls: "setting-item-description",
		});
		this.renderDoctrineKeywords(containerEl);
		this.renderDoctrineSynonyms(containerEl);
		this.renderTagEmbeddings(containerEl);

		this.renderPerformance(containerEl);
		this.renderResetButton(containerEl);
	}

	private renderOnboarding(containerEl: HTMLElement): void {
		const db = this.plugin.db;
		const folderCount = this.plugin.settings.folders.length;
		let chunks = 0;
		if (db) {
			const row = db.exec("SELECT COUNT(*) FROM chunks")[0];
			chunks = row ? Number(row.values[0][0]) : 0;
		}
		const inSync = db
			? getMeta(db, FOLDERS_FP_KEY) ===
				foldersFingerprint(this.plugin.settings)
			: false;

		const box = containerEl.createDiv({ cls: "wr-sync-banner" });
		box.createEl("p", {
			text: "🚀 시작하기 — 이 순서대로 하세요",
			cls: "wr-onboarding-title",
		});

		let now: string;
		if (folderCount === 0) {
			now =
				"▶ 지금 할 일: 아래 ‘📂 검색 대상 폴더’에서 내 설교·묵상 폴더를 먼저 추가하세요.";
		} else if (!db || chunks === 0 || !inSync) {
			now =
				"▶ 지금 할 일: ‘📂 검색 대상 폴더’의 [전체 재색인] 버튼을 누르세요. (노트를 읽어 들이는 과정이라 몇 분 걸릴 수 있습니다)";
		} else {
			now =
				"✅ 검색 준비 완료! 이제 노트를 작성하면 관련 자료가 옆 패널에 자동으로 추천됩니다. (명령 팔레트 → ‘Open Recall pane’)";
		}
		box.createEl("p", { text: now, cls: "setting-item-description" });

		const ol = box.createEl("ol", { cls: "wr-onboarding-steps" });
		ol.createEl("li", {
			text: "검색할 폴더 추가 — 아래 ‘📂 검색 대상 폴더’ (필수)",
		});
		ol.createEl("li", {
			text: "[전체 재색인] 누르기 — 폴더를 정한 뒤 한 번 (필수)",
		});
		box.createEl("p", {
			text: "※ 문장 의미로 찾는 ‘의미 검색’을 쓰려면 위 ‘🔑 OpenAI API 키’도 입력하세요(없으면 태그 검색만 됩니다). 태그·교리 검색을 더 정확하게 하려면 맨 아래 ‘선택: 태그 검색 강화’를 나중에 설정하세요.",
			cls: "setting-item-description",
		});
	}

	private renderApiKey(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "🔑 OpenAI API 키" });
		const desc = containerEl.createEl("p", {
			cls: "setting-item-description",
		});
		desc.appendText("의미 검색(semantic search)에 사용됩니다. ");
		const link = desc.createEl("a", {
			text: "platform.openai.com/api-keys",
			href: "https://platform.openai.com/api-keys",
		});
		link.setAttr("target", "_blank");
		desc.appendText(
			" 에서 발급받아 입력하세요. 키는 옵시디언의 data.json에 평문으로 저장됩니다 — 다른 사람과 공유 금지.",
		);

		new Setting(containerEl)
			.setName("API 키")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.style.width = "100%";
			})
			.addExtraButton((btn) => {
				let visible = false;
				btn.setIcon("eye")
					.setTooltip("키 보기/숨기기")
					.onClick(() => {
						visible = !visible;
						const input = btn.extraSettingsEl
							.closest(".setting-item")
							?.querySelector(
								"input",
							) as HTMLInputElement | null;
						if (input) input.type = visible ? "text" : "password";
						btn.setIcon(visible ? "eye-off" : "eye");
					});
			});
	}

	private renderPerformance(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "⚡ 성능" });
		new Setting(containerEl)
			.setName("검색 결과를 미리 펼쳐둘까요? (Eager 렌더)")
			.setDesc(
				"끄기(추천·기본): 검색하면 목록이 즉시 뜨고, 카드를 누를 때 그 내용만 잠깐(~0.3초) 불러옵니다. 노트가 많은 분께 좋습니다. 켜기: 검색하자마자 모든 카드 내용을 미리 불러와 펼침이 즉각적이지만, 검색 직후 1~3초 멈칫합니다. 결과를 매번 거의 다 펼쳐보고 컴퓨터가 빠른 분께만 추천합니다.",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.eagerRender)
					.onChange(async (value) => {
						this.plugin.settings.eagerRender = value;
						await this.plugin.saveSettings();
					});
			});
	}

	private renderDoctrineKeywords(containerEl: HTMLElement): void {
		containerEl.createEl("h3", {
			text: "✝️ ① 신학 분류 키워드 (DOCTRINE)",
		});
		containerEl.createEl("p", {
			text: "본인의 DOCTRINE 분류 트리를 아래 박스에 붙여넣으세요. 위키링크 [[키워드]] 또는 큰따옴표 \"키워드\" 형식을 인식하고, 이모지 prefix(🔖 등)는 자동 제거됩니다. 태그 검색에서 의미적으로 가까운 키워드까지 매치하기 위한 어휘로 쓰입니다 (다음 단계에서 임베딩).",
			cls: "setting-item-description",
		});

		const ta = containerEl.createEl("textarea");
		ta.value = this.plugin.settings.doctrineRaw;
		ta.style.width = "100%";
		ta.style.minHeight = "180px";
		ta.style.fontFamily = "var(--font-monospace)";
		ta.style.fontSize = "var(--font-ui-smaller)";
		ta.style.padding = "8px";
		ta.style.marginBottom = "8px";

		const kwCount = this.plugin.settings.doctrineKeywords.length;
		const summary = containerEl.createEl("p", {
			cls: "setting-item-description",
		});
		summary.createSpan({
			text:
				kwCount === 0
					? "아직 인식된 키워드가 없습니다. "
					: `현재 ${kwCount}개 키워드 인식됨. `,
		});
		summary.createSpan({
			text: "키워드를 추가·수정·삭제하려면 위 글상자를 고치고 ‘분석’을 누르세요.",
		});
		containerEl.createEl("p", {
			text: "💡 키워드를 바꿨다면: ‘① 키워드 분석’ → ‘② 동의어 생성’ → ‘③ 교리 키워드 임베딩’ 순서로 누르면 최신 상태가 됩니다.",
			cls: "setting-item-description",
		});

		const card = this.renderEmbedCard(containerEl, "③ 교리 키워드 임베딩");
		let embedBtn: ButtonComponent | null = null;
		const computeCounts = () => {
			const total = this.plugin.settings.doctrineKeywords.length;
			const db = this.plugin.db;
			const embedded = db
				? getEmbeddedKeys(db, "doctrine_embeddings", EMBEDDING_MODEL).size
				: 0;
			const lastAt = db
				? getMaxEmbeddedAt(db, "doctrine_embeddings", EMBEDDING_MODEL)
				: 0;
			return {
				total,
				embedded,
				pending: Math.max(0, total - embedded),
				db,
				lastAt,
			};
		};
		const updateStatus = () => {
			const { total, embedded, pending, lastAt } = computeCounts();
			if (total === 0) card.setState("empty", { done: 0, total: 0 });
			else if (pending === 0)
				card.setState("complete", { done: embedded, total }, lastAt);
			else card.setState("pending", { done: embedded, total });
		};
		const refreshBtn = () => {
			if (!embedBtn) return;
			// 동의어 포함 임베딩이라 매번 전체 재생성 — pending과 무관하게 활성.
			const { total, db } = computeCounts();
			embedBtn
				.setButtonText("③ 교리 키워드 임베딩 (전체 갱신)")
				.setDisabled(total === 0 || !db);
		};
		updateStatus();

		new Setting(containerEl)
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText("① 키워드 분석")
					.setCta()
					.onClick(async () => {
						const raw = ta.value;
						const parsed = parseDoctrineRaw(raw);
						this.plugin.settings.doctrineRaw = raw;
						this.plugin.settings.doctrineKeywords = parsed;
						await this.plugin.saveSettings();
						new Notice(
							`A4P Sermon Desk: ${parsed.length}개 키워드 인식됨`,
						);
						this.display();
					});
			})
			.addButton((btn: ButtonComponent) => {
				embedBtn = btn;
				refreshBtn();
				btn.onClick(async () => {
					const db = this.plugin.db;
					if (!db) return;
					const apiKey = this.plugin.settings.openaiApiKey;
					btn.setDisabled(true);
					try {
						const res = await embedDoctrineKeys(
							db,
							this.plugin.settings.doctrineKeywords,
							apiKey,
							this.plugin.settings.doctrineSynonyms,
							(p: LexiconProgress) => {
								btn.setButtonText(`임베딩 중 ${p.done}/${p.total}`);
								card.setState("running", {
									done: p.done,
									total: p.total,
								});
							},
						);
						await this.plugin.persistDb();
						new Notice(
							`DOCTRINE 임베딩 완료: ${res.embedded}개 재생성`,
						);
					} catch (e) {
						if (e instanceof MissingApiKeyError) {
							new Notice(e.message);
						} else {
							console.error("[a4p-sermon-desk] doctrine embed", e);
							new Notice(
								`DOCTRINE 임베딩 실패: ${e instanceof Error ? e.message : String(e)}`,
							);
						}
					} finally {
						updateStatus();
						refreshBtn();
					}
				});
			});
	}

	private renderDoctrineSynonyms(containerEl: HTMLElement): void {
		containerEl.createEl("h3", {
			text: "🔁 ② 동의어 자동 생성",
		});
		containerEl.createEl("p", {
			text: "등록한 신학 분류 키워드마다 본문에서 실제로 쓰이는 유사 표현을 AI(gpt-4o-mini)가 자동 생성합니다. 예: '중생' → '거듭남, 새로 태어남'. 본문에 '거듭남'이라고 쓰면 '중생'으로 분류된 노트가 매치됩니다. (동의어는 본문 텍스트 매칭에 쓰이며, 키워드 임베딩과는 별개입니다.)",
			cls: "setting-item-description",
		});

		const synAll = this.plugin.settings.doctrineSynonyms;
		const synKeyN = Object.values(synAll).filter((a) => a.length > 0).length;
		const synTotal = Object.values(synAll).reduce(
			(a, arr) => a + arr.length,
			0,
		);
		containerEl.createEl("p", {
			text:
				synTotal === 0
					? "아직 생성된 동의어가 없습니다."
					: `📊 ${synKeyN}개 키워드에 총 ${synTotal}개 동의어가 등록됨 (키워드당 평균 ${(
							synTotal / Math.max(1, synKeyN)
						).toFixed(1)}개). 아래 카드의 ‘N/N’은 동의어가 붙은 키워드 수입니다 — 동의어 개수가 아닙니다.`,
			cls: "setting-item-description",
		});

		const card = this.renderEmbedCard(containerEl, "② 동의어 생성");
		let genBtn: ButtonComponent | null = null;
		const computeCounts = () => {
			const total = this.plugin.settings.doctrineKeywords.length;
			const syn = this.plugin.settings.doctrineSynonyms;
			const done = this.plugin.settings.doctrineKeywords.filter(
				(k) => (syn[k]?.length ?? 0) > 0,
			).length;
			return { total, done, pending: Math.max(0, total - done) };
		};
		const updateStatus = () => {
			const { total, done, pending } = computeCounts();
			if (total === 0) card.setState("empty", { done: 0, total: 0 });
			else if (pending === 0)
				card.setState("complete", { done, total });
			else card.setState("pending", { done, total });
		};
		const refreshBtn = () => {
			if (!genBtn) return;
			const { total, pending } = computeCounts();
			if (!this.plugin.db) {
				genBtn.setButtonText("② 동의어 — DB 로드 전").setDisabled(true);
			} else if (total === 0) {
				genBtn
					.setButtonText("② 동의어 — 먼저 ① 키워드 분석")
					.setDisabled(true);
			} else if (pending === 0) {
				genBtn.setButtonText("② 동의어 (최신)").setDisabled(true);
			} else {
				genBtn
					.setButtonText(`② 동의어 생성하기 (남은 ${pending}개)`)
					.setDisabled(false);
			}
		};
		updateStatus();

		new Setting(containerEl).addButton((btn: ButtonComponent) => {
			genBtn = btn;
			refreshBtn();
			btn.onClick(async () => {
				const apiKey = this.plugin.settings.openaiApiKey;
				const startDone = computeCounts().done;
				btn.setDisabled(true);
				try {
					const result = await generateDoctrineSynonyms(
						this.plugin.settings.doctrineKeywords,
						apiKey,
						this.plugin.settings.doctrineSynonyms,
						(p: SynonymProgress) => {
							btn.setButtonText(`생성 중 ${p.done}/${p.total}`);
							card.setState("running", {
								done: startDone + p.done,
								total: startDone + p.total,
							});
						},
					);
					this.plugin.settings.doctrineSynonyms = result;
					await this.plugin.saveSettings();
					const count = Object.keys(result).length;
					const words = Object.values(result).reduce(
						(a, arr) => a + arr.length,
						0,
					);
					new Notice(
						`동의어 생성 완료: ${count}개 키워드에 총 ${words}개 동의어 등록됨`,
					);
					this.display();
				} catch (e) {
					if (e instanceof MissingApiKeyError) {
						new Notice(e.message);
					} else {
						console.error("[a4p-sermon-desk] synonym gen", e);
						new Notice(
							`동의어 생성 실패: ${e instanceof Error ? e.message : String(e)}`,
						);
					}
				} finally {
					updateStatus();
					refreshBtn();
				}
			});
		});
	}

	private renderTagEmbeddings(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "🏷️ 볼트 태그 임베딩 (DOCTRINE과 별개)" });
		containerEl.createEl("p", {
			text: "노트의 #태그·태그 위키링크를 임베딩해 검색 시 의미가 가까운 태그까지 매치합니다. 위 ①②③(교리 키워드)와 무관하게 독립적으로 쓸 수 있습니다. 노트에 새 태그를 달고 ‘전체 재색인’을 하면 아래 ‘대기 N개’가 늘어납니다 — 그때 이 버튼을 누르세요.",
			cls: "setting-item-description",
		});

		const card = this.renderEmbedCard(containerEl, "볼트 태그 임베딩");
		let embedBtn: ButtonComponent | null = null;
		const computeCounts = () => {
			const db = this.plugin.db;
			if (!db)
				return { total: 0, embedded: 0, pending: 0, db: null, lastAt: 0 };
			const total = getDistinctTagKeys(db).length;
			const embedded = getEmbeddedKeys(db, "tag_embeddings", EMBEDDING_MODEL)
				.size;
			const lastAt = getMaxEmbeddedAt(db, "tag_embeddings", EMBEDDING_MODEL);
			return {
				total,
				embedded,
				pending: Math.max(0, total - embedded),
				db,
				lastAt,
			};
		};
		const updateStatus = () => {
			const { total, embedded, pending, lastAt } = computeCounts();
			if (total === 0) card.setState("empty", { done: 0, total: 0 });
			else if (pending === 0)
				card.setState("complete", { done: embedded, total }, lastAt);
			else card.setState("pending", { done: embedded, total });
		};
		const refreshBtn = () => {
			if (!embedBtn) return;
			const { total, pending, db } = computeCounts();
			if (!db) {
				embedBtn.setButtonText("태그 임베딩 — DB 로드 전").setDisabled(true);
			} else if (total === 0) {
				embedBtn
					.setButtonText("태그 임베딩 — 먼저 전체 재색인")
					.setDisabled(true);
			} else if (pending === 0) {
				embedBtn.setButtonText("태그 임베딩 (최신)").setDisabled(true);
			} else {
				embedBtn
					.setButtonText(`태그 임베딩하기 (대기 ${pending}개)`)
					.setDisabled(false);
			}
		};
		updateStatus();

		new Setting(containerEl).addButton((btn: ButtonComponent) => {
			embedBtn = btn;
			refreshBtn();
			btn.onClick(async () => {
				const db = this.plugin.db;
				if (!db) return;
				const apiKey = this.plugin.settings.openaiApiKey;
				const startEmbedded = computeCounts().embedded;
				btn.setDisabled(true);
				try {
					const res = await embedTagKeys(
						db,
						apiKey,
						(p: LexiconProgress) => {
							btn.setButtonText(`임베딩 중 ${p.done}/${p.total}`);
							card.setState("running", {
								done: startEmbedded + p.done,
								total: startEmbedded + p.total,
							});
						},
					);
					await this.plugin.persistDb();
					new Notice(
						`태그 임베딩 완료: ${res.embedded}개 신규 / ${res.skipped}개 기존`,
					);
				} catch (e) {
					if (e instanceof MissingApiKeyError) {
						new Notice(e.message);
					} else {
						console.error("[a4p-sermon-desk] tag embed", e);
						new Notice(
							`태그 임베딩 실패: ${e instanceof Error ? e.message : String(e)}`,
						);
					}
				} finally {
					updateStatus();
					refreshBtn();
				}
			});
		});
	}

	private renderEmbedCard(
		parent: HTMLElement,
		defaultTitle: string,
	): {
		setState: (
			state: "empty" | "pending" | "running" | "complete",
			counts: { done: number; total: number },
			lastAt?: number,
		) => void;
	} {
		const card = parent.createDiv({ cls: "wr-embed-card is-pending" });
		const head = card.createDiv({ cls: "wr-embed-head" });
		const iconEl = head.createSpan({ cls: "wr-embed-icon", text: "⚠️" });
		const titleEl = head.createSpan({ text: defaultTitle });
		const progressEl = card.createEl(
			"progress",
			{ cls: "wr-embed-progress" },
		) as HTMLProgressElement;
		progressEl.max = 1;
		progressEl.value = 0;
		const meta = card.createDiv({ cls: "wr-embed-meta" });
		const countEl = meta.createSpan({ text: "" });
		const timeEl = meta.createSpan({ text: "" });

		const fmtTime = (ts: number): string => {
			if (!ts) return "";
			const diffSec = Math.floor((Date.now() - ts) / 1000);
			if (diffSec < 60) return "마지막 갱신: 방금 전";
			if (diffSec < 3600)
				return `마지막 갱신: ${Math.floor(diffSec / 60)}분 전`;
			if (diffSec < 86400)
				return `마지막 갱신: ${Math.floor(diffSec / 3600)}시간 전`;
			const d = new Date(ts);
			return `마지막 갱신: ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		};

		const setState: (
			state: "empty" | "pending" | "running" | "complete",
			counts: { done: number; total: number },
			lastAt?: number,
		) => void = (state, counts, lastAt) => {
			card.removeClass("is-empty");
			card.removeClass("is-pending");
			card.removeClass("is-running");
			card.removeClass("is-complete");
			card.addClass(`is-${state}`);
			const { done, total } = counts;
			progressEl.max = Math.max(1, total);
			progressEl.value = done;
			switch (state) {
				case "empty":
					iconEl.setText("⚠️");
					titleEl.setText(`${defaultTitle} — 등록된 키 없음`);
					countEl.setText("");
					break;
				case "pending":
					iconEl.setText("⏳");
					titleEl.setText(`${defaultTitle} — 대기`);
					countEl.setText(`${done} / ${total}`);
					break;
				case "running":
					iconEl.setText("🔄");
					titleEl.setText(`${defaultTitle} — 진행 중`);
					countEl.setText(`${done} / ${total}`);
					break;
				case "complete":
					iconEl.setText("✅");
					titleEl.setText(`${defaultTitle} — 완료`);
					countEl.setText(`${done} / ${total}`);
					break;
			}
			timeEl.setText(state === "complete" && lastAt ? fmtTime(lastAt) : "");
		};

		return { setState };
	}

	private renderSyncBanner(containerEl: HTMLElement): void {
		const db = this.plugin.db;
		const inSync = db
			? getMeta(db, FOLDERS_FP_KEY) ===
				foldersFingerprint(this.plugin.settings)
			: false;
		const banner = containerEl.createDiv({ cls: "wr-sync-banner" });
		banner.createEl("p", {
			text: inSync
				? "✅ 폴더·가중치 설정이 검색 인덱스와 일치합니다."
				: "⚠️ 폴더·가중치를 바꿨습니다. 아래 ‘변경사항 적용’을 눌러야 검색에 반영됩니다.",
			cls: "setting-item-description",
		});
		new Setting(banner)
			.addButton((btn) => {
				btn.setButtonText("변경사항 적용 (재색인 없이)")
					.setCta()
					.onClick(async () => {
						await this.plugin.runReapply();
						this.display();
					});
			})
			.addButton((btn) => {
				btn.setButtonText("전체 재색인")
					.setTooltip(
						"새 폴더를 추가했거나 처음 설정할 때 (시간이 걸립니다)",
					)
					.onClick(async () => {
						btn.setButtonText("전체 재색인 중…").setDisabled(true);
						await this.plugin.runReindex();
						this.display();
					});
			});
	}

	private renderGroup(containerEl: HTMLElement, groupId: GroupId): void {
		const meta = GROUP_META[groupId];
		const groupEl = containerEl.createDiv({
			cls: `wr-group wr-group-${groupId}`,
		});

		const header = groupEl.createDiv({ cls: "wr-group-header" });
		header.createSpan({ text: meta.icon, cls: "wr-group-icon" });
		header.createSpan({ text: meta.title });

		groupEl.createEl("p", { text: meta.desc, cls: "wr-group-desc" });

		const list = groupEl.createDiv({ cls: "wr-cat-list" });
		const folders = this.plugin.settings.folders.filter(
			(f) => f.groupId === groupId,
		);

		if (folders.length === 0) {
			list.createEl("p", {
				text: "(이 그룹에 폴더가 없습니다)",
				cls: "setting-item-description",
			});
		} else {
			folders.forEach((folder) => this.renderFolderRow(list, folder));
		}

		this.renderAddFolderRow(groupEl, groupId);
	}

	private renderFolderRow(
		containerEl: HTMLElement,
		folder: FolderEntry,
	): void {
		const fmt = (w: number) => (w === 0 ? "0 · 제외" : `${w}`);
		const setting = new Setting(containerEl).setName(folder.path);
		const valueLabel = setting.controlEl.createSpan({
			cls: "weighted-recall-value",
		});
		setting.addSlider((slider) => {
			slider
				.setLimits(WEIGHT_MIN, WEIGHT_MAX, WEIGHT_STEP)
				.setValue(folder.weight)
				.setDynamicTooltip()
				.onChange(async (value) => {
					folder.weight = value;
					valueLabel.setText(fmt(value));
					await this.plugin.saveSettings();
				});
		});
		valueLabel.setText(fmt(folder.weight));
		valueLabel.style.minWidth = "3.5em";
		valueLabel.style.textAlign = "right";
		valueLabel.style.marginLeft = "0.5em";
		setting.addExtraButton((btn) => {
			const target: GroupId =
				folder.groupId === "internal" ? "external" : "internal";
			btn.setIcon(
				folder.groupId === "internal" ? "arrow-down" : "arrow-up",
			)
				.setTooltip(`'${GROUP_META[target].title}'로 이동`)
				.onClick(async () => {
					folder.groupId = target;
					await this.plugin.saveSettings();
					this.display();
				});
		});
		setting.addExtraButton((btn) => {
			btn.setIcon("trash-2")
				.setTooltip("이 폴더 제거")
				.onClick(async () => {
					this.plugin.settings.folders =
						this.plugin.settings.folders.filter(
							(f) => f.path !== folder.path,
						);
					await this.plugin.saveSettings();
					this.display();
				});
		});
	}

	private renderAddFolderRow(groupEl: HTMLElement, groupId: GroupId): void {
		const meta = GROUP_META[groupId];
		const addEl = groupEl.createDiv({ cls: "wr-cat-add" });
		let textComp: TextComponent;
		new Setting(addEl)
			.setName(`＋ ${meta.title}에 폴더 추가`)
			.setDesc("폴더 경로를 입력하고 ‘추가’. 새 폴더는 기본 5점으로 들어갑니다.")
			.addText((text) => {
				textComp = text;
				text.setPlaceholder("폴더 경로 입력...");
				new FolderSuggest(this.app, text.inputEl);
			})
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText("추가")
					.setCta()
					.onClick(async () => {
						const path = textComp.getValue().trim();
						if (!path) return;
						const conflict = this.plugin.settings.folders.find(
							(f) => f.path === path,
						);
						if (conflict) {
							new Notice(
								`이미 등록된 폴더입니다 (${
									conflict.groupId === "external"
										? "외부"
										: "내부"
								}).`,
							);
							return;
						}
						this.plugin.settings.folders.push({
							path,
							groupId,
							weight: DEFAULT_WEIGHT,
						});
						textComp.setValue("");
						await this.plugin.saveSettings();
						this.display();
					});
			});
	}

	private renderExcludedFolders(containerEl: HTMLElement): void {
		const groupEl = containerEl.createDiv({
			cls: "wr-group wr-group-excluded",
		});

		const header = groupEl.createDiv({ cls: "wr-group-header" });
		header.createSpan({ text: "🚫", cls: "wr-group-icon" });
		header.createSpan({ text: "제외 폴더" });

		groupEl.createEl("p", {
			text: "여기 등록된 경로로 시작하는 폴더는 인덱싱·검색에서 완전히 빠집니다.",
			cls: "wr-group-desc",
		});

		const list = groupEl.createDiv({ cls: "wr-cat-list" });
		if (this.plugin.settings.excludedFolders.length === 0) {
			list.createEl("p", {
				text: "(제외 폴더 없음)",
				cls: "setting-item-description",
			});
		} else {
			this.plugin.settings.excludedFolders.forEach((path, index) => {
				const card = list.createDiv({ cls: "wr-cat-card" });
				new Setting(card).setName(path).addExtraButton((btn) => {
					btn.setIcon("trash-2")
						.setTooltip("제외 목록에서 제거")
						.onClick(async () => {
							this.plugin.settings.excludedFolders.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
						});
				});
			});
		}

		const addEl = groupEl.createDiv({ cls: "wr-cat-add" });
		let textComp: TextComponent;
		new Setting(addEl)
			.setName("새 제외 폴더 추가")
			.addText((text) => {
				textComp = text;
				text.setPlaceholder("폴더 경로 입력...");
				new FolderSuggest(this.app, text.inputEl);
			})
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText("추가")
					.setCta()
					.onClick(async () => {
						const path = textComp.getValue().trim();
						if (!path) return;
						if (this.plugin.settings.excludedFolders.includes(path)) {
							new Notice("이미 제외 목록에 있는 폴더입니다.");
							return;
						}
						this.plugin.settings.excludedFolders.push(path);
						textComp.setValue("");
						await this.plugin.saveSettings();
						this.display();
					});
			});
	}

	private renderResetButton(containerEl: HTMLElement): void {
		containerEl.createEl("h3", { text: "초기화" });
		new Setting(containerEl)
			.setName("기본값으로 되돌리기")
			.setDesc(
				"모든 폴더·가중치·제외 목록을 초기 권장값으로 되돌립니다. (되돌린 뒤 ‘변경사항 적용’을 눌러주세요.)",
			)
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText("초기화")
					.setWarning()
					.onClick(async () => {
						this.plugin.settings = JSON.parse(
							JSON.stringify(DEFAULT_SETTINGS),
						);
						await this.plugin.saveSettings();
						this.display();
					});
			});
	}
}
