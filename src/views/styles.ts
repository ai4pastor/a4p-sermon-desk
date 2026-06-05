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
`;
