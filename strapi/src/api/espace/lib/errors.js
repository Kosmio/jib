'use strict';

/** Expected failure of the participant space API (06-api.md): the context middleware answers { error: { code, message, ...extra } }. */
class EspaceError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.name = 'EspaceError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

module.exports = { EspaceError };
