export interface Position {
  line: number;     // 1-based
  column: number;   // 1-based
}

export interface Range {
  start: Position;
  end: Position;
}

export interface RefactorResult {
  success: boolean;
  message: string;
  filesChanged?: string[];
  editDetails?: Array<{
    filePath: string;
    edits: Array<{
      line: number;
      oldText: string;
      newText: string;
    }>;
  }>;
}