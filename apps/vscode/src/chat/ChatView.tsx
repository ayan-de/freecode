import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ChatView implements vscode.WebviewViewProvider {
  constructor(private context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
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
  }
}