const { z } = require('zod');

// E5 takes no input. z.object removes unknown query fields (spec 6.2).
const listTopicsQuery = z.object({});

module.exports = { listTopicsQuery };
