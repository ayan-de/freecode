import * as vscode from 'vscode';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../webview/App.js';

export class ChatView implements vscode.WebviewViewProvider {
  private webviewView: vscode.WebviewView | undefined;
  private root: Root | null = null;

  constructor(private context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this.getHtml();

    this.root = createRoot(webviewView.webview as unknown as HTMLElement);
    this.root.render(React.createElement(App));
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FreeCode Chat</title>
  <style>
    body { margin: 0; padding: 0; background: #1e1e1e; }
  </style>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;
  }
}