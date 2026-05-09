export type FileAction = 'create' | 'write' | 'delete';

export interface FileChange {
  path: string;
  action: FileAction;
  content?: string;
}

export interface ParsedResponse {
  summary: string;
  changes: FileChange[];
  raw: string;
  parserUsed: string;
}

export interface ParserStrategy {
  name: string;
  parse(raw: string): ParserResult;
}

export interface ParserResult {
  success: boolean;
  response?: ParsedResponse;
  error?: string;
}