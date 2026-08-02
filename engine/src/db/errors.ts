/** A match with a recorded real-world result cannot be overwritten by a simulation. */
export class MatchLockedError extends Error {
  readonly code = 'MATCH_LOCKED';
  constructor(matchNumber: number) {
    super(`Match ${matchNumber} has an actual result and cannot be changed in a simulation`);
    this.name = 'MatchLockedError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
