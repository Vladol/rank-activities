import type { ConstraintExpr, ResolvedDefinition } from './activity-definition';
import type { RequirableMetric } from '../weather/derived/derived-metric.registry';

/**
 * Everything a declaration needs fetched: the metrics of its features *and* of
 * its constraints. `weather_code` is nobody's feature, and the shared
 * severe-weather rule cannot be decided without it — which is why the planner
 * asks for it at every location, and why the two metrics behind that rule are
 * marked as always required in stage-three.md, section 4.
 *
 * A derived metric stays itself here. Expanding it into its base metrics is
 * the planner's job, and doing it here would put the planner's knowledge into
 * the declaration.
 */
export function metricRequirements(definition: ResolvedDefinition): readonly RequirableMetric[] {
  const required = new Set<RequirableMetric>();

  for (const feature of definition.features) {
    required.add(feature.metric);

    if (readsDaylight(feature.aggregation)) {
      required.add('is_day');
    }
  }

  for (const constraint of definition.constraints) {
    walk(constraint.when, required);
  }

  return [...required];
}

function readsDaylight(aggregation: { type: string; params?: unknown }): boolean {
  if (aggregation.type === 'daylightWindow') {
    return true;
  }

  const window = (aggregation.params as { window?: unknown } | undefined)?.window;

  return window === 'daylight';
}

function walk(expr: ConstraintExpr, into: Set<RequirableMetric>): void {
  if ('anyOf' in expr) {
    expr.anyOf.forEach((branch) => walk(branch, into));
  } else if ('allOf' in expr) {
    expr.allOf.forEach((branch) => walk(branch, into));
  } else if ('not' in expr) {
    walk(expr.not, into);
  } else {
    into.add(expr.metric);

    if (readsDaylight(expr.aggregation)) {
      into.add('is_day');
    }
  }
}
