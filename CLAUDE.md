# OA Simulator backend

Specification: docs/OA Simulator System Design Specification.md. It is the only source of truth. Never edit it.
Always read sections 1 and 2, plus the sections named in my prompt.

Rules
- Build one phase at a time, exactly as written in section 7.3.
- Follow the folder structure in section 7.2.
- Do not add endpoints, fields, packages or features that are not in the spec.
- If something is not specified, stop and ask me. Do not guess.
- Show me a short plan first and wait for my approval before writing code.
- Every number comes from config/limits.js or config/env.js, never written in other files.
- Write an automated test for every acceptance check in the sections you follow,
  named with the rule id where one exists (for example R4).
- Never log passwords, tokens, student code or test data.
- When finished, run the tests and list each acceptance check as passed or failed.
- After a phase is finished and its tests pass, add a line to PROGRESS.md with
  the phase number and the date. This is how I know which phase is done.
- Do not start the next phase until I ask.
