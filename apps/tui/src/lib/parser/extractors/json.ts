import type { ParserStrategy, ParserResult, ParsedResponse, FileChange } from '../types.js';

export class JsonExtractor implements ParserStrategy {
  name = 'json';

  parse(raw: string): ParserResult {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        return { success: false, error: 'No JSON found' };
      }

      const parsed = JSON.parse(match[0]);
      const changes: FileChange[] = (parsed.changes || []).map((c: any) => ({
        path: c.file || c.path,
        action: (c.action || 'create') as FileChange['action'],
        content: c.content || c.code,
      }));

      if (changes.length === 0) {
        return { success: false, error: 'No changes in JSON' };
      }

      return {
        success: true,
        response: {
          summary: parsed.summary || parsed.description || 'Generated structure',
          changes,
          raw,
          parserUsed: this.name,
        },
      };
    } catch (error) {
      return { success: false, error: `JSON parse error: ${error}` };
    }
  }
}