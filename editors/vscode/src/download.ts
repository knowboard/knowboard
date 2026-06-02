import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import * as tar from 'tar';
import * as vscode from 'vscode';

/**
 * Maps Node.js `process.arch` + `process.platform` to Rust target triples.
 * Returns `undefined` for unsupported platforms.
 */
export function detectRustTarget(): string | undefined {
	const arch = process.arch;
	const platform = process.platform;

	if (platform === 'darwin') {
		if (arch === 'arm64') return 'aarch64-apple-darwin';
		if (arch === 'x64') return 'x86_64-apple-darwin';
	}

	if (platform === 'linux') {
		if (arch === 'arm64') return 'aarch64-unknown-linux-gnu';
		if (arch === 'x64') return 'x86_64-unknown-linux-gnu';
	}

	if (platform === 'win32') {
		if (arch === 'x64') return 'x86_64-pc-windows-msvc';
		if (arch === 'arm64') return 'aarch64-pc-windows-msvc';
	}

	return undefined;
}

/**
 * Returns the expected binary name for the current platform.
 */
export function binaryName(): string {
	return process.platform === 'win32' ? 'knowboard-lsp.exe' : 'knowboard-lsp';
}

/**
 * Returns the archive name for a given Rust target triple and version.
 */
export function archiveName(target: string, version: string): string {
	const ext = target.includes('windows') ? 'zip' : 'tar.gz';
	return `knowboard-lsp-${target}.${ext}`;
}

/**
 * Returns the download URL for a given version and target triple.
 */
export function downloadUrl(version: string, target: string): string {
	return `https://github.com/knowboard/knowboard/releases/download/v${version}/knowboard-lsp-${target}.tar.gz`;
}

/**
 * Returns the directory where the downloaded binary is stored.
 */
export function binaryStorageDir(context: vscode.ExtensionContext): string {
	return path.join(context.globalStorageUri.fsPath, 'bin');
}

/**
 * Returns the full path to the downloaded binary.
 */
export function binaryPath(context: vscode.ExtensionContext): string {
	return path.join(binaryStorageDir(context), binaryName());
}

/**
 * Checks whether the downloaded binary exists and is executable.
 */
export function isBinaryInstalled(context: vscode.ExtensionContext): boolean {
	const bp = binaryPath(context);
	try {
		fs.accessSync(bp, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Downloads and extracts the knowboard-lsp binary for the current platform.
 *
 * @returns The path to the downloaded binary, or `undefined` if the platform
 *          is unsupported or the download fails.
 */
export async function downloadBinary(
	context: vscode.ExtensionContext,
	version: string,
	outputChannel: vscode.OutputChannel,
	progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<string | undefined> {
	const target = detectRustTarget();
	if (!target) {
		outputChannel.appendLine(`[download] Unsupported platform: ${process.platform} ${process.arch}`);
		return undefined;
	}

	const dir = binaryStorageDir(context);
	fs.mkdirSync(dir, { recursive: true });

	const url = downloadUrl(version, target);
	const bp = binaryPath(context);

	outputChannel.appendLine(`[download] Downloading knowboard-lsp v${version} for ${target}...`);
	outputChannel.appendLine(`[download] URL: ${url}`);

	try {
		await downloadAndExtract(url, dir, outputChannel, progress);
		// Make executable on Unix
		if (process.platform !== 'win32') {
			fs.chmodSync(bp, 0o755);
		}
		outputChannel.appendLine(`[download] Binary installed at: ${bp}`);
		return bp;
	} catch (error) {
		outputChannel.appendLine(`[download] Failed to download binary: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}
}

/**
 * Downloads a .tar.gz archive from a URL and extracts it into the given
 * destination directory.
 */
function downloadAndExtract(
	url: string,
	destDir: string,
	outputChannel: vscode.OutputChannel,
	progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<void> {
	return new Promise((resolve, reject) => {
		https.get(url, (response) => {
			if (response.statusCode === 302 || response.statusCode === 301) {
				if (response.headers.location) {
					downloadAndExtract(response.headers.location, destDir, outputChannel, progress)
						.then(resolve)
						.catch(reject);
					return;
				}
			}

			if (response.statusCode !== 200) {
				reject(new Error(`HTTP ${response.statusCode} ${response.statusMessage}`));
				return;
			}

			const total = parseInt(response.headers['content-length'] ?? '0', 10);
			let received = 0;
			// Tracks the cumulative absolute percentage (0–100) we've reported.
			let lastReportedPct = 0;

			const extractor = tar.x({
				C: destDir,
				strip: 0,
			});

			response
				.on('data', (chunk: Buffer) => {
					received += chunk.length;
					if (total > 0) {
						// Download portion = 0–90% of the overall progress bar.
						const desiredPct = Math.min(Math.round((received / total) * 90), 90);
						if (desiredPct > lastReportedPct) {
							progress?.report({
								message: `Downloading... ${Math.round((received / total) * 100)}%`,
								increment: desiredPct - lastReportedPct,
							});
							lastReportedPct = desiredPct;
						}
					}
				})
				.pipe(zlib.createGunzip())
				.pipe(extractor);

			extractor.on('finish', () => {
				// Extraction portion = 90–100%.
				progress?.report({
					message: 'Extracting...',
					increment: 100 - lastReportedPct,
				});
				resolve();
			});
			extractor.on('error', reject);
		}).on('error', reject);
	});
}
