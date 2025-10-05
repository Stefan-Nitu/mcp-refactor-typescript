/**
 * TypeScript server protocol types
 * Based on TypeScript's tsserver protocol
 */

interface TSPosition {
  line: number;
  offset: number;
}

interface TSTextSpan {
  start: TSPosition;
  end: TSPosition;
}

export interface TSTextChange {
  start: TSPosition;
  end: TSPosition;
  newText: string;
}

export interface TSFileEdit {
  fileName: string;
  textChanges: TSTextChange[];
}

export interface TSRenameLoc {
  start: TSPosition;
  end: TSPosition;
}

interface TSRenameFileLocation {
  file: string;
  locs: TSRenameLoc[];
}

export interface TSRenameResponse {
  info: {
    canRename: boolean;
    displayName?: string;
    fullDisplayName?: string;
    kind?: string;
    kindModifiers?: string;
    triggerSpan?: TSTextSpan;
  };
  locs: TSRenameFileLocation[];
}

export interface TSRefactorInfo {
  name: string;
  description: string;
  actions: TSRefactorAction[];
  inlineable?: boolean;
}

export interface TSRefactorAction {
  name: string;
  description: string;
  notApplicableReason?: string;
}

export interface TSRefactorEditInfo {
  edits: TSFileEdit[];
  renameFilename?: string;
  renameLocation?: TSPosition;
}

export interface TSCodeFixAction {
  description: string;
  changes: TSFileEdit[];
  commands?: unknown[];
  fixName?: string;
  fixId?: string;
  fixAllDescription?: string;
}

export interface TSOrganizeImportsResponse {
  fileName: string;
  textChanges: TSTextChange[];
}

export interface TSReferenceEntry {
  file: string;
  start: TSPosition;
  end: TSPosition;
  lineText: string;
  isWriteAccess: boolean;
  isDefinition?: boolean;
}

export interface TSReferencesResponse {
  symbolName: string;
  symbolStartOffset: number;
  symbolDisplayString: string;
  refs: TSReferenceEntry[];
}
