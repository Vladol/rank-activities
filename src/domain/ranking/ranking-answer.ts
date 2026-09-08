import type { ResolvedLocation } from '../location/resolved-location';
import type { ActivityResult, DayRanking } from './rank';

/**
 * The scope of what this service judged, returned with every answer.
 *
 * A code with a translation key, for the same reason a reason is: the sentence
 * a user reads is a translation, and the thing a client branches on must not
 * be the English text. A high score is not an authorisation — the ranking sees
 * weather and nothing else.
 */
export const RANKING_SCOPE = {
  code: 'WEATHER_ONLY',
  i18n: 'scope.weather_only',
  /** What the ranking is explicitly blind to, so a client can say so too. */
  excludes: ['hazards', 'operations', 'access'],
} as const;

export type ScopeStatement = typeof RANKING_SCOPE;

/**
 * One local day of the answer.
 *
 * `complete` is declared now though it is always true, and it is the honest
 * report of what was computed rather than a placeholder: every window built
 * today is a whole local day. Adding the field later would change the shape of
 * every day in every answer, and it costs one boolean now (design.md,
 * Decision 6). The behaviour it will describe arrives with TD-01 of
 * docs/development-flow/stage-two.md, section 10.
 */
export interface RankedDay {
  /** The location's own local date, `YYYY-MM-DD`, as the source labelled it. */
  readonly date: string;
  readonly complete: boolean;
  /** The hours the day actually held — never the constant 24. */
  readonly hoursCounted: number;
  readonly ranking: DayRanking;
}

/**
 * An answer that can be argued with: which place, when the data was obtained,
 * whether it is stale, under which rules, and in which time zone the dates are
 * (FR-14 of stage-two.md, section 9).
 */
export interface RankingAnswer {
  readonly location: ResolvedLocation;
  /**
   * The IANA zone the days are labelled in. Never `auto`: that is what we asked
   * the source for, not what the answer is in — the source reports the zone it
   * chose, and that is what travels here. `null` only when neither the geocoder
   * nor any source ever named one, which is not a zone we may invent.
   */
  readonly timezone: string | null;
  /** What was asked for, beside `days.length`, which is what was answered. */
  readonly requestedDays: number;
  readonly days: readonly RankedDay[];
  /**
   * Per-activity outcomes that belong to no day.
   *
   * Empty in every answer that holds data, and the reason it exists at all is
   * that a day is the location's own local date and only the source ever tells
   * us one: when nothing was obtained, there is no honest date to hang a
   * result on, and inventing one from our clock is the day-shift this contract
   * forbids (TD-01 of stage-two.md, section 10). The activities still answer —
   * each with missing data — rather than the whole request failing.
   */
  readonly undated: readonly ActivityResult[];
  /**
   * When the underlying data was obtained, as an ISO instant; `null` when none
   * was obtained at all, which is not the same as "obtained just now".
   */
  readonly fetchedAt: string | null;
  /** Whether the answer was produced from data past its refresh window. */
  readonly stale: boolean;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly scope: ScopeStatement;
}
