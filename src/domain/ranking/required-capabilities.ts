import type { ResolvedDefinition } from '../activity/activity-definition';
import { metricRequirements } from '../activity/metric-requirements';
import {
  type RequirableMetric,
  derivedMetric,
  isDerivedMetric,
} from '../weather/derived/derived-metric.registry';
import { type Capability, type MetricCode, metric } from '../weather/metric';

/**
 * Which capabilities an activity's answer actually depends on, and which of
 * its metrics each one owes.
 *
 * This is what makes a partial failure stay partial: when the marine host is
 * down, the activities that asked it for nothing are unaffected, and nothing
 * here needs to know that the failing host is the one serving waves
 * (spec, "A failure affecting one activity does not cancel the others").
 *
 * A derived metric is expanded into what it is computed from, because that is
 * what a source is asked for — the derivation happens on our side and cannot
 * fail for want of a host.
 */
export function requiredCapabilities(
  definition: ResolvedDefinition,
): ReadonlyMap<Capability, readonly MetricCode[]> {
  const byCapability = new Map<Capability, MetricCode[]>();

  for (const code of baseMetrics(metricRequirements(definition))) {
    const capability = metric(code).capability;
    const known = byCapability.get(capability);

    if (known === undefined) {
      byCapability.set(capability, [code]);
    } else if (!known.includes(code)) {
      known.push(code);
    }
  }

  return byCapability;
}

/** The metrics a source is asked for: derived ones replaced by their inputs. */
export function baseMetrics(requirements: readonly RequirableMetric[]): readonly MetricCode[] {
  const codes = new Set<MetricCode>();

  for (const requirement of requirements) {
    if (isDerivedMetric(requirement)) {
      for (const dependency of derivedMetric(requirement).requires) {
        codes.add(dependency);
      }
    } else {
      codes.add(requirement as MetricCode);
    }
  }

  return [...codes];
}
