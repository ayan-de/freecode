import * as vscode from 'vscode';
import { ChatView } from './chat/ChatView.js';

export function activate(context: vscode.ExtensionContext) {
  const chatView = new ChatView(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'freecode.chat',
      chatView
    )
  );
}

export function deactivate() {}