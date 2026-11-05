# OA Simulator: System Design Specification

*The single source of truth for building the backend. Claude Code should build exactly what is written here and ask before guessing anything that is not.*

**Status:** Sections 1 and 2 are final. Sections 3 and 4 are final. Section 5 is final. Sections 6 and 7 are final. The specification is complete.

## How to read this document

- Every rule has an ID (for example R4) so code, tests and discussion can point to it.
- "Must" means required. "Should" means recommended. Anything marked **Open** is undecided: do not build it, ask.
- Numbers in the Limits table are configuration values. Keep them in one config file, never scattered through the code.
- The backend is the authority. The browser is untrusted and only displays things.

## 1. Scope and requirements

### 1.1 Purpose

A backend for a mock online-assessment platform. A student builds a timed round (number of questions, topic and difficulty per question), solves Python problems in a strict no-pause round, and receives a report about that single round.

### 1.2 In scope (MVP)

- Register and login
- Round builder: choose number of questions, topic and difficulty per question, and duration
- Server-enforced timed round with start, finish and automatic expiry
- Free navigation between questions with per-question autosave
- Run (samples only) and Submit (samples plus hidden tests)
- Local Python runner behind one function, `runTests`
- Attempt logging
- A report based only on the current round

### 1.3 Out of scope (MVP)

- Any language other than Python
- A frontend (the backend is tested through an API client such as Postman)
- Cross-round history and trend analytics
- Custom-input Run
- Public deployment of the local runner (it is not sandboxed)
- Problems with several valid answers (grading is exact comparison after normalization)
- AI hints and company presets

### 1.4 Technology

Node.js, Express, MongoDB with Mongoose, JWT authentication, `bcrypt` for passwords. Python 3 installed on the machine for the local runner.

### 1.5 Product decisions (decision log)

| # | Decision |
| --- | --- |
| D1 | Students write a full program from scratch: read stdin, print to stdout. |
| D2 | Python is the only supported language. |
| D3 | Code runs through a local Python runner for now. Judge0 on a Linux server is the planned replacement, so execution must stay behind `runTests`. |
| D4 | Students can move freely between questions. |
| D5 | The report uses only the current round. |
| D6 | Scoring is solved or not solved. Tests passed is still stored per submission. |
| D7 | A student may resubmit after an Accepted. The question stays solved and the report uses the first Accepted time. |
| D8 | A student can have only one ACTIVE round at a time. |
| D9 | A READY round never expires and can be started at any time. |
| D10 | After a round is FINISHED the student sees the report only, not their code. |
| D11 | Run and Submit disclosure rules are in section 2.5. |

### 1.6 Limits (configuration)

| Setting | Value |
| --- | --- |
| Questions per round | 1 to 5 |
| Round duration | 5 to 180 minutes |
| Run cooldown | 3 seconds per user |
| Submit cooldown | 5 seconds per user |
| Max Runs per question per round | 30 |
| Max Submits per question per round | 20 |
| Max code size | 50 KB |
| Time limit per test | Per problem, default 2 seconds |
| Max READY rounds per user | 20 |
| Default duration per difficulty (suggestion only) | Easy 12, Medium 20, Hard 30 minutes |

## 2. Domain rules and states

### 2.1 Entities

| Entity | Meaning |
| --- | --- |
| User | A registered student. |
| Problem | One question in the bank: statement, topic, difficulty, samples, hidden tests, time limit. |
| Round | One timed assessment owned by a user. Also called an assessment in code. |
| Slot | One question position inside a round (Q1, Q2, ...), pointing at one Problem. |
| Submission | One graded Submit of one question. |
| Attempt event | A log entry: a question was opened, a Run happened, or a Submit happened. |

### 2.2 Round states

| State | Meaning | Allowed next state | Trigger |
| --- | --- | --- | --- |
| READY | Questions chosen and saved; clock not started | ACTIVE | Student starts it |
| READY | (same) | deleted | Student deletes it |
| ACTIVE | Clock running | FINISHED | Student finishes it, or the deadline passes |
| FINISHED | Locked; report available | none | Final |

A FINISHED round records `finishReason`: `MANUAL` or `EXPIRED`. No other transitions are allowed. In particular a round never goes backwards, and ACTIVE rounds cannot be deleted.

### 2.3 Question (slot) status

Derived from saved data, not stored as a separate state:

| Status | Condition |
| --- | --- |
| Not opened | `firstOpenedAt` is empty |
| Opened | `firstOpenedAt` is set, no Run or Submit yet |
| Attempted | At least one Run or Submit exists |
| Solved | At least one Submission has verdict Accepted (`solvedAt` is the first one) |

### 2.4 Rules that must always hold

| # | Rule | Acceptance check |
| --- | --- | --- |
| R1 | Only the owner can read or change a round. Other users get 404. | User B requesting User A's round gets 404. |
| R2 | Hidden tests (inputs and expected outputs) never leave the server: not in any response, not in any log. | No API response or log line contains hidden data. The public problem endpoint has no `hiddenTests` field. |
| R3 | The server clock is the only clock. `deadline = startedAt + duration`, set once at start. | Changing the client clock has no effect. |
| R4 | Open question, autosave, Run and Submit work only while the round is ACTIVE and `now <= deadline`. | A Submit at deadline plus 1 second is rejected. |
| R5 | Start works only from READY. Starting again never moves the deadline. | Two Start calls in a row return the same deadline (or 409 on the second); the deadline is unchanged. |
| R6 | A FINISHED round is read-only. | Run, Submit, autosave and Start on a FINISHED round are rejected. |
| R7 | Questions are chosen once when the round is created, never change, and never repeat within a round. | Refreshing or re-reading a round returns the same questions. |
| R8 | A solved question stays solved. `solvedAt` is the first Accepted and never changes. | A Wrong Answer after an Accepted does not unsolve the question. |
| R9 | A submission is judged by when the request arrived, not when grading finished. | A Submit that arrives before the deadline is graded normally even if grading ends after it. |
| R10 | An infrastructure failure (runner could not run) is never saved as a verdict and does not use up an attempt. | After a simulated runner failure, no Submission exists and the attempt counters are unchanged. |
| R11 | Disclosure follows section 2.5. | See section 2.5. |
| R12 | When a round expires, `finishedAt` is set to the deadline, not to the moment the server noticed. | Report time used never exceeds the allotted duration. |
| R13 | A user can have at most one ACTIVE round. Starting a second returns 409. Before checking, the server first finishes any round of that user whose deadline has passed. | An expired-but-unmarked round does not block the next Start. |
| R14 | A user can have at most 20 READY rounds. Creating more returns 409. | The 21st create is rejected with a clear message. |
| R15 | Expiry is lazy. No background timer is required: any request that touches a round first checks `now > deadline` and, if true and still ACTIVE, marks it FINISHED (EXPIRED). | A round whose user closed the browser becomes FINISHED the next time anything reads it. |
| R16 | After FINISHED, the API exposes the report only. Saved code is stored but not returned to the student. | No endpoint returns code for a FINISHED round. |

### 2.5 What the student sees (disclosure rules)

| Situation | Run (samples only) | Submit (samples plus hidden) |
| --- | --- | --- |
| All tests pass | Each sample: input, expected, actual, passed | `Accepted` |
| Syntax error | Error message with the line number | Error message with the line number (safe: it happens before any test runs) |
| Runtime error | Full error text and the sample that failed | `Not accepted, with no reason and no test number` |
| Time limit exceeded | `Time Limit Exceeded` and the sample that timed out | `Not accepted, with no reason and no test number` |
| Wrong output | Each sample: input, expected, actual, failed | `Not accepted, with no reason and no test number` |
| Runner failure | "Something went wrong, try again" | "Something went wrong, try again" |

Reason for the strict Submit rule: a Python error message can contain the hidden input (for example an `int()` conversion error quotes the bad value), and a test number lets a student probe the hidden suite.

Submit response: ACCEPTED when every test passes; COMPILATION\_ERROR (message with the line number) when the code has a syntax error, checked before any test runs; otherwise NOT\_ACCEPTED. The stored verdict is the type of the first failing test in order (samples first, then hidden), and grading may stop at the first failing test (D27, D28).

### 2.6 Edge cases already decided

- **Refresh during a round:** the backend returns the same deadline, questions and saved code.
- **Browser closed:** the clock keeps running; the student can reopen and continue.
- **Last-second code:** the browser should send a final autosave a few seconds before the deadline. The server rejects anything that arrives after it (R4).
- **Resubmitting after Accepted:** allowed (D7), but it never changes `solvedAt`.
- **Report time per question:** from `firstOpenedAt` to the first Accepted, or to `finishedAt` if unsolved. A question never opened is reported as Not attempted.

## 3. Data model

The system stores five collections: `users`, `problems`, `assessments`, `submissions` and `attemptEvents`. All five are final below.

### 3.1 Conventions and decisions

- Every document has `_id` (ObjectId), `createdAt` and `updatedAt` (Mongoose `timestamps: true`).
- All dates are stored in UTC and compared on the server only.
- Problem enums are lowercase (`easy`, `medium`, `hard`); round states are uppercase (`READY`, `ACTIVE`, `FINISHED`).
- Topics come from one list in config (`TOPICS`), never hard-coded in a schema. Changing the list must need no code change elsewhere.

| # | Decision |
| --- | --- |
| D12 | Each problem has exactly one topic. |
| D13 | A problem may appear again in a later round for the same student. The only no-repeat rule is inside one round (R7). |
| D14 | The topic list is decided separately, together with the question bank. Until then `TOPICS` holds a placeholder list. |

### 3.2 `problems`

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `slug` | string | yes | Unique; lowercase letters, digits and hyphens, e.g. `add-two-numbers` |
| `title` | string | yes | 3 to 100 characters |
| `statement` | string | yes | Markdown |
| `inputFormat` | string | yes | Shown to the student |
| `outputFormat` | string | yes | Shown to the student |
| `constraints` | string | yes | Shown to the student |
| `topic` | string | yes | Must be one value from `TOPICS` |
| `difficulty` | enum | yes | `easy`, `medium`, `hard` |
| `timeLimitMs` | number | yes | Default 2000; allowed 500 to 10000 |
| `samples` | array of `{ input, output, explanation? }` | yes | 1 to 3 items; public |
| `hiddenTests` | array of `{ input, output }` | yes when approved | 5 to 10 items; `select: false` (R2) |
| `status` | enum | yes | `draft` or `approved`; default `draft` |

**Rules**

- Only `approved` problems can be picked for a round.
- `hiddenTests` is excluded from every query unless the code asks for it with `.select('+hiddenTests')`, and only the Submit handler may do that.
- The public problem response contains title, statement, formats, constraints, topic, difficulty and samples. It never contains `hiddenTests` or `status`.
- Reference solutions and test generators are not stored here. They live in the repo's `seed/` folder.
- Expected time per question for the report comes from the difficulty table in section 1.6, not from the problem.

**Indexes:** unique on `slug`; compound on (`status`, `topic`, `difficulty`).

**Acceptance checks**

- The public problem endpoint returns no `hiddenTests` field.
- Saving an approved problem with 4 hidden tests is rejected.
- Saving a topic that is not in `TOPICS` is rejected.

### 3.3 `assessments` (a round)

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `user` | ObjectId, ref `User` | yes | The owner (R1) |
| `status` | enum | yes | `READY` (default), `ACTIVE`, `FINISHED` |
| `durationMin` | number | yes | 5 to 180 |
| `slots` | array of slot | yes | 1 to 5 items, embedded (below) |
| `startedAt` | date | no | Set at Start |
| `deadline` | date | no | `startedAt + durationMin`; set at Start and never changed (R3) |
| `finishedAt` | date | no | Set at finish; equals `deadline` when the round expired (R12) |
| `finishReason` | enum | no | `MANUAL` or `EXPIRED`; set together with `finishedAt` |
| `lastRunAt` | date | no | Used for the Run cooldown |
| `lastSubmitAt` | date | no | Used for the Submit cooldown |

**Each slot (embedded in the round)**

| Field | Type | Rule |
| --- | --- | --- |
| `index` | number | 1-based position (Q1, Q2, ...) |
| `topic` | string | From `TOPICS`; what the student asked for |
| `difficulty` | enum | `easy`, `medium`, `hard` |
| `problem` | ObjectId, ref `Problem` | Chosen at creation and never changed (R7). Its topic and difficulty must equal the slot's |
| `firstOpenedAt` | date | Set once, on the first open |
| `code` | string | Latest autosaved code; default empty; at most 51,200 characters |
| `codeUpdatedAt` | date | Time of the last autosave |
| `runCount` | number | Default 0 |
| `submitCount` | number | Default 0 |
| `activeMinutes` | array of numbers | Minute numbers (counted from Start) in which the student autosaved, ran or submitted; default empty; no duplicates (section 5.5) |
| `solvedAt` | date | Set once, at the first Accepted (R8) |

Slots are embedded because a slot only makes sense inside one round and is always loaded with it. Submissions and events are separate collections because there can be many and they keep growing.

**Indexes**

- (`user`, `createdAt` descending) to list a student's rounds, newest first.
- (`user`, `status`) to find the student's READY and ACTIVE rounds.
- A unique partial index on `user`, applying only where `status` is `ACTIVE`. The database itself then refuses a second ACTIVE round (R13), even if two Start requests arrive at the same moment.

**Updates that must be atomic (one conditional update, never read-then-write)**

- Start: match `_id`, `user` and `status: READY`, and set `status`, `startedAt` and `deadline` together. If nothing matches, reject.
- Run and Submit counters: increment `runCount` or `submitCount` only if it is still below its cap, in the same update that checks the cooldown.
- `solvedAt`: set only if it is still empty.

**Acceptance checks**

- Creating a second ACTIVE round for the same user fails at the database and the API returns 409.
- Reading a round again returns the same `problem` in every slot.
- Two simultaneous Start calls produce one deadline.
- A slot whose problem does not match its topic or difficulty cannot be saved.

### 3.4 `users`

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `name` | string | yes | 2 to 50 characters |
| `email` | string | yes | Trimmed and lowercased before saving; unique |
| `passwordHash` | string | yes | `bcrypt` hash; `select: false`; never returned by any endpoint |

The plain password is 8 to 72 characters (72 is the `bcrypt` limit) and is never stored or logged. There are no roles: every user is a student.

**Index:** unique on `email`.

**Acceptance checks**

- Registering the same email twice, in any letter case, returns 409.
- No response, including login and `/me`, contains `passwordHash`.

### 3.5 `submissions` (one document per Submit)

| Field | Type | Rule |
| --- | --- | --- |
| `assessment` | ObjectId, ref | The round |
| `user` | ObjectId, ref | Copied from the round, so ownership checks need one lookup |
| `problem` | ObjectId, ref |  |
| `slotIndex` | number | Which question in the round |
| `verdict` | enum | `ACCEPTED`, `WRONG_ANSWER`, `COMPILATION_ERROR`, `RUNTIME_ERROR`, `TIME_LIMIT_EXCEEDED` |
| `errorMessage` | string | Only for `COMPILATION_ERROR`: the message with its line number. Never stored for runtime errors, because they can contain hidden input |
| `testsPassed`, `totalTests` | number | For example 3 of 5; kept so partial credit can be added later |
| `failedTestNumber` | number | Used inside the report to tell a sample failure from a hidden one; never returned by any endpoint (D11) |
| `runtimeMs` | number | Slowest test |
| `submittedAt` | date | When the request arrived (R9) |

The submitted code is not stored here (D16). The latest code of each question stays in its slot.

A runner failure creates no submission (R10), so there is no verdict for it.

**Index:** (`assessment`, `slotIndex`, `submittedAt`).

**Acceptance checks**

- A simulated runner failure creates no submission and leaves `submitCount` unchanged.
- No endpoint returns `failedTestNumber`.

### 3.6 `attemptEvents` (the timeline the report reads)

| Field | Type | Rule |
| --- | --- | --- |
| `assessment`, `user`, `problem` | ObjectId, refs |  |
| `slotIndex` | number |  |
| `type` | enum | `RUN` or `SUBMIT` |
| `at` | date | Server time when the request arrived |
| `verdict` | enum | Same values as in `submissions`; for a Run, `ACCEPTED` means every sample passed |
| `submission` | ObjectId, ref | Only on `SUBMIT` events |

Opening a question is not logged as an event (D15). `firstOpenedAt` on the slot holds the one thing the report needs.

**Index:** (`assessment`, `slotIndex`, `at`).

**Where the report gets its data**

| Report item | Source |
| --- | --- |
| Solved, time to solve | Slot: `firstOpenedAt`, `solvedAt` |
| Time spent on an unsolved question | Slot `firstOpenedAt` to the round's `finishedAt` |
| Attempts | Slot `runCount` and `submitCount` |
| Verdict history | `submissions` |
| Attempt timeline | `attemptEvents` |
| Time used vs allotted | Round: `startedAt`, `finishedAt`, `durationMin` |

### 3.7 How the collections link, and decisions

| From | To | Link |
| --- | --- | --- |
| `assessments` | `users` | `user` |
| `assessments.slots` | `problems` | `slots[].problem` |
| `submissions` | `assessments`, `users`, `problems` | `assessment`, `user`, `problem` |
| `attemptEvents` | `assessments`, `users`, `problems`, `submissions` | `assessment`, `user`, `problem`, `submission` |

| # | Decision |
| --- | --- |
| D15 | Opening a question is not logged as an event; `firstOpenedAt` is enough. |
| D16 | Submissions store the verdict only, not the submitted code. |
| D17 | Problems are added by a seed script. There is no admin role and no endpoint for adding problems. |
| D18 | Accounts are register and login only. No password reset, no email verification. |

## 4. API contract

The backend has 16 endpoints. This section fixes their URLs, inputs, outputs and errors. The logic behind them (verdicts, report formulas, `runTests`) is in section 5.

### 4.1 Conventions

- Base path is `/api`; the health check is `/health`.
- Request and response bodies are JSON. Maximum request body: 512 KB (code is limited separately to 51,200 characters).
- Protected endpoints need the header `Authorization: Bearer <token>`. The token is a JWT holding the user id, valid for 1 day.
- Dates are ISO 8601 strings in UTC. IDs are strings.
- Every response about a round includes `serverTime`, so the browser can compute its countdown.
- `:id` is the round id. `:index` is the question number in the round (1 up to the number of questions), never a problem id.
- `language` is always `python`. Any other value is a validation error.

### 4.2 Error format and codes

Every error returns `{ error: { code, message, details? } }`. `details` is used only for field-level validation messages and for naming a slot that could not be filled.

| Code | HTTP | When |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Bad or missing input |
| `UNAUTHORIZED` | 401 | Missing, invalid or expired token |
| `INVALID_CREDENTIALS` | 401 | Login failed (same message for wrong email and wrong password) |
| `NOT_FOUND` | 404 | Unknown id, another user's round, or a question index out of range |
| `EMAIL_TAKEN` | 409 | Register with an existing email |
| `READY_LIMIT_REACHED` | 409 | Creating a round while 20 READY rounds exist |
| `ROUND_NOT_READY` | 409 | Start or delete on a round that is not READY |
| `ACTIVE_ROUND_EXISTS` | 409 | Start while another round of the user is ACTIVE |
| `ROUND_NOT_ACTIVE` | 409 | Open, autosave, Run, Submit or Finish on a round that is not ACTIVE |
| `ROUND_EXPIRED` | 409 | The round is FINISHED because its deadline passed |
| `ROUND_NOT_FINISHED` | 409 | Report on a round that is not FINISHED |
| `CODE_TOO_LARGE` | 413 | Code over 51,200 characters, or any request body over 512 KB |
| `NOT_ENOUGH_PROBLEMS` | 422 | A slot cannot be filled; `details` names the slot |
| `COOLDOWN` | 429 | Run or Submit sent too soon after the previous one |
| `ATTEMPT_LIMIT` | 429 | 30 Runs or 20 Submits already used on this question |
| `TOO_MANY_REQUESTS` | 429 | General per-IP rate limit (section 6) |
| `RUNNER_UNAVAILABLE` | 503 | The runner failed; nothing is counted or saved (R10) |
| `INTERNAL_ERROR` | 500 | Anything unexpected; the message never contains internal detail |

### 4.3 The round guard

Endpoints E12 to E15 run these steps in this order before doing anything else. E8, E10, E11 and E16 use steps 1 to 3.

1. The token is valid, else 401.
2. The round exists and belongs to the user, else 404 (R1).
3. Lazy expiry (R15): if the status is ACTIVE and now is later than `deadline`, mark it FINISHED with `finishReason` EXPIRED and `finishedAt` equal to `deadline`.
4. The status must be ACTIVE. Otherwise return 409 `ROUND_EXPIRED` if the round finished by expiry, or 409 `ROUND_NOT_ACTIVE`.
5. `:index` must be a whole number from 1 to the number of questions, else 404.

### 4.4 Endpoints

**E1. `GET /health`**

- Auth: none. Success 200: `{ status: 'ok' }`.

**E2. `POST /api/auth/register`**

- Auth: none. Request: `name`, `email`, `password`.
- Does: validates input, lowercases the email, rejects a duplicate, hashes the password with `bcrypt`, saves the user, issues a token.
- Success 201: `{ token, user: { id, name, email } }`.
- Errors: 400 `VALIDATION_ERROR`, 409 `EMAIL_TAKEN`.

**E3. `POST /api/auth/login`**

- Auth: none. Request: `email`, `password`.
- Does: finds the user and compares the password with the stored hash.
- Success 200: `{ token, user: { id, name, email } }`.
- Errors: 400 `VALIDATION_ERROR`, 401 `INVALID_CREDENTIALS`.

**E4. `GET /api/auth/me`**

- Auth: token. Success 200: `{ user: { id, name, email } }`. Errors: 401.

**E5. `GET /api/topics`**

- Auth: token.
- Does: counts `approved` problems per topic and difficulty. Topics with no approved problem are left out.
- Success 200: `{ topics: [ { topic, easy, medium, hard } ] }`, where each difficulty is a count.

**E6. `POST /api/assessments` (build a round)**

- Auth: token. Request: `slots` (array of `{ topic, difficulty }`) and optional `durationMin`.
- Checks: 1 to 5 slots; each topic is in `TOPICS`; each difficulty is valid; `durationMin` from 5 to 180; fewer than 20 READY rounds.
- Does: if `durationMin` is missing, sets it to the sum of the difficulty table. For each slot, picks one random approved problem with that topic and difficulty that was not already picked in this request (R7). If a slot cannot be filled, nothing is saved.
- Success 201: the round summary (section 4.5) with status READY.
- Errors: 400 `VALIDATION_ERROR`, 409 `READY_LIMIT_REACHED`, 422 `NOT_ENOUGH_PROBLEMS` (details: the slot number, topic and difficulty).

**E7. `GET /api/assessments`**

- Auth: token. Query: optional `status` (`READY`, `ACTIVE`, `FINISHED`), `page` (default 1), `limit` (default 20, maximum 50).
- Does: runs lazy expiry on the user's ACTIVE round first, then lists the user's rounds, newest first.
- Success 200: `{ items, page, limit, total }`. Each item has `id`, `status`, `durationMin`, `questionCount`, `solvedCount`, `createdAt`, `startedAt`, `finishedAt`, `finishReason`.

**E8. `GET /api/assessments/:id`**

- Auth: token. Guard steps 1 to 3.
- Success 200: the round summary. It never contains problem statements, samples, code or hidden tests, in any status.
- Errors: 404.

**E9. `DELETE /api/assessments/:id`**

- Auth: token. Works only on a READY round of the user.
- Success 204. Errors: 404, 409 `ROUND_NOT_READY`.

**E10. `POST /api/assessments/:id/start`**

- Auth: token. Request: no body.
- Does, in order: finds the round (404 if not the user's); finishes any of the user's ACTIVE rounds whose deadline has passed; requires status READY; then makes one atomic update setting `status` to ACTIVE, `startedAt` to now and `deadline` to `startedAt + durationMin`. If the database refuses because the user already has an ACTIVE round, return 409.
- Success 200: the round summary, including `startedAt`, `deadline`, `serverTime`.
- Errors: 404, 409 `ROUND_NOT_READY`, 409 `ACTIVE_ROUND_EXISTS`.

**E11. `POST /api/assessments/:id/finish`**

- Auth: token. Request: no body. Guard steps 1 to 3.
- Does: if ACTIVE, sets FINISHED with `finishReason` MANUAL and `finishedAt` now. If already FINISHED, changes nothing and returns it (safe to repeat).
- Success 200: the round summary.
- Errors: 404, 409 `ROUND_NOT_ACTIVE` (the round is still READY).

**E12. `POST /api/assessments/:id/questions/:index/open`**

- Auth: token. Request: no body. Full round guard.
- Does: sets the slot's `firstOpenedAt` only if it is empty (one atomic update). Returns the question.
- Success 200: the question (section 4.5). Hidden tests are never included.

**E13. `PUT /api/assessments/:id/questions/:index/code` (autosave)**

- Auth: token. Request: `{ code }`. Full round guard.
- Does: saves `code` and `codeUpdatedAt` on the slot.
- Success 204. Errors: 400, 413 `CODE_TOO_LARGE`, plus the guard errors.
- The browser calls it after about 1 to 2 seconds without typing, when switching questions, and once more shortly before the deadline.

**E14. `POST /api/assessments/:id/questions/:index/run` (samples only)**

- Auth: token. Request: `{ language, code }`. Full round guard.
- Then checks, in order: code size; cooldown (3 seconds since `lastRunAt`); `runCount` below 30.
- Does: records the attempt atomically (`lastRunAt`, `runCount`), saves the code to the slot, loads the samples, calls `runTests`, compares each output, writes a RUN event.
- Success 200: the run result (section 4.5).
- Errors: 400, 413, 429 `COOLDOWN`, 429 `ATTEMPT_LIMIT`, 503 `RUNNER_UNAVAILABLE`, plus the guard errors.

**E15. `POST /api/assessments/:id/questions/:index/submit`**

- Auth: token. Request: `{ language, code }`. Full round guard, judged by arrival time (R9).
- Then checks: code size; cooldown (5 seconds since `lastSubmitAt`); `submitCount` below 20.
- Does: records the attempt atomically, saves the code to the slot, loads samples plus hidden tests, calls `runTests`, decides the verdict, saves a submission and a SUBMIT event, and sets `solvedAt` if this is the first ACCEPTED.
- Success 200: the submit result (section 4.5).
- Errors: same as E14.

**E16. `GET /api/assessments/:id/report`**

- Auth: token. Guard steps 1 to 3.
- Does: requires status FINISHED, then computes the report from saved data (formulas in section 5).
- Success 200: the report (section 4.5). It contains no code and no problem statements (R16).
- Errors: 404, 409 `ROUND_NOT_FINISHED`.

### 4.5 Response shapes

**Round summary** (E6, E8, E10, E11)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string |  |
| `status` | string | `READY`, `ACTIVE`, `FINISHED` |
| `durationMin` | number |  |
| `createdAt`, `startedAt`, `deadline`, `finishedAt` | string or null | Empty until set |
| `finishReason` | string or null | `MANUAL` or `EXPIRED` |
| `serverTime` | string | Current server time |
| `slots` | array | Each: `index`, `topic`, `difficulty`, `opened` (boolean), `solved` (boolean), `runCount`, `submitCount` |

**Question** (E12)

| Field | Type |
| --- | --- |
| `index`, `title`, `topic`, `difficulty` | number, string, string, string |
| `statement`, `inputFormat`, `outputFormat`, `constraints` | string |
| `samples` | array of `{ input, output, explanation }` |
| `code` | string, the saved code (empty if none) |
| `serverTime` | string |

**Run result** (E14)

| Field | Type | Notes |
| --- | --- | --- |
| `compilation` | object or null | `{ message }` with the line number when the code has a syntax error; then `results` is empty |
| `results` | array | One per sample: `input`, `expected`, `actual`, `passed`, `status` (`OK`, `RUNTIME_ERROR`, `TIME_LIMIT_EXCEEDED`), `error` (the error text, samples only) |
| `testsPassed`, `totalTests` | number | Samples only |
| `runsLeft` | number | `30 - runCount` |

**Submit result** (E15)

| Field | Type | Notes |
| --- | --- | --- |
| `verdict` | string | `ACCEPTED`, `NOT_ACCEPTED, COMPILATION_ERROR` |
| `errorMessage` | string | Present only for `COMPILATION_ERROR` (message with the line number) |
| `solved` | boolean | Whether the question is now solved |
| `submitsLeft` | number | `20 - submitCount` |
| `serverTime` | string |  |

NOT\_ACCEPTED means at least one test did not pass. The reason (wrong answer, runtime error, time limit) is stored but not returned. Nothing else is returned: no test number, no tests passed, no hidden input (D11, D27).

**Report** (E16): fields are fixed here, formulas in section 5.

The fields of the report are defined in section 5.5, under Report response (E16).

### 4.6 Acceptance checks

- Any protected endpoint without a token returns 401.
- User B calling any round endpoint on User A's round gets 404.
- No response ever contains `hiddenTests`, `passwordHash` or `failedTestNumber`.
- E8 on a READY, ACTIVE or FINISHED round returns no statements, samples or code.
- E12 on a READY round returns 409 `ROUND_NOT_ACTIVE`.
- Starting a second round while one is ACTIVE returns 409 `ACTIVE_ROUND_EXISTS`; starting the same round twice returns 409 `ROUND_NOT_READY`.
- Finishing twice returns 200 both times with the same result.
- E15 one second after the deadline returns 409 `ROUND_EXPIRED` and the round is FINISHED with `finishedAt` equal to `deadline`.
- Two Runs within 3 seconds: the second returns 429 `COOLDOWN`.
- A runner failure returns 503 and leaves `runCount`, `submitCount` and the cooldown unchanged.
- E16 on an ACTIVE round returns 409 `ROUND_NOT_FINISHED`.

### 4.7 Decisions

| # | Decision |
| --- | --- |
| D19 | There is no endpoint that returns a problem by id. Students only see problems through their own round. |
| D20 | Problem statements are hidden while a round is READY. They appear only through E12 on an ACTIVE round. |
| D21 | Register also returns a token. |
| D22 | Run and Submit also save the code to the slot. |
| D23 | Questions are addressed by `:index` (1-based position), not by problem id. |
| D24 | The next-round suggestion is part of the report; there is no separate endpoint. |
| D25 | Finish is safe to repeat; Start is not. |
| D26 | Students can list their past rounds (E7). |

## 5. Core logic

This section pins down the logic inside the endpoints. All of it is final.

### 5.1 The `runTests` contract

`runTests` runs a student's Python code on a list of inputs and reports what happened. It never decides right or wrong, and it never sees expected outputs. It is the only code that touches Python, so a later Judge0 adapter can replace it without changing anything else.

**Input**

| Field | Type | Rule |
| --- | --- | --- |
| `language` | string | Must be `python`, otherwise it throws (the API already rejected other values) |
| `code` | string | The student's program, exactly as typed |
| `inputs` | array of strings | One entry per test; each is fed to stdin as-is |
| `timeLimitMs` | number | Per test, from the problem |
| `stopOnError` | boolean | If true, skip the remaining tests after the first test whose status is not `OK` |

**Output**

| Field | Type | Meaning |
| --- | --- | --- |
| `compile` | object | `{ ok: true }` or `{ ok: false, message, line }`. If not ok, `results` is empty and no test ran |
| `results` | array | One entry per test that ran, in order |

Each entry of `results`:

| Field | Meaning |
| --- | --- |
| `status` | `OK`, `RUNTIME_ERROR` or `TIME_LIMIT_EXCEEDED` |
| `stdout` | What the program printed, capped at 64 KB |
| `stderr` | Error text, capped at 8 KB. Only the Run endpoint may show it |
| `exitCode` | Process exit code, or null if it was killed |
| `timeMs` | Wall-clock time, including Python's start-up |

**When it throws:** if the runner itself fails (Python not found, no temp folder, anything unexpected) it throws `RunnerUnavailableError`. This is never returned as a result, so it cannot be mistaken for a student error. The backend turns it into 503 and counts nothing (R10).

**What it does, per call**

1. Create a fresh temp folder with a random name and write the code to a file there, unchanged. Unchanged matters: syntax error line numbers then match the student's editor.
2. Run a syntax check once, using a small helper script that compiles the file without running it. On a syntax error, return `compile: { ok: false, message, line }` and stop.
3. For each input, in order:
   - Start `python3 -I -u -B file.py` as a child process inside the temp folder, in its own process group, with a minimal environment (nothing from the backend's `.env`).
   - Write the input to stdin, then close stdin. A broken pipe (the program never reads input) is ignored.
   - Start a wall-clock timer for `timeLimitMs`. If it fires, kill the whole process group.
   - Collect stdout and stderr, stopping at the caps.
4. Map how the process ended to a status:

| What happened | Status |
| --- | --- |
| Exit code 0 | `OK` |
| Exit code not 0 (crash, uncaught error, `EOFError`) | `RUNTIME_ERROR` |
| Killed by the timer | `TIME_LIMIT_EXCEEDED` |
| Killed for printing over 64 KB | `RUNTIME_ERROR`, with stderr saying output limit exceeded |
| Python could not be started at all | Throws `RunnerUnavailableError` |

5. If `stopOnError` is true and a status is not `OK`, skip the remaining inputs.
6. Always delete the temp folder in a `finally` step, even after errors.

**Other rules**

- At most 2 `runTests` calls run at the same time (a setting). Others wait in a queue. If more than 10 are waiting, it throws `RunnerUnavailableError`.
- There is no memory limit: the local runner cannot enforce one reliably on a Mac. A Judge0 adapter would add it.
- Run (samples) passes `stopOnError: false`, so every sample shows a result. Submit passes `stopOnError: true`, so one infinite loop costs one time limit, not one per test.
- The Judge0 adapter must return this same shape.

**Acceptance checks**

- A correct program returns `OK` with the right stdout.
- A program with a missing colon returns `compile.ok = false` with the right line number, and no test runs.
- A program that divides by zero returns `RUNTIME_ERROR`.
- `while True: pass` returns `TIME_LIMIT_EXCEEDED` in about the limit plus a small margin, and no Python process is left running.
- A program printing 10 MB returns `RUNTIME_ERROR` and does not exhaust memory.
- A program calling `input()` when no input exists returns `RUNTIME_ERROR`.
- No temp folder remains after any of the above.
- With Python unavailable it throws `RunnerUnavailableError` instead of returning a result.

**Decisions**

| # | Decision |
| --- | --- |
| D27 | On Submit the student is never told why a test failed. The response says only `ACCEPTED`, `NOT_ACCEPTED` (some test cases did not pass) or `COMPILATION_ERROR` (with the message and line number). |
| D28 | The stored verdict of a submission is the type of the first failing test in order (samples first, then hidden). It is stored for the report, never returned by Submit. |
| D29 | Run uses `stopOnError: false`; Submit uses `stopOnError: true`. |

### 5.2 Output comparison and verdict calculation

**The core idea.** The student writes a complete program (D1). Nothing is returned to the backend as an object. The only thing the backend ever sees is the text the program printed to stdout. So every answer, whatever its type (number, list, stack, tree), must be printed in one fixed text format that the problem statement defines, and comparing answers means comparing text.

### Comparing outputs

The backend normalizes both the student's stdout and the stored expected output in the same way:

1. Convert Windows line endings (`\r\n`) and old Mac ones (`\r`) to `\n`.
2. Split into lines.
3. Remove spaces and tabs at the end of each line.
4. Remove empty lines at the end of the whole output.
5. Join the lines back with `\n`.

Then the two strings must be exactly equal.

| Student prints | Expected | Result |
| --- | --- | --- |
| `5` | `5` | Pass |
| ` 5  ` (trailing space) | `5` | Pass |
| `5` followed by extra blank lines | `5` | Pass |
| `5` | `6` | Fail |
| `yes` | `Yes` | Fail (case matters) |
| `1  2` (two spaces) | `1 2` | Fail (spaces inside a line matter) |
| `  5 ` (leading space) | `5` | Fail |
| `1` and `2` on two lines | `1 2` on one line | Fail |
| Nothing printed | `5` | Fail |
| A debug print left in the code | `5` | Fail (extra output) |

### Other details that must hold

- Before feeding a test input to stdin, the backend makes sure it ends with `\n`.
- Expected outputs are stored already normalized by the seed script, and the backend normalizes them again when comparing.
- Python errors mention the temp file's path. The file is named `main.py`, and any occurrence of the temp folder path in stderr or syntax messages is replaced with `main.py`, so nothing about the server reaches the student.
- A compile error is shown as `Line {line}: {message}`, for example `Line 3: SyntaxError: invalid syntax`. If no line is known, only the message.
- In a Run response, each sample's `actual` and `error` are cut at 10,000 characters, with `(truncated)` added.

### Rules for writing problems (data structures and formats)

Every problem statement must define an exact input format and an exact output format. The expected outputs are produced by the reference solution printing in exactly that output format. The student's program reads the input and builds any structure itself (a list, a stack, a tree); only the final printed text is compared.

| Kind of data | Input format | Output format |
| --- | --- | --- |
| Number, string | As stated | Printed as is |
| Array (vector) | Line 1: `n`; line 2: `n` values | Values on one line, separated by single spaces |
| Matrix | Line 1: `r c`; then `r` lines | `r` lines of space-separated values |
| Linked list | Same as an array of its values | The result's values on one line; an empty list prints nothing |
| Stack or queue | A list of commands (push, pop, ...), or the starting contents | What each query prints, one per line; or the final contents on one line, with the order stated (top to bottom, front to back) |
| Set, map, or any unordered result | As stated | Printed in sorted order (by value or by key), so only one output is correct |
| Binary tree | Level-order values with the word `null` for a missing child; line 1 is the token count | A number or list computed from the tree, or a tree printed in the same level-order format with trailing `null` tokens removed (a single canonical form) |
| Graph | Line 1: `n m`; then `m` lines of edges (with a weight if weighted) | Numbers (for example distances) rather than paths, unless a tie-break rule makes the path unique |
| Yes or no answer | As stated | The exact words stated in the problem, such as `YES` or `NO` |
| Decimal number | As stated | Printed with the exact number of decimal places stated in the problem |
| Several valid answers | Not allowed | Either state a tie-break rule (such as the lexicographically smallest) or do not use the problem |

There is no such thing as a returned pointer or object reference: only printed text exists. Two trees are equal exactly when their canonical text is equal.

### Verdict calculation (Submit)

Tests are in a fixed order: samples first, then hidden tests.

1. If `compile.ok` is false: stored verdict `COMPILATION_ERROR`, `errorMessage` set, `testsPassed` 0.
2. Otherwise go through the results in order. A test fails if its status is not `OK`, or its normalized output differs from the expected one. The first failing test decides the stored verdict:

| First failing test | Stored verdict |
| --- | --- |
| `RUNTIME_ERROR` | `RUNTIME_ERROR` |
| `TIME_LIMIT_EXCEEDED` | `TIME_LIMIT_EXCEEDED` |
| Status `OK` but wrong output | `WRONG_ANSWER` |

Its position is saved as `failedTestNumber` (for debugging only; never returned).

3. If no test fails: stored verdict `ACCEPTED`.
4. `testsPassed` is how many of the executed tests passed; `totalTests` is all tests (samples plus hidden). Tests skipped because of `stopOnError` count as not passed. `runtimeMs` is the slowest executed test.
5. The response maps the stored verdict as in D27: `ACCEPTED` and `COMPILATION_ERROR` stay as they are; everything else is returned as `NOT_ACCEPTED`.

### Run calculation

For each sample in order: it passes if its status is `OK` and its normalized output equals the expected one. The response lists every sample (input, expected, actual, passed, status, error) and `testsPassed` out of the number of samples. A Run never creates a submission and never marks a question solved.

### Acceptance checks

- Trailing spaces and extra trailing blank lines pass; leading spaces, wrong case and doubled inner spaces fail.
- CRLF output equals the same text with LF.
- A solution that fails a sample and also a hidden test is stored with the type of the sample's failure.
- A Submit with a syntax error returns `COMPILATION_ERROR` and runs no test.
- No response and no stored error text contains the temp folder path.
- A program that passes tests 1 and 2, then times out on test 3, is stored as `TIME_LIMIT_EXCEEDED` with `testsPassed` 2.
- Every problem in the seed data has its input format, output format and canonical form stated in the statement.

### Decisions

| # | Decision |
| --- | --- |
| D30 | Comparison is line-based: only trailing spaces and trailing blank lines are ignored. |
| D31 | Every answer is text printed by the program, in a canonical format defined by the problem. Trees, stacks and other structures are never compared as objects. |
| D32 | Decimals are printed with a fixed number of places and compared exactly. A tolerance checker is not in the MVP. |

### 5.3 Atomic updates: attempts, cooldowns, start and finish

**The problem.** Two requests can arrive at the same moment (a double click, two tabs). If the backend first reads the round, checks the cooldown, and then writes, both requests can pass the check before either writes. The fix is one rule: **every check that protects a limit is part of the update itself.** The backend sends a single conditional update to MongoDB; MongoDB applies it to the round document atomically, so exactly one of two simultaneous requests matches. Never read, check, then write.

**One clock value per request.** When a request arrives, the backend captures `now` once. That same value is used in every condition and is saved as `submittedAt`, `at` and `solvedAt`. This is what makes R9 true.

### The attempt gate (Run and Submit)

E14 and E15 start with one conditional update, after the round guard and the code-size check.

|  | Run (E14) | Submit (E15) |
| --- | --- | --- |
| Match | The round id and user, status ACTIVE, `deadline` later than `now`, and the slot with this index | Same |
| Counter condition | The slot's `runCount` is below 30 | The slot's `submitCount` is below 20 |
| Cooldown condition | `lastRunAt` is empty or at least 3 seconds before `now` | `lastSubmitAt` is empty or at least 5 seconds before `now` |
| Set | `lastRunAt` = `now`; the slot's `runCount` + 1; the slot's `code` and `codeUpdatedAt`; the current minute added to the slot's activeMinutes | `lastSubmitAt` = `now`; the slot's `submitCount` + 1; the slot's `code` and `codeUpdatedAt`; the current minute added to the slot's activeMinutes |

The update returns the round as it was before the change (call it the previous round).

**If nothing matches,** the backend reads the round once to find out why, in this order:

1. The round is not ACTIVE or its deadline has passed: apply the guard errors (run lazy expiry first; 409 `ROUND_EXPIRED` or `ROUND_NOT_ACTIVE`).
2. The slot's counter is already at its cap: 429 `ATTEMPT_LIMIT`.
3. Otherwise: 429 `COOLDOWN`, with `details.retryAfterMs` saying how long to wait.

**Giving the attempt back (R10).** If `runTests` throws `RunnerUnavailableError`, the backend reverses the gate with a second conditional update: it matches only if `lastRunAt` (or `lastSubmitAt`) still equals this request's `now`, then subtracts 1 from the counter and restores the previous cooldown time from the previous round. The saved code stays. A later attempt by the student is never touched, because of the match condition.

### The other atomic operations

| Operation | Match | Set | If nothing matches |
| --- | --- | --- | --- |
| Lazy expiry (run by the round guard) | The round id, status ACTIVE, `deadline` at or before `now` | Status FINISHED, `finishReason` EXPIRED, `finishedAt` = `deadline` | Nothing to do; carry on |
| Start (E10) | The round id and user, status READY | Status ACTIVE, `startedAt` = `now`, `deadline` = `now` + `durationMin` | Read the round: not READY gives 409 `ROUND_NOT_READY`. If the database rejects it because of the unique ACTIVE index, 409 `ACTIVE_ROUND_EXISTS` |
| Finish (E11) | The round id and user, status ACTIVE, `deadline` later than `now` | Status FINISHED, `finishReason` MANUAL, `finishedAt` = `now` | Read the round: FINISHED is returned as it is; READY gives 409 `ROUND_NOT_ACTIVE` |
| Open question (E12) | The round id and user, status ACTIVE, `deadline` later than `now`, the slot with this index and an empty `firstOpenedAt` | The slot's `firstOpenedAt` = `now` | Nothing wrong: it was already set; carry on and return the question |
| Autosave (E13) | The round id and user, status ACTIVE, `deadline` later than `now`, the slot with this index | The slot's `code` and `codeUpdatedAt`; the current minute added to the slot's activeMinutes | Apply the guard errors |
| First solve (after a graded Submit) | The round id, the slot with this index and an empty `solvedAt` | The slot's `solvedAt` = this submission's `submittedAt` | Nothing wrong: already solved; carry on |

**The first-solve update does not require ACTIVE.** A Submit that passed the gate before the deadline is graded in full even if grading ends after the deadline (R9), so its result is still saved and can still mark the question solved.

### Order of work inside Submit

1. Round guard, code-size check, attempt gate.
2. Load tests and call `runTests`. If it throws, give the attempt back and return 503.
3. Calculate the verdict (5.2).
4. Save the submission, then the SUBMIT event, then (only if ACCEPTED) the first-solve update.

If the server stops between steps 1 and 4, the attempt is counted but no submission exists. That is accepted for the MVP.

### Acceptance checks

- Two simultaneous Runs on one question: one succeeds, the other returns 429 `COOLDOWN`, and `runCount` rises by exactly 1.
- The 31st Run on a question returns 429 `ATTEMPT_LIMIT`; the 21st Submit does too.
- A Run 2 seconds after another returns 429 `COOLDOWN` with `retryAfterMs` about 1000; one after 3 seconds succeeds.
- Run and Submit cooldowns are independent.
- A runner failure leaves `runCount`, `submitCount`, `lastRunAt` and `lastSubmitAt` as they were.
- A request arriving exactly at `deadline` is rejected (`deadline` must be later than `now`).
- Autosave after the deadline is rejected and the saved code does not change.
- Two simultaneous Finish calls end with one FINISHED round and two 200 responses.
- Two simultaneous Start calls produce one deadline.
- A Submit accepted before the deadline whose grading ends after it still creates its submission and sets `solvedAt`.

### Decisions

| # | Decision |
| --- | --- |
| D33 | Every limit check is part of one atomic conditional update; no read-then-write. |
| D34 | Run and Submit cooldowns are independent, and both are per round. |
| D35 | A failed runner gives the attempt back (R10), but the saved code stays. |
| D36 | There is no lock to stop a second Run starting while the first is still executing; the cooldown and the runner queue limit the load. |

### 5.4 Round creation (E6): how problems are picked

1. **Validate** the request (section 4.4) and check that the user has fewer than 20 READY rounds.
2. **Set the duration:** use `durationMin` if given, otherwise add up the difficulty table (easy 12, medium 20, hard 30).
3. **Group the slots** by (topic, difficulty). A group with `k` slots needs `k` different problems from the approved pool for that pair.
4. **Check the pool first.** Count the approved problems for each group. If any group has fewer than it needs, stop and save nothing. Return 422 `NOT_ENOUGH_PROBLEMS`, and let `details` list every short group: its slot numbers, topic, difficulty, how many were asked for and how many exist.
5. **Pick randomly.** Fetch the ids of the approved problems of the group, shuffle them with a proper shuffle (Fisher-Yates) and take the first `k`. Do not use MongoDB `$sample`, because it can return the same document twice.
6. **Assign** the picked problems to the group's slots in slot order.
7. **Save** the round as READY, with all slot counters at 0, and return the round summary (no statements).

**Rules**

- The slots stay in the order the student gave them (D37). Nothing is sorted.
- Every slot names a topic from `TOPICS`. There is no `any topic` option in the MVP (D38).
- R7 holds because a problem has one topic and one difficulty: problems of different groups are always different, and inside a group `k` distinct problems are taken. A problem can still appear again in a later round (D13).
- The 20 READY rounds cap is a plain count before saving, not an atomic check. Two simultaneous creates could end at 21, which is harmless, so this is an allowed exception to D33.

**Acceptance checks**

- Three slots of the same topic and difficulty give three different problems.
- Asking for 3 slots of a group with only 2 approved problems returns 422 and saves nothing; `details` shows 3 requested and 2 available.
- Two short groups in one request are both listed in `details`.
- A `draft` problem is never picked.
- The returned slots are in the requested order.
- Creating a round does not change any other round.

**Decisions**

| # | Decision |
| --- | --- |
| D37 | Questions keep the order the student arranged them. |
| D38 | Every slot names a topic; there is no `any topic` option. |
| D39 | Random picking uses a shuffle of the matching ids, not `$sample`. |

### 5.5 The report

The report is a pure function of saved data: `buildReport(round, problems, submissions, events)`. E16 loads the data and calls it. It uses no AI and gives the same output for the same round. Every sentence is a template filled with numbers from the database.

### Active minutes (new data)

- Each slot has `activeMinutes`: an array of whole numbers with no duplicates.
- The minute number is `floor((now - startedAt) / 60 seconds)`, so 0 is the first minute of the round.
- The current minute is added to the set in the same atomic update as autosave (E13), the Run gate and the Submit gate (section 5.3). Opening a question does not add one.
- A question's `activeMin` is the number of entries. The browser should autosave only when the code changed.
- Limit: time spent reading without typing is not counted, so `activeMin` is approximate and can be lower than real time.

### Metrics

Per question:

| Metric | How it is computed |
| --- | --- |
| `result` | `SOLVED` if `solvedAt` is set; `NOT_OPENED` if `firstOpenedAt` is empty; otherwise `NOT_SOLVED` |
| `activeMin` | Number of entries in `activeMinutes` |
| `expectedMin` | From the difficulty table (easy 12, medium 20, hard 30) |
| `firstRunAfterMin` | Time of the first RUN event minus `firstOpenedAt`, in whole minutes; empty if there is no Run |
| `runCount`, `submitCount` | From the slot |
| `failedSubmits` | Submissions with a verdict other than `ACCEPTED` made before `solvedAt` (all of them if unsolved) |
| `runtimeMs`, `timeLimitMs` | `runtimeMs` of the first `ACCEPTED` submission, and the problem's limit (solved questions only) |
| `runtimeRatio` | `runtimeMs / timeLimitMs` |
| `lastVerdict` | Stored verdict of the last submission; empty if none |
| `lastFailedTestNumber` | `failedTestNumber` of the last submission (used only inside the report; never returned) |
| `blindSubmits` | SUBMIT events with no RUN event on the same question since the previous SUBMIT (or since `firstOpenedAt` for the first one) |

For the round:

| Metric | How it is computed |
| --- | --- |
| `solved`, `total` | Number of `SOLVED` questions, and the number of questions |
| `timeUsedSec` | `finishedAt - startedAt` |
| `timeAllottedSec` | `durationMin * 60` |
| `timeLeftSec` | `timeAllottedSec - timeUsedSec`, never below 0 |
| `timeLeftRatio` | `timeLeftSec / timeAllottedSec` |
| `totalFailedSubmits` | Sum of `failedSubmits` over all questions |
| `lateFailedSubmits` | Submissions with a verdict other than `ACCEPTED` made in the last 5 minutes before `finishedAt` |

### Failure reason

For a question that is not `SOLVED`, `failureReason` is chosen from the last submission. It names the kind of failure only, never a test number, input, output or error text.

| Situation | `failureReason` |
| --- | --- |
| `lastVerdict` is `TIME_LIMIT_EXCEEDED` | `TOO_SLOW` |
| `WRONG_ANSWER` and `lastFailedTestNumber` is greater than the number of samples | `WRONG_ON_HIDDEN` |
| `WRONG_ANSWER` and `lastFailedTestNumber` is within the samples | `WRONG_ON_SAMPLE` |
| `RUNTIME_ERROR` | `CRASH` |
| `COMPILATION_ERROR` | `SYNTAX_ERROR` |
| No submission but `runCount` is above 0 | `NOT_SUBMITTED` |
| Otherwise | empty |

### Grade

| Grade | Rule (checked in this order) |
| --- | --- |
| `NEEDS_WORK` | No question solved |
| `PARTIAL` | At least one solved, but not all |
| `SOLVED_WITH_STRUGGLE` | All solved and (`totalFailedSubmits` is above 3 or `timeLeftRatio` is below 0.10) |
| `EXCELLENT` | All solved, `totalFailedSubmits` is 0, `timeLeftRatio` is above 0.25, and no question has `runtimeRatio` of 0.8 or more |
| `STRONG` | All solved, anything else |

### Insight rules

Each rule is a condition on the metrics. When it is true, it produces an insight with a priority. Thresholds are settings (see below).

| Rule | Fires when | Priority |
| --- | --- | --- |
| `TRIAGE` | Question A is not solved and `activeMin` is at least `expectedMin`, and some other question B is `NOT_OPENED` or is not solved with `activeMin` below half of its `expectedMin` | 100 |
| `TOO_SLOW` | A question's `failureReason` is `TOO_SLOW` | 90 |
| `EDGE_CASES` | `failureReason` is `WRONG_ON_HIDDEN` | 85 |
| `SAMPLE_FAIL` | `failureReason` is `WRONG_ON_SAMPLE` | 84 |
| `CRASH` | `failureReason` is `CRASH` | 83 |
| `SYNTAX` | `failureReason` is `SYNTAX_ERROR` | 82 |
| `NOT_SUBMITTED` | `failureReason` is `NOT_SUBMITTED` | 81 |
| `RISKY_RUNTIME` | A solved question has `runtimeRatio` of 0.8 or more | 80 |
| `MANY_FAILED_SUBMITS` | A question has `failedSubmits` of 3 or more | 70 |
| `PANIC_SUBMITS` | `lateFailedSubmits` is 3 or more | 60 |
| `BLIND_SUBMITS` | A question has `blindSubmits` of 2 or more | 55 |
| `SLOW_START` | A question has `firstRunAfterMin` above half of its `expectedMin` | 40 |
| `SLOWEST` | All solved, and the question with the highest `activeMin / expectedMin` has a ratio of 1.0 or more | 35 |
| `TOO_EASY` | All solved, `totalFailedSubmits` is 0, and `timeLeftRatio` is above 0.25 | 30 |

### Templates

The text of each insight is filled in from `values`. `Q{n}` is the question number.

| Rule | Text |
| --- | --- |
| `TRIAGE` | You spent {minutes} minutes on Q{n} without solving it, while {other}. Moving on after about {expected} minutes could have meant {possible} of {total} solved. |
| `TOO_SLOW` | Q{n} ran out of time on at least one test. Your logic may be right, but the algorithm needs to be faster. Check the constraints to see what complexity you need. |
| `EDGE_CASES` | Q{n} passed the samples but gave wrong answers on some hidden tests. Think about edge cases: empty or minimum input, maximum values, duplicates and negative numbers. |
| `SAMPLE_FAIL` | Q{n} still failed a sample test. Re-read the statement and trace the sample by hand against your code. |
| `CRASH` | Q{n} crashed on some input. Check index bounds, empty input, type conversions and division by zero. |
| `SYNTAX` | Q{n} ended with a syntax error. Run your code before you submit so errors show up early. |
| `NOT_SUBMITTED` | On Q{n} you ran your code but never submitted it. Only a submission counts. |
| `RISKY_RUNTIME` | Q{n} passed, but its slowest test used {runtime} s of a {limit} s limit. A bigger test could time out, so look for a faster approach. |
| `MANY_FAILED_SUBMITS` | Q{n} took {count} failed submits. In a real OA, wrong submissions can cost minutes or points. Run the samples and test edge cases before you submit. |
| `PANIC_SUBMITS` | {count} failed submits came in the last 5 minutes. That looks like guessing under pressure. Stop, re-read the problem and test one idea at a time. |
| `BLIND_SUBMITS` | On Q{n} you submitted {count} times without running your code in between. Running first costs nothing and catches most mistakes. |
| `SLOW_START` | On Q{n} you waited {minutes} minutes before your first run. Writing a rough solution earlier gives you something to improve. |
| `SLOWEST` | Q{n} took {minutes} minutes against an expected {expected}. It was your bottleneck. |
| `TOO_EASY` | You solved everything on the first try with {left} minutes to spare. This level is not challenging you. |

In `TRIAGE`, `{other}` is `Q{m} was never opened` when B is `NOT_OPENED`, otherwise `Q{m} got only {minutes} minutes`. `{possible}` is the smaller of `solved + 1` and `total`.

Fallback headline when no rule fires: `All {total} solved within the time.` if everything is solved, otherwise `Time ran out with {unsolved} question(s) unsolved.`

### Choosing what to show

1. Collect every insight whose rule fired (a rule can fire once per question).
2. Sort by priority, highest first; break ties by the lower question number.
3. Keep at most one insight per question: the highest-priority one. Insights that belong to no question (`TRIAGE`, `PANIC_SUBMITS`, `TOO_EASY`) are always kept.
4. The first insight is the headline. The next three, at most, are the insights list. The rest are dropped.
5. A question's `flags` are the rules that fired for it among `RISKY_RUNTIME`, `MANY_FAILED_SUBMITS`, `BLIND_SUBMITS` and `SLOW_START`, even when dropped from the list.

### Next round

The first matching row decides. `durationMin` is the sum of the difficulty table for the new slots, unless stated.

| Headline rule or grade | Next round | Reason text |
| --- | --- | --- |
| `TRIAGE` | The same slots, the same duration | Practise choosing the order: skim all questions and start with the easiest. |
| `TOO_SLOW`, `EDGE_CASES`, `SAMPLE_FAIL`, `CRASH`, `SYNTAX`, `NOT_SUBMITTED` | One slot for each unsolved question, with its topic and difficulty | Practise the topics that cost you this round. |
| `RISKY_RUNTIME`, `MANY_FAILED_SUBMITS`, `BLIND_SUBMITS`, `PANIC_SUBMITS`, `SLOW_START` | The same slots, the same duration | Same round again, aiming for first-try solutions with a safe runtime. |
| `SLOWEST`, or grade `SOLVED_WITH_STRUGGLE` because of time | The same slots, with `durationMin` at 85 percent of this round (nearest minute, at least 5) | Same questions in less time to build speed. |
| `TOO_EASY`, or grade `EXCELLENT` | Every slot one level harder (easy to medium, medium to hard). If all are already hard, add one more hard question (at most 5) | You solved this level with time to spare. |
| Anything else | The same slots, the same duration | Repeat the round and aim to beat your result. |

The next round is only a suggestion with the same shape as the E6 request. It may be refused by E6 with 422 if the bank is short; the frontend shows that message.

### Settings (thresholds)

| Setting | Value |
| --- | --- |
| Risky runtime ratio | 0.8 |
| Many failed submits | 3 |
| Late-submit window and count | 5 minutes, 3 submits |
| Blind submits | 2 |
| Slow start | 0.5 of expected time |
| Too easy and excellent time left | above 25 percent |
| Struggle: failed submits and time left | above 3, below 10 percent |
| Triage: under-attempted question | below 0.5 of expected time |
| Maximum insights after the headline | 3 |
| Faster-round factor | 0.85 |

### Report response (E16)

This replaces the report table in section 4.5.

| Field | Type | Notes |
| --- | --- | --- |
| `roundId`, `durationMin`, `startedAt`, `finishedAt`, `finishReason` |  | From the round |
| `grade` | string | `EXCELLENT`, `STRONG`, `SOLVED_WITH_STRUGGLE`, `PARTIAL`, `NEEDS_WORK` |
| `summary` | object | `solved`, `total`, `timeUsedSec`, `timeAllottedSec`, `timeLeftSec` |
| `headline` | object | An insight: `{ rule, question, values, text }` |
| `insights` | array | Up to 3 insights of the same shape |
| `questions` | array | Each: `index`, `topic`, `difficulty`, `result`, `activeMin`, `expectedMin`, `firstRunAfterMin`, `runCount`, `submitCount`, `failedSubmits`, `runtimeMs`, `timeLimitMs`, `failureReason`, `flags` |
| `timeMap` | object | `totalMinutes` and, for each question, its `activeMinutes` list |
| `nextRound` | object | `reason`, `slots` (`topic`, `difficulty`), `durationMin` |

The report never contains code, problem statements, hidden inputs or outputs, test numbers, error text or the raw stored verdicts.

### Acceptance checks

- `buildReport` is a pure function: the same input always gives the same output, with no database or network call inside.
- Three questions solved first try with more than 25 percent time left and fast runtimes: grade `EXCELLENT`, headline `TOO_EASY`, next round one level harder.
- All solved with 4 failed submits in total: grade `SOLVED_WITH_STRUGGLE`.
- One solved, Q2 unsolved with a Time Limit Exceeded after 31 minutes, Q3 never opened: grade `PARTIAL`, headline `TRIAGE`, Q2 `failureReason` is `TOO_SLOW`, Q3 `result` is `NOT_OPENED`.
- A round with no submissions: grade `NEEDS_WORK`, with the fallback headline.
- The list has at most 3 insights plus the headline, and at most one per question.
- No response field contains `failedTestNumber`, code, or any test input or output.
- A `WRONG_ANSWER` on test 2 of 2 samples gives `WRONG_ON_SAMPLE`; the same on test 5 of 7 gives `WRONG_ON_HIDDEN`.
- Active minutes: an autosave, a Run and a Submit in the same minute add one entry; opening a question adds none.

### Decisions

| # | Decision |
| --- | --- |
| D40 | After the round is FINISHED the report may name the kind of failure (too slow, wrong on hidden tests, crash, syntax error), but never a test number, input, output or error text. |
| D41 | Insights are written by rules and fixed templates, never by an AI. |
| D42 | Time spent comes from `activeMinutes`, recorded on autosave, Run and Submit. |
| D43 | The grade has five levels, decided by the rules above. |
| D44 | The report shows one headline and at most three insights, with at most one per question. |
| D45 | Every threshold is a setting, not hard-coded. |

## 6. Cross-cutting rules

These rules apply to every endpoint. They are decided once here so that no endpoint invents its own.

### 6.1 Authentication and passwords

- Tokens are JWTs signed with HS256 using `JWT_SECRET`. The payload holds `sub` (the user id), `iat` and `exp`. The token lives 1 day (`JWT_EXPIRES_IN`).
- The token travels only in the `Authorization: Bearer <token>` header. There are no cookies, no refresh tokens and no logout endpoint; the client simply discards the token (D46).
- The auth middleware verifies the signature and expiry, then loads the user by `sub`. If the token is bad, expired or the user no longer exists, it returns 401 `UNAUTHORIZED`. It attaches `req.user` for later steps.
- Passwords are hashed with `bcrypt`, cost 10 (`BCRYPT_COST`, allowed 10 to 12). The password must be 8 to 72 bytes long.
- Login must not reveal whether the email exists: a wrong email and a wrong password return the same 401 `INVALID_CREDENTIALS` message. When the email is not found, the backend still runs one `bcrypt` comparison against a fixed dummy hash, so both cases take about the same time.
- Register does return 409 `EMAIL_TAKEN`. Hiding that would make signing up unusable, so this small exposure is accepted.
- CORS allows only the origins listed in `CORS_ORIGIN` (never a wildcard in production), the methods GET, POST, PUT and DELETE, and the headers `Authorization` and `Content-Type`. Credentials mode is not needed.
- `helmet` sets the standard security headers on every response.

### 6.2 Validation

- Every endpoint validates its body, params and query with one `zod` schema before any other logic. Unknown fields are removed. A value of the wrong type (an object where a string is expected) is a validation error. This also blocks NoSQL operator injection.
- A malformed JSON body returns 400 `VALIDATION_ERROR`. An unknown route returns 404 `NOT_FOUND`.
- A route id that is not a valid ObjectId returns 404 `NOT_FOUND`, not 400, so ids cannot be probed. A question `:index` outside 1 to the number of questions also returns 404.
- Request values are never placed directly inside a database query as objects; only validated strings, numbers and ObjectIds are used. Mongoose is configured with `sanitizeFilter: true` as a second layer.

| Field | Rule |
| --- | --- |
| `name` | String, trimmed, 2 to 50 characters |
| `email` | String, valid format, at most 254 characters, trimmed and lowercased |
| `password` | String, 8 to 72 bytes |
| `durationMin` | Whole number, 5 to 180 |
| `slots` | Array of 1 to 5 items |
| `slots[].topic` | String, one of `TOPICS` |
| `slots[].difficulty` | One of `easy`, `medium`, `hard` |
| `language` | Exactly `python` |
| `code` | String, at most 51,200 characters |
| `status` (query) | One of `READY`, `ACTIVE`, `FINISHED` |
| `page` (query) | Whole number, at least 1, default 1 |
| `limit` (query) | Whole number, 1 to 50, default 20 |

Validation errors return 400 with `details` listing each bad field and a short reason.

### 6.3 Error handling

- Application code throws an `AppError` carrying the code, HTTP status, message and optional details from section 4.2. One central error middleware turns it into `{ error: { code, message, details? } }`.
- Any other error returns 500 `INTERNAL_ERROR` with a generic message. The full error is logged on the server. A stack trace or internal message is never sent to the client.
- Database duplicate-key errors are translated: a duplicate `users.email` gives 409 `EMAIL_TAKEN`; a duplicate on the unique ACTIVE-round index gives 409 `ACTIVE_ROUND_EXISTS`.
- A body larger than the limit returns 413 `CODE_TOO_LARGE`.
- Every response carries an `X-Request-Id` header (a generated UUID). The same id appears in the logs of that request, so one failure can be traced.
- Async handlers must forward errors to the middleware; an unhandled promise rejection must never crash the process silently.

### 6.4 Rate limiting

General limits protect the server. They are separate from the per-question cooldowns and caps in 5.3.

| Applies to | Limit | Keyed by |
| --- | --- | --- |
| `POST /api/auth/register` and `POST /api/auth/login` | 10 requests per minute | IP address |
| All other `/api` endpoints | 200 requests per minute | The user id (IP address if no valid token) |

- Exceeding a limit returns 429 `TOO_MANY_REQUESTS` with a `Retry-After` header.
- The counters live in memory (`express-rate-limit`), which is enough for one server instance. Behind a proxy, `TRUST_PROXY` must be set so the real client address is used.
- Autosave has no limit of its own; the browser sends it at most once every 1 to 2 seconds.

### 6.5 Logging

- One JSON log line per request (`pino` with `pino-http`): method, route, status, duration in milliseconds, request id, and the user id when known. The level comes from `LOG_LEVEL`.
- Never log: passwords, tokens, the `Authorization` header, the body of auth requests, student code, hidden tests, expected outputs, or the stdout and stderr of student programs (R2). Redact the fields `password`, `authorization`, `token`, `code` and `hiddenTests` in every log.
- Log these events at info level, with ids only: round created, started and finished (with the finish reason); a Submit with its stored verdict, tests passed and runtime.
- Log at error level: every 500, every `RunnerUnavailableError` with its cause, and any failed database operation.

### 6.6 Configuration

Settings come from environment variables, validated with `zod` when the server starts. If one is missing or invalid, the server prints which one and exits, instead of failing later. A `.env.example` file lists them all; `.env` is never committed.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | 5000 |  |
| `MONGODB_URI` | none | Required |
| `JWT_SECRET` | none | Required, at least 32 characters |
| `JWT_EXPIRES_IN` | `1d` |  |
| `BCRYPT_COST` | 10 | 10 to 12 |
| `CORS_ORIGIN` | none | Required in production; a comma-separated list of origins |
| `TRUST_PROXY` | `false` | Set to `true` behind a proxy |
| `LOG_LEVEL` | `info` |  |
| `PYTHON_BIN` | `python3` | Path of the Python executable |
| `RUNNER_CONCURRENCY` | 2 | Simultaneous `runTests` calls |
| `RUNNER_QUEUE_MAX` | 10 | Waiting calls allowed before it throws |
| `RUNNER_STDOUT_LIMIT_BYTES` | 65536 |  |
| `RUNNER_STDERR_LIMIT_BYTES` | 8192 |  |

**Constants, not environment variables.** The limits in section 1.6, the report thresholds in 5.5, the difficulty table, and `TOPICS` live in one file, `config/limits.js`. No number from those tables may be written anywhere else in the code.

### 6.7 Startup, time and shutdown

- Startup order: validate settings, connect to MongoDB, wait until the model indexes exist (in particular the unique partial ACTIVE-round index on `assessments`), then start listening. If any step fails, exit with a non-zero code.
- Every timestamp comes from one function, `now()`, in a clock module, and every date is UTC. Tests replace this function to control time (for example to test the deadline).
- On `SIGTERM` or `SIGINT`: stop accepting new requests, let running requests finish, kill any running Python processes, delete their temp folders, close the database connection, then exit.
- The health endpoint (E1) only reports that the process is alive.

### 6.8 Acceptance checks

- The server refuses to start without `MONGODB_URI` or with a `JWT_SECRET` shorter than 32 characters, and says which setting is wrong.
- A request with an expired token returns 401; a token for a deleted user returns 401.
- Login with an unknown email and login with a wrong password return identical responses.
- A request with `email` sent as an object (an injection attempt) returns 400.
- A malformed JSON body returns 400; an invalid round id returns 404.
- A thrown unexpected error returns 500 with a generic message and no stack trace, and the log has the full error under the same request id.
- The 11th login request from one IP within a minute returns 429 with `Retry-After`.
- No log line contains a password, token, student code or any test data.
- Setting the clock to after a round's deadline makes Submit return 409 `ROUND_EXPIRED` without waiting in real time.
- On `SIGTERM` no Python process or temp folder is left behind.

### 6.9 Decisions

| # | Decision |
| --- | --- |
| D46 | Access tokens only: no refresh tokens, no cookies, no logout endpoint. |
| D47 | Validation uses one `zod` schema per endpoint; invalid ids return 404, not 400. |
| D48 | All errors go through one central middleware; internal details never reach the client. |
| D49 | Rate limits are per IP for auth and per user for everything else, kept in memory. |
| D50 | Logs are structured JSON and never contain secrets, code or test data. |
| D51 | Settings come from validated environment variables; all other numbers are constants in one file. |
| D52 | Time comes from one replaceable `now()` function. |

## 7. Build plan and acceptance tests

This section tells the builder what to create and in which order. Build one phase at a time. A phase is finished only when its done-when checks pass.

### 7.1 Tools and versions

| Item | Choice |
| --- | --- |
| Runtime | Node.js 20 or newer, Python 3.9 or newer installed on the machine |
| Packages | `express`, `mongoose`, `zod`, `jsonwebtoken`, `bcrypt`, `helmet`, `cors`, `express-rate-limit`, `pino`, `pino-http`, `dotenv` |
| Dev packages | `jest`, `supertest`, `mongodb-memory-server`, `nodemon` |
| Database | MongoDB Atlas free tier (or a local MongoDB) for running; `mongodb-memory-server` for tests |
| Module style | CommonJS (`require`) |

### 7.2 Folder structure

```
oa-simulator-backend/
  package.json
  .env.example          (every variable from 6.6; .env is never committed)
  .gitignore
  README.md
  src/
    server.js           (startup and shutdown, 6.7)
    app.js              (builds the Express app; no listening)
    clock.js            (now(); replaceable in tests)
    config/
      env.js            (validated environment variables)
      limits.js         (all constants: limits, thresholds, TOPICS, difficulty table)
      db.js
    errors/
      AppError.js
    middleware/
      requestId.js, auth.js, validate.js, rateLimit.js, notFound.js, errorHandler.js
    models/
      User.js, Problem.js, Assessment.js, Submission.js, AttemptEvent.js
    schemas/              (zod schemas, one file per area)
    routes/               (URL to controller only)
    controllers/          (read the request, call a service, send the response)
    services/
      authService.js
      topicService.js
      roundService.js       (create, list, get, delete: 5.4)
      roundStateService.js  (guard, lazy expiry, start, finish: 4.3, 5.3)
      questionService.js    (open, autosave: 5.3)
      attemptService.js     (the attempt gate and giving it back: 5.3)
      gradingService.js     (Run and Submit: 5.2)
      reportService.js      (buildReport, a pure function: 5.5)
    runner/
      index.js              (runTests: 5.1)
      compile_check.py      (syntax check helper)
      queue.js
    utils/
      normalizeOutput.js, shuffle.js
  seed/
    problems/             (one JSON file per problem)
    solutions/            (one reference solution per problem, never imported by the app)
    validateProblems.js, generateExpected.js, seedProblems.js
  tests/
    unit/, integration/, helpers/ (fakeRunner.js, fakeClock.js, factories.js)
```

**Layer rules.** Routes know URLs only. Controllers know HTTP only. Services hold the rules and know nothing about Express. Only the runner knows about Python. Only the models know about the database schema. A service never reads `req` or `res`.

### 7.3 Build phases

Each phase lists what to build, the sections it follows, and when it is done. Every acceptance check in those sections must become an automated test, named with its rule id (for example `R4`) where one exists.

**Phase 0: Skeleton**

- Build: project setup, `config/env.js` with startup validation, `config/limits.js`, `clock.js`, `AppError`, the request id, not-found and error middleware, `pino` logging, `app.js`, `server.js`, E1.
- Follow: 6.3, 6.5, 6.6, 6.7.
- Done when: E1 answers; a missing setting stops the server with a clear message; an unknown route and a thrown error both return the standard error JSON; every response has `X-Request-Id`.

**Phase 1: Models**

- Build: the five models with every field, rule and index of section 3, including the unique partial ACTIVE-round index. The server waits for index creation before listening.
- Follow: section 3, 6.7.
- Done when: the acceptance checks of 3.2 to 3.5 pass; a query on `Problem` never returns `hiddenTests` unless asked with `+hiddenTests`; a second ACTIVE round for one user is refused by the database.

**Phase 2: Authentication**

- Build: E2, E3, E4, the auth middleware, the validation middleware with the auth schemas, the auth rate limit.
- Follow: 4.4 (E2 to E4), 6.1, 6.2, 6.4.
- Done when: the acceptance checks of 3.4 and 6.8 for authentication pass; the response never contains `passwordHash`.

**Phase 3: The runner**

- Build: `runTests` exactly as in 5.1, with `compile_check.py`, the queue, and temp-folder cleanup.
- Follow: 5.1, 6.6 (runner settings), 6.7 (shutdown cleanup).
- Done when: every acceptance check of 5.1 passes using real Python (these tests are marked slow and need Python installed).

**Phase 4: Question bank and topics**

- Build: `validateProblems.js`, `generateExpected.js`, `seedProblems.js` (7.5), at least 15 problems across the topics you choose, and E5.
- Follow: 3.2, 4.4 (E5), 5.2 (rules for writing problems), 7.5.
- Done when: the seed script can be run twice without duplicates; every seeded problem passed validation; E5 returns correct counts; no public response contains `hiddenTests`.

**Phase 5: Round builder**

- Build: E6, E7, E8, E9 with `roundService`.
- Follow: 4.4 (E6 to E9), 4.5 (round summary), 5.4.
- Done when: the acceptance checks of 5.4 pass; user B gets 404 on user A's round (R1); E8 never returns statements or code (R16 and D20).

**Phase 6: Round engine**

- Build: the round guard, lazy expiry, E10, E11, E12, E13, and every atomic operation of the second table in 5.3.
- Follow: 2.2 to 2.4, 4.3, 4.4 (E10 to E13), 5.3.
- Done when: the acceptance checks of 5.3 that concern Start, Finish, Open and Autosave pass, with the fake clock; two simultaneous Start calls produce one deadline (R5, R13); autosave after the deadline is rejected (R4).

**Phase 7: Run and Submit**

- Build: the attempt gate and its give-back, `gradingService` (comparison and verdict), E14, E15, the first-solve update, submissions and events.
- Follow: 4.4 (E14, E15), 4.5, 5.1 to 5.3.
- Done when: the acceptance checks of 5.2 and 5.3 pass; with the fake runner the four outcomes (accepted, wrong, crash, timeout) give the right stored verdicts and the right responses; with the real runner a correct and a wrong program behave the same; a runner failure leaves counters unchanged (R10).

**Phase 8: Report**

- Build: `buildReport` as a pure function, `activeMinutes` recording, E16.
- Follow: 5.5, 4.4 (E16).
- Done when: every acceptance check of 5.5 passes; the same input gives the same report; no field of the report contains code, a test number or test data.

**Phase 9: Hardening and README**

- Build: `helmet`, CORS, rate-limit settings, log redaction, graceful shutdown, a full test run, the README (7.7).
- Follow: section 6, 7.6, 7.7.
- Done when: every acceptance check in sections 3 to 6 has a passing test; the log redaction check passes; the README is complete.

### 7.4 Suggested schedule

| Day | Phases |
| --- | --- |
| 1 | 0 and 1 |
| 2 | 2 |
| 3 | 3 and 4 |
| 4 | 5 and 6 |
| 5 | 7 |
| 6 | 8 |
| 7 | 9 |
| 8 | Revision and mock interview; no new features |

If time runs short, finish phases 0 to 7 and write the report (phase 8) in its simplest form; do not skip the tests of phases 6 and 7.

### 7.5 Seed data format

Each problem is one file `seed/problems/<slug>.json` plus a reference solution `seed/solutions/<slug>.py`.

| Field of the problem file | Rule |
| --- | --- |
| `slug`, `title`, `statement`, `inputFormat`, `outputFormat`, `constraints` | As in 3.2 |
| `topic`, `difficulty` | A value from `TOPICS`; `easy`, `medium` or `hard` |
| `timeLimitMs` | 500 to 10,000; default 2000 |
| `samples` | 1 to 3 items with `input` and `explanation`; no `output` is written by hand |
| `hiddenInputs` | 5 to 10 input strings: edge cases (smallest, largest, empty where allowed, duplicates), random cases, and at least one maximum-size case |

**The pipeline** (run by the scripts, in this order):

1. `validateProblems.js` checks every rule below and prints each failure.
2. `generateExpected.js` runs the reference solution through `runTests` on every sample input and every hidden input, and writes the outputs as the expected outputs, already normalized (5.2). A reference solution that fails or times out stops the script.
3. `seedProblems.js` upserts each problem by `slug` into MongoDB with status `approved`. A problem that failed validation or generation is never imported.

**Validation rules**

- Every required field is present, `topic` is in `TOPICS`, there are 1 to 3 samples and 5 to 10 hidden inputs.
- Every input ends with a newline.
- The reference solution finishes in under half of `timeLimitMs` on every input.
- The statement defines the input and output format using the rules of 5.2, including the canonical form for any data structure.
- No two tests have the same input.
- A human reads each statement once before the problem is marked approved.

### 7.6 Testing plan

- **Pure functions first:** `normalizeOutput`, verdict calculation, `shuffle`, and `buildReport`, with plain unit tests.
- **API tests:** `supertest` against the app with `mongodb-memory-server`. The runner is replaced by `fakeRunner.js`, which returns scripted results in the shape of 5.1, so grading is tested without Python. `clock.js` is replaced by `fakeClock.js` so deadlines are tested without waiting.
- **Runner tests:** real Python, marked slow, only for `runTests`.
- **Coverage target:** every rule R1 to R16 and every acceptance check in sections 3 to 6 has at least one test. Name tests with the rule id where there is one.
- **Never test by reading the code only:** each phase ends with its tests running green.

### 7.7 README outline

1. What the project is and the problem it solves.
2. Architecture in one picture: browser, backend, runner, database.
3. How to run it: prerequisites, `.env`, seed, start, test.
4. The flow of a round, in the words of sections 4 and 5.
5. API summary: the 16 endpoints.
6. Key design decisions: server-authoritative time, hidden tests never leave the server, the runner behind one function, atomic updates, a rule-based report.
7. Known limitations, stated plainly: Python only; the local runner is not sandboxed and must never be exposed publicly; no memory limit; one correct output per input; correctness depends on the question bank; no frontend in this scope.
8. Production plan: replace `runTests` with a Judge0 adapter on a Linux server; add a sandbox, memory limits and more languages.

### 7.8 How to give a phase to Claude Code

Use this prompt, filling in the phase number and the sections it follows:

Read sections 1 and 2 of this document, then the sections listed for Phase N in 7.3. Build only Phase N, following the folder structure in 7.2. Write an automated test for every acceptance check in those sections. Do not add endpoints, fields, packages or features that are not written here. If something is not specified, stop and ask me. When you finish, run the tests and list each acceptance check as passed or failed.

Rules for the builder:

- One phase at a time, one commit per phase.
- The specification is never edited by the builder; a gap is reported to the owner.
- Every number comes from `config/limits.js` or `config/env.js`.
- Anything marked Open is not built.

### 7.9 Demonstration script (the project is done when this works)

1. Register and log in; call `/me`.
2. List topics; build a round with three questions; list rounds; get the round (no statements yet).
3. Start it; see the deadline and server time; try to start a second round (409).
4. Open a question; autosave code; Run on samples; Submit a correct solution (`ACCEPTED`).
5. Submit a wrong, a crashing and an infinite-loop solution on other questions (`NOT_ACCEPTED`); submit one with a syntax error (`COMPILATION_ERROR` with its line number).
6. Submit again within the cooldown (429).
7. Let the deadline pass (or finish early) and read the report; try to submit afterwards (409).
8. Try to read the round as a second user (404).

### 7.10 Decisions

| # | Decision |
| --- | --- |
| D53 | The backend is built in ten phases, one at a time, each ending with passing tests. |
| D54 | The runner is built and tested before the question bank, because expected outputs are generated by running the reference solutions. |
| D55 | Grading and deadlines are tested with a fake runner and a fake clock; only `runTests` itself uses real Python. |
| D56 | The builder never changes this specification; gaps are reported to the owner. |
