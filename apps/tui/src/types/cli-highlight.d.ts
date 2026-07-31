declare module 'cli-highlight' {
  export interface HighlightOptions {
    language?: string;
    theme?: Record<string, any>;
    ignoreIllegals?: boolean;
  }
  export function highlight(code: string, options?: HighlightOptions): string;
  export function supportsLanguage(name: string): boolean;
}
