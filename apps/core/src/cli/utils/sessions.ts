import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SessionMeta {
  id: string;
  title: string;
  projectPath: string;
  provider: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  lastTurnAt: number;
  turnCount: number;
}

function getSessionsDir(): string {
  return path.join(os.homedir(), '.freecode', 'sessions');
}

export function readSessionsDir(): SessionMeta[] {
  const sessionsDir = getSessionsDir();
  const sessions: SessionMeta[] = [];

  if (!fs.existsSync(sessionsDir)) {
    return sessions;
  }

  // Iterate through project directories
  const projectDirs = fs.readdirSync(sessionsDir);
  for (const projectDir of projectDirs) {
    const projectPath = path.join(sessionsDir, projectDir);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    // Iterate through session directories
    const sessionDirs = fs.readdirSync(projectPath);
    for (const sessionDir of sessionDirs) {
      const sessionPath = path.join(projectPath, sessionDir);
      if (!fs.statSync(sessionPath).isDirectory()) continue;

      const metaPath = path.join(sessionPath, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;

      try {
        const content = fs.readFileSync(metaPath, 'utf-8');
        const meta = JSON.parse(content) as SessionMeta;
        sessions.push(meta);
      } catch {
        // Skip invalid meta.json files
      }
    }
  }

  // Sort by lastTurnAt descending
  sessions.sort((a, b) => b.lastTurnAt - a.lastTurnAt);
  return sessions;
}

export function deleteSession(sessionId: string): boolean {
  const sessionsDir = getSessionsDir();

  if (!fs.existsSync(sessionsDir)) {
    return false;
  }

  const projectDirs = fs.readdirSync(sessionsDir);
  for (const projectDir of projectDirs) {
    const projectPath = path.join(sessionsDir, projectDir);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    const sessionPath = path.join(projectPath, sessionId);
    if (fs.existsSync(sessionPath) && fs.statSync(sessionPath).isDirectory()) {
      // Delete session directory recursively
      fs.rmSync(sessionPath, { recursive: true, force: true });
      return true;
    }
  }

  return false;
}