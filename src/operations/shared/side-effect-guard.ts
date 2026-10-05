import type {
  BindingElement,
  BindingName,
  Expression,
  ExpressionStatement,
  Node,
  PropertyDeclaration,
  PropertyName,
  SyntaxKind,
  VariableDeclaration,
} from 'typescript';
import type { TSTextChange } from '../../language-servers/typescript/tsserver-types.js';
import { loadCompiler, type TypeScriptModule } from './typescript-compiler.js';

type Declaration = VariableDeclaration | BindingElement | PropertyDeclaration;

/** A declaration left in place so the code that sets it still runs */
export interface KeptDeclaration {
  name: string;
  line: number;
  cause: 'initializer' | 'assignment';
}

/**
 * Nothing reads `server` in `const server = app.listen(3000)`, but deleting
 * the declaration, as TypeScript's fix does, also stops the server starting.
 * So a declaration the fix would remove whose initializer may have side
 * effects is left as it is, and returned to be named in the result.
 *
 * The fix for a single unused variable deletes each statement assigning to it
 * as well - `handle = setInterval(tick)` goes with `let handle`. Such a
 * variable is kept too, and each write to a kept one is left alone, as
 * deleting a declaration while keeping a write to it breaks the code.
 *
 * Only a declaration or write removed on its own counts. One inside something
 * removed whole - an unused function, whose body never runs - goes with it.
 *
 * `text` must be the one the edits were computed from, as their positions
 * count in it - for fix_all, the text its round started from.
 */
export async function keepSideEffects(
  filePath: string,
  text: string,
  changes: TSTextChange[],
): Promise<{ changes: TSTextChange[]; kept: KeptDeclaration[] }> {
  // Our own TypeScript rather than the project's is enough: it only parses
  // the file to find its declarations
  const ts = await loadCompiler();
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
  );

  // Not getPositionOfLineAndCharacter, which asserts that an offset lies
  // within its line: tsserver puts the end of a file that ends in a line break
  // past that break on the last line, where the compiler starts another
  const lineStarts = sourceFile.getLineStarts();
  const toPosition = ({ line, offset }: TSTextChange['start']) =>
    lineStarts[line - 1] + offset - 1;
  const spans = changes.map((change) => ({
    change,
    start: toPosition(change.start),
    end: toPosition(change.end),
  }));
  const covers = (span: { start: number; end: number }, node: Node) =>
    span.start <= node.getStart(sourceFile) && span.end >= node.end;
  const removedAlone = (node: Node, container: Node) =>
    spans.some(
      (span) =>
        covers(span, node) &&
        // Nothing encloses a top-level declaration, yet deleting a file's
        // only statement covers the whole file
        (ts.isSourceFile(container) || !covers(span, container)),
    );

  const removedDeclarations: Declaration[] = [];
  const removedWrites: Array<{ statement: ExpressionStatement } & Write> = [];

  const visit = (node: Node): void => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isBindingElement(node) ||
      ts.isPropertyDeclaration(node)
    ) {
      if (removedAlone(node, listOf(ts, node).container)) {
        removedDeclarations.push(node);
      }
    } else if (ts.isExpressionStatement(node)) {
      const write = writeOf(ts, node.expression);
      if (write && removedAlone(node, node.parent)) {
        removedWrites.push({ statement: node, ...write });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Matched by name alone: only the fix for one variable deletes writes, and
  // every write it deletes is to that variable
  const writtenWithSideEffects = new Set(
    removedWrites
      .filter(({ mayHaveSideEffects }) => mayHaveSideEffects)
      .map(({ name }) => name),
  );

  const kept: KeptDeclaration[] = [];
  const keptNames = new Set<string>();
  const guarded: Array<{ list: Node; members: readonly Node[] }> = [];

  for (const declaration of removedDeclarations) {
    const names = boundNames(ts, declaration.name);
    const cause = initializerMayHaveSideEffects(ts, declaration)
      ? 'initializer'
      : names.some((name) => writtenWithSideEffects.has(name))
        ? 'assignment'
        : undefined;
    if (!cause) continue;

    kept.push({
      name: names.join(', '),
      line:
        sourceFile.getLineAndCharacterOfPosition(
          declaration.getStart(sourceFile),
        ).line + 1,
      cause,
    });
    for (const name of names) keptNames.add(name);
    guarded.push(listOf(ts, declaration));
  }

  for (const { statement, name } of removedWrites) {
    if (keptNames.has(name)) {
      guarded.push({ list: statement, members: [statement] });
    }
  }

  // Every edit to a guarded list goes, not just the kept member's: removing
  // the last member also removes the separator before it as an edit of its
  // own, and each of those edits assumes the rest are applied too. An edit
  // wholly inside a member - within a function in its initializer - is not
  // part of the list, and stays
  const disturbsGuardedList = (span: { start: number; end: number }) =>
    guarded.some(
      ({ list, members }) =>
        span.start < list.end &&
        span.end > list.getStart(sourceFile) &&
        !members.some(
          (member) =>
            member.getStart(sourceFile) < span.start && span.end < member.end,
        ),
    );

  return {
    changes: spans
      .filter((span) => !disturbsGuardedList(span))
      .map(({ change }) => change),
    kept,
  };
}

/**
 * The list a declaration is a member of, which TypeScript's fix edits as a
 * whole, and the node around it that only an edit removing something larger -
 * the enclosing function or class, or the whole destructuring - would cover
 */
function listOf(
  ts: TypeScriptModule,
  declaration: Declaration,
): { list: Node; members: readonly Node[]; container: Node } {
  const { parent } = declaration;

  if (ts.isVariableDeclarationList(parent)) {
    const container = ts.isVariableStatement(parent.parent)
      ? parent.parent.parent
      : parent.parent;
    return { list: parent, members: parent.declarations, container };
  }

  if (ts.isObjectBindingPattern(parent) || ts.isArrayBindingPattern(parent)) {
    return { list: parent, members: parent.elements, container: parent };
  }

  return { list: declaration, members: [declaration], container: parent };
}

/**
 * A destructured name's default and computed key are evaluated along with it,
 * and a destructuring declaration's pattern holds its elements' defaults
 */
function initializerMayHaveSideEffects(
  ts: TypeScriptModule,
  declaration: Declaration,
): boolean {
  const parts: Array<Node | undefined> = [
    declaration.name,
    declaration.initializer,
    ts.isBindingElement(declaration) ? declaration.propertyName : undefined,
  ];

  return parts.some(
    (part) => part !== undefined && mayHaveSideEffects(ts, part),
  );
}

/**
 * Whether evaluating `node` can do more than produce a value. The body of a
 * function or method runs only when it is called, so only a computed name -
 * evaluated where the function is defined - is looked into.
 */
function mayHaveSideEffects(ts: TypeScriptModule, node: Node): boolean {
  if (ts.isFunctionLike(node)) {
    return (
      node.name !== undefined &&
      ts.isComputedPropertyName(node.name) &&
      mayHaveSideEffects(ts, node.name)
    );
  }

  if (
    ts.isCallExpression(node) ||
    ts.isNewExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isYieldExpression(node) ||
    ts.isDeleteExpression(node) ||
    ts.isTaggedTemplateExpression(node) ||
    updatedOperand(ts, node) !== undefined ||
    (ts.isBinaryExpression(node) && isAssignment(ts, node.operatorToken.kind))
  ) {
    return true;
  }

  return (
    ts.forEachChild(
      node,
      (child) => mayHaveSideEffects(ts, child) || undefined,
    ) ?? false
  );
}

/** The name a write assigns to, and whether the value it assigns may have side effects */
interface Write {
  name: string;
  mayHaveSideEffects: boolean;
}

/**
 * The write a statement's expression makes to a variable or a property of
 * `this`, the only kinds TypeScript's fix deletes. `x++` writes nothing but
 * its own target, so only an assigned value can have side effects.
 */
function writeOf(
  ts: TypeScriptModule,
  expression: Expression,
): Write | undefined {
  let target = updatedOperand(ts, expression);
  let value: Expression | undefined;

  if (
    ts.isBinaryExpression(expression) &&
    isAssignment(ts, expression.operatorToken.kind)
  ) {
    target = expression.left;
    value = expression.right;
  }
  if (!target) return undefined;

  const name = ts.isIdentifier(target)
    ? target.text
    : ts.isPropertyAccessExpression(target) &&
        target.expression.kind === ts.SyntaxKind.ThisKeyword
      ? target.name.text
      : undefined;
  if (name === undefined) return undefined;

  return {
    name,
    mayHaveSideEffects: value !== undefined && mayHaveSideEffects(ts, value),
  };
}

/** The operand of `++` or `--`, either side */
function updatedOperand(
  ts: TypeScriptModule,
  node: Node,
): Expression | undefined {
  if (ts.isPostfixUnaryExpression(node)) return node.operand;
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return node.operand;
  }
  return undefined;
}

/** `=` or a compound assignment such as `+=` or `??=` */
function isAssignment(ts: TypeScriptModule, kind: SyntaxKind): boolean {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

/** Every name a declaration binds, reading through destructuring patterns */
function boundNames(
  ts: TypeScriptModule,
  name: BindingName | PropertyName,
): string[] {
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) =>
      ts.isBindingElement(element) ? boundNames(ts, element.name) : [],
    );
  }

  return [name.getText()];
}

const KEPT_BECAUSE = {
  initializer: [
    'declaration whose initializer',
    'declarations whose initializers',
  ],
  assignment: [
    'declaration whose assignments',
    'declarations whose assignments',
  ],
} as const;

export function describeKept(
  kept: KeptDeclaration[],
  preview: boolean,
): string {
  return Object.entries(KEPT_BECAUSE)
    .map(([cause, [one, many]]) => {
      const group = kept.filter((declaration) => declaration.cause === cause);
      if (group.length === 0) return '';

      const names = group.map(({ name, line }) => `${name} (line ${line})`);
      return `. ${preview ? 'Would keep' : 'Kept'} ${group.length} unused ${group.length === 1 ? one : many} may have side effects: ${names.join(', ')}`;
    })
    .join('');
}
