import { Field, Float, ID, Int, ObjectType, createUnionType, registerEnumType } from '@nestjs/graphql';

import { REASON, type ReasonCode } from '../../../domain/shared/reason-code';

/**
 * The exposed shape of an answer.
 *
 * Nothing here is a domain type. The mapper beside this file is the only place
 * a domain field name appears on the way out, which is what lets the core be
 * renamed without a client noticing — and what stops a field nobody meant to
 * publish from arriving by way of a spread.
 *
 * What the transport does with these — the error envelope, the endpoint's
 * bounds, the trace identifier — is `graphql-api`, and lives beside this file.
 * These models own the contents and their meaning, and nothing about how they
 * are carried.
 */
registerEnumType(
  Object.fromEntries(Object.keys(REASON).map((code) => [code, code])) as Record<
    ReasonCode,
    ReasonCode
  >,
  {
    name: 'ReasonCode',
    description:
      'Every reason the service reports, from the one registry: inapplicability, a violated constraint, missing data and a rejected request.',
  },
);

export enum OutcomeKindModel {
  RANKED = 'RANKED',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  NO_DATA = 'NO_DATA',
}

registerEnumType(OutcomeKindModel, { name: 'OutcomeKind' });

export enum FeatureRoleModel {
  ADDITIVE = 'ADDITIVE',
  GATE = 'GATE',
}

registerEnumType(FeatureRoleModel, {
  name: 'FeatureRole',
  description: 'Whether the feature contributes a share of the score or limits it.',
});

export enum ContributionStatusModel {
  USED = 'USED',
  DEGRADED = 'DEGRADED',
  EXCLUDED = 'EXCLUDED',
}

registerEnumType(ContributionStatusModel, {
  name: 'ContributionStatus',
  description:
    'Whether the feature was scored on data, on the profile neutral value, or dropped for want of it.',
});

@ObjectType('AggregatedValue')
export class AggregatedValueModel {
  @Field(() => Float)
  value!: number;

  @Field(() => String, { description: 'The canonical unit, never the source own.' })
  unit!: string;

  @Field(() => Int)
  sampleCount!: number;

  @Field(() => Int)
  missingCount!: number;
}

@ObjectType('FeatureContribution')
export class FeatureContributionModel {
  @Field(() => String)
  featureId!: string;

  @Field(() => String)
  metric!: string;

  @Field(() => FeatureRoleModel)
  role!: FeatureRoleModel;

  @Field(() => ContributionStatusModel)
  status!: ContributionStatusModel;

  @Field(() => AggregatedValueModel, {
    nullable: true,
    description: 'Absent when the feature had no value to aggregate.',
  })
  raw!: AggregatedValueModel | null;

  @Field(() => Float)
  normalized!: number;

  @Field(() => Float, { nullable: true, description: 'Effective share; absent for a limiting feature.' })
  weight!: number | null;

  @Field(() => Float, { nullable: true })
  contribution!: number | null;

  @Field(() => Float, { nullable: true, description: 'Only a limiting feature has one.' })
  gateFactor!: number | null;
}

@ObjectType('RankedOutcome')
export class RankedOutcomeModel {
  @Field(() => OutcomeKindModel)
  kind!: OutcomeKindModel;

  @Field(() => Int, { description: '0 to 100. Zero is a judgement about today, not a refusal.' })
  score!: number;

  @Field(() => String, {
    nullable: true,
    description: 'The constraint that drove the score to zero, when one did.',
  })
  constraintViolated!: ReasonCode | null;

  @Field(() => [FeatureContributionModel])
  breakdown!: FeatureContributionModel[];

  @Field(() => Int)
  definitionVersion!: number;

  @Field(() => String)
  profileId!: string;

  @Field(() => Int)
  profileVersion!: number;
}

@ObjectType('NotApplicableOutcome')
export class NotApplicableOutcomeModel {
  @Field(() => OutcomeKindModel)
  kind!: OutcomeKindModel;

  @Field(() => String)
  reason!: ReasonCode;

  @Field(() => String, {
    description: 'The translation key for the reason. The text follows the code, never the reverse.',
  })
  messageKey!: string;
}

@ObjectType('NoDataOutcome')
export class NoDataOutcomeModel {
  @Field(() => OutcomeKindModel)
  kind!: OutcomeKindModel;

  @Field(() => String)
  reason!: ReasonCode;

  @Field(() => String)
  messageKey!: string;

  @Field(() => [String])
  missingMetrics!: string[];

  @Field(() => Boolean)
  retryable!: boolean;
}

/**
 * A union rather than one type with optional fields. The alternative lets a
 * client read `score` and ignore the rest, and the state that must not be read
 * as a number is exactly the one a careless client would read as one
 * (design.md, Decision 1).
 */
export const ActivityOutcomeModel = createUnionType({
  name: 'ActivityOutcome',
  types: () =>
    [RankedOutcomeModel, NotApplicableOutcomeModel, NoDataOutcomeModel] as const,
  resolveType: (value: { kind: OutcomeKindModel }) =>
    value.kind === OutcomeKindModel.RANKED
      ? RankedOutcomeModel
      : value.kind === OutcomeKindModel.NOT_APPLICABLE
        ? NotApplicableOutcomeModel
        : NoDataOutcomeModel,
});

export type ActivityOutcomeModel =
  | RankedOutcomeModel
  | NotApplicableOutcomeModel
  | NoDataOutcomeModel;

@ObjectType('ActivityResult')
export class ActivityResultModel {
  @Field(() => String, { description: 'The stable activity code, never a display title.' })
  activity!: string;

  @Field(() => ActivityOutcomeModel)
  outcome!: ActivityOutcomeModel;
}

@ObjectType('RankedDay')
export class RankedDayModel {
  @Field(() => String, { description: 'The location own local date, YYYY-MM-DD.' })
  date!: string;

  @Field(() => Boolean, { description: 'Whether the day was computed from a complete local day.' })
  complete!: boolean;

  @Field(() => Int, { description: 'The hours this day actually held, never assumed to be 24.' })
  hoursCounted!: number;

  @Field(() => [ActivityResultModel], { description: 'Descending by score, ties by activity code.' })
  ranked!: ActivityResultModel[];

  @Field(() => [ActivityResultModel], {
    description: 'Inapplicable and missing-data results. They take no part in the ordering.',
  })
  notRanked!: ActivityResultModel[];
}

@ObjectType('ResolvedPlace')
export class ResolvedPlaceModel {
  @Field(() => ID)
  id!: string;

  @Field(() => Float)
  latitude!: number;

  @Field(() => Float)
  longitude!: number;

  @Field(() => String, { nullable: true })
  name!: string | null;

  @Field(() => String, { nullable: true })
  countryCode!: string | null;

  @Field(() => String, { nullable: true })
  admin1!: string | null;

  @Field(() => Float, { nullable: true })
  elevationMetres!: number | null;
}

@ObjectType('ScopeStatement')
export class ScopeStatementModel {
  @Field(() => String)
  code!: string;

  @Field(() => String)
  messageKey!: string;

  @Field(() => [String], { description: 'What the ranking is explicitly blind to.' })
  excludes!: string[];
}

@ObjectType('RankingAnswer')
export class RankingAnswerModel {
  @Field(() => ResolvedPlaceModel)
  location!: ResolvedPlaceModel;

  @Field(() => String, {
    nullable: true,
    description: 'The IANA zone the dates are in. Absent only when nothing ever named one.',
  })
  timezone!: string | null;

  @Field(() => Int)
  requestedDays!: number;

  @Field(() => [RankedDayModel])
  days!: RankedDayModel[];

  @Field(() => [ActivityResultModel], {
    description:
      'Outcomes that belong to no day, which happens only when no data was obtained and no local date could be identified.',
  })
  undated!: ActivityResultModel[];

  @Field(() => String, { nullable: true, description: 'When the data was obtained, ISO instant.' })
  fetchedAt!: string | null;

  @Field(() => Boolean)
  stale!: boolean;

  @Field(() => String)
  profileId!: string;

  @Field(() => Int)
  profileVersion!: number;

  @Field(() => ScopeStatementModel)
  scope!: ScopeStatementModel;
}
