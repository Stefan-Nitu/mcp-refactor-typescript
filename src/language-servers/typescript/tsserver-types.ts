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

export interface TSDiagnostic {
  start?: number;
  length?: number;
  startLocation?: TSPosition;
  endLocation?: TSPosition;
  message: string;
  code: number;
  category: string;
  source?: string;
  reportsUnnecessary?: boolean;
}

export interface TSCombinedCodeFix {
  changes: TSFileEdit[];
  commands?: unknown[];
}

export enum IndentStyle {
  None = 0,
  Block = 1,
  Smart = 2
}

export interface EditorSettings {
  baseIndentSize?: number;
  indentSize?: number;
  tabSize?: number;
  newLineCharacter?: string;
  convertTabsToSpaces?: boolean;
  indentStyle?: IndentStyle;
  trimTrailingWhitespace?: boolean;
}

export interface FormatCodeSettings extends EditorSettings {
  readonly insertSpaceAfterCommaDelimiter?: boolean;
  readonly insertSpaceAfterSemicolonInForStatements?: boolean;
  readonly insertSpaceBeforeAndAfterBinaryOperators?: boolean;
  readonly insertSpaceAfterConstructor?: boolean;
  readonly insertSpaceAfterKeywordsInControlFlowStatements?: boolean;
  readonly insertSpaceAfterFunctionKeywordForAnonymousFunctions?: boolean;
  readonly insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis?: boolean;
  readonly insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets?: boolean;
  readonly insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces?: boolean;
  readonly insertSpaceAfterOpeningAndBeforeClosingEmptyBraces?: boolean;
  readonly insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces?: boolean;
  readonly insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces?: boolean;
  readonly insertSpaceAfterTypeAssertion?: boolean;
  readonly insertSpaceBeforeFunctionParenthesis?: boolean;
  readonly placeOpenBraceOnNewLineForFunctions?: boolean;
  readonly placeOpenBraceOnNewLineForControlBlocks?: boolean;
  readonly insertSpaceBeforeTypeAnnotation?: boolean;
  readonly indentMultiLineObjectLiteralBeginningOnBlankLine?: boolean;
  readonly indentSwitchCase?: boolean;
}
