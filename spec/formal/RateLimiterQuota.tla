------------------------------ MODULE RateLimiterQuota ------------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Capacity, WindowLimit, RefillPerStep, MaxCost, Requests

VARIABLES tokens, used, requestCache, consumed

vars == <<tokens, used, requestCache, consumed>>

Init ==
  /\ tokens = Capacity
  /\ used = 0
  /\ requestCache = {}
  /\ consumed = {}

CanConsume(cost) ==
  /\ cost \in 1..MaxCost
  /\ tokens >= cost
  /\ used + cost <= WindowLimit

Consume(cost, req) ==
  /\ req \in Requests
  /\ req \notin requestCache
  /\ IF CanConsume(cost)
        THEN /\ tokens' = tokens - cost
             /\ used' = used + cost
             /\ consumed' = consumed \cup {req}
        ELSE /\ UNCHANGED <<tokens, used, consumed>>
  /\ requestCache' = requestCache \cup {req}

RetrySame(req) ==
  /\ req \in requestCache
  /\ UNCHANGED vars

Refill ==
  /\ tokens' = IF tokens + RefillPerStep <= Capacity THEN tokens + RefillPerStep ELSE Capacity
  /\ UNCHANGED <<used, requestCache, consumed>>

Next ==
  \/ Refill
  \/ (\E cost \in 1..MaxCost: \E req \in Requests: Consume(cost, req))
  \/ (\E req \in Requests: RetrySame(req))

InvTokenBounds ==
  /\ tokens >= 0
  /\ tokens <= Capacity

InvWindowBound ==
  /\ used >= 0
  /\ used <= WindowLimit

InvNoDoubleConsume ==
  consumed \subseteq requestCache

Spec == Init /\ [][Next]_vars

THEOREM Spec => []InvTokenBounds
THEOREM Spec => []InvWindowBound
THEOREM Spec => []InvNoDoubleConsume

=============================================================================
