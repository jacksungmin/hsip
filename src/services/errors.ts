// Shared error types for data store rejections.
// Per docs/06 "Errors": store reads reject with NotFoundError on
// missing id, other errors surface as named Error subclasses. Central
// user-facing error surface is deferred to step 7's cross-cutting
// section.

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}
