import path from "node:path";

/**
 * Forbids importing server-only code (src/server/**) into browser code.
 *
 * Options: [{ always: boolean }]
 * - always: false (default) -> only checks files that start with the "use client" directive
 * - always: true            -> checks every file (used for src/components/** and src/lib/client/**)
 *
 * Catches both the alias form (`@/server/...`) and relative paths that land inside src/server.
 */
const SERVER_DIR = `${path.sep}src${path.sep}server`;

function isClientFile(program) {
  for (const node of program.body) {
    if (node.type !== "ExpressionStatement" || typeof node.directive !== "string") break;
    if (node.directive === "use client") return true;
  }
  return false;
}

function isServerImport(source, filename) {
  if (source === "@/server" || source.startsWith("@/server/")) return true;
  if (source.startsWith(".")) {
    const resolved = path.resolve(path.dirname(filename), source);
    return resolved.includes(`${SERVER_DIR}${path.sep}`) || resolved.endsWith(SERVER_DIR);
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
export const noServerInClient = {
  meta: {
    type: "problem",
    docs: { description: "Disallow importing src/server code into client code" },
    schema: [
      {
        type: "object",
        properties: { always: { type: "boolean" } },
        additionalProperties: false,
      },
    ],
    messages: {
      forbidden:
        "'{{source}}' is server-only code. Client code must call the API (/api/...) instead of importing src/server.",
    },
  },
  create(context) {
    const always = context.options[0]?.always === true;
    if (!always && !isClientFile(context.sourceCode.ast)) return {};

    const check = (sourceNode) => {
      if (!sourceNode || sourceNode.type !== "Literal" || typeof sourceNode.value !== "string") {
        return;
      }
      if (isServerImport(sourceNode.value, context.filename)) {
        context.report({
          node: sourceNode,
          messageId: "forbidden",
          data: { source: sourceNode.value },
        });
      }
    };

    return {
      ImportDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
    };
  },
};

const localRulesPlugin = {
  meta: { name: "local" },
  rules: { "no-server-in-client": noServerInClient },
};

export default localRulesPlugin;
