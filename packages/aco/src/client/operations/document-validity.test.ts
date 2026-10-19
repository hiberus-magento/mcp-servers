// Copyright 2026 Hiberus. Licensed under the Apache License, Version 2.0.
//
// RED-first. The fetch double routes on the operation NAME extracted from
// the posted body (`testing/fetch-double.ts`) and never inspects the rest of
// the document, so a document no conformant GraphQL server would accept
// still passes every response-shaped test in this package. Two shipped
// documents sat green that way until a live smoke test ran them:
// `SearchCatalog` declared `$phrase: String` where the field requires
// `String!`, and `FacetValues` declared `$attribute` and never referenced
// it — a document with an unused variable is invalid against EVERY
// GraphQL server, which means that query had never run anywhere.
//
// This scan closes the half of that gap that needs no schema: syntax, and
// variable declaration/use agreement. It CANNOT catch a type mismatch
// against Adobe's schema (`String` vs `String!`, a renamed field, a wrong
// argument name) — all of those need the real schema, which this repository
// deliberately does not fetch. Those stay the job of the per-operation
// document assertions in the sibling `*.test.ts` files.
//
// `graphql` is a devDependency used only here: it supplies the real parser
// rather than a hand-rolled one that could be wrong in its own way. The
// package's runtime `dependencies` stay empty — nothing under `src/` that
// the bundle reaches imports it.
import { Kind, parse, visit } from "graphql";
import { describe, expect, it } from "vitest";
import { collectOperationDocuments, extractDocuments, operationModuleNames } from "../../testing/operation-documents.js";

/**
 * Returns one message per defect, empty when the document is well formed.
 * Variable use is collected document-wide rather than per operation: every
 * document this package ships holds exactly one operation and no fragments,
 * so document-wide and per-operation are the same set here, and the
 * single-operation shape is itself asserted below.
 */
export function documentDefects(document: string): string[] {
  let ast;
  try {
    ast = parse(document);
  } catch (error) {
    return [`is not syntactically valid GraphQL: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`];
  }

  const declared = new Set<string>();
  for (const definition of ast.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) {
      continue;
    }
    for (const variableDefinition of definition.variableDefinitions ?? []) {
      declared.add(variableDefinition.variable.name.value);
    }
  }

  const used = new Set<string>();
  visit(ast, {
    // Skip the declaration subtree, otherwise every declared variable would
    // look used by its own declaration. Default values cannot reference
    // variables, so nothing is lost by skipping the whole node.
    VariableDefinition: () => false,
    Variable: (node) => {
      used.add(node.name.value);
    },
  });

  const defects: string[] = [];
  for (const name of declared) {
    if (!used.has(name)) {
      defects.push(`declares $${name} and never uses it`);
    }
  }
  for (const name of used) {
    if (!declared.has(name)) {
      defects.push(`uses $${name} without declaring it`);
    }
  }
  return defects;
}

describe("documentDefects (proven against synthetic documents)", () => {
  it("accepts a document whose declared variables are all used", () => {
    expect(documentDefects("query ListThings($size: Int) { things(size: $size) { id } }")).toEqual([]);
  });

  it("accepts a document with no variables at all", () => {
    expect(documentDefects("query ListThings { things { id } }")).toEqual([]);
  });

  it("rejects a declared-but-unused variable — invalid against every GraphQL server", () => {
    expect(documentDefects("query ListThings($attribute: String!) { things { id } }")).toEqual(["declares $attribute and never uses it"]);
  });

  it("rejects a used-but-undeclared variable", () => {
    expect(documentDefects("query ListThings { things(size: $size) { id } }")).toEqual(["uses $size without declaring it"]);
  });

  it("rejects an unparseable document", () => {
    const defects = documentDefects("query ListThings { things { id ");
    expect(defects).toHaveLength(1);
    expect(defects[0]).toContain("is not syntactically valid GraphQL");
  });
});

describe("the document collector itself", () => {
  it("finds a document hoisted into a const, which is the shape every operation module uses", () => {
    const source = "const LIST_THINGS_DOCUMENT = `query ListThings { things { id } }`;\n";
    expect(extractDocuments(source, "things.ts")).toEqual([{ file: "things.ts", constName: "LIST_THINGS_DOCUMENT", document: "query ListThings { things { id } }" }]);
  });

  it("finds a document written inline at the `document:` field", () => {
    const source = "transport.execute({ document: `query ListThings { things { id } }` });\n";
    expect(extractDocuments(source, "things.ts")).toEqual([{ file: "things.ts", constName: "<inline>", document: "query ListThings { things { id } }" }]);
  });
});

describe("client/operations/ — every shipped document", () => {
  const documents = collectOperationDocuments();

  // Positive control: a scan that finds nothing passes every assertion
  // below while proving nothing at all. Every operation module must
  // contribute at least one document.
  it("is actually found by the scan — every operation module contributes one", () => {
    expect(documents.length).toBeGreaterThan(0);
    const scannedFiles = new Set(documents.map((entry) => entry.file));
    expect([...scannedFiles].sort()).toEqual(operationModuleNames());
  });

  it("is syntactically valid GraphQL and declares exactly the variables it uses", () => {
    const violations = documents.flatMap((entry) => documentDefects(entry.document).map((defect) => `${entry.file} ${entry.constName}: ${defect}`));
    expect(violations).toEqual([]);
  });

  it("holds exactly one operation, which is what makes the fetch double's name-keyed routing unambiguous", () => {
    // An unparseable document is reported by the assertion above, not here:
    // rethrowing its parse error from this test would replace one clear
    // failure with a stack trace from inside the parser.
    const violations = documents
      .filter((entry) => {
        let operationCount: number;
        try {
          operationCount = parse(entry.document).definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION).length;
        } catch {
          return false;
        }
        return operationCount !== 1;
      })
      .map((entry) => `${entry.file} ${entry.constName}`);
    expect(violations).toEqual([]);
  });
});
