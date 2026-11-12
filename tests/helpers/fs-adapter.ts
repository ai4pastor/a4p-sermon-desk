// 실제 파일 시스템 위의 옵시디언 DataAdapter 대역 — 저장·압축·지연 로드 테스트용.
// 경로는 볼트 기준 상대 경로(옵시디언과 같음), base는 테스트마다 새로 만든 임시 폴더.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeFsAdapter(base: string) {
	const abs = (p: string) => path.join(base, p);
	return {
		async exists(p: string) {
			return fs.existsSync(abs(p));
		},
		async remove(p: string) {
			await fs.promises.unlink(abs(p));
		},
		async rename(from: string, to: string) {
			await fs.promises.rename(abs(from), abs(to));
		},
		async writeBinary(p: string, data: ArrayBuffer) {
			await fs.promises.writeFile(abs(p), new Uint8Array(data));
		},
		async readBinary(p: string) {
			const b = await fs.promises.readFile(abs(p));
			return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
		},
		async list(dir: string) {
			return {
				files: fs.readdirSync(abs(dir)).map((f) => `${dir}/${f}`),
				folders: [] as string[],
			};
		},
		async stat(p: string) {
			if (!fs.existsSync(abs(p))) return null;
			const s = fs.statSync(abs(p));
			return { type: "file" as const, size: s.size, ctime: s.ctimeMs, mtime: s.mtimeMs };
		},
		getFullPath(p: string) {
			return abs(p);
		},
	};
}

/** 테스트용 새 임시 볼트 폴더 — 플러그인 폴더까지 만들어 둔다. */
export function makeTempVault(pluginDir: string): string {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "a4p-sermon-desk-test-"));
	fs.mkdirSync(path.join(base, pluginDir), { recursive: true });
	return base;
}
