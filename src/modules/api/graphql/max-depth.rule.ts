import {
  GraphQLError,
  Kind,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
} from 'graphql';

/**
 * How deep a query may nest, refused during validation and therefore before a
 * single resolver runs.
 *
 * Written here rather than taken from a plugin because the published ones
 * *throw* out of the validation phase instead of reporting through it, which
 * turns a client's mistake into our internal error and loses the registry code
 * with it. The rule itself is a depth count over the selection set; what a
 * dependency would have added is the part that was wrong.
 *
 * A depth limit and not a cost analyser: the schema is shallow and
 * non-recursive, and the amplification this API has is a stream of distinct
 * city names, which the inbound limit is what bounds
 * (design.md, Decision 5).
 */
export function maxDepthRule(limit: number): ValidationRule {
  return (context: ValidationContext) => ({
    OperationDefinition(operation) {
      const depth = depthOf(operation.selectionSet, context, new Set());

      if (depth > limit) {
        context.reportError(
          new GraphQLError(
            `a query may nest ${limit} levels deep, and this one nests ${depth}`,
            { nodes: [operation], extensions: { code: 'INVALID_QUERY' } },
          ),
        );
      }
    },
  });
}

/**
 * The deepest path through a selection set.
 *
 * A fragment costs no level of its own — it is a way of writing a selection,
 * not a step in the data — and a fragment already on the path is not followed
 * again, so a cyclic pair cannot make the count run for ever.
 */
function depthOf(
  selectionSet: SelectionSetNode,
  context: ValidationContext,
  visiting: ReadonlySet<string>,
): number {
  let deepest = 0;

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      // Introspection is answered or refused as a whole by the endpoint's
      // configuration; counting its depth would refuse it here instead, in
      // development, where it is meant to work.
      const depth = selection.name.value.startsWith('__')
        ? 0
        : 1 +
          (selection.selectionSet === undefined
            ? 0
            : depthOf(selection.selectionSet, context, visiting));

      deepest = Math.max(deepest, depth);
      continue;
    }

    if (selection.kind === Kind.INLINE_FRAGMENT) {
      deepest = Math.max(deepest, depthOf(selection.selectionSet, context, visiting));
      continue;
    }

    const name = selection.name.value;

    if (visiting.has(name)) {
      continue;
    }

    const fragment: FragmentDefinitionNode | null | undefined = context.getFragment(name);

    if (fragment !== undefined && fragment !== null) {
      deepest = Math.max(
        deepest,
        depthOf(fragment.selectionSet, context, new Set([...visiting, name])),
      );
    }
  }

  return deepest;
}
