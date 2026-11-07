const AppError = require('../errors/AppError');

// Spec 6.2: validates body, params and query with a zod schema before any other logic.
// `schemas` is { body?, params?, query? }. Parsed values replace the originals, so unknown fields are gone.
// A bad route param (a round id that is not an ObjectId, a question index out of range) returns
// 404 NOT_FOUND, not 400, so ids cannot be probed.
function validate(schemas) {
  return (req, res, next) => {
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) return next(new AppError('NOT_FOUND', 404, 'Not found'));
      req.params = result.data;
    }

    const details = [];
    for (const part of ['body', 'query']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part]);
      if (result.success) {
        req[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          details.push({ field: [part, ...issue.path].join('.'), message: issue.message });
        }
      }
    }

    if (details.length > 0) return next(new AppError('VALIDATION_ERROR', 400, 'Invalid input', details));
    next();
  };
}

module.exports = validate;
