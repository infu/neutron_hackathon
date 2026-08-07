/// Initial values for the ashroot singleton `store`.
///
/// `Ashroot.Use` calls `ensure()` internally, which writes these **only when
/// the store slot is empty**. Passing the same defaults on every upgrade is
/// therefore safe and will not clobber live configuration.

import Ashroot "../.ashroot/lib";

module {
    public func store() : Ashroot.Types.Store = {
        siteTitle = "Neutron Hackathon";
        registrationOpen = true;
        // Empty until a frontend is uploaded. `Assets` recomputes it on every
        // change, so this is only ever the value before the first upload.
        frontendHash = "";
        // Instructions one participant may spend in a season before they are
        // frozen for the rest of it.
        //
        // Half a trillion. The ash suite reports the heaviest call in the low
        // millions, so this is on the order of a hundred thousand of them —
        // orders of magnitude past anything a person does through the site,
        // and still a hard stop on a script that has stopped being a client
        // and started being a load generator.
        instructionCap = 500_000_000_000;
        // Controllers validate and publish the ledgers before accepting the
        // first sponsor application.  The boolean distinguishes a deliberate
        // empty list from a canister whose launch configuration is unfinished.
        ledgerAllowlistSet = false;
        ledgerAllowlist = [];
        // A finished one-season canister never reopens registration.  This is
        // the optional place its read-only UI points for the next event.
        nextSeasonUrl = "";
    };
};
