import {
    CompressedDeskPassMinter,
    MerkleTreeConfig,
    PassMetadata
} from '../../core/solana/CompressedDeskPassMinter';

describe('CompressedDeskPassMinter', () => {
    let minter: CompressedDeskPassMinter;
    const treeConfig: MerkleTreeConfig = {
        maxDepth: 5, // small depth for fast testing (2^5 = 32 capacity)
        maxBufferSize: 8,
        canopyDepth: 2,
        treeAuthority: 'Auth11111111111111111111111111111111111111',
        treeAddress: 'Tree11111111111111111111111111111111111111'
    };

    const sampleMetadata: PassMetadata = {
        name: 'WorkSphere Nomad Pass - Zone A',
        symbol: 'WSPASS',
        uri: 'https://arweave.net/ws-nomad-pass-sample',
        sellerFeeBasisPoints: 0,
        venueId: 'venue-sf-downtown',
        seatTier: 'HOT_DESK',
        validUntil: Date.now() + 86400000,
        attributes: [
            { traitType: 'Venue', value: 'San Francisco Hub' },
            { traitType: 'Tier', value: 'HotDesk-Ultra' },
            { traitType: 'AccessLevel', value: 'FullDay' }
        ]
    };

    beforeEach(() => {
        minter = new CompressedDeskPassMinter(treeConfig);
    });

    describe('Tree Configuration & Rent Calculations', () => {
        it('validates configuration constraints', () => {
            expect(minter.getCapacity()).toBe(32);
            expect(minter.getLeafCount()).toBe(0);
            expect(minter.getRoot()).toBeDefined();

            // Depth out of bounds
            expect(() => new CompressedDeskPassMinter({ ...treeConfig, maxDepth: 2 })).toThrow();
            expect(() => new CompressedDeskPassMinter({ ...treeConfig, maxDepth: 35 })).toThrow();
            // Canopy too large
            expect(() => new CompressedDeskPassMinter({ ...treeConfig, canopyDepth: 5 })).toThrow();
        });

        it('calculates on-chain byte allocation and rent exemption', () => {
            const rent = CompressedDeskPassMinter.calculateTreeRent({
                maxDepth: 14,
                maxBufferSize: 64,
                canopyDepth: 8
            });

            expect(rent.bytes).toBeGreaterThan(1000);
            expect(rent.lamports).toBeGreaterThan(0);
            expect(rent.sol).toBeGreaterThan(0);
        });
    });

    describe('Metadata Hashing and Asset Identification', () => {
        it('hashes metadata into a 32-byte digest', () => {
            const metaHash = minter.hashMetadata(sampleMetadata);
            expect(metaHash.length).toBe(32);
        });

        it('derives unique asset IDs based on leaf index', () => {
            const id0 = minter.deriveAssetId(0);
            const id1 = minter.deriveAssetId(1);
            expect(id0.startsWith('cPass-')).toBe(true);
            expect(id1.startsWith('cPass-')).toBe(true);
            expect(id0).not.toBe(id1);
        });
    });

    describe('Minting & Merkle Proofs', () => {
        it('mints a compressed pass, updates root, and verifies proof', async () => {
            const initialRoot = minter.getRoot();
            const owner = 'OwnerPubkey11111111111111111111111111111111';

            const { asset, proof } = await minter.mintPass(owner, sampleMetadata);

            expect(asset.leafIndex).toBe(0);
            expect(asset.owner).toBe(owner);
            expect(asset.status).toBe('ACTIVE');
            expect(minter.getLeafCount()).toBe(1);

            const newRoot = minter.getRoot();
            expect(newRoot).not.toBe(initialRoot);
            expect(proof.proof.length).toBe(treeConfig.maxDepth);

            // Verify proof cryptographically
            const isValid = minter.verifyProof(asset.leafHash, proof.proof, asset.leafIndex, newRoot);
            expect(isValid).toBe(true);
        });

        it('rejects invalid or tampered Merkle proofs', async () => {
            const owner = 'OwnerPubkey11111111111111111111111111111111';
            const { asset, proof } = await minter.mintPass(owner, sampleMetadata);

            // Tampered leaf
            const fakeLeaf = '00'.repeat(32);
            const isFakeValid = minter.verifyProof(fakeLeaf, proof.proof, asset.leafIndex, minter.getRoot());
            expect(isFakeValid).toBe(false);

            // Corrupted proof path
            const corruptedProof = [...proof.proof];
            corruptedProof[0] = 'ff'.repeat(32);
            const isCorruptedValid = minter.verifyProof(asset.leafHash, corruptedProof, asset.leafIndex, minter.getRoot());
            expect(isCorruptedValid).toBe(false);
        });

        it('mints multiple passes and maintains independent valid proofs', async () => {
            const owner1 = 'Owner1111111111111111111111111111111111111';
            const owner2 = 'Owner2222222222222222222222222222222222222';

            const mint1 = await minter.mintPass(owner1, sampleMetadata);
            const mint2 = await minter.mintPass(owner2, { ...sampleMetadata, seatTier: 'DEDICATED_DESK' });

            expect(minter.getLeafCount()).toBe(2);

            // Re-fetch fresh proof for leaf 0 after leaf 1 was added
            const proof0 = minter.getProofForLeaf(0);
            const proof1 = minter.getProofForLeaf(1);

            expect(minter.verifyProof(mint1.asset.leafHash, proof0.proof, 0, minter.getRoot())).toBe(true);
            expect(minter.verifyProof(mint2.asset.leafHash, proof1.proof, 1, minter.getRoot())).toBe(true);
        });
    });

    describe('Transfer Lifecycle', () => {
        it('transfers compressed pass and verifies ownership update', async () => {
            const ownerA = 'OwnerAAAA111111111111111111111111111111111';
            const ownerB = 'OwnerBBBB222222222222222222222222222222222';

            const { asset, proof } = await minter.mintPass(ownerA, sampleMetadata);
            const preTransferRoot = minter.getRoot();

            const { updatedAsset, newRoot } = await minter.transferPass(
                asset.assetId,
                ownerA,
                ownerB,
                proof.proof
            );

            expect(updatedAsset.owner).toBe(ownerB);
            expect(newRoot).not.toBe(preTransferRoot);

            // Verify updated proof for new owner
            const freshProof = minter.getProofForLeaf(asset.leafIndex);
            const isValid = minter.verifyProof(updatedAsset.leafHash, freshProof.proof, asset.leafIndex, newRoot);
            expect(isValid).toBe(true);
        });

        it('rejects unauthorized transfer attempt', async () => {
            const ownerA = 'OwnerAAAA111111111111111111111111111111111';
            const impostor = 'Impostor999999999999999999999999999999999';
            const recipient = 'Recipient2222222222222222222222222222222';

            const { asset, proof } = await minter.mintPass(ownerA, sampleMetadata);

            await expect(
                minter.transferPass(asset.assetId, impostor, recipient, proof.proof)
            ).rejects.toThrow('Unauthorized transfer');
        });
    });

    describe('Burn & Revocation', () => {
        it('burns pass, clears leaf hash to zero, and updates status', async () => {
            const owner = 'OwnerBurner1111111111111111111111111111111';
            const { asset, proof } = await minter.mintPass(owner, sampleMetadata);

            const { newRoot } = await minter.burnPass(asset.assetId, owner, proof.proof);
            expect(newRoot).toBeDefined();

            const burnedAsset = minter.getPass(asset.assetId);
            expect(burnedAsset?.status).toBe('BURNED');
            expect(burnedAsset?.leafHash).toBe('00'.repeat(32));

            // Cannot transfer burned pass
            await expect(
                minter.transferPass(asset.assetId, owner, 'NewOwner', proof.proof)
            ).rejects.toThrow('Cannot transfer asset in status BURNED');
        });
    });

    describe('Bubblegum Instruction Payload Builder', () => {
        it('generates well-formed Bubblegum instruction payload', () => {
            const payload = minter.buildBubblegumInstruction('mintV1', {
                payer: 'PayerPubkey11111111111111111111111111111111',
                owner: 'OwnerPubkey11111111111111111111111111111111',
                metadata: sampleMetadata
            });

            expect(payload.programId).toBe(CompressedDeskPassMinter.BUBBLEGUM_PROGRAM_ID);
            expect(payload.action).toBe('mintV1');
            expect(payload.accounts.length).toBe(6);
            expect(payload.data.length).toBeGreaterThan(0);
        });
    });
});
