pragma circom 2.0.0;

// Prove knowledge of a private identity token that binds to a public
// membership commitment — token never leaves the prover.
template PremiumMembership() {
    signal input identityToken;
    signal input expectedCommit;

    signal t2;
    t2 <== identityToken * identityToken;

    // commit = token^2 + 5*token + 17
    signal commit;
    commit <== t2 + identityToken * 5 + 17;
    expectedCommit === commit;
}

component main {public [expectedCommit]} = PremiumMembership();
