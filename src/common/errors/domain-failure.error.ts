import type { DomainError } from '../../domain/shared/domain-error';
import type { ReasonCode } from '../../domain/shared/reason-code';

/**
 * A domain failure on its way to the transport.
 *
 * The domain answers with a `Result` and never throws (`domain-error.ts`), so
 * this exists only at the edge: it is how a value that says "there is no answer
 * to give" travels the one hop from a resolver to the exception filter without
 * the resolver having to know what an error envelope looks like.
 */
export class DomainFailure extends Error {
  constructor(readonly failure: DomainError<ReasonCode>) {
    super(failure.message);
    this.name = 'DomainFailure';
  }
}
