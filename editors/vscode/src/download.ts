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
export function binaryName(target: string): string {
	return target?.includes('windows') ? 'knowboard-lsp.exe' : 'knowboard-lsp';
}

/**
 * Returns the download URL for a given version and target triple.
 */
export function downloadUrl(version: string, target: string): string {
	return `https://github.com/knowboard/knowboard/releases/download/v${version}/knowboard-lsp-${target}.tar.gz`;
}

/**
 * Returns the asset name for a given target triple.
 */
export function assetName(target: string): string {
	return `knowboard-lsp-${target}.tar.gz`;
}

/**
 * Returns the versioned directory path for the downloaded binary.
 * The version is baked into the path so extension updates always get a fresh download.
 */
export function binaryDir(context: vscode.ExtensionContext, version: string, target: string): string {
	return path.join(context.globalStorageUri.fsPath, 'lsp-bin', version, target);
}

/**
 * Returns the full path to the downloaded binary, versioned so extension
 * upgrades trigger a re-download.
 */
export function binaryPath(context: vscode.ExtensionContext, version: string, target: string): string {
	return path.join(binaryDir(context, version, target), binaryName(target));
}

/**
 * Checks whether the downloaded binary for this version exists and is executable.
 */
export function isBinaryInstalled(context: vscode.ExtensionContext, version: string, target: string): boolean {
	const bp = binaryPath(context, version, target);
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
	target: string,
	outputChannel: vscode.OutputChannel,
	progress?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<string | undefined> {
	const dir = binaryDir(context, version, target);
	fs.mkdirSync(dir, { recursive: true });

	const url = downloadUrl(version, target);
	const bp = binaryPath(context, version, target);

	outputChannel.appendLine(`[download] Downloading knowboard-lsp v${version} for ${target}...`);
	outputChannel.appendLine(`[download] URL: ${url}`);

	try {
		// Extract into a temp directory alongside the final binary, then rename.
		const extractDir = path.join(dir, '.extract');
		fs.mkdirSync(extractDir, { recursive: true });
		await downloadAndExtract(url, extractDir, outputChannel, progress);

		const extracted = path.join(extractDir, binaryName(target));
		fs.renameSync(extracted, bp);
		fs.rmdirSync(extractDir, { recursive: true });

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
