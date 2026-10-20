import { ts, type SourceFile } from "ts-morph";
import type { EdgeKind } from "./types.ts";

export type ImportSite = {
  kind: EdgeKind;
  // Null when the specifier is computed at runtime and can't be read.
  specifier: string | null;
  // The expression as written, for reporting a computed specifier.
  text: string;
  line: number;
  typeOnly: boolean;
};

function literalValue(node: ts.Node | undefined): string | null {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text;
  }
  return null;
}

// Every place the file names another module. Walks the raw compiler tree
// rather than ts-morph wrappers: wrapping every node of a large repository
// costs more than the parse itself.
export function readImports(sourceFile: SourceFile): ImportSite[] {
  const file = sourceFile.compilerNode;
  const sites: ImportSite[] = [];

  const add = (
    kind: EdgeKind,
    at: ts.Node,
    specifierNode: ts.Node | undefined,
    typeOnly: boolean,
  ) => {
    sites.push({
      kind,
      specifier: literalValue(specifierNode),
      text: specifierNode ? specifierNode.getText(file) : "",
      line: file.getLineAndCharacterOfPosition(at.getStart(file)).line + 1,
      typeOnly,
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      add("import", node, node.moduleSpecifier, node.importClause?.isTypeOnly ?? false);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add("re_export", node, node.moduleSpecifier, node.isTypeOnly);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      // `import x = require("y")` is a require that TypeScript spells differently.
      add("require", node, node.moduleReference.expression, node.isTypeOnly);
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add("dynamic_import", node, node.arguments[0], false);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        add("require", node, node.arguments[0], false);
      }
    } else if (ts.isImportTypeNode(node)) {
      const argument = ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument;
      add("import", node, argument, true);
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return sites;
}
