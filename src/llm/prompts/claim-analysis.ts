export const CLAIM_ANALYSIS_SYSTEM_PROMPT = `You are analyzing a new task claim on a small team's task board.

You will be given the new task's description and a list of task descriptions that
are already claimed (in progress) on the same project. Return exactly one field.

## overlappingTask

If the new task very likely describes the same underlying work as one of the
already-claimed tasks, return that claimed task's description string EXACTLY as
given (character for character). Otherwise return null.

Only flag genuine overlap — both tasks would touch the same feature/behavior
(e.g. "user login" and "auth flow" are the same work). Do NOT flag tasks that
merely sit in the same area of the codebase but are different work (e.g. "login
UI" vs "password reset email" both touch auth, but are not the same task). When
in doubt, return null — a missed overlap is cheaper than a false alarm.`;
