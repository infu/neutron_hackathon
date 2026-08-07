/// File storage in stable memory, in fixed-size slots.
///
/// ## Why slots, and why fixed
///
/// A `Region` can only ever grow: *"A size of a region can only grow and never
/// shrink. In addition, the stable memory pages allocated to a region will not
/// be reclaimed by garbage collection"* (`mo:core/Region`). There is no giving
/// space back — an allocator here can only reuse what it already holds.
///
/// That turns the usual design question inside out. Variable-sized blocks bring
/// fragmentation, coalescing, best-fit searches and eventually compaction, all
/// of it to avoid wasting space you cannot return anyway. Fixed slots bring
/// none of it: every slot in a class is interchangeable, so a freed slot always
/// fits the next file of that class exactly. Allocation is a pop, freeing is a
/// push, and no large file can be blocked by a small hole because there are no
/// small holes.
///
/// ## What it costs, measured
///
/// A 200-app season at the published caps (`test/pic/memory.test.mjs`, 1600
/// files, 880 MB of content):
///
/// | class | holds | slot | waste |
/// | --- | --- | --- | --- |
/// | `#small` | 100 KB icon | 128 KiB | 23.7% |
/// | `#image` | 400 KB shot | 448 KiB | 12.8% |
/// | `#build` | 1.9 MB package | 2 MiB | 9.4% |
///
/// **11.66% overall**, because the big files dominate the total and waste
/// least. Reserved 996 MB against 880 MB live.
///
/// That is the good case, where every file is at its cap. Churn measures the
/// other end: a 1.5 MB build in a 2 MiB slot wastes 28%
/// (`test/pic/churn.test.mjs`). Both are the trade working — fragmentation,
/// coalescing and compaction would cost more than either — but the headroom is
/// smaller than "stable memory is cheap" suggests:
///
/// * `moc --max-stable-pages` defaults to **65536 pages = 4 GiB**, and it gates
///   `Region.grow`, not just the old `ExperimentalStableMemory` API.
/// * An honest **1,000-app round reserves 4.64 GiB** — measured, then
///   extrapolated from the 200-app run. With avatars it is 4.76 GiB.
/// * Four full submissions from each of 1,000 hackers reserve ~18.55 GiB.
/// * The adversarial bound is higher because these three regions never shrink:
///   participants may fill/delete the small pool, then the image pool, then
///   the build pool. Their summed high-water marks are ~64.50 GiB even though
///   no account exceeds its live allowance at any moment.
///
/// So stable memory is the binding constraint, not the heap, and the flag has
/// to be raised for a full-size event. The repository's direct backend build
/// script passes 1,310,720 pages (80 GiB) for both deploy and PocketIC test Wasm.
/// Participant admission has a lower ~65.50 GiB policy ceiling: the exact
/// cross-class participant bound plus 1 GiB of frontend headroom.
///
/// ## Using it safely
///
/// ```motoko
/// let store = Slab.Use(mem);
/// let #ok(handle) = store.write(bytes) else …;   // class chosen for you
/// let ?bytes = store.read(handle) else …;        // null once dropped
/// store.drop(handle);                            // idempotent
/// ```
///
/// The three ways a store like this normally hurts you are all closed:
///
/// **You cannot pick the wrong class.** `write` takes bytes and nothing else,
/// and sizes the slot itself. A caller cannot put a 4 KB icon in a 2 MB slot
/// by mistake, or ask for a slot too small and have to handle the error.
///
/// **A stale handle reads nothing, not something.** Every slot carries a
/// generation that increments when it is dropped. A handle from before the drop
/// no longer matches, so `read` returns `null` — where a naive design would
/// hand back whatever file now occupies that slot, which is somebody else's.
/// That is the failure this module exists to make impossible: it is silent,
/// it looks like success, and it leaks.
///
/// **Dropping twice does nothing the second time.** The generation check makes
/// `drop` idempotent. Without it the slot lands on the free list twice and two
/// different files are later handed the same slot.
///
/// A forged handle is caught by the same check — the generation will not match
/// unless the caller guessed it, and a guess buys them a slot they already had
/// a handle to.
///
/// ## Slots are page-aligned on purpose
///
/// Regions grow in 64 KiB pages, so a slot of a whole number of pages means
/// slot `i` owns pages `[i*P, (i+1)*P)` exactly. Growing is then one comparison
/// against the region's page count, with no arithmetic that could leave a slot
/// straddling the end.

import List "mo:core/List";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Region "mo:core/Region";

module {

    /// 64 KiB, the unit a region grows in.
    public let PAGE : Nat64 = 65_536;

    /// The shape of a file, not who uploaded it — an avatar and an app icon
    /// are the same storage problem.
    public type Class = { #small; #image; #build };

    /// Pages per slot. Each is the smallest whole number of pages holding the
    /// published cap for that kind of file (rules.md §3): 100 KB, 400 KB, 1.9 MB.
    public func pagesFor(class_ : Class) : Nat64 = switch (class_) {
        case (#small) 2; // 128 KiB
        case (#image) 7; // 448 KiB
        case (#build) 32; // 2 MiB
    };

    public func slotBytes(class_ : Class) : Nat = Nat64.toNat(pagesFor(class_) * PAGE);

    /// The largest file this can hold at all.
    public func capacity() : Nat = slotBytes(#build);

    /// Where a file is.
    ///
    /// Treat it as opaque and keep it next to whatever names the file. The
    /// `gen` is what makes a stale one safe: hold on to a handle past a `drop`
    /// and you get `null`, not the next tenant's bytes.
    public type Handle = {
        class_ : Class;
        slot : Nat64;
        gen : Nat32;
        size : Nat;
    };

    /// One class's storage.
    public type Pool = {
        var region : ?Region.Region;
        /// Slots ever handed out. Only ever rises, except when the newest slot
        /// is dropped, which rewinds rather than leaking a free-list entry.
        var high : Nat64;
        /// Slots waiting to be reused.
        free : List.List<Nat64>;
        /// Bytes of file actually held, as opposed to slot space reserved.
        /// Tracked rather than derived: the pool holds slots, not lengths, so
        /// the only other way to know is to walk every asset row.
        var bytes : Nat;
        /// Current generation per slot, indexed by slot number, rising every
        /// time that slot is dropped.
        ///
        /// This list never shrinks, even when `high` rewinds. It is the record
        /// of how many times each slot has been reused, and forgetting it is
        /// exactly how a stale handle starts matching again: drop the newest
        /// slot, rewind, allocate it afresh at generation zero, and the handle
        /// from before the drop is live once more, pointing at somebody else's
        /// file.
        gens : List.List<Nat32>;
    };

    public type Mem = { small : Pool; image : Pool; build : Pool };

    public func init() : Mem = { small = pool(); image = pool(); build = pool() };

    func pool() : Pool = {
        var region = null;
        var high = 0;
        free = List.empty<Nat64>();
        var bytes = 0;
        gens = List.empty<Nat32>();
    };

    public type Error = {
        /// Larger than the biggest slot there is. Nothing can hold it.
        #TooLarge : { size : Nat; largest : Nat };
        /// Stable memory would not grow. Nothing was written.
        #OutOfMemory;
    };

    public type Result<T> = { #ok : T; #err : Error };

    public class Use(mem : Mem) {

        /// Store `bytes`, in whichever slot size fits.
        ///
        /// The class is chosen here rather than by the caller — it is a
        /// function of the length, and asking a caller to pick invites picking
        /// wrong in the direction that wastes 2 MB on a favicon.
        public func write(bytes : Blob) : Result<Handle> {
            let ?class_ = classFor(bytes.size()) else {
                return #err(#TooLarge({ size = bytes.size(); largest = capacity() }));
            };
            let p = poolFor(class_);
            let region = switch (p.region) {
                case (?r) r;
                case null {
                    // Created on first use, so a class nobody writes to costs
                    // nothing at all.
                    let r = Region.new();
                    p.region := ?r;
                    r;
                };
            };

            let reused = List.removeLast(p.free);
            let index = switch (reused) {
                case (?slot) slot;
                case null {
                    let fresh = p.high;
                    p.high += 1;
                    // Only extend when this slot has never existed. A rewound
                    // slot keeps the generation it had, so handles issued
                    // before it was dropped stay dead.
                    if (Nat64.toNat(fresh) >= List.size(p.gens)) List.add(p.gens, 0 : Nat32);
                    fresh;
                };
            };

            let pages = pagesFor(class_);
            let needed = (index + 1) * pages;
            let have = Region.size(region);
            if (have < needed) {
                if (Region.grow(region, needed - have) == 0xFFFF_FFFF_FFFF_FFFF) {
                    // Nothing was written, so give the slot back exactly as it
                    // was found — rewinding if it was fresh, re-queuing if not.
                    switch (reused) {
                        case (?slot) List.add(p.free, slot);
                        case null p.high -= 1;
                    };
                    return #err(#OutOfMemory);
                };
            };

            Region.storeBlob(region, index * pages * PAGE, bytes);
            p.bytes += bytes.size();
            #ok({ class_; slot = index; gen = genOf(p, index); size = bytes.size() });
        };

        /// Read a file back, or `null` if this handle no longer names it.
        public func read(handle : Handle) : ?Blob {
            let p = poolFor(handle.class_);
            let ?region = p.region else return null;
            if (not current(p, handle)) return null;
            let pages = pagesFor(handle.class_);
            ?Region.loadBlob(region, handle.slot * pages * PAGE, handle.size);
        };

        /// Is this handle still good? Cheap, and does not read the bytes.
        public func holds(handle : Handle) : Bool {
            current(poolFor(handle.class_), handle);
        };

        /// Give a slot back. Idempotent: dropping an already-dropped handle,
        /// or one that was never real, does nothing.
        public func drop(handle : Handle) {
            let p = poolFor(handle.class_);
            if (not current(p, handle)) return;
            // Bump first: from here the old handle is dead whatever else fails.
            List.put(p.gens, Nat64.toNat(handle.slot), genOf(p, handle.slot) + 1);
            p.bytes := if (p.bytes > handle.size) p.bytes - handle.size else 0;
            // Dropping the newest slot rewinds instead of queuing, so a
            // write-then-delete loop does not grow the free list for ever.
            if (handle.slot + 1 == p.high) p.high -= 1 else List.add(p.free, handle.slot);
        };

        /// The bytes are left where they are on `drop`. Zeroing would cost a
        /// write of the whole slot to hide data already unreachable — `read`
        /// refuses a stale handle, and the next `write` overwrites the prefix
        /// it uses. If this ever holds something where residue matters, zero it
        /// here and say why.
        public func stats() : Stats {
            let each = [
                (#small, statsOf(mem.small)),
                (#image, statsOf(mem.image)),
                (#build, statsOf(mem.build)),
            ];
            var reserved = 0;
            var liveBytes = 0;
            var liveSlots = 0;
            for ((_, one) in each.vals()) {
                reserved += one.reserved;
                liveBytes += one.liveBytes;
                liveSlots += one.liveSlots;
            };
            { classes = each; reserved; liveBytes; liveSlots };
        };

        /// Stable bytes the next write in this class would have to reserve.
        ///
        /// A dropped interior slot sits on `free`; a dropped tail slot rewinds
        /// `high` while its region remains grown. Both are reusable without
        /// committing another page, so admission must credit both shapes. The
        /// allocator remains the source of truth instead of making the actor
        /// reconstruct its free-list rules from aggregate statistics.
        public func reservationGrowth(class_ : Class) : Nat {
            let p = poolFor(class_);
            if (List.size(p.free) > 0) return 0;

            let needed = (p.high + 1) * pagesFor(class_);
            let held = switch (p.region) {
                case (?region) Region.size(region);
                case null (0 : Nat64);
            };
            if (held >= needed) 0 else Nat64.toNat((needed - held) * PAGE);
        };

        func statsOf(p : Pool) : ClassStats {
            let slots = Nat64.toNat(p.high);
            let freed = List.size(p.free);
            {
                slots;
                freed;
                liveSlots = slots - freed;
                liveBytes = p.bytes;
                reserved = switch (p.region) {
                    case (?r) Nat64.toNat(Region.size(r) * PAGE);
                    case null 0;
                };
            };
        };

        func current(p : Pool, handle : Handle) : Bool {
            if (handle.slot >= p.high) return false;
            genOf(p, handle.slot) == handle.gen;
        };

        func genOf(p : Pool, slot : Nat64) : Nat32 {
            switch (List.get(p.gens, Nat64.toNat(slot))) {
                case (?g) g;
                case null 0;
            };
        };

        func poolFor(class_ : Class) : Pool = switch (class_) {
            case (#small) mem.small;
            case (#image) mem.image;
            case (#build) mem.build;
        };
    };

    public type ClassStats = {
        /// Slots ever handed out, less any rewound.
        slots : Nat;
        /// Slots waiting to be reused.
        freed : Nat;
        /// Slots holding a file.
        liveSlots : Nat;
        /// Bytes of file in them. Always at most `liveSlots × slot size`; the
        /// difference is what fixed slots cost.
        liveBytes : Nat;
        /// Stable memory committed to this class, in bytes. Never falls.
        reserved : Nat;
    };

    public type Stats = {
        classes : [(Class, ClassStats)];
        /// Stable memory committed. Never falls.
        reserved : Nat;
        /// Bytes of file held in it.
        liveBytes : Nat;
        /// Slots holding a file.
        liveSlots : Nat;
    };

    /// The smallest class that holds a file of this size.
    public func classFor(size : Nat) : ?Class {
        if (size <= slotBytes(#small)) return ?#small;
        if (size <= slotBytes(#image)) return ?#image;
        if (size <= slotBytes(#build)) return ?#build;
        null;
    };

    public func describe(error : Error) : Text = switch (error) {
        case (#TooLarge({ size; largest })) {
            "that file is " # Nat.toText(size) # " bytes; the largest slot holds "
            # Nat.toText(largest);
        };
        case (#OutOfMemory) "stable memory would not grow";
    };
};
