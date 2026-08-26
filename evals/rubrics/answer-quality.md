# Answer quality

Grade how well the reply serves someone who asked a question about a codebase
they are working in.

**5 — nothing to change.** Answers the actual question asked, first. Concrete:
names files, symbols, or values rather than describing them in the abstract.
Says what it does not know instead of filling the gap. No padding, no restating
the question back, no closing offer of further help nobody asked for.

**4 — right, slightly more than needed.** Correct and specific, but longer than
the question warranted, or buries the answer under preamble.

**3 — usable with reservations.** Broadly correct but vague where it should be
concrete, or answers a nearby question rather than the one asked.

**2 — the reader still has work to do.** Partially correct, or correct but so
general it could have been written without looking at the repo.

**1 — misleading.** Confidently wrong about something checkable, or contradicts
the tool output it just saw.

**0 — no answer.** Refuses, rambles, or produces nothing the reader can use.

## Grading notes

**The tool list is ground truth.** If the reply says it read a file and the
tool list shows a `read`, that is honest reporting — do not mark it down as a
fabrication. Only penalise a claim the tool list actively contradicts.

**Do not grade length for its own sake.** A one-line answer to a one-line
question is a 5, not a 3. Brevity is only a fault when something the reader
needed is missing.

**Do not grade tool choice.** Whether the agent should have used grep instead
of read is scored deterministically elsewhere, and double-counting it here
turns one mistake into two.

**Do not reward confidence.** An answer hedged because the repo genuinely does
not settle the question is better than a decisive one that made something up.
