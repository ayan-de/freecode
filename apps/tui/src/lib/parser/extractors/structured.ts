import type { ParserStrategy, ParserResult, FileChange } from '../types.js';

export class StructuredExtractor implements ParserStrategy {
  name = 'structured';

  parse(raw: string): ParserResult {
    const changes: FileChange[] = [];

    const patterns = [
      /FILE:\s*(.+?)\n```[\w]*\n([\s\S]*?)```/g,
      /<file\s+path="(.+?)"[^>]*>([\s\S]*?)<\/file>/gi,
      /^(.+?\.ts)\n```[\w]*\n([\s\S]*?)```/gm,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(raw)) !== null) {
        const path = match[1].trim();
        const content = match[2].trim();

        if (path && content && !changes.some(c => c.path === path)) {
          changes.push({ path, action: 'create', content });
        }
      }
    }

    if (changes.length === 0) {
      return { success: false, error: 'No structured file blocks found' };
    }

    return {
      success: true,
      response: {
        summary: this.extractSummary(raw),
        changes,
        raw,
        parserUsed: this.name,
      },
    };
  }

  private extractSummary(raw: string): string {
    const match = raw.match(/^(?!```|FILE:|>|\s)(.+)/m);
    return match ? match[1].trim().slice(0, 200) : 'Generated file structure';
  }
}