import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { startCli as ipcStartCli, listTools as ipcListTools, sessionStart, sessionSend, callTool as ipcCallTool, stopCli as ipcStopCli } from '../ipc/client.js';

export class ChatView implements vscode.WebviewViewProvider {
  private webview?: vscode.WebviewView;

  constructor(private context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webview = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    const htmlPath = path.join(this.context.extensionPath, 'dist', 'webview', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');

    // Replace relative URLs with webview URIs
    html = html.replace(
      'bundle.js',
      webviewView.webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'bundle.js')
      ).toString()
    );

    webviewView.webview.html = html;

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'startCli':
          ipcStartCli();
          webviewView.webview.postMessage({ type: 'cliStarted' });
          break;

        case 'listTools':
          try {
            const tools = await ipcListTools();
            webviewView.webview.postMessage({ type: 'toolsList', tools });
          } catch (err) {
            webviewView.webview.postMessage({ type: 'error', error: String(err) });
          }
          break;

        case 'sessionStart':
          try {
            const config = message.config;
            const session = await sessionStart(config);
            webviewView.webview.postMessage({ type: 'sessionStarted', session });
          } catch (err) {
            webviewView.webview.postMessage({ type: 'error', error: String(err) });
          }
          break;

        case 'sessionSend':
          try {
            const { sessionId, message: userMessage } = message;
            const result = await sessionSend(sessionId, userMessage);
            webviewView.webview.postMessage({ type: 'sessionResponse', result });
          } catch (err) {
            webviewView.webview.postMessage({ type: 'error', error: String(err) });
          }
          break;

        case 'callTool':
          try {
            const { name, args } = message;
            const result = await ipcCallTool(name, args);
            webviewView.webview.postMessage({ type: 'toolResult', result });
          } catch (err) {
            webviewView.webview.postMessage({ type: 'error', error: String(err) });
          }
          break;

        case 'stopCli':
          ipcStopCli();
          webviewView.webview.postMessage({ type: 'cliStopped' });
          break;
      }
    });
  }
}