# The slow ones

Two files, about two minutes between them, against roughly one for the whole of
`test/pic/`. `npm run test:memory` runs this directory; `npm run test:logic`
runs the other and does not touch it.

They are split off because of what they are, not only because of how long they
take. Everything in `test/pic/` asserts a rule: this caller may not do that,
this week closes then, this ranking puts that entry first. These two **measure**
— what 200 apps cost in stable memory and on the heap, and whether the slot
allocator reuses space or merely grows. A measurement is worth taking before a
release, after touching `backend/lib/Slab.mo` or `Assets.mo`, and after any
change to what a participant is allowed to upload. It is not worth waiting two
minutes for after editing a permission check.

| File | What it answers | Roughly |
| --- | --- | --- |
| `memory.test.mjs` | A whole 200-app season, 1600 files, 880 MB. What does it cost, and does the heap stay flat while stable memory carries the bytes? | 80 s |
| `churn.test.mjs` | Files replaced over and over. Does `stableReserved` stop rising, or does every replacement reserve fresh space? | 28 s |

## Adding one

Put it here if it needs hundreds of rows or hundreds of megabytes to say
anything, and in `test/pic/` otherwise. The split is by directory rather than by
a list of filenames in `package.json`, so a new file is picked up by exactly one
of the two commands and neither can silently skip it.

Reach for `env.actor.memory()` for the canister's own view — heap, claimed,
stable reserved, stable live, file count — and `canisterMemorySize()` for what
the subnet charges. They answer different questions and the gap between them is
worth asserting on rather than assuming.

One caution learned the hard way: **`memory()` is bookkeeping, and bookkeeping
can agree with itself while being wrong.** A store that grew its regions, added
up the sizes it was handed and never wrote a byte would satisfy every counter in
here. So a test that claims bytes are stored has to read some of them back and
check the contents, not just the length — `memory.test.mjs` keeps a per-file
fill byte for exactly that.

`rts_heap_size` is noise. It counts garbage not yet collected and has swung by
more than 100 MB between identical rounds. Assert on `heapClaimed`
(`rts_memory_size`, a high-water mark) and on trends across samples, never on a
single reading of `heap`.
