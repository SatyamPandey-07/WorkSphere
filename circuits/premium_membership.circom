pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

template PremiumMembership() {
    signal input identityToken;
    signal input expectedCommit;

    component hash = Poseidon(1);
    hash.inputs[0] <== identityToken;
    expectedCommit === hash.out;
}

template MultiVenueClusterMembership(nVenues) {
    signal input venueIds[nVenues];
    signal input clusterMerkleRoot;
    signal output validClusterHash;

    component poseidon = Poseidon(nVenues);
    for (var i = 0; i < nVenues; i++) {
        poseidon.inputs[i] <== venueIds[i];
    }
    validClusterHash <== poseidon.out;
}

component main {public [expectedCommit]} = PremiumMembership();
