------------------------------ MODULE RateLimit ------------------------------
\* Formal model of src/server/auth-rate-limit.ts (`countRequest` atomic upsert
\* and `pruneIdleRows` background deletion) across concurrent app instances.
\*
\* Each instance executes in two steps matching the real server code:
\*   1. BeginConsume(inst): captures `const now = Date.now()` in Node.
\*   2. CommitConsume(inst): executes Postgres's atomic
\*      `INSERT ... ON CONFLICT (key) DO UPDATE ... RETURNING` with that `now`.
\* Concurrent instances can interleave between BeginConsume and CommitConsume
\* across clock ticks, alongside background PruneIdle deletions.

EXTENDS Integers

CONSTANTS
  Instances,     \* App server instances sharing the Postgres rate_limit table
  MaxRequests,   \* Maximum admitted requests per window (rule.max)
  RuleWindow,    \* Rate-limit window length (rule.window)
  IdleRowWindow, \* Background prune threshold (IDLE_ROW_MS > RuleWindow)
  MaxTime        \* Finite clock bound for exhaustive TLC exploration

ASSUME
  /\ MaxRequests >= 1
  /\ RuleWindow >= 1
  /\ IdleRowWindow > RuleWindow
  /\ MaxTime >= IdleRowWindow

VARIABLES
  now,             \* Monotonic global clock
  pendingNow,      \* Per-instance captured `Date.now()` (-1 when idle)
  rowPresent,      \* Whether a row for this key exists in rate_limit
  rowCount,        \* rate_limit.count (includes refused requests in current window)
  rowLastRequest,  \* rate_limit.last_request
  windowAdmitted,  \* Ghost: requests admitted since the current window started
  lastAction,      \* Ghost: "init" | "begin" | "consume" | "prune" | "tick" | "done"
  lastAllowed,     \* Ghost: allowed boolean from the most recent CommitConsume
  lastRetryAfter,  \* Ghost: retryAfter seconds from the most recent CommitConsume
  prevLastRequest  \* Ghost: rowLastRequest immediately prior to lastAction

vars == <<now, pendingNow, rowPresent, rowCount, rowLastRequest, windowAdmitted,
          lastAction, lastAllowed, lastRetryAfter, prevLastRequest>>

\* Bound refused attempts in one window so TLC explores a finite state space
\* while still exercising multiple concurrent refused attempts per window.
MaxTrackedCount == MaxRequests + 2

Init ==
  /\ now = 0
  /\ pendingNow = [i \in Instances |-> -1]
  /\ rowPresent = FALSE
  /\ rowCount = 0
  /\ rowLastRequest = 0
  /\ windowAdmitted = 0
  /\ lastAction = "init"
  /\ lastAllowed = TRUE
  /\ lastRetryAfter = 0
  /\ prevLastRequest = 0

\* Step 1 in Node: instance reads Date.now() before issuing the SQL upsert.
BeginConsume(inst) ==
  /\ inst \in Instances
  /\ pendingNow[inst] = -1
  /\ (~rowPresent \/ rowLastRequest <= now - RuleWindow \/ rowCount < MaxTrackedCount)
  /\ pendingNow' = [pendingNow EXCEPT ![inst] = now]
  /\ prevLastRequest' = rowLastRequest
  /\ lastAction' = "begin"
  /\ UNCHANGED <<now, rowPresent, rowCount, rowLastRequest, windowAdmitted, lastAllowed, lastRetryAfter>>

\* Step 2 in Postgres: atomic `INSERT ... ON CONFLICT (key) DO UPDATE ... RETURNING`.
CommitConsume(inst) ==
  /\ inst \in Instances
  /\ pendingNow[inst] /= -1
  /\ LET reqNow == pendingNow[inst]
         expired == rowPresent /\ (rowLastRequest <= reqNow - RuleWindow)
     IN
       /\ (~rowPresent \/ expired \/ rowCount < MaxTrackedCount)
       /\ pendingNow' = [pendingNow EXCEPT ![inst] = -1]
       /\ prevLastRequest' = rowLastRequest
       /\ lastAction' = "consume"
       /\ IF ~rowPresent \/ expired
          THEN
            /\ rowPresent' = TRUE
            /\ rowCount' = 1
            /\ rowLastRequest' = reqNow
            /\ windowAdmitted' = 1
            /\ lastAllowed' = (1 <= MaxRequests)
            /\ lastRetryAfter' = 0
          ELSE
            LET nextCount == rowCount + 1
                nextLast  == IF rowCount < MaxRequests THEN reqNow ELSE rowLastRequest
                allowed   == nextCount <= MaxRequests
                remaining == nextLast + RuleWindow - reqNow
                retry     == IF allowed THEN 0 ELSE IF remaining > 1 THEN remaining ELSE 1
            IN
              /\ rowPresent' = TRUE
              /\ rowCount' = nextCount
              /\ rowLastRequest' = nextLast
              /\ windowAdmitted' = IF allowed THEN windowAdmitted + 1 ELSE windowAdmitted
              /\ lastAllowed' = allowed
              /\ lastRetryAfter' = retry
  /\ UNCHANGED <<now>>

\* Background `DELETE FROM rate_limit WHERE last_request < now - IDLE_ROW_MS`.
PruneIdle(inst) ==
  /\ inst \in Instances
  /\ rowPresent
  /\ rowLastRequest < now - IdleRowWindow
  /\ prevLastRequest' = rowLastRequest
  /\ rowPresent' = FALSE
  /\ rowCount' = 0
  /\ rowLastRequest' = 0
  /\ windowAdmitted' = 0
  /\ lastAction' = "prune"
  /\ UNCHANGED <<now, pendingNow, lastAllowed, lastRetryAfter>>

Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ prevLastRequest' = rowLastRequest
  /\ lastAction' = "tick"
  /\ UNCHANGED <<pendingNow, rowPresent, rowCount, rowLastRequest, windowAdmitted, lastAllowed, lastRetryAfter>>

\* Finite-horizon stuttering once the clock reaches MaxTime.
Done ==
  /\ now = MaxTime
  /\ lastAction' = "done"
  /\ prevLastRequest' = rowLastRequest
  /\ UNCHANGED <<now, pendingNow, rowPresent, rowCount, rowLastRequest, windowAdmitted, lastAllowed, lastRetryAfter>>

Next ==
  \/ \E inst \in Instances : BeginConsume(inst)
  \/ \E inst \in Instances : CommitConsume(inst)
  \/ \E inst \in Instances : PruneIdle(inst)
  \/ Tick
  \/ Done

Spec == Init /\ [][Next]_vars

\* ----------------------------- Safety invariants -----------------------------

TypeOK ==
  /\ now \in 0..MaxTime
  /\ \A i \in Instances : pendingNow[i] \in (-1)..MaxTime
  /\ rowPresent \in BOOLEAN
  /\ rowCount \in 0..MaxTrackedCount
  /\ rowLastRequest \in 0..MaxTime
  /\ windowAdmitted \in 0..MaxRequests
  /\ lastAction \in {"init", "begin", "consume", "prune", "tick", "done"}
  /\ lastAllowed \in BOOLEAN
  /\ lastRetryAfter \in 0..(MaxTime + RuleWindow + 1)

\* Across all concurrent instances and interleavings, at most MaxRequests are admitted per window.
NeverExceedsWindowLimit ==
  windowAdmitted <= MaxRequests

\* Row count matches admitted requests while under the limit, and saturates admitted at MaxRequests once over.
CountTracksAdmitted ==
  rowPresent =>
    /\ (rowCount <= MaxRequests => rowCount = windowAdmitted)
    /\ (rowCount > MaxRequests => windowAdmitted = MaxRequests)

\* A refused request never advances last_request (prevents lockout extension).
RefusedNeverExtendsWindow ==
  (lastAction = "consume" /\ ~lastAllowed) => rowLastRequest = prevLastRequest

\* Every refused request reports retryAfter >= 1 second.
PositiveRetryAfter ==
  (lastAction = "consume" /\ ~lastAllowed) => lastRetryAfter >= 1

\* Background pruning never deletes a row whose rate-limit window is still active.
PruneNeverDeletesActiveWindow ==
  lastAction = "prune" => prevLastRequest + RuleWindow <= now

===============================================================================
