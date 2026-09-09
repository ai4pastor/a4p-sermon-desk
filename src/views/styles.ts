export const WR_STYLES = `
.wr-root {
	padding: 0;
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
}
.wr-mount {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}
.wr-h {
	margin: 0 0 4px;
	font-size: var(--font-ui-medium);
	font-weight: 600;
	color: var(--text-normal);
}
.wr-status {
	margin: 0 0 12px;
	color: var(--text-muted);
	font-size: var(--font-ui-smaller);
}
.wr-controls {
	display: flex;
	gap: 6px;
	margin: 0 0 8px;
}
.wr-profile-row {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 6px;
	margin: 0 0 8px;
}
.wr-profile-label {
	font-size: var(--font-ui-smaller);
	color: var(--text-muted);
}
.wr-profile-chip {
	display: inline-flex;
	align-items: center;
	padding: 2px 10px;
	font-size: var(--font-ui-smaller);
	background: var(--background-secondary);
	color: var(--text-muted);
	border: 1px solid var(--background-modifier-border);
	border-radius: 12px;
	cursor: pointer;
	transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.wr-profile-chip:hover {
	background: var(--background-modifier-hover);
	border-color: var(--background-modifier-border-hover);
}
.wr-profile-chip.is-active {
	border-color: var(--interactive-accent);
	color: var(--interactive-accent);
	background: var(--background-modifier-hover);
	font-weight: 600;
}
.wr-btn-pause, .wr-btn-refresh, .wr-btn-mode {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 4px 10px;
	font-size: var(--font-ui-smaller);
	background: var(--background-secondary);
	color: var(--text-normal);
	border: 1px solid var(--background-modifier-border);
	border-radius: 4px;
	cursor: pointer;
	transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.wr-btn-pause:hover, .wr-btn-refresh:hover, .wr-btn-mode:hover {
	background: var(--background-modifier-hover);
	border-color: var(--background-modifier-border-hover);
}
.wr-btn-pause.is-paused {
	border-color: var(--text-accent);
	color: var(--text-accent);
}
.wr-btn-mode-semantic.is-active {
	border-color: var(--interactive-accent);
	color: var(--interactive-accent);
	background: var(--background-modifier-hover);
	font-weight: 600;
}
.wr-btn-mode-tag.is-active {
	border-color: var(--color-cyan, #5fb3b3);
	color: var(--color-cyan, #5fb3b3);
	background: var(--background-modifier-hover);
	font-weight: 600;
}
.wr-btn-mode-chat.is-active {
	border-color: var(--color-purple, #a882ff);
	color: var(--color-purple, #a882ff);
	background: var(--background-modifier-hover);
	font-weight: 600;
}
.wr-btn-pause svg, .wr-btn-refresh svg, .wr-btn-mode svg {
	width: 14px;
	height: 14px;
}
.wr-relevance {
	display: flex;
	align-items: center;
	gap: 10px;
	margin: 0 0 12px;
	padding: 10px 12px;
	background: var(--background-secondary);
	border-radius: 10px;
	font-size: var(--font-ui-smaller);
	color: var(--text-muted);
}
.wr-relevance-label {
	font-weight: 700;
	color: var(--text-normal);
	letter-spacing: 0.2px;
	font-size: 13px;
	padding: 4px 10px;
	border-radius: 4px;
	background: var(--background-modifier-border);
}
.wr-relevance-end {
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.3px;
	padding: 2px 8px;
	border-radius: 999px;
}
.wr-relevance-end-strict {
	background: #f87171;
	color: #fff;
}
.wr-relevance-end-loose {
	background: #fcd34d;
	color: #78350f;
}
.wr-relevance-slider {
	flex: 1;
	cursor: pointer;
	-webkit-appearance: none;
	appearance: none;
	height: 6px;
	background: linear-gradient(to right, #f87171 0%, #fcd34d 100%);
	border-radius: 3px;
	outline: none;
}
.wr-relevance-slider::-webkit-slider-thumb {
	-webkit-appearance: none;
	width: 18px;
	height: 18px;
	border-radius: 50%;
	background: var(--background-primary);
	border: 2px solid var(--text-normal);
	cursor: pointer;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
	transition: transform 0.12s ease;
}
.wr-relevance-slider::-webkit-slider-thumb:hover {
	transform: scale(1.18);
}
.wr-relevance-slider::-moz-range-thumb {
	width: 18px;
	height: 18px;
	border-radius: 50%;
	background: var(--background-primary);
	border: 2px solid var(--text-normal);
	cursor: pointer;
	box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}
.wr-relevance-value {
	font-family: var(--font-monospace);
	min-width: 26px;
	text-align: center;
	font-weight: 700;
	font-size: 12px;
	padding: 3px 8px;
	background: #fb923c;
	color: #fff;
	border-radius: 6px;
}
.wr-list {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.wr-tabs {
	flex: 0 0 auto;
	display: flex;
	gap: 4px;
	margin-bottom: 8px;
	border-bottom: 1px solid var(--background-modifier-border);
}
.wr-tab-btn {
	flex: 1;
	padding: 8px 12px;
	background: transparent;
	color: var(--text-muted);
	border: none;
	border-bottom: 2px solid transparent;
	cursor: pointer;
	font-size: var(--font-ui-smaller);
	font-weight: 500;
	transition: color 0.12s ease, border-color 0.12s ease;
	margin-bottom: -1px;
}
.wr-tab-btn:hover { color: var(--text-normal); }
.wr-tab-btn.is-active {
	color: var(--text-normal);
	font-weight: 600;
}
.wr-tab-internal.is-active {
	border-bottom-color: var(--interactive-accent);
}
.wr-tab-external.is-active {
	border-bottom-color: var(--color-red, #e05c5c);
}
.wr-tab-content {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding-right: 4px;
}
.wr-empty-section {
	color: var(--text-muted);
	font-size: var(--font-ui-smaller);
	padding: 12px;
	text-align: center;
	font-style: italic;
}
.wr-hidden { display: none !important; }
.wr-card {
	position: relative;
	padding: 10px 12px 10px 16px;
	border: 1px solid var(--background-modifier-border);
	border-radius: 8px;
	background: var(--background-primary);
	cursor: pointer;
	transition: background-color 0.12s ease, border-color 0.12s ease;
	display: flex;
	gap: 10px;
	align-items: flex-start;
}
.wr-card::before {
	content: '';
	position: absolute;
	left: 5px;
	top: 8px;
	bottom: 8px;
	width: 3px;
	border-radius: 2px;
	background: var(--text-faint);
}
.wr-card-internal::before {
	background: var(--interactive-accent);
}
.wr-card-external::before {
	background: var(--color-red, #e05c5c);
}
.wr-card.wr-card-pinned,
.wr-card.wr-card-pinned:hover {
	border-color: var(--color-red, #e05c5c);
}
.wr-pin-section {
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding-right: 4px;
}
.wr-tabs-wrap {
	min-height: 0;
	display: flex;
	flex-direction: column;
}
.wr-resize-handle {
	flex: 0 0 auto;
	height: 8px;
	cursor: row-resize;
	background: var(--background-modifier-border);
	border-radius: 2px;
	margin: 4px 0;
	position: relative;
	transition: background-color 0.15s ease;
}
.wr-resize-handle:hover,
.wr-resize-handle.is-dragging {
	background: var(--interactive-accent);
}
.wr-resize-handle::before {
	content: '';
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	width: 32px;
	height: 2px;
	background: var(--text-faint);
	border-radius: 1px;
}
.wr-noselect { user-select: none !important; }
.wr-pin-header {
	font-size: var(--font-ui-smaller);
	color: var(--text-muted);
	font-weight: 600;
	margin: 0 0 2px;
	letter-spacing: 0.02em;
}
.wr-pin-divider {
	border-top: 1px solid var(--background-modifier-border);
	margin: 0 0 8px;
}
.wr-pin-marker {
	position: absolute;
	top: 6px;
	right: 8px;
	font-size: 11px;
	color: var(--color-red, #e05c5c);
	pointer-events: none;
	line-height: 1;
}
.wr-rank-pin {
	background: var(--color-red, #e05c5c);
	color: var(--text-on-accent);
	font-size: 11px;
}
.wr-actions {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
	align-items: center;
	margin-top: 4px;
}
.wr-pin-btn,
.wr-link-btn {
	padding: 4px 10px;
	font-size: 11px;
	background: var(--background-secondary);
	color: var(--text-normal);
	border: 1px solid var(--background-modifier-border);
	border-radius: 4px;
	cursor: pointer;
	transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.wr-pin-btn:hover,
.wr-link-btn:hover {
	background: var(--background-modifier-hover);
	border-color: var(--background-modifier-border-hover);
}
.wr-pin-btn.is-pinned {
	border-color: var(--color-red, #e05c5c);
	color: var(--color-red, #e05c5c);
}
.wr-card:hover {
	background: var(--background-modifier-hover);
	border-color: var(--background-modifier-border-hover);
}
.wr-card-expanded,
.wr-card-expanded:hover {
	background: var(--background-secondary);
	border-color: var(--interactive-accent);
}
.wr-rank {
	flex: 0 0 auto;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	background: var(--background-modifier-border);
	color: var(--text-muted);
	font-size: 11px;
	font-weight: 600;
	display: flex;
	align-items: center;
	justify-content: center;
	margin-top: 1px;
}
.wr-card-expanded .wr-rank {
	background: var(--interactive-accent);
	color: var(--text-on-accent);
}
.wr-body {
	flex: 1 1 auto;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.wr-title {
	font-weight: 600;
	color: var(--text-normal);
	font-size: var(--font-ui-small);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.wr-heading {
	display: inline-block;
	align-self: flex-start;
	padding: 1px 6px;
	border-radius: 4px;
	background: var(--background-modifier-border);
	color: var(--text-muted);
	font-size: 10px;
	line-height: 1.5;
}
.wr-path {
	color: var(--text-faint);
	font-size: 10px;
	line-height: 1.4;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.wr-keychips {
	display: flex;
	flex-wrap: wrap;
	gap: 3px;
	margin-top: 2px;
}
.wr-keychip {
	display: inline-flex;
	align-items: center;
	padding: 0 6px;
	border-radius: 8px;
	font-size: 10px;
	line-height: 1.6;
	background: var(--background-modifier-border);
	color: var(--text-muted);
}
.wr-keychip-dExact, .wr-keychip-dSyn {
	color: var(--interactive-accent);
	background: var(--background-modifier-hover);
	border: 1px solid var(--interactive-accent);
}
.wr-keychip-tExact {
	color: var(--color-cyan, #5fb3b3);
	background: var(--background-modifier-hover);
	border: 1px solid var(--color-cyan, #5fb3b3);
}
/* 벡터 발견 키 — 텍스트에 없는데 의미로 찾아낸 키임을 점선으로 구분 */
.wr-keychip.is-vec {
	border-style: dashed;
}
.wr-keychip-dVec {
	color: var(--interactive-accent);
	background: transparent;
	border: 1px dashed var(--interactive-accent);
}
.wr-keychip-tVec {
	color: var(--color-cyan, #5fb3b3);
	background: transparent;
	border: 1px dashed var(--color-cyan, #5fb3b3);
}
.wr-keychip-more {
	font-size: 10px;
	color: var(--text-faint);
	align-self: center;
}
.wr-preview {
	color: var(--text-muted);
	font-size: var(--font-ui-smaller);
	line-height: 1.45;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
.wr-fulltext {
	color: var(--text-normal);
	font-size: var(--font-ui-smaller);
	line-height: 1.55;
	padding: 8px 10px;
	background: var(--background-primary);
	border: 1px solid var(--background-modifier-border);
	border-radius: 6px;
}
.wr-md p { margin: 0 0 6px; }
.wr-md p:last-child { margin-bottom: 0; }
.wr-md ul, .wr-md ol { margin: 4px 0 6px; padding-left: 20px; }
.wr-md li { margin: 2px 0; }
.wr-md blockquote {
	margin: 4px 0;
	padding-left: 8px;
	border-left: 2px solid var(--background-modifier-border);
	color: var(--text-muted);
}
.wr-md code {
	font-size: 0.9em;
	background: var(--background-modifier-border);
	padding: 1px 4px;
	border-radius: 3px;
}
.wr-md a.internal-link {
	color: var(--text-accent);
	text-decoration: none;
}
.wr-md a.internal-link:hover {
	text-decoration: underline;
}
.wr-mark {
	background: var(--text-highlight-bg, rgba(255, 208, 0, 0.35));
	color: var(--text-normal);
	font-weight: 600;
	border-radius: 2px;
	padding: 0 1px;
}
.wr-open-btn {
	margin-top: 4px;
	align-self: flex-start;
	padding: 4px 10px;
	font-size: 11px;
	background: var(--interactive-accent);
	color: var(--text-on-accent);
	border: none;
	border-radius: 4px;
	cursor: pointer;
	transition: opacity 0.12s ease;
}
.wr-open-btn:hover {
	opacity: 0.85;
}
.wr-meta {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-top: 2px;
	color: var(--text-faint);
	font-size: 11px;
}
.wr-category {
	color: var(--text-muted);
}
.wr-weight {
	color: var(--text-accent);
	font-weight: 500;
}
.wr-flags {
	font-family: var(--font-monospace);
	color: var(--text-faint);
	letter-spacing: 0.02em;
}
/* ── 🔬 분석: 점수 막대 ── */
.wr-score {
	margin: 5px 0 2px;
	font-size: 10px;
	color: var(--text-faint);
	cursor: default;
}
.wr-score-row {
	display: flex;
	align-items: center;
	gap: 6px;
}
.wr-score-track {
	flex: 1;
	display: flex;
	height: 6px;
	border-radius: 3px;
	background: var(--background-modifier-border);
	overflow: hidden;
}
.wr-score-seg {
	display: block;
	height: 100%;
	transition: width 0.25s ease;
}
.wr-score-seg-lex {
	background: var(--interactive-accent);
}
.wr-score-seg-sem {
	background: var(--color-cyan, #5fb3b3);
}
.wr-score-pct {
	min-width: 3.2ch;
	text-align: right;
	font-family: var(--font-monospace);
	color: var(--text-muted);
}
.wr-score-mults {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 3px 6px;
	margin-top: 3px;
}
.wr-score-legend {
	display: inline-flex;
	align-items: center;
	gap: 3px;
}
.wr-score-dot {
	display: inline-block;
	width: 7px;
	height: 7px;
	border-radius: 2px;
}
.wr-score-mult {
	font-family: var(--font-monospace);
	padding: 0 4px;
	border: 1px solid var(--background-modifier-border);
	border-radius: 6px;
	line-height: 1.5;
	color: var(--text-muted);
}
/* ── 🔬 분석: 왜 이 결과? ── */
.wr-why {
	margin: 2px 0 0;
	font-size: 11px;
	color: var(--text-muted);
	cursor: default;
}
.wr-why > summary {
	cursor: pointer;
	list-style: none;
	color: var(--text-accent);
	font-size: 11px;
	user-select: none;
}
.wr-why > summary::-webkit-details-marker {
	display: none;
}
.wr-why > summary::before {
	content: "▸ ";
	color: var(--text-faint);
}
.wr-why[open] > summary::before {
	content: "▾ ";
}
.wr-why-body {
	margin: 4px 0 2px;
	padding: 6px 8px;
	border-left: 2px solid var(--background-modifier-border);
	display: grid;
	gap: 4px;
}
.wr-why-row {
	display: grid;
	grid-template-columns: 7.5em 1fr;
	gap: 0 8px;
	align-items: baseline;
}
.wr-why-label {
	color: var(--text-faint);
	white-space: nowrap;
}
.wr-why-value {
	color: var(--text-normal);
	word-break: keep-all;
	overflow-wrap: anywhere;
}
.wr-why-muted {
	color: var(--text-faint);
}
.wr-why-note {
	color: var(--text-faint);
	font-style: italic;
}
.wr-why-terms {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 3px;
	vertical-align: middle;
}
.wr-why-term {
	display: inline-flex;
	padding: 0 6px;
	border-radius: 8px;
	font-size: 10px;
	line-height: 1.6;
	background: var(--background-modifier-hover);
	color: var(--interactive-accent);
	border: 1px solid var(--interactive-accent);
}
.wr-why-meter {
	display: inline-block;
	width: 64px;
	height: 4px;
	margin-left: 6px;
	vertical-align: middle;
	border-radius: 2px;
	background: var(--background-modifier-border);
	overflow: hidden;
}
.wr-why-meter > span {
	display: block;
	height: 100%;
	background: var(--color-cyan, #5fb3b3);
}
.wr-why-keys {
	display: grid;
	gap: 2px;
}
.wr-why-key b {
	font-weight: 600;
	color: var(--text-normal);
}
.wr-why-w {
	font-family: var(--font-monospace);
	color: var(--text-accent);
}
.wr-chip-analysis {
	margin-left: auto;
}
/* ── 🔬 분석: 쿼리 요약 헤더 ── */
.wr-query-summary {
	margin: 0 0 6px;
	padding: 6px 8px;
	border-radius: 6px;
	background: var(--background-secondary);
	font-size: 11px;
	color: var(--text-muted);
	display: grid;
	gap: 3px;
}
.wr-qs-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 3px 6px;
}
.wr-qs-label {
	color: var(--text-faint);
	white-space: nowrap;
	min-width: 4.5em;
}
.wr-qs-text {
	color: var(--text-normal);
	word-break: keep-all;
	overflow-wrap: anywhere;
}
.wr-qs-muted {
	color: var(--text-faint);
}
/* ── 채팅 출처 카드 보강 ── */
.wr-chat-source-snippet {
	margin-top: 2px;
	font-size: 11px;
	line-height: 1.45;
	color: var(--text-muted);
	word-break: keep-all;
	overflow-wrap: anywhere;
}
.wr-chat-source-actions {
	display: flex;
	flex-direction: column;
	gap: 2px;
	align-self: flex-start;
}
.wr-chat-source-insert {
	background: transparent;
	border: none;
	box-shadow: none;
	padding: 0 4px;
	cursor: pointer;
	color: var(--text-faint);
	font-size: 12px;
}
.wr-chat-source-insert:hover {
	color: var(--text-accent);
}
.wr-sibling-chip {
	display: inline-flex;
	align-items: center;
	margin: 2px 0 0;
	padding: 0 6px;
	border-radius: 8px;
	font-size: 10px;
	line-height: 1.6;
	color: var(--text-muted);
	background: var(--background-modifier-border);
}
.wr-empty {
	margin: 24px 0;
	padding: 24px 12px;
	text-align: center;
	color: var(--text-muted);
	font-size: var(--font-ui-smaller);
	border: 1px dashed var(--background-modifier-border);
	border-radius: 8px;
}

/* === Settings tab — internal/external groups === */
.wr-group {
	margin-top: 24px;
	padding: 16px 20px 18px;
	border-radius: 12px;
	background: var(--background-secondary);
	border-left: 3px solid var(--background-modifier-border);
}
.wr-group-internal {
	border-left-color: var(--interactive-accent);
}
.wr-group-external {
	border-left-color: var(--color-red, #e05c5c);
}
.wr-group-excluded {
	border-left-color: var(--text-muted);
}
.wr-group-header {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: 1.2em;
	font-weight: 700;
	color: var(--text-normal);
	margin-bottom: 4px;
}
.wr-group-icon {
	font-size: 1.3em;
	line-height: 1;
}
.wr-group-desc {
	margin: 0 0 14px;
	color: var(--text-muted);
	font-size: 0.88em;
	line-height: 1.5;
}
.wr-cat-list {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.wr-cat-card {
	padding: 12px 14px;
	background: var(--background-primary);
	border: 1px solid var(--background-modifier-border);
	border-radius: 10px;
	transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.wr-cat-card:hover {
	border-color: var(--background-modifier-border-hover);
	box-shadow: 0 2px 6px rgba(0,0,0,0.08);
}
.wr-cat-card .setting-item {
	border-top: none;
	padding: 6px 0;
}
.wr-cat-card .setting-item:first-of-type {
	padding-top: 0;
}
.wr-group-internal .wr-cat-add {
	border-color: var(--interactive-accent);
}
.wr-group-external .wr-cat-add {
	border-color: var(--color-red, #e05c5c);
}
.wr-cat-add {
	margin-top: 12px;
	padding: 10px 14px;
	border: 1px dashed;
	border-radius: 10px;
	background: transparent;
	transition: background-color 0.15s ease;
}
.wr-cat-add:hover {
	background: var(--background-modifier-hover);
}
.wr-cat-add .setting-item {
	border-top: none;
	padding: 4px 0;
}
.wr-group-move-btn {
	font-size: 11px !important;
	padding: 3px 8px !important;
}

.wr-embed-card {
	border: 1px solid var(--background-modifier-border);
	border-radius: 8px;
	padding: 12px 14px;
	margin: 8px 0 16px;
	background: var(--background-secondary);
	transition: border-color 0.15s, background 0.15s;
}
.wr-embed-card.is-complete {
	border-color: var(--color-green, #2eb88a);
}
.wr-embed-card.is-running {
	border-color: var(--interactive-accent);
}
.wr-embed-card.is-pending {
	border-color: var(--color-yellow, #d4a72c);
}
.wr-embed-head {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: 600;
	margin-bottom: 6px;
}
.wr-embed-icon {
	font-size: 14px;
}
.wr-embed-progress {
	width: 100%;
	height: 8px;
	margin: 4px 0;
	border-radius: 4px;
	overflow: hidden;
	-webkit-appearance: none;
	appearance: none;
	border: none;
}
.wr-embed-progress::-webkit-progress-bar {
	background: var(--background-modifier-border);
	border-radius: 4px;
}
.wr-embed-progress::-webkit-progress-value {
	background: var(--interactive-accent);
	border-radius: 4px;
	transition: width 0.2s;
}
.wr-embed-card.is-complete .wr-embed-progress::-webkit-progress-value {
	background: var(--color-green, #2eb88a);
}
.wr-embed-meta {
	font-size: 12px;
	color: var(--text-muted);
	display: flex;
	justify-content: space-between;
	gap: 12px;
	margin-top: 4px;
}
.wr-sync-banner {
	margin: 8px 0 12px;
	padding: 10px 12px;
	border: 1px solid var(--background-modifier-border);
	border-radius: 8px;
	background: var(--background-secondary);
}
.wr-onboarding-title {
	font-weight: 600;
	font-size: var(--font-ui-medium);
	margin: 0 0 6px;
}
.wr-onboarding-steps {
	margin: 6px 0;
	padding-left: 1.4em;
}
.wr-onboarding-steps li {
	margin: 2px 0;
}
.wr-chip-list {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin: 6px 0 12px;
}
.wr-chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 8px;
	font-size: var(--font-ui-smaller);
	background: var(--background-modifier-hover);
	border: 1px solid var(--background-modifier-border);
	border-radius: 12px;
}
.wr-chip-x {
	cursor: pointer;
	color: var(--text-muted);
	font-size: 0.85em;
}
.wr-chip-x:hover {
	color: var(--text-error);
}
.wr-syn-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 8px 0 12px;
}
.wr-syn-row {
	display: flex;
	align-items: baseline;
	gap: 8px;
	flex-wrap: wrap;
}
.wr-syn-key {
	font-weight: 600;
	color: var(--text-accent);
	min-width: 4em;
}

/* ===== 팝업 보기 (Modal) ===== */
.wr-popup-btn {
	padding: 4px 10px;
	font-size: 11px;
	background: var(--background-secondary);
	color: var(--text-normal);
	border: 1px solid var(--background-modifier-border);
	border-radius: 4px;
	cursor: pointer;
	transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.wr-popup-btn:hover {
	background: var(--background-modifier-hover);
	border-color: var(--background-modifier-border-hover);
}
.wr-popup {
	max-width: 760px;
	width: 90vw;
}
.wr-popup-header {
	margin-bottom: 8px;
}
.wr-popup-title-row {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}
.wr-popup-title {
	font-weight: 700;
	font-size: var(--font-ui-large);
	color: var(--text-normal);
}
.wr-popup-chip {
	padding: 1px 8px;
	font-size: var(--font-ui-smaller);
	color: var(--text-muted);
	background: var(--background-modifier-hover);
	border: 1px solid var(--background-modifier-border);
	border-radius: 12px;
}
.wr-popup-path {
	margin-top: 2px;
	font-size: var(--font-ui-smaller);
	color: var(--text-faint);
}
.wr-popup-actions {
	display: flex;
	gap: 6px;
	flex-wrap: wrap;
	align-items: center;
	padding-bottom: 8px;
	border-bottom: 1px solid var(--background-modifier-border);
}
.wr-popup-actions button {
	padding: 4px 10px;
	font-size: var(--font-ui-smaller);
	background: var(--background-secondary);
	color: var(--text-normal);
	border: 1px solid var(--background-modifier-border);
	border-radius: 4px;
	cursor: pointer;
	transition: background-color 0.12s ease, border-color 0.12s ease;
}
.wr-popup-actions button:hover {
	background: var(--background-modifier-hover);
	border-color: var(--background-modifier-border-hover);
}
.wr-popup-actions button.wr-open-btn {
	background: var(--interactive-accent);
	color: var(--text-on-accent);
	border: none;
	transition: opacity 0.12s ease;
}
.wr-popup-actions button.wr-open-btn:hover {
	opacity: 0.85;
	background: var(--interactive-accent);
}
.wr-popup-body {
	max-height: 68vh;
	overflow-y: auto;
	margin-top: 8px;
	padding: 4px 8px 12px 2px;
	font-size: var(--font-ui-small);
	line-height: 1.6;
}
.wr-popup-anchor {
	background: var(--text-highlight-bg, rgba(255, 208, 0, 0.35));
	border-radius: 2px;
}
@keyframes wr-flash-anim {
	0% {
		box-shadow: 0 0 0 4px var(--interactive-accent);
	}
	100% {
		box-shadow: 0 0 0 4px transparent;
	}
}
.wr-flash {
	animation: wr-flash-anim 1.5s ease-out 1;
}

/* ── 채팅 탭 ── */
.wr-chat-mount {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}
.wr-chat {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}
.wr-chat-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin: 0 0 6px;
}
.wr-chat-header-title {
	font-size: var(--font-ui-smaller);
	font-weight: 600;
	color: var(--text-muted);
}
.wr-chat-new-btn {
	padding: 2px 10px;
	font-size: var(--font-ui-smaller);
	background: var(--background-secondary);
	color: var(--text-normal);
	border: 1px solid var(--background-modifier-border);
	border-radius: 4px;
	cursor: pointer;
}
.wr-chat-new-btn:hover:not(:disabled) {
	background: var(--background-modifier-hover);
}
.wr-chat-new-btn:disabled {
	opacity: 0.4;
	cursor: default;
}
.wr-chat-messages {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 4px 4px 10px 2px;
}
.wr-chat-empty {
	margin: auto;
	text-align: center;
	color: var(--text-faint);
	font-size: var(--font-ui-smaller);
	line-height: 1.7;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
	padding: 0 12px;
}
.wr-chat-empty-icon {
	font-size: 28px;
	opacity: 0.7;
}
.wr-chat-empty-title {
	font-weight: 600;
	color: var(--text-muted);
	font-size: var(--font-ui-small);
}
.wr-chat-empty-desc {
	color: var(--text-faint);
}
.wr-chat-cite-demo,
.wr-chat-cite {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 20px;
	height: 20px;
	padding: 0 6px;
	margin: 0 2px;
	font-size: 12px;
	font-weight: 700;
	line-height: 1;
	vertical-align: baseline;
	transform: translateY(3px);
	background: var(--background-modifier-hover);
	color: var(--text-accent);
	border: 1px solid var(--background-modifier-border);
	border-radius: 10px;
	cursor: pointer;
	transition: background-color 0.12s ease, border-color 0.12s ease;
}
.wr-chat-cite:hover {
	background: var(--interactive-accent);
	border-color: var(--interactive-accent);
	color: var(--text-on-accent);
}
.wr-chat-examples-label {
	margin-top: 14px;
	font-size: var(--font-ui-smaller);
	color: var(--text-faint);
}
.wr-chat-examples {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-top: 8px;
	width: 100%;
	max-width: 260px;
}
.wr-chat-example-btn {
	padding: 7px 12px;
	font-size: var(--font-ui-smaller);
	text-align: left;
	background: var(--background-secondary);
	color: var(--text-muted);
	border: 1px solid var(--background-modifier-border);
	border-radius: 8px;
	cursor: pointer;
	transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.wr-chat-example-btn:hover {
	background: var(--background-modifier-hover);
	color: var(--text-normal);
	border-color: var(--interactive-accent);
}
/* 문답 턴 (집중 리딩형): 최신 턴은 문서형으로 펼침, 과거 턴은 한 줄로 접힘 */
.wr-chat-turn {
	display: flex;
	flex-direction: column;
	padding-bottom: 14px;
	border-bottom: 1px solid var(--background-modifier-border);
}
.wr-chat-turn.is-latest {
	border-bottom: none;
}
.wr-chat-q {
	display: flex;
	gap: 8px;
	align-items: baseline;
	padding: 9px 12px;
	border-radius: 8px;
	background: var(--background-secondary);
	border-left: 3px solid var(--interactive-accent);
	font-size: var(--font-ui-small);
	line-height: 1.55;
	color: var(--text-muted);
	word-break: keep-all;
	overflow-wrap: anywhere;
}
.wr-chat-q b {
	color: var(--text-accent);
	flex-shrink: 0;
}
.wr-chat-q.is-collapsible {
	cursor: pointer;
}
.wr-chat-q.is-collapsible:hover {
	background: var(--background-modifier-hover);
}
.wr-chat-turn-collapsed {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 9px 12px;
	border: none;
	border-radius: 8px;
	background: var(--background-secondary);
	color: var(--text-muted);
	font-size: var(--font-ui-small);
	text-align: left;
	cursor: pointer;
}
.wr-chat-turn-collapsed:hover {
	background: var(--background-modifier-hover);
	color: var(--text-normal);
}
.wr-chat-turn-collapsed b {
	color: var(--text-accent);
	flex-shrink: 0;
}
.wr-chat-collapsed-text {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.wr-chat-collapsed-chevron {
	flex-shrink: 0;
	color: var(--text-faint);
	font-size: 10px;
}
.wr-chat-answer {
	margin-top: 14px;
	padding: 0 2px;
}
/* 답변 본문 — 노트 본문과 동일한 읽기 경험 (사용자 글자 크기 설정 존중) */
.wr-chat-md {
	font-family: var(--font-text);
	font-size: var(--font-text-size, 16px);
	line-height: 1.75;
	color: var(--text-normal);
	word-break: keep-all;
	overflow-wrap: anywhere;
}
.wr-chat-md p:first-child { margin-top: 0; }
.wr-chat-md p:last-child { margin-bottom: 0; }
.wr-chat-md p { margin: 0.8em 0; }
.wr-chat-md ul, .wr-chat-md ol {
	margin: 0.6em 0;
	padding-inline-start: 1.3em;
}
.wr-chat-md li { margin: 0.35em 0; }
/* 제목 위계: 장식은 h4 왼쪽 막대 하나만 — 크기·굵기·여백으로 구분 */
.wr-chat-md h1, .wr-chat-md h2, .wr-chat-md h3, .wr-chat-md h4, .wr-chat-md h5, .wr-chat-md h6 {
	margin: 1.3em 0 0.45em;
	line-height: 1.4;
	font-weight: 700;
	color: var(--text-normal);
	border: none;
}
.wr-chat-md h1:first-child, .wr-chat-md h2:first-child,
.wr-chat-md h3:first-child, .wr-chat-md h4:first-child {
	margin-top: 0.15em;
}
.wr-chat-md h1 { font-size: 1.25em; margin-top: 1.4em; }
.wr-chat-md h2 { font-size: 1.15em; }
.wr-chat-md h3 { font-size: 1.15em; }
.wr-chat-md h4 {
	font-size: 1.02em;
	margin-top: 1.1em;
	padding-left: 9px;
	border-left: 3px solid var(--interactive-accent);
}
.wr-chat-md h5, .wr-chat-md h6 {
	font-size: 0.95em;
	font-weight: 600;
	color: var(--text-muted);
}
/* 성경구절 인용 — 답변의 주인공: 크기 유지, accent 막대만 */
.wr-chat-md blockquote {
	margin: 0.9em 0;
	padding: 2px 0 2px 12px;
	border-left: 3px solid var(--interactive-accent);
	background: transparent;
	color: var(--text-normal);
	line-height: 1.8;
}
.wr-chat-md blockquote p { margin: 0.3em 0; }
.wr-chat-answer-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin-top: 12px;
	padding-top: 8px;
	border-top: 1px solid var(--background-modifier-border);
}
/* 크게 보기 팝업 본문 — 읽기 폭 제한 */
.wr-chat-md-popup {
	max-width: 72ch;
	margin: 0 auto;
}
.wr-chat-sources-toggle {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 4px 8px;
	min-height: 24px;
	font-size: var(--font-ui-small);
	font-weight: 600;
	background: transparent;
	color: var(--text-muted);
	border: none;
	border-radius: 5px;
	cursor: pointer;
}
.wr-chat-sources-toggle:hover,
.wr-chat-sources-toggle.is-open {
	color: var(--text-accent);
	background: var(--background-modifier-hover);
}
.wr-chat-sources-chevron {
	font-size: 9px;
}
.wr-chat-answer-actions {
	display: flex;
	gap: 4px;
}
.wr-chat-action-btn {
	padding: 4px 10px;
	min-height: 24px;
	font-size: var(--font-ui-small);
	background: transparent;
	color: var(--text-muted);
	border: 1px solid var(--background-modifier-border);
	border-radius: 6px;
	cursor: pointer;
}
.wr-chat-action-btn:hover {
	color: var(--text-normal);
	background: var(--background-modifier-hover);
	border-color: var(--background-modifier-border-hover);
}
.wr-chat-sources {
	display: flex;
	flex-direction: column;
	gap: 4px;
	margin-top: 6px;
}
.wr-chat-source-card {
	position: relative;
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 5px 8px 5px 12px;
	background: var(--background-primary);
	border: 1px solid var(--background-modifier-border);
	border-radius: 6px;
	cursor: pointer;
	transition: background-color 0.12s ease, border-color 0.12s ease;
}
.wr-chat-source-card::before {
	content: '';
	position: absolute;
	left: 4px;
	top: 6px;
	bottom: 6px;
	width: 3px;
	border-radius: 2px;
	background: var(--text-faint);
}
.wr-chat-source-internal::before {
	background: var(--interactive-accent);
}
.wr-chat-source-external::before {
	background: var(--color-red, #e05c5c);
}
.wr-chat-source-card:hover {
	background: var(--background-modifier-hover);
	border-color: var(--background-modifier-border-hover);
}
.wr-chat-source-num {
	flex-shrink: 0;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 17px;
	height: 17px;
	font-size: 10px;
	font-weight: 700;
	background: var(--background-modifier-hover);
	color: var(--text-accent);
	border-radius: 9px;
}
.wr-chat-source-body {
	flex: 1;
	min-width: 0;
}
.wr-chat-source-title {
	font-size: var(--font-ui-smaller);
	font-weight: 600;
	color: var(--text-normal);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.wr-chat-source-heading {
	font-size: var(--font-ui-smaller);
	color: var(--text-muted);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.wr-chat-source-open {
	flex-shrink: 0;
	width: 22px;
	height: 22px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font-size: 12px;
	background: transparent;
	color: var(--text-faint);
	border: none;
	border-radius: 4px;
	cursor: pointer;
}
.wr-chat-source-open:hover {
	color: var(--text-accent);
	background: var(--background-modifier-border);
}
.wr-chat-loading {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 6px 4px;
	font-size: var(--font-ui-small);
	color: var(--text-muted);
}
.wr-chat-spinner {
	width: 12px;
	height: 12px;
	flex-shrink: 0;
	border: 2px solid var(--background-modifier-border);
	border-top-color: var(--interactive-accent);
	border-radius: 50%;
	animation: wr-chat-spin 0.8s linear infinite;
}
@keyframes wr-chat-spin {
	to { transform: rotate(360deg); }
}
.wr-chat-dots::after {
	content: "…";
	display: inline-block;
	animation: wr-chat-dots-anim 1.2s steps(4, end) infinite;
	width: 1.2em;
	overflow: hidden;
	vertical-align: bottom;
}
@keyframes wr-chat-dots-anim {
	0% { width: 0; }
	100% { width: 1.2em; }
}
.wr-chat-error {
	align-self: stretch;
	padding: 10px 12px;
	border-radius: 8px;
	font-size: var(--font-ui-small);
	line-height: 1.55;
	background: var(--background-secondary);
	border: 1px solid var(--text-error);
	color: var(--text-error);
	word-break: keep-all;
	overflow-wrap: anywhere;
}
.wr-chat-input-row {
	display: flex;
	align-items: flex-end;
	gap: 6px;
	padding-top: 8px;
	border-top: 1px solid var(--background-modifier-border);
}
.wr-chat-input {
	flex: 1;
	resize: none;
	min-height: 32px;
	max-height: 120px;
	padding: 6px 10px;
	font-size: var(--font-ui-small);
	font-family: inherit;
	line-height: 1.5;
	background: var(--background-modifier-form-field);
	color: var(--text-normal);
	border: 1px solid var(--background-modifier-border);
	border-radius: 8px;
}
.wr-chat-input:focus {
	border-color: var(--interactive-accent);
	outline: none;
}
.wr-chat-send-btn {
	width: 32px;
	height: 32px;
	flex-shrink: 0;
	font-size: 16px;
	font-weight: 700;
	background: var(--interactive-accent);
	color: var(--text-on-accent);
	border: none;
	border-radius: 8px;
	cursor: pointer;
}
.wr-chat-send-btn:hover:not(:disabled) {
	background: var(--interactive-accent-hover);
}
.wr-chat-send-btn:disabled {
	opacity: 0.4;
	cursor: default;
}
`;
