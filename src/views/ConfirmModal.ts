import { App, Modal, Setting } from "obsidian";

export interface ConfirmOptions {
	title: string;
	body: string;
	confirmText?: string;
	cancelText?: string;
	/** true면 확인 버튼을 경고색으로(되돌리기 어려운 동작). */
	warning?: boolean;
}

/** 확인/취소 모달 — Promise<boolean>. 닫기(Esc·바깥 클릭)는 취소로 본다. */
export function confirmModal(app: App, opts: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (ok: boolean) => {
			if (settled) return;
			settled = true;
			resolve(ok);
		};
		const modal = new (class extends Modal {
			onOpen(): void {
				this.contentEl.createEl("h3", { text: opts.title });
				this.contentEl.createEl("p", {
					text: opts.body,
					cls: "setting-item-description",
				});
				new Setting(this.contentEl)
					.addButton((b) =>
						b.setButtonText(opts.cancelText ?? "취소").onClick(() => {
							done(false);
							this.close();
						}),
					)
					.addButton((b) => {
						b.setButtonText(opts.confirmText ?? "확인").onClick(() => {
							done(true);
							this.close();
						});
						if (opts.warning) b.setWarning();
						else b.setCta();
					});
			}
			onClose(): void {
				done(false);
			}
		})(app);
		modal.open();
	});
}
