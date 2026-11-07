const mongoose = require('mongoose');
const { z } = require('zod');
const limits = require('../config/limits');

const DIFFICULTIES = Object.keys(limits.DIFFICULTY_TABLE);
const ROUND_STATUSES = ['READY', 'ACTIVE', 'FINISHED'];

// An endpoint that takes no input in this part of the request. z.object removes unknown fields.
const noInput = z.object({});

// Spec 6.2: slots[].topic is one of TOPICS, read when the request arrives so the list stays in config.
const slot = z.object({
  topic: z.string().refine((value) => limits.TOPICS.includes(value), {
    message: `must be one of: ${limits.TOPICS.join(', ')}`,
  }),
  difficulty: z.enum(DIFFICULTIES),
});

// E6 body (spec 4.4, 6.2).
const createRoundBody = z.object({
  slots: z.array(slot).min(limits.QUESTIONS_PER_ROUND_MIN).max(limits.QUESTIONS_PER_ROUND_MAX),
  durationMin: z.number().int().min(limits.ROUND_DURATION_MIN).max(limits.ROUND_DURATION_MAX).optional(),
});

// A query value that must be written as digits only (no sign, decimal point, exponent or array),
// read as a whole number from 1 up to `max`, with `fallback` when it is missing.
function wholeNumberQuery(fallback, max) {
  return z
    .string()
    .regex(/^[0-9]+$/, 'must be a whole number')
    .optional()
    .transform((value) => (value === undefined ? fallback : Number(value)))
    .pipe(z.number().int().positive().max(max));
}

// E7 query (spec 4.4, 6.2).
const listRoundsQuery = z.object({
  status: z.enum(ROUND_STATUSES).optional(),
  page: wholeNumberQuery(limits.LIST_PAGE_DEFAULT, Number.MAX_SAFE_INTEGER),
  limit: wholeNumberQuery(limits.LIST_LIMIT_DEFAULT, limits.LIST_LIMIT_MAX),
});

// :id is a round id. One that is not an ObjectId fails here and the validate middleware returns 404.
const roundParams = z.object({
  id: z.string().refine((value) => mongoose.isObjectIdOrHexString(value)),
});

// :index is a question number: a whole number from 1, written without a sign or leading zeros.
// Anything else returns 404; the round guard checks the upper end against the number of questions (4.3 step 5).
const questionParams = roundParams.extend({
  index: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .transform(Number),
});

// E13 body (spec 4.4, 6.2). The length limit is checked after the round guard and returns
// 413 CODE_TOO_LARGE (4.2), so only the type is checked here.
const saveCodeBody = z.object({ code: z.string() });

// E14 and E15 body (spec 4.1, 4.4, 6.2): language is exactly python. As in E13, the code length is
// checked after the round guard and returns 413.
const attemptBody = z.object({ language: z.literal('python'), code: z.string() });

module.exports = { noInput, createRoundBody, listRoundsQuery, roundParams, questionParams, saveCodeBody, attemptBody };
