# OA Simulator backend

## 1. What it is

A backend for a mock online-assessment (OA) platform. A student builds a timed round by choosing the number of questions (1 to 5), a topic and a difficulty for each question, and a duration. They then solve Python problems in a strict round with no pausing, and get a report about that round.

It gives students a realistic place to practise OAs: the server keeps the time, hidden tests stay secret, attempts are limited, and the report says what went wrong (too slow, wrong on edge cases, a crash, poor time use) and suggests the next round.

The full design is in [`docs/OA Simulator System Design Specification.md`](docs/OA%20Simulator%20System%20Design%20Specification.md). It is the only source of truth for this code.

## 2. Architecture

```
  Browser or API client (Postman, curl)
          |  HTTPS + JSON, Authorization: Bearer <JWT>
          v
  +---------------------------------------------------------+
  |  Express backend (Node.js)                              |
  |  helmet, CORS, rate limits, request id, pino logs       |
  |  routes -> controllers -> services (all the rules)      |
  |                                                         |
  |   roundService       roundStateService  questionService |
  |   attemptService     gradingService     reportService   |
  +----------+-------------------------------+--------------+
             |                               |
             | runTests(code, inputs)        | Mongoose
             v                               v
  +-------------------------+      +-------------------------+
  |  Runner (src/runner)    |      |  MongoDB                |
  |  local Python 3, one    |      |  users, problems,       |
  |  process per test, a    |      |  assessments,           |
  |  queue, time limits,    |      |  submissions,           |
  |  temp-folder cleanup    |      |  attemptEvents          |
  +-------------------------+      +-------------------------+
```

- **Routes** know URLs only. **Controllers** know HTTP only. **Services** hold the rules and never touch `req` or `res`.
- Only the **runner** knows about Python, and only the **models** know the database schema.

## 3. How to run it

**Prerequisites**

- Node.js 20 or newer.
- Python 3.9 or newer, on the `PATH` as `python3` (or set `PYTHON_BIN`).
- MongoDB: a local server or a MongoDB Atlas free cluster.

**Settings**

```bash
cp .env.example .env
```

Then edit `.env`. Every setting is checked when the server starts. If one is missing or wrong, the server prints which one and exits.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `5000` | |
| `MONGODB_URI` | none | Required |
| `JWT_SECRET` | none | Required, at least 32 characters |
| `JWT_EXPIRES_IN` | `1d` | |
| `BCRYPT_COST` | `10` | 10 to 12 |
| `CORS_ORIGIN` | none | Comma-separated browser origins. Required in production, where `*` is refused. When unset, no cross-origin browser requests are allowed. |
| `TRUST_PROXY` | `false` | Set to `true` behind a proxy, so rate limits see the real client address |
| `LOG_LEVEL` | `info` | |
| `PYTHON_BIN` | `python3` | |
| `RUNNER_CONCURRENCY` | `2` | Simultaneous `runTests` calls |
| `RUNNER_QUEUE_MAX` | `10` | Waiting calls allowed before the runner refuses work |
| `RUNNER_STDOUT_LIMIT_BYTES` | `65536` | |
| `RUNNER_STDERR_LIMIT_BYTES` | `8192` | |

**Install, seed, start**

```bash
npm install
```

```bash
npm run seed
```

```bash
npm start
```

- **`npm run seed`** runs three steps in order. Running it again updates problems by `slug` and never creates duplicates.
  1. `seed:validate` checks every problem file.
  2. `seed:generate` runs each reference solution through the runner to produce the expected outputs, which go in `seed/expected/` and are not committed.
  3. `seed:import` upserts every valid problem with status `approved`.
- **The question bank** has 15 problems in `seed/problems/`: three per topic (arrays, strings, hashing, sorting, math), one easy, one medium and one hard. Each has a reference solution in `seed/solutions/`. A person should read every statement once before importing it into a real database.
- **`npm start`** starts the server in this order: check settings, connect to MongoDB, wait for the indexes, then listen. `npm run dev` restarts on file changes. `GET /health` answers `{ "status": "ok" }`.

**Test**

```bash
npm test
```

```bash
npm run test:fast
```

- **`npm test`** runs everything. MongoDB runs in memory, so no database is needed. Grading and deadlines are tested with a fake runner and a fake clock.
- **The `*.slow.test.js` files** use real Python: the runner itself, Run and Submit, the seed pipeline, shutdown and the demonstration script.
- **`npm run test:fast`** skips the slow files.

## 4. The flow of a round

1. **Build (E6).** The student sends 1 to 5 slots (`topic`, `difficulty`) and an optional `durationMin`, which defaults to easy 12, medium 20 and hard 30 minutes per question.
   - For each slot the server picks a random approved problem, using a Fisher-Yates shuffle, never the same problem twice in one round.
   - If any slot can't be filled, nothing is saved and the reply is 422 with every short group listed.
   - The round is saved as **READY**. A student can have at most 20 READY rounds, and a READY round never expires.
2. **Start (E10).**
   - One atomic update moves READY to **ACTIVE** and sets `startedAt` and `deadline = startedAt + durationMin`. The deadline never changes after that.
   - A unique index allows only one ACTIVE round per student, even if two Starts arrive together.
   - Any earlier round whose deadline has passed is finished first, so it can't block the new one.
3. **Work on questions.**
   - **Open (E12)** shows the statement and samples. Statements are hidden until the round is ACTIVE.
   - **Autosave (E13)** stores the code.
   - **Run (E14)** runs the samples and shows each sample's input, expected output, actual output and error.
   - **Submit (E15)** runs the samples and the hidden tests and says only `ACCEPTED`, `NOT_ACCEPTED` or `COMPILATION_ERROR` (with the line number).
   - Run and Submit each pass one atomic "attempt gate":
     - the round is ACTIVE and the deadline is later than now;
     - Runs have a 3-second cooldown and Submits a 5-second cooldown;
     - each question allows at most 30 Runs and 20 Submits.
   - If the runner itself fails, the attempt is given back and the reply is 503.
4. **Finish (E11) or expiry.**
   - The student can finish early, which records MANUAL, and finishing again is harmless.
   - There is no timer. Any request that touches a round after its deadline marks it **FINISHED** (EXPIRED) with `finishedAt` equal to the deadline.
   - A Submit that arrived before the deadline is still graded in full.
5. **Report (E16).** For a FINISHED round, `buildReport` turns the saved data into:
   - a grade, a summary and a headline;
   - up to three insights, per-question metrics and a time map;
   - a suggested next round.

   Every sentence is a fixed template filled with numbers. After the round, the student sees the report, not their code.

## 5. API summary

All bodies are JSON. Protected endpoints need `Authorization: Bearer <token>`. `:id` is a round id and `:index` is the question number (1, 2, ...).

| # | Method and path | Auth | What it does |
| --- | --- | --- | --- |
| E1 | `GET /health` | no | Liveness check |
| E2 | `POST /api/auth/register` | no | Create an account; returns a token and the user |
| E3 | `POST /api/auth/login` | no | Returns a token and the user |
| E4 | `GET /api/auth/me` | yes | The current user |
| E5 | `GET /api/topics` | yes | Approved problems per topic and difficulty |
| E6 | `POST /api/assessments` | yes | Build a round (READY) |
| E7 | `GET /api/assessments` | yes | List your rounds (`status`, `page`, `limit`) |
| E8 | `GET /api/assessments/:id` | yes | The round summary (no statements or code) |
| E9 | `DELETE /api/assessments/:id` | yes | Delete a READY round |
| E10 | `POST /api/assessments/:id/start` | yes | Start the clock |
| E11 | `POST /api/assessments/:id/finish` | yes | Finish early (safe to repeat) |
| E12 | `POST /api/assessments/:id/questions/:index/open` | yes | The question, its samples and your saved code |
| E13 | `PUT /api/assessments/:id/questions/:index/code` | yes | Autosave |
| E14 | `POST /api/assessments/:id/questions/:index/run` | yes | Run on the samples |
| E15 | `POST /api/assessments/:id/questions/:index/submit` | yes | Submit against samples and hidden tests |
| E16 | `GET /api/assessments/:id/report` | yes | The report of a FINISHED round |

**Error format.** Every error is `{ "error": { "code", "message", "details?" } }`. The codes are listed in section 4.2 of the specification. For example:
- `VALIDATION_ERROR` is 400;
- `NOT_FOUND` is 404 (also for another student's round, or an invalid id);
- `ROUND_EXPIRED` is 409;
- `COOLDOWN` is 429;
- `RUNNER_UNAVAILABLE` is 503.

**Rate limits.**
- Register and login allow 10 requests per minute per IP address.
- Every other `/api` endpoint allows 200 requests per minute per user, or per IP address when there's no valid token.
- Going over gives 429 with a `Retry-After` header.

## 6. Key design decisions

- **The server's clock is the only clock.** The deadline is set once at Start from the server's time. Every request reads the clock once and uses that value everywhere, which is how a Submit is judged by when it arrived. Expiry is lazy, so nothing depends on a background timer.
- **Hidden tests never leave the server.**
  - `hiddenTests` is excluded from every query unless the Submit handler asks for it.
  - Submit never says which test failed or why, because a Python error message can quote the hidden input.
  - Logs redact passwords, tokens, the Authorization header, code and hidden tests.
- **The runner is behind one function.** `runTests` is the only code that touches Python and it returns plain results. A Judge0 adapter can replace it without changing anything else.
- **Atomic updates instead of read-then-write.** Every limit (the cooldowns, the attempt caps, the one-ACTIVE-round rule, Start, Finish and the first solve) is a single conditional MongoDB update or a unique index, so double clicks and two tabs can't break the rules.
- **A rule-based report.** `buildReport` is a pure function: the same data always gives the same report. It uses no AI, and every threshold is a setting in `src/config/limits.js`.
- **One place for every number.** Limits, thresholds, topics and the difficulty table live in `src/config/limits.js`. Environment settings live in `src/config/env.js` and are checked at startup.

## 7. Known limitations

- **Python only.**
- **The local runner is not sandboxed.** Student code runs as the server's user, with only a time limit and output caps. Never expose this backend to the public internet.
- **No memory limit.** The local runner can't enforce one reliably on macOS.
- **One correct output per input.** Grading is an exact comparison after trimming trailing spaces and blank lines, so problems with several valid answers aren't supported.
- **Correctness depends on the question bank.** A wrong reference solution produces wrong expected outputs. Brute-force checks and a human review help, but they're no guarantee.
- **No frontend in this scope.** Use an API client such as Postman.
- **Single instance.** Rate-limit counters are kept in memory.

## 8. Production plan

- Replace the local runner with a **Judge0 adapter on a Linux server** that returns the same `runTests` shape.
- Add a real **sandbox**, **memory limits** and **more languages** through Judge0.
- Keep the rest as it is: the API, the rules, the atomic updates and the report don't depend on how code is executed.
