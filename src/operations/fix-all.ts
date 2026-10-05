/**
 * Fix all operation handler
 */

import { z } from 'zod';
import type {
  RefactorResult,
  TypeScriptServer,
} from '../language-servers/typescript/tsserver-client.js';
import type {
  TSCodeFixAction,
  TSCombinedCodeFix,
  TSDiagnostic,
  TSFileEdit,
  TSTextChange,
} from '../language-servers/typescript/tsserver-types.js';
import { formatValidationError } from '../utils/validation-error.js';
import type { EditApplicator } from './shared/edit-applicator.js';
import type { FileOperations } from './shared/file-operations.js';
import {
  describeKept,
  type KeptDeclaration,
  keepSideEffects,
} from './shared/side-effect-guard.js';
import type { TSServerGuard } from './shared/tsserver-guard.js';

export const fixAllSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  preview: z.boolean().optional(),
});

// A fix can leave an error of its own behind, whose fix can leave another
const MAX_ROUNDS = 10;

// The fixName of TypeScript's fixes for unused code, and the prefix of the
// fixIds of their families: unusedIdentifier_delete, _deleteImports and more
const UNUSED_IDENTIFIER = 'unusedIdentifier';

/** A file as the fixes so far leave it, with the edits that got it there */
interface StagedFile {
  lines: string[];
  change: RefactorResult['filesChanged'][number];
}

/** One round's fix, and whether it is one of TypeScript's for unused code */
interface ChosenFix {
  fileEdits: TSFileEdit[];
  removesUnused: boolean;
}

export class FixAllOperation {
  constructor(
    private tsServer: TypeScriptServer,
    private fileOps: FileOperations,
    private editApplicator: EditApplicator,
    private tsServerGuard: TSServerGuard,
    private maxRounds = MAX_ROUNDS,
  ) {}

  async execute(input: Record<string, unknown>): Promise<RefactorResult> {
    try {
      const validated = fixAllSchema.parse(input);
      const filePath = this.fileOps.resolvePath(validated.filePath);

      const guardResult = await this.tsServerGuard.ensureReady();
      if (guardResult) return guardResult;

      await this.tsServer.openFile(filePath);

      try {
        return await this.fixFile(filePath, validated.preview ?? false);
      } finally {
        // Each round hands tsserver the files as its fix leaves them, which a
        // preview or a failure never writes, so they are sent back as the
        // disk holds them. A tsserver that has exited holds nothing to restore
        if (this.tsServer.isRunning()) await this.tsServer.syncOpenFiles();
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return formatValidationError(error);
      }

      return {
        success: false,
        message: `Fix all failed: ${error instanceof Error ? error.message : String(error)}

Try:
  1. Ensure the file exists and is a valid TypeScript file
  2. Check that TypeScript can compile the file
  3. Some errors may not be auto-fixable`,
        filesChanged: [],
      };
    }
  }

  private async fixFile(
    filePath: string,
    preview: boolean,
  ): Promise<RefactorResult> {
    let diagnostics = await this.getDiagnostics(filePath);

    if (diagnostics.length === 0) {
      return {
        success: true,
        message: 'No fixes needed',
        filesChanged: [],
      };
    }

    // One fix per round, computed from the text the rounds before it left.
    // A family held back because it competes with the fix some error prefers
    // - stubs for names that can be imported - is free to go once those
    // errors are fixed, and fixes computed from the same text can collide
    const staged = new Map<string, StagedFile>();
    // An error whose declaration is kept is marked fixed along with the rest
    // its fix reached, as chooseFix marks every error it picks a fix for, so
    // no later round offers that declaration's removal again
    const fixedErrors = new Set<string>();
    const kept: KeptDeclaration[] = [];
    let editCount = 0;
    let fixesLeft = false;

    for (let round = 0; diagnostics.length > 0; round++) {
      const fix = await this.chooseFix(filePath, diagnostics, fixedErrors);
      if (!fix) break;

      // Checked once the next fix is known, so a limit reached just as the
      // fixes ran out is not reported as leaving any
      if (round === this.maxRounds) {
        fixesLeft = true;
        break;
      }

      const fileEdits = fix.removesUnused
        ? await this.keepSideEffects(fix.fileEdits, staged, kept)
        : fix.fileEdits;
      editCount += await this.stage(fileEdits, staged);
      diagnostics = await this.getDiagnostics(filePath);
    }

    const keptNote = describeKept(kept, preview);

    if (staged.size === 0) {
      return {
        success: true,
        message: `No auto-fixable errors found${keptNote}`,
        filesChanged: [],
      };
    }

    const filesChanged = Array.from(staged.values(), ({ change }) => change);
    const limitNote = fixesLeft
      ? ` - stopped after ${this.maxRounds} round(s) with fixable errors left; run fix_all again`
      : '';

    if (preview) {
      return {
        success: true,
        message: `Preview: Would apply ${editCount} fix(es) in ${staged.size} file(s)${limitNote}${keptNote}`,
        filesChanged,
        preview: {
          filesAffected: staged.size,
          estimatedTime: '< 1s',
          command: 'Run again with preview: false to apply changes',
        },
      };
    }

    // Every file is read and computed before any is written, so a failure
    // part-way cannot leave the fix applied to some files and not others
    for (const [path, { lines }] of staged) {
      await this.fileOps.writeLines(path, lines);
    }

    return {
      success: true,
      message: `Applied ${editCount} fix(es) in ${staged.size} file(s)${limitNote}${keptNote}`,
      filesChanged,
      nextActions: ['organize_imports - Clean up imports after fixes'],
    };
  }

  /**
   * Picks the fix for one round, or returns null when no error is left to
   * fix. The fixes tsserver offers for an error are alternatives, the one it
   * prefers first - importing an unresolved name before declaring a stub for
   * it - and applying two leaves code that does not compile. A family's
   * combined fix reaches every error in the file it can fix, so it is taken
   * only when each of those errors prefers it and has had no fix yet; failing
   * that, one error gets the fix it prefers, alone.
   */
  private async chooseFix(
    filePath: string,
    diagnostics: TSDiagnostic[],
    fixedErrors: Set<string>,
  ): Promise<ChosenFix | null> {
    const offers: Array<{ error: string; fixes: TSCodeFixAction[] }> = [];
    for (const diagnostic of diagnostics) {
      const fixes = await this.getCodeFixes(filePath, diagnostic);
      if (fixes.length > 0) {
        // Known by its message, as each round's edits move its position
        const error = `${diagnostic.code} ${diagnostic.message}`;
        offers.push({ error, fixes });
      }
    }

    // Held back from any error it would give a second fix: one that prefers
    // another, or one still here after its own fix, which would get it again
    const heldBack = new Set<string>();
    for (const { error, fixes } of offers) {
      for (const { fixId } of fixes) {
        if (fixId && (fixId !== fixes[0].fixId || fixedErrors.has(error))) {
          heldBack.add(fixId);
        }
      }
    }

    const unfixed = offers.filter(({ error }) => !fixedErrors.has(error));
    const fixId = unfixed
      .map(({ fixes }) => fixes[0].fixId)
      .find((id) => id !== undefined && !heldBack.has(id));

    if (fixId) {
      for (const { error, fixes } of unfixed) {
        if (fixes[0].fixId === fixId) fixedErrors.add(error);
      }

      const combinedFix = await this.tsServer.sendRequest<TSCombinedCodeFix>(
        'getCombinedCodeFix',
        {
          scope: {
            type: 'file',
            args: { file: filePath },
          },
          fixId,
        },
      );
      return {
        fileEdits: combinedFix?.changes ?? [],
        removesUnused: fixId.startsWith(`${UNUSED_IDENTIFIER}_`),
      };
    }

    // Its fix has no fixId - tsserver leaves it off when the file has one
    // error of the kind - or a family held back, which cannot be applied to
    // the file as a whole
    const [next] = unfixed;
    if (!next) return null;

    fixedErrors.add(next.error);
    return {
      fileEdits: next.fixes[0].changes ?? [],
      removesUnused: next.fixes[0].fixName === UNUSED_IDENTIFIER,
    };
  }

  /**
   * Leaves out the edits that would delete a declaration whose initializer
   * may have side effects, and records each one kept. Judged on each file as
   * the rounds before left it, which is the text tsserver computed this
   * round's fix from and the one its positions count in.
   */
  private async keepSideEffects(
    fileEdits: TSFileEdit[],
    staged: Map<string, StagedFile>,
    kept: KeptDeclaration[],
  ): Promise<TSFileEdit[]> {
    const guarded: TSFileEdit[] = [];

    for (const { fileName, textChanges } of fileEdits) {
      const lines =
        staged.get(fileName)?.lines ?? (await this.fileOps.readLines(fileName));
      const result = await keepSideEffects(
        fileName,
        lines.join('\n'),
        textChanges,
      );

      kept.push(...result.kept);
      // A file left with no edit is not staged: it would be written unchanged
      // and counted among the files fixed
      if (result.changes.length > 0) {
        guarded.push({ fileName, textChanges: result.changes });
      }
    }

    return guarded;
  }

  /**
   * Applies one round's edits to the files as the rounds before it left
   * them, and hands tsserver the result for the next round to be computed
   * from. Returns the number of edits.
   */
  private async stage(
    fileEdits: TSFileEdit[],
    staged: Map<string, StagedFile>,
  ): Promise<number> {
    // A fix is free to edit a file other than the one asked about - making
    // a symbol exported from the module that declares it, for one - so the
    // edits are grouped by the file each lands in rather than filtered to
    // the requested one, which used to drop them silently
    const changesByFile = new Map<string, TSTextChange[]>();
    for (const fileEdit of fileEdits) {
      const existing = changesByFile.get(fileEdit.fileName) ?? [];
      existing.push(...fileEdit.textChanges);
      changesByFile.set(fileEdit.fileName, existing);
    }

    let editCount = 0;

    for (const [path, textChanges] of changesByFile) {
      const file = staged.get(path);
      const lines = file?.lines ?? (await this.fileOps.readLines(path));
      const sortedChanges = this.editApplicator.sortEdits(textChanges);
      const change = this.editApplicator.buildFileChanges(
        lines,
        sortedChanges,
        path,
      );
      // Split again because an edit that inserts a line break leaves it inside
      // one entry, where the next round's line numbers, counting it, miss
      const fixedText = this.editApplicator
        .applyEdits(lines, sortedChanges)
        .join('\n');
      const fixedLines = fixedText.split('\n');

      if (file) {
        file.lines = fixedLines;
        file.change.edits.push(...change.edits);
      } else {
        staged.set(path, { lines: fixedLines, change });
      }

      await this.tsServer.openFileWithContent(path, fixedText);
      editCount += sortedChanges.length;
    }

    return editCount;
  }

  private async getDiagnostics(filePath: string): Promise<TSDiagnostic[]> {
    const diagnostics = await this.tsServer.sendRequest<TSDiagnostic[]>(
      'semanticDiagnosticsSync',
      {
        file: filePath,
        includeLinePosition: true,
      },
    );
    return diagnostics ?? [];
  }

  private async getCodeFixes(
    filePath: string,
    diagnostic: TSDiagnostic,
  ): Promise<TSCodeFixAction[]> {
    const startLine = diagnostic.startLocation?.line ?? 1;
    const startOffset = diagnostic.startLocation?.offset ?? 1;
    const endLine = diagnostic.endLocation?.line ?? startLine;
    const endOffset = diagnostic.endLocation?.offset ?? startOffset;

    const fixes = await this.tsServer.sendRequest<TSCodeFixAction[]>(
      'getCodeFixes',
      {
        file: filePath,
        startLine,
        endLine,
        startOffset,
        endOffset,
        errorCodes: [diagnostic.code],
      },
    );
    return fixes ?? [];
  }
}
