import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	RevealOutputChannelOn,
	ServerOptions,
	Trace,
} from 'vscode-languageclient/node';

const CLIENT_ID = 'knowboard';
const CLIENT_NAME = 'Knowboard LSP';
const DEFAULT_SERVER_COMMAND = 'knowboard-lsp';
const SUPPORTED_LANGUAGES = ['turtle', 'jsonld', 'yamlld', 'ntriples', 'rdfxml', 'sparql', 'markdown'];

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const outputChannel = vscode.window.createOutputChannel('Knowboard');
	context.subscriptions.push(outputChannel);

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

	await startClient(outputChannel);
}

export async function deactivate(): Promise<void> {
	await stopClient();
}

async function startClient(outputChannel: vscode.OutputChannel): Promise<void> {
	if (client) {
		return;
	}

	const config = vscode.workspace.getConfiguration('knowboard');
	const command = resolveServerCommand(config);
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
	await startClient(outputChannel);
}

async function stopClient(): Promise<void> {
	const activeClient = client;
	client = undefined;

	if (activeClient) {
		await activeClient.stop();
	}
}

function resolveServerCommand(config: vscode.WorkspaceConfiguration): string {
	const configuredPath = config.get<string>('server.path', DEFAULT_SERVER_COMMAND).trim() || DEFAULT_SERVER_COMMAND;

	if (configuredPath !== DEFAULT_SERVER_COMMAND) {
		return resolveConfiguredPath(configuredPath);
	}

	return configuredPath;
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
