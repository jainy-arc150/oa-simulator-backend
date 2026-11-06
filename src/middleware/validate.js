const AppError = require('../errors/AppError');

// Spec 6.2: validates body, params and query with a zod schema before any other logic.
// `schemas` is { body?, params?, query? }. Parsed values replace the originals, so unknown fields are gone.
function validate(schemas) {
  return (req, res, next) => {
    const details = [];

    for (const part of ['body', 'params', 'query']) {
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
