import type { ActivityOutcome, FeatureContribution } from '../../../domain/ranking/activity-outcome';
import type { ActivityResult } from '../../../domain/ranking/rank';
import type { RankedDay, RankingAnswer, ScopeStatement } from '../../../domain/ranking/ranking-answer';
import type { ResolvedLocation } from '../../../domain/location/resolved-location';
import { REASON, type ReasonCode } from '../../../domain/shared/reason-code';
import {
  type ActivityOutcomeModel,
  ActivityResultModel,
  AggregatedValueModel,
  ContributionStatusModel,
  FeatureContributionModel,
  FeatureRoleModel,
  NoDataOutcomeModel,
  NotApplicableOutcomeModel,
  OutcomeKindModel,
  RankedDayModel,
  RankedOutcomeModel,
  RankingAnswerModel,
  ResolvedPlaceModel,
  ScopeStatementModel,
} from './ranking.models';

/**
 * The one crossing of the boundary.
 *
 * Every field is written out by name rather than spread, which is the whole
 * point: a domain field that is renamed changes one line here and nothing a
 * client sees, and a domain field that is added does not escape by accident.
 * The cost is that this file is dull; the alternative is a published contract
 * whose shape is decided by whatever the core happens to hold today.
 */
export function toRankingAnswerModel(answer: RankingAnswer): RankingAnswerModel {
  const model = new RankingAnswerModel();

  model.location = toPlaceModel(answer.location);
  model.timezone = answer.timezone;
  model.requestedDays = answer.requestedDays;
  model.days = answer.days.map(toDayModel);
  model.undated = answer.undated.map(toResultModel);
  model.fetchedAt = answer.fetchedAt;
  model.stale = answer.stale;
  model.profileId = answer.profileId;
  model.profileVersion = answer.profileVersion;
  model.scope = toScopeModel(answer.scope);

  return model;
}

function toPlaceModel(location: ResolvedLocation): ResolvedPlaceModel {
  const model = new ResolvedPlaceModel();

  model.id = location.id;
  model.latitude = location.coordinates.latitude;
  model.longitude = location.coordinates.longitude;
  // A point resolved from raw coordinates has no administrative context, and
  // inventing the nearest city would be a different answer than the one asked.
  model.name = location.place?.name ?? null;
  model.countryCode = location.place?.countryCode ?? null;
  model.admin1 = location.place?.admin1 ?? null;
  model.elevationMetres = location.elevationMetres;

  return model;
}

function toScopeModel(scope: ScopeStatement): ScopeStatementModel {
  const model = new ScopeStatementModel();

  model.code = scope.code;
  model.messageKey = scope.i18n;
  model.excludes = [...scope.excludes];

  return model;
}

function toDayModel(day: RankedDay): RankedDayModel {
  const model = new RankedDayModel();

  model.date = day.date;
  model.complete = day.complete;
  model.hoursCounted = day.hoursCounted;
  model.ranked = day.ranking.ranked.map(toResultModel);
  model.notRanked = day.ranking.notRanked.map(toResultModel);

  return model;
}

function toResultModel(result: ActivityResult): ActivityResultModel {
  const model = new ActivityResultModel();

  model.activity = result.activity;
  model.outcome = toOutcomeModel(result.outcome);

  return model;
}

export function toOutcomeModel(outcome: ActivityOutcome): ActivityOutcomeModel {
  if (outcome.kind === 'ranked') {
    const model = new RankedOutcomeModel();

    model.kind = OutcomeKindModel.RANKED;
    model.score = outcome.score;
    model.constraintViolated = outcome.constraintViolated ?? null;
    model.breakdown = outcome.breakdown.map(toContributionModel);
    model.definitionVersion = outcome.definitionVersion;
    model.profileId = outcome.profileId;
    model.profileVersion = outcome.profileVersion;

    return model;
  }

  if (outcome.kind === 'not_applicable') {
    const model = new NotApplicableOutcomeModel();

    model.kind = OutcomeKindModel.NOT_APPLICABLE;
    model.reason = outcome.reason;
    model.messageKey = messageKeyOf(outcome.reason);

    return model;
  }

  const model = new NoDataOutcomeModel();

  model.kind = OutcomeKindModel.NO_DATA;
  model.reason = outcome.reason;
  model.messageKey = messageKeyOf(outcome.reason);
  model.missingMetrics = [...outcome.missingMetrics];
  model.retryable = outcome.retryable;

  return model;
}

function toContributionModel(contribution: FeatureContribution): FeatureContributionModel {
  const model = new FeatureContributionModel();

  model.featureId = contribution.featureId;
  model.metric = contribution.metric;
  model.role = contribution.role === 'gate' ? FeatureRoleModel.GATE : FeatureRoleModel.ADDITIVE;
  model.status = STATUS[contribution.status];
  model.raw = contribution.raw === null ? null : toRawModel(contribution.raw);
  model.normalized = contribution.normalized;
  model.weight = contribution.weight;
  model.contribution = contribution.contribution;
  model.gateFactor = contribution.gateFactor;

  return model;
}

function toRawModel(raw: NonNullable<FeatureContribution['raw']>): AggregatedValueModel {
  const model = new AggregatedValueModel();

  model.value = raw.value;
  model.unit = raw.unit;
  model.sampleCount = raw.sampleCount;
  model.missingCount = raw.missingCount;

  return model;
}

const STATUS: Record<FeatureContribution['status'], ContributionStatusModel> = {
  used: ContributionStatusModel.USED,
  degraded: ContributionStatusModel.DEGRADED,
  excluded: ContributionStatusModel.EXCLUDED,
};

/**
 * The translation key of a reason, taken from the registry. The client
 * branches on the code and shows the translation; deriving the code from the
 * text would be the same relationship the wrong way round.
 */
export function messageKeyOf(reason: ReasonCode): string {
  return REASON[reason].i18n;
}
