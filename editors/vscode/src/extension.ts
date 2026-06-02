import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	RevealOutputChannelOn,
	ServerOptions,
	Trace,
} from 'vscode-languageclient/node';
import { binaryPath, downloadBinary, isBinaryInstalled } from './download.js';
import which from 'which';

const CLIENT_ID = 'knowboard';
const CLIENT_NAME = 'Knowboard LSP';
const DEFAULT_SERVER_COMMAND = 'knowboard-lsp';
const SUPPORTED_LANGUAGES = ['turtle', 'jsonld', 'yamlld', 'ntriples', 'rdfxml', 'sparql', 'markdown'];

let client: LanguageClient | undefined;
let extensionContext: vscode.ExtensionContext | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	extensionContext = context;

	const outputChannel = vscode.window.createOutputChannel('Knowboard');
	context.subscriptions.push(outputChannel);

	// Ensure the binary is downloaded before starting the server.
	await ensureBinaryDownloaded(context, outputChannel);

	context.subscriptions.push(vscode.commands.registerCommand('knowboard.restartServer', async () => {
		await restartClient(outputChannel);
		vscode.window.showInformationMessage('Knowboard server restarted.');
	}));

	context.subscriptions.push(vscode.commands.registerCommand('knowboard.copySparqlUrl', async () => {
		const baseUrl = await getSparqlServerUrl();
		if (!baseUrl) {
			vscode.window.showInformationMessage('SPARQL server is not running. Set [sparql_server] listen = "auto" in .knowboard.toml to enable it.');
			return;
		}
		const sparqlUrl = `${baseUrl}/sparql`;
		await vscode.env.clipboard.writeText(sparqlUrl);
		vscode.window.showInformationMessage(`Copied SPARQL URL: ${sparqlUrl}`);
	}));

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
		if (event.affectsConfiguration('knowboard.server')) {
			await restartClient(outputChannel);
			return;
		}

		if (event.affectsConfiguration('knowboard.trace.server') && client) {
			await client.setTrace(traceSetting());
		}
	}));

	await startClient(context, outputChannel);
}

export async function deactivate(): Promise<void> {
	await stopClient();
}

async function startClient(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Promise<void> {
	if (client) {
		return;
	}

	const config = vscode.workspace.getConfiguration('knowboard');
	const command = resolveServerCommand(config, context);
	const args = config.get<string[]>('server.args', []);
	const envOverrides = config.get<Record<string, string>>('server.env', {});

	const serverOptions: ServerOptions = {
		command,
		args,
		options: {
			env: buildServerEnv(envOverrides),
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			...SUPPORTED_LANGUAGES.map(language => ({ scheme: 'file', language })),
			{ scheme: 'file', pattern: '**/.knowboard.toml' },
		],
		outputChannel,
		revealOutputChannelOn: RevealOutputChannelOn.Never,
	};

	outputChannel.appendLine(`Starting ${CLIENT_NAME}: ${command}${args.length > 0 ? ` ${args.join(' ')}` : ''}`);

	const nextClient = new LanguageClient(CLIENT_ID, CLIENT_NAME, serverOptions, clientOptions);
	client = nextClient;

	try {
		await nextClient.start();
		await nextClient.setTrace(traceSetting());
	} catch (error) {
		client = undefined;
		outputChannel.appendLine(`Failed to start ${CLIENT_NAME}: ${formatError(error)}`);
		await showStartFailure(command);
	}
}

async function restartClient(outputChannel: vscode.OutputChannel): Promise<void> {
	await stopClient();
	if (extensionContext) {
		await startClient(extensionContext, outputChannel);
	}
}

async function stopClient(): Promise<void> {
	const activeClient = client;
	client = undefined;

	if (activeClient) {
		await activeClient.stop();
	}
}

function resolveServerCommand(config: vscode.WorkspaceConfiguration, context: vscode.ExtensionContext): string {
	const configuredPath = config.get<string>('server.path', DEFAULT_SERVER_COMMAND).trim() || DEFAULT_SERVER_COMMAND;

	if (configuredPath !== DEFAULT_SERVER_COMMAND) {
		return resolveConfiguredPath(configuredPath);
	}

	// Prefer the auto-downloaded binary if it exists.
	const downloaded = binaryPath(context);
	try {
		fs.accessSync(downloaded, fs.constants.X_OK);
		return downloaded;
	} catch {
		// Fall back to PATH.
		return DEFAULT_SERVER_COMMAND;
	}
}

function resolveConfiguredPath(configuredPath: string): string {
	if (path.isAbsolute(configuredPath) || isBareCommand(configuredPath)) {
		return configuredPath;
	}

	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!workspaceRoot) {
		return configuredPath;
	}

	return path.resolve(workspaceRoot, configuredPath);
}

function isBareCommand(value: string): boolean {
	return !value.includes(path.posix.sep) && !value.includes(path.win32.sep);
}

function buildServerEnv(envOverrides: Record<string, string>): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		...envOverrides,
	};
	return env;
}

function traceSetting(): Trace {
	const setting = vscode.workspace.getConfiguration('knowboard').get<string>('trace.server', 'off');

	switch (setting) {
		case 'messages':
			return Trace.Messages;
		case 'verbose':
			return Trace.Verbose;
		default:
			return Trace.Off;
	}
}

async function showStartFailure(command: string): Promise<void> {
	const selection = await vscode.window.showErrorMessage(
		`Knowboard could not start ${command}. Install knowboard-lsp, or set knowboard.server.path to an existing binary.`,
		'Open Settings'
	);

	if (selection === 'Open Settings') {
		await vscode.commands.executeCommand('workbench.action.openSettings', 'knowboard.server.path');
	}
}

async function getSparqlServerUrl(): Promise<string | null> {
	if (!client) {
		return null;
	}
	try {
		const url = await client.sendRequest<string | null>('knowboard/getSparqlServerUrl');
		return url ?? null;
	} catch {
		return null;
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Ensures the knowboard-lsp binary is downloaded for the current platform.
 * Skips if the user has configured a custom server path, or if the command
 * is already available on PATH.
 */
async function ensureBinaryDownloaded(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	const config = vscode.workspace.getConfiguration('knowboard');
	const configuredPath = config.get<string>('server.path', DEFAULT_SERVER_COMMAND).trim();

	// If the user has set a custom path, don't auto-download.
	if (configuredPath !== DEFAULT_SERVER_COMMAND) {
		outputChannel.appendLine('[download] Custom server.path set — skipping auto-download.');
		return;
	}

	// If the command is already on PATH, skip.
	if (await isOnPath(DEFAULT_SERVER_COMMAND)) {
		outputChannel.appendLine(`[download] ${DEFAULT_SERVER_COMMAND} found on PATH — skipping auto-download.`);
		return;
	}

	// If already installed in global storage, skip.
	if (isBinaryInstalled(context)) {
		outputChannel.appendLine('[download] Binary already installed.');
		return;
	}

	const packageJson = vscode.extensions.getExtension('knowboard.knowboard-vscode')?.packageJSON;
	const version: string | undefined = packageJson?.version;

	if (!version) {
		outputChannel.appendLine('[download] Could not determine extension version — skipping auto-download.');
		return;
	}

	outputChannel.appendLine(`[download] knowboard-lsp v${version} not found locally — downloading...`);

	const result = await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Knowboard: downloading knowboard-lsp v${version}...`,
			cancellable: false,
		},
		(progress) => downloadBinary(context, version, outputChannel, progress),
	);

	if (result) {
		outputChannel.appendLine(`[download] knowboard-lsp v${version} ready at ${result}`);
	} else {
		outputChannel.appendLine(`[download] Auto-download failed — will fall back to PATH.`);
	}
}

/**
 * Checks whether a command is available on the system PATH.
 */
async function isOnPath(command: string): Promise<boolean> {
	try {
		await which(command);
		return true;
	} catch {
		return false;
	}
}
