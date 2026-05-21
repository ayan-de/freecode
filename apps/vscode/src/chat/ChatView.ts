import * as vscode from 'vscode';

export class ChatView implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.html = '<html><body>FreeCode Chat</body></html>';
  }
}