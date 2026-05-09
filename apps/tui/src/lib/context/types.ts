export interface ProjectContext {
  projectPath: string;
  name: string;
  tree: string;
  files: Record<string, string>;
  metadata: ContextMetadata;
}

export interface ContextMetadata {
  collectedAt: number;
  fileCount: number;
  totalSize: number;
}

export interface ContextStrategy {
  name: string;
  collect(projectPath: string, options?: ContextOptions): Promise<ProjectContext>;
}

export interface ContextOptions {
  maxDepth?: number;
  ignorePatterns?: string[];
  includePatterns?: string[];
}