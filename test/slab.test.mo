/// The slab store, and specifically the ways it could hurt a caller.
///
/// Round-tripping bytes is the easy half and would pass on a design with every
/// footgun still in it. What these actually check is that a handle cannot be
/// used to read somebody else's file: after a drop, after a reuse, after a
/// second drop, and when it was never real.

import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat64 "mo:core/Nat64";
import Runtime "mo:core/Runtime";
import Test "mo:test";

import Slab "../backend/lib/Slab";

persistent actor {

    transient func fresh() : Slab.Use = Slab.Use(Slab.init());

    /// `n` bytes, all `fill`, so a mixed-up read is visible rather than subtle.
    transient func bytes(n : Nat, fill : Nat8) : Blob {
        Blob.fromArray(Array.tabulate<Nat8>(n, func(_) = fill));
    };

    transient func mustWrite(store : Slab.Use, blob : Blob) : Slab.Handle {
        switch (store.write(blob)) {
            case (#ok(h)) h;
            case (#err(e)) Runtime.trap("write failed: " # Slab.describe(e));
        };
    };

    // ── Sizing ───────────────────────────────────────────────────────────────

    public func the_class_is_chosen_by_size_not_by_the_caller() : async Test.Metrics {
        Test.test(
            func() {
                // The caps from the Build section of the Rules page, each landing in the smallest slot
                // that holds it.
                assert Slab.classFor(100_000) == ?#small;
                assert Slab.classFor(400_000) == ?#image;
                assert Slab.classFor(1_900_000) == ?#build;
                // Boundaries: a slot holds exactly its own size.
                assert Slab.classFor(Slab.slotBytes(#small)) == ?#small;
                assert Slab.classFor(Slab.slotBytes(#small) + 1) == ?#image;
                assert Slab.classFor(458_752) == ?#image;
                assert Slab.classFor(458_753) == ?#build;
                assert Slab.classFor(Slab.slotBytes(#build)) == ?#build;
                assert Slab.classFor(Slab.slotBytes(#build) + 1) == null;
                assert Slab.classFor(0) == ?#small;
            }
        );
    };

    public func every_slot_is_a_whole_number_of_pages() : async Test.Metrics {
        Test.test(
            func() {
                // Page alignment is what lets `write` grow the region with one
                // comparison and no risk of a slot straddling the end.
                for (class_ in [#small, #image, #build].vals()) {
                    assert Slab.slotBytes(class_) % Nat64.toNat(Slab.PAGE) == 0;
                };
                assert Slab.slotBytes(#small) >= 100_000;
                assert Slab.slotBytes(#image) >= 400_000;
                assert Slab.slotBytes(#build) >= 1_900_000;
            }
        );
    };

    public func a_file_too_large_for_any_slot_is_refused() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                switch (store.write(bytes(Slab.capacity() + 1, 7))) {
                    case (#err(#TooLarge(_))) {};
                    case _ Runtime.trap("expected TooLarge");
                };
            }
        );
    };

    // ── Round trip ───────────────────────────────────────────────────────────

    public func what_goes_in_comes_out() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                let small = mustWrite(store, bytes(4_000, 1));
                let image = mustWrite(store, bytes(300_000, 2));
                let build = mustWrite(store, bytes(1_500_000, 3));

                assert store.read(small) == ?bytes(4_000, 1);
                assert store.read(image) == ?bytes(300_000, 2);
                assert store.read(build) == ?bytes(1_500_000, 3);
                // Each landed in the class its size calls for.
                assert small.class_ == #small;
                assert image.class_ == #image;
                assert build.class_ == #build;
            }
        );
    };

    public func a_short_file_reads_back_short() : async Test.Metrics {
        Test.test(
            func() {
                // A slot is far bigger than most files in it. Reading the whole
                // slot would return the padding — and, in a reused slot, the
                // tail of whatever was there before.
                let store = fresh();
                let big = mustWrite(store, bytes(90_000, 9));
                store.drop(big);
                let small = mustWrite(store, bytes(10, 1));
                let ?read = store.read(small) else Runtime.trap("no read");
                assert read.size() == 10;
                assert read == bytes(10, 1);
            }
        );
    };

    // ── The footguns ─────────────────────────────────────────────────────────

    public func a_dropped_handle_reads_nothing() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                let handle = mustWrite(store, bytes(1_000, 5));
                assert store.holds(handle);
                store.drop(handle);
                assert not store.holds(handle);
                assert store.read(handle) == null;
            }
        );
    };

    /// The one that matters. A slot is reused, and the previous owner's handle
    /// must not read the new owner's file.
    public func a_stale_handle_cannot_read_its_successor() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                let mine = mustWrite(store, bytes(1_000, 1));
                store.drop(mine);

                // Same class, so this takes the very slot just freed.
                let theirs = mustWrite(store, bytes(1_000, 2));
                assert theirs.slot == mine.slot;

                assert store.read(theirs) == ?bytes(1_000, 2);
                assert store.read(mine) == null;
                assert not store.holds(mine);
            }
        );
    };

    public func dropping_twice_does_not_hand_one_slot_to_two_files() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                // Two slots, so the drops queue rather than rewinding.
                let keep = mustWrite(store, bytes(1_000, 1));
                let going = mustWrite(store, bytes(1_000, 2));
                store.drop(going);
                store.drop(going);
                store.drop(going);

                let a = mustWrite(store, bytes(1_000, 3));
                let b = mustWrite(store, bytes(1_000, 4));
                assert a.slot != b.slot;
                assert store.read(a) == ?bytes(1_000, 3);
                assert store.read(b) == ?bytes(1_000, 4);
                assert store.read(keep) == ?bytes(1_000, 1);
            }
        );
    };

    public func a_handle_nobody_issued_reads_nothing() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                let real = mustWrite(store, bytes(1_000, 1));
                // A slot that exists, with a generation it never had.
                assert store.read({ real with gen = real.gen + 1 }) == null;
                // A slot that does not exist at all.
                assert store.read({ real with slot = 999 }) == null;
                // The right slot in the wrong class.
                assert store.read({ real with class_ = #build }) == null;
                // And the real one still works, so none of the above disturbed it.
                assert store.read(real) == ?bytes(1_000, 1);
            }
        );
    };

    // ── Reuse ────────────────────────────────────────────────────────────────

    public func a_freed_slot_is_reused_rather_than_growing() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                // Two live, so dropping the first queues it instead of rewinding.
                let first = mustWrite(store, bytes(1_000, 1));
                let second = mustWrite(store, bytes(1_000, 2));
                let before = store.stats().reserved;

                store.drop(first);
                let third = mustWrite(store, bytes(1_000, 3));
                assert third.slot == first.slot;
                assert store.stats().reserved == before;
                assert store.read(second) == ?bytes(1_000, 2);
            }
        );
    };

    public func reservation_projection_credits_every_reusable_slot_shape() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                let charge = Slab.slotBytes(#small);
                assert store.reservationGrowth(#small) == charge;

                // Dropping an interior slot puts it on the explicit free list.
                let first = mustWrite(store, bytes(1_000, 1));
                let second = mustWrite(store, bytes(1_000, 2));
                assert store.reservationGrowth(#small) == charge;
                store.drop(first);
                assert store.reservationGrowth(#small) == 0;
                let reused = mustWrite(store, bytes(1_000, 3));
                assert reused.slot == first.slot;

                // Dropping the newest slot rewinds `high` instead. It is not on
                // the free list, but the already-grown region is equally
                // reusable and must also project zero reservation growth.
                store.drop(reused);
                store.drop(second);
                assert store.stats().liveSlots == 0;
                assert store.reservationGrowth(#small) == 0;
                ignore mustWrite(store, bytes(1_000, 4));
                assert store.stats().reserved == 2 * charge;
            }
        );
    };

    public func deleted_class_high_water_marks_accumulate_independently() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();

                let s1 = mustWrite(store, bytes(1_000, 1));
                let s2 = mustWrite(store, bytes(1_000, 2));
                store.drop(s1);
                store.drop(s2);

                let i1 = mustWrite(store, bytes(131_073, 3));
                let i2 = mustWrite(store, bytes(131_073, 4));
                store.drop(i1);
                store.drop(i2);

                let b1 = mustWrite(store, bytes(458_753, 5));
                let b2 = mustWrite(store, bytes(458_753, 6));
                store.drop(b1);
                store.drop(b2);

                let expected = 2 * (
                    Slab.slotBytes(#small)
                    + Slab.slotBytes(#image)
                    + Slab.slotBytes(#build)
                );
                let stats = store.stats();
                assert stats.liveSlots == 0;
                assert stats.liveBytes == 0;
                assert stats.reserved == expected;
                // Each class can reuse its own historical allocation, but none
                // of those bytes reduced another class's high-water mark.
                assert store.reservationGrowth(#small) == 0;
                assert store.reservationGrowth(#image) == 0;
                assert store.reservationGrowth(#build) == 0;
            }
        );
    };

    public func writing_and_dropping_for_ever_does_not_grow() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                var i = 0;
                while (i < 50) {
                    let h = mustWrite(store, bytes(1_000, 1));
                    store.drop(h);
                    i += 1;
                };
                let after = store.stats();
                // One slot ever, reused every time — and rewound, so it is not
                // even sitting on the free list.
                assert after.reserved == Slab.slotBytes(#small);
                assert after.liveSlots == 0 and after.liveBytes == 0;
            }
        );
    };

    public func classes_do_not_share_slots() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                let small = mustWrite(store, bytes(1_000, 1));
                let image = mustWrite(store, bytes(200_000, 2));
                // Both are slot 0 of their own class, which must not collide.
                assert small.slot == image.slot;
                assert store.read(small) == ?bytes(1_000, 1);
                assert store.read(image) == ?bytes(200_000, 2);
            }
        );
    };

    public func nothing_is_reserved_for_a_class_never_written_to() : async Test.Metrics {
        Test.test(
            func() {
                let store = fresh();
                assert store.stats().reserved == 0;
                ignore mustWrite(store, bytes(10, 1));
                // Only the small class has a region; the other two cost nothing.
                assert store.stats().reserved == Slab.slotBytes(#small);
            }
        );
    };
};
