pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

template PremiumMembership() {
    signal input identityToken;
    signal input expectedCommit;

    component hash = Poseidon(1);
    hash.inputs[0] <== identityToken;
    expectedCommit === hash.out;
}

component main {public [expectedCommit]} = PremiumMembership();
