import type { ParserStrategy, ParserResult, ParsedResponse, FileChange } from '../types.js';

export class MarkdownExtractor implements ParserStrategy {
  name = 'markdown';

  parse(raw: string): ParserResult {
    const changes: FileChange[] = [];
    const fileBlockRegex = /FILE:\s*(.+?)\n```[\w]*\n([\s\S]*?)```/g;

    let match;
    while ((match = fileBlockRegex.exec(raw)) !== null) {
      changes.push({
        path: match[1].trim(),
        action: 'create',
        content: match[2].trim(),
      });
    }

    if (changes.length === 0) {
      return { success: false, error: 'No file blocks found' };
    }

    const summary = this.extractSummary(raw);

    return {
      success: true,
      response: {
        summary,
        changes,
        raw,
        parserUsed: this.name,
      },
    };
  }

  private extractSummary(raw: string): string {
    const lines = raw.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('```') && !trimmed.startsWith('FILE:')) {
        const cleaned = trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '');
        if (cleaned.length > 10) {
          return cleaned.slice(0, 200);
        }
      }
    }
    return 'Generated file structure';
  }
}