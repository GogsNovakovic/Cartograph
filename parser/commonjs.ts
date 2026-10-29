import { ts, type SourceFile } from "ts-morph";
import type { CommonJsExports } from "./types.ts";

// What a CommonJS module hands to whoever requires it, read from its writes
// to module.exports and exports. Only top-level statements are read: they run
// once, in order, so the result is exact. A write anywhere else (inside a
// function, behind an `if`) or the exports object passed somewhere that could
// change it makes the whole list unreadable rather than partly right.

type Target =
  | { kind: "replace"; ref: ts.Node }
  | { kind: "alias"; ref: ts.Node }
  | { kind: "name"; ref: ts.Node; name: string; viaModule: boolean };

function isModuleExports(node: ts.Node): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "module" &&
    node.name.text === "exports"
  );
}

function isExportsIdentifier(node: ts.Node): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text === "exports";
}

// A key written so its name can be read: `a`, `"a"`, `1`.
function keyName(name: ts.Node): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

// `module.exports` / `exports` / `module.exports.x` / `exports["x"]`, or null
// for anything else being assigned to.
function targetOf(node: ts.Expression): Target | null {
  if (isModuleExports(node)) return { kind: "replace", ref: node };
  if (isExportsIdentifier(node)) return { kind: "alias", ref: node };
  let object: ts.Expression;
  let name: string | null;
  if (ts.isPropertyAccessExpression(node)) {
    object = node.expression;
    name = node.name.text;
  } else if (ts.isElementAccessExpression(node)) {
    object = node.expression;
    name = keyName(node.argumentExpression);
  } else {
    return null;
  }
  if (!isModuleExports(object) && !isExportsIdentifier(object)) return null;
  // A computed key names nothing that can be read; the walk below reports it.
  if (name === null) return null;
  return { kind: "name", ref: object, name, viaModule: isModuleExports(object) };
}

type Value = { names: string[]; wholeValue: boolean } | { reason: string };

// What replacing module.exports with `value` exports.
function readValue(value: ts.Expression, line: number): Value {
  if (ts.isParenthesizedExpression(value)) return readValue(value.expression, line);
  if (ts.isObjectLiteralExpression(value)) {
    const names: string[] = [];
    for (const property of value.properties) {
      const name =
        ts.isSpreadAssignment(property) || property.name === undefined ? null : keyName(property.name);
      if (name === null) {
        return { reason: `module.exports is set at line ${line} to an object whose keys are not all written out` };
      }
      if (!names.includes(name)) names.push(name);
    }
    return { names, wholeValue: false };
  }
  // Hands on another module's exports, which would mean reading that file.
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "require") {
    return { reason: `module.exports is set at line ${line} to whatever ${value.arguments[0]?.getText() ?? "a module"} exports` };
  }
  // A function, a class, an instance: the module is that one value.
  return { names: [], wholeValue: true };
}

function isAssignmentTarget(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && parent.left === node) {
    const op = parent.operatorToken.kind;
    return op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment;
  }
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    return parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken;
  }
  return ts.isDeleteExpression(parent);
}

// Every place the file refers to module.exports or the exports object, as
// an expression rather than a name that happens to be "exports".
function references(file: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (isModuleExports(node)) {
      found.push(node);
      return;
    }
    if (isExportsIdentifier(node)) {
      const parent = node.parent;
      const isName = !ts.isShorthandPropertyAssignment(parent) && "name" in parent && parent.name === node;
      if (!isName) found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export function readCommonJsExports(sourceFile: SourceFile): CommonJsExports | null {
  const file = sourceFile.compilerNode;
  const lineOf = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

  let names: string[] = [];
  let wholeValue = false;
  // Whether `exports` still points at the object module.exports holds.
  // Replacing module.exports alone breaks that; `exports = module.exports =`
  // keeps it.
  let aliased = true;
  let exportEquals = false;
  const handled = new Set<ts.Node>();

  for (const statement of file.statements) {
    // TypeScript's spelling of `module.exports = value`.
    if (ts.isExportAssignment(statement) && statement.isExportEquals) {
      const value = readValue(statement.expression, lineOf(statement));
      if ("reason" in value) return { exact: false, line: lineOf(statement), reason: value.reason };
      ({ names, wholeValue } = value);
      exportEquals = true;
      continue;
    }
    if (!ts.isExpressionStatement(statement)) continue;

    // `a = b = value`: every target gets the same value.
    const targets: Target[] = [];
    let value = statement.expression;
    while (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = targetOf(value.left);
      if (target) targets.push(target);
      value = value.right;
    }
    if (targets.length === 0) continue;
    for (const target of targets) handled.add(target.ref);

    const line = lineOf(statement);
    const replaces = targets.some((target) => target.kind === "replace");
    const realiases = targets.some((target) => target.kind === "alias");
    // The rightmost assignment happens first, so a replacement lands before
    // any name written in the same chain.
    if (replaces) {
      const read = readValue(value, line);
      if ("reason" in read) return { exact: false, line, reason: read.reason };
      ({ names, wholeValue } = read);
      aliased = realiases;
    } else if (realiases) {
      aliased = false;
    }
    for (const target of targets) {
      // `exports.x` after module.exports was replaced writes to an object
      // nothing requiring this file ever sees.
      if (target.kind !== "name" || (!target.viaModule && !aliased)) continue;
      if (!names.includes(target.name)) names.push(target.name);
    }
  }

  const refs = references(file);
  if (refs.length === 0 && !exportEquals) return null;

  for (const ref of refs) {
    if (handled.has(ref)) continue;
    // Reading a property (`exports.helper()`) changes nothing.
    const parent = ref.parent;
    const isRead =
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
      parent.expression === ref &&
      !isAssignmentTarget(parent);
    if (isRead) continue;
    const written = ref.getText(file);
    return {
      exact: false,
      line: lineOf(ref),
      reason: isAssignmentTarget(ref) || isAssignmentTarget(parent)
        ? `${written} is written at line ${lineOf(ref)} somewhere that may not run once, in order`
        : `${written} is handed to other code at line ${lineOf(ref)}, which could change it`,
    };
  }
  return { exact: true, names, wholeValue };
}
