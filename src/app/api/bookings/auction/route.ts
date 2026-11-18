import { NextRequest, NextResponse } from 'next/server';
import { VickreyAuctionEngine } from '@/core/auctions/VickreyAuctionEngine';
import { BidCryptography } from '@/core/auctions/BidCryptography';

const engine = new VickreyAuctionEngine();
const cryptoUtil = new BidCryptography();

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, deskId, auctionId, userId, amount, salt, reveals } = body;

        if (action === 'CREATE') {
            if (!deskId) return NextResponse.json({ error: 'deskId required' }, { status: 400 });
            const auction = engine.createAuction(deskId, 15 * 60 * 1000); // 15 min auction
            return NextResponse.json({ success: true, auctionId: auction.auctionId, endsAt: auction.endsAt });
        }

        if (action === 'BID') {
            if (!auctionId || !userId || amount === undefined || !salt) {
                return NextResponse.json({ error: 'Missing bid parameters' }, { status: 400 });
            }

            const placed = await engine.placeBid(auctionId, userId, amount, salt);
            if (!placed) {
                return NextResponse.json({ error: 'Auction closed or invalid' }, { status: 400 });
            }

            return NextResponse.json({ success: true, message: 'Bid sealed successfully' });
        }

        if (action === 'SETTLE') {
            if (!auctionId || !reveals) {
                return NextResponse.json({ error: 'Missing settlement data' }, { status: 400 });
            }

            await engine.closeAuction(auctionId);
            const result = await engine.settleAuction(auctionId, reveals);

            if (!result) {
                return NextResponse.json({ error: 'Settlement failed (no valid bids)' }, { status: 400 });
            }

            return NextResponse.json({
                success: true,
                winnerId: result.winnerId,
                pricePaid: result.price
            });
        }

        if (action === 'GENERATE_SALT') {
            const salt = cryptoUtil.generateSalt();
            return NextResponse.json({ salt });
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    } catch (error) {
        console.error('Auction API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
