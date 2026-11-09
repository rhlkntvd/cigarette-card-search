// A coarse text limit; the service enforces the model's token limit.
export const MAX_QUERY_LENGTH = 500;
export const QUERY_TOO_LONG_MESSAGE =
  "Description is too long. Try a shorter phrase.";

export class QueryTooLongError extends Error {
  constructor() {
    super(QUERY_TOO_LONG_MESSAGE);
    this.name = "QueryTooLongError";
  }
}
