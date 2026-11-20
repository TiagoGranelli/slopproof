-------------------------- MODULE KeysetPagination --------------------------
\* Formal model of src/server/db/keyset.ts and src/server/posts/repo.ts:
\* newest-first keyset pagination `(created_at, id) < cursor` with `limit + 1`
\* lookahead interleaved with concurrent post creates, edits, and deletes.
\*
\* Post ids model the strict total order on `(created_at, id)`: larger id means
\* newer post, and edits mutate only `body` (never the sort key or author).

EXTENDS Integers, Sequences, FiniteSets

CONSTANTS
  Authors,    \* Set of authors (e.g. {"alice", "bob"})
  Bodies,     \* Set of post bodies (e.g. {"v1", "v2"})
  PageLimit,  \* Page size (`limit`)
  MaxPostId   \* Upper bound on post ids created during the run

ASSUME
  /\ PageLimit >= 1
  /\ MaxPostId >= 2

PostIds == 1..MaxPostId
NoCursor == MaxPostId + 1

VARIABLES
  posts,               \* Function PostIds -> [present, author, body]
  nextId,              \* Next post id to insert (strictly increasing)
  readerPhase,         \* "idle" | "paging" | "done"
  cursor,              \* Exclusive upper bound: rows must have id < cursor
  seen,                \* Sequence of post ids collected by the reader across pages
  initialSnapshot,     \* Post ids present when the reader began page 1
  ownerViolation       \* Ghost: TRUE iff an author mutated another author's post

vars == <<posts, nextId, readerPhase, cursor, seen, initialSnapshot, ownerViolation>>

EmptyPost == [present |-> FALSE, author |-> "none", body |-> "v1"]

\* Returns the highest `k` ids from finite set `S` in strictly descending order.
RECURSIVE TopK(_, _)
TopK(S, k) ==
  IF S = {} \/ k = 0
  THEN << >>
  ELSE
    LET m == CHOOSE x \in S : \A y \in S : x >= y
    IN <<m>> \o TopK(S \ {m}, k - 1)

InSeq(seq, elem) == \E idx \in 1..Len(seq) : seq[idx] = elem

Init ==
  /\ posts = [id \in PostIds |->
       IF id <= 2 THEN [present |-> TRUE, author |-> "alice", body |-> "v1"]
       ELSE EmptyPost]
  /\ nextId = 3
  /\ readerPhase = "idle"
  /\ cursor = NoCursor
  /\ seen = << >>
  /\ initialSnapshot = {}
  /\ ownerViolation = FALSE

\* PostsRepo.create: appends a new post with a strictly greater key.
CreatePost(author) ==
  /\ author \in Authors
  /\ nextId <= MaxPostId
  /\ posts' = [posts EXCEPT ![nextId] = [present |-> TRUE, author |-> author, body |-> "v1"]]
  /\ nextId' = nextId + 1
  /\ UNCHANGED <<readerPhase, cursor, seen, initialSnapshot, ownerViolation>>

\* PostsRepo.update: WHERE id = :id AND author_id = :authorId; sort key is immutable.
EditPost(author, id, nextBody) ==
  /\ author \in Authors
  /\ id \in PostIds
  /\ nextBody \in Bodies
  /\ posts[id].present
  /\ posts[id].author = author
  /\ posts[id].body /= nextBody
  /\ ownerViolation' = (ownerViolation \/ posts[id].author /= author)
  /\ posts' = [posts EXCEPT ![id].body = nextBody]
  /\ UNCHANGED <<nextId, readerPhase, cursor, seen, initialSnapshot>>

\* PostsRepo.remove: WHERE id = :id AND author_id = :authorId.
DeletePost(author, id) ==
  /\ author \in Authors
  /\ id \in PostIds
  /\ posts[id].present
  /\ posts[id].author = author
  /\ ownerViolation' = (ownerViolation \/ posts[id].author /= author)
  /\ posts' = [posts EXCEPT ![id] = EmptyPost]
  /\ UNCHANGED <<nextId, readerPhase, cursor, seen, initialSnapshot>>

\* PostsRepo.listPublic + toPage: WHERE (created_at, id) < cursor ORDER BY DESC LIMIT limit + 1.
FetchNextPage ==
  /\ readerPhase \in {"idle", "paging"}
  /\ LET eligible == { id \in PostIds : posts[id].present /\ id < cursor }
         shown    == TopK(eligible, PageLimit)
         hasMore  == Cardinality(eligible) > PageLimit
     IN
       /\ seen' = seen \o shown
       /\ initialSnapshot' = IF readerPhase = "idle"
                             THEN { id \in PostIds : posts[id].present }
                             ELSE initialSnapshot
       /\ IF hasMore
          THEN
            /\ cursor' = shown[Len(shown)]
            /\ readerPhase' = "paging"
          ELSE
            /\ cursor' = 0
            /\ readerPhase' = "done"
  /\ UNCHANGED <<posts, nextId, ownerViolation>>

\* Finite-horizon stuttering once pagination has reached exhaustion.
Done ==
  /\ readerPhase = "done"
  /\ UNCHANGED vars

Next ==
  \/ \E a \in Authors : CreatePost(a)
  \/ \E a \in Authors, id \in PostIds, b \in Bodies : EditPost(a, id, b)
  \/ \E a \in Authors, id \in PostIds : DeletePost(a, id)
  \/ FetchNextPage
  \/ Done

Spec == Init /\ [][Next]_vars

\* ----------------------------- Safety invariants -----------------------------

TypeOK ==
  /\ nextId \in 1..(MaxPostId + 1)
  /\ readerPhase \in {"idle", "paging", "done"}
  /\ cursor \in 0..NoCursor
  /\ Len(seen) <= MaxPostId
  /\ ownerViolation \in BOOLEAN

\* A reader paginating across concurrent creates, edits, and deletes never sees the same post twice.
NoDuplicatePostIds ==
  \A i, j \in 1..Len(seen) : i /= j => seen[i] /= seen[j]

\* Across all pages combined, keys are strictly decreasing.
StrictlyDecreasingKeys ==
  \A i \in 1..(Len(seen) - 1) : seen[i] > seen[i + 1]

\* Every post present when pagination started that survives without deletion is seen before exhaustion.
NoSkippedSurvivingPosts ==
  readerPhase = "done" =>
    \A id \in initialSnapshot : posts[id].present => InSeq(seen, id)

\* Ownership checks prevent cross-author edits or deletions.
OwnershipPreserved ==
  /\ ~ownerViolation
  /\ \A id \in PostIds : posts[id].present => posts[id].author \in Authors

===============================================================================
