import type { ParserStrategy, ParserResult, FileChange } from '../types.js';

export class StructuredExtractor implements ParserStrategy {
  name = 'structured';

  parse(raw: string): ParserResult {
    const changes: FileChange[] = [];

    // Pattern 1: FILE: path followed by code block ```...```
    const codeBlockPattern = /FILE:\s*(.+?)\n```[\w]*\n([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockPattern.exec(raw)) !== null) {
      const path = match[1].trim();
      const content = match[2].trim();
      if (path && content && !changes.some(c => c.path === path)) {
        changes.push({ path, action: 'create', content });
      }
    }

    // Pattern 2: FILE: path followed by content (no code block)
    // Matches "FILE: path\n\nContent until next FILE: or end"
    const noCodeBlockPattern = /FILE:\s*([^\n]+)\n\n([\s\S]*?)(?=\nFILE:|$)/g;
    while ((match = noCodeBlockPattern.exec(raw)) !== null) {
      const path = match[1].trim();
      let content = match[2];

      // Skip if content starts with header-like text that indicates bad match
      if (content.startsWith('Markdown\n') || content.startsWith('markdown\n') ||
          content.startsWith('Json\n') || content.startsWith('json\n')) {
        content = content.replace(/^(?:Markdown|Json)\n*/i, '');
      }

      if (path && content && content.length > 5 && !changes.some(c => c.path === path)) {
        changes.push({ path, action: 'create', content: content.trim() });
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
    // Remove FILE: lines and code blocks for summary extraction
    const cleaned = raw
      .replace(/FILE:\s*[^\n]+\n?/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^#+\s*/gm, '')
      .trim();

    const lines = cleaned.split('\n').filter(l => l.trim().length > 10);
    if (lines.length > 0) {
      return lines[0].slice(0, 200);
    }
    return 'Generated file structure';
  }
}