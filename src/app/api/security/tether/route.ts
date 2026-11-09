import { NextRequest, NextResponse } from 'next/server';
import { DeviceTetheringProtocol } from '@/core/security/DeviceTetheringProtocol';

const tetherProtocol = new DeviceTetheringProtocol();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, sessionId, secondaryPublicKey, payload, signature } = body;

    if (action === 'INITIATE') {
      if (!sessionId) {
        return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
      }
      const { publicKey } = await tetherProtocol.initiateSession(sessionId);
      return NextResponse.json({ success: true, publicKey });
    }

    if (action === 'HANDSHAKE') {
      if (!sessionId || !secondaryPublicKey) {
        return NextResponse.json({ error: 'Missing handshake data' }, { status: 400 });
      }
      const success = await tetherProtocol.completeHandshake(sessionId, secondaryPublicKey);
      return NextResponse.json({ success });
    }

    if (action === 'PING') {
      if (!sessionId || !payload || !signature) {
        return NextResponse.json({ error: 'Missing ping data' }, { status: 400 });
      }
      
      const isValid = await tetherProtocol.verifyPing(sessionId, payload, signature);
      
      if (!isValid) {
        tetherProtocol.breachSession(sessionId);
        return NextResponse.json({ valid: false, breached: true }, { status: 401 });
      }

      return NextResponse.json({ valid: true, breached: false });
    }

    if (action === 'SIGN') {
      if (!sessionId || !payload) {
        return NextResponse.json({ error: 'Missing sign data' }, { status: 400 });
      }
      const signature = await tetherProtocol.signPing(sessionId, payload);
      return NextResponse.json({ signature });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Tether API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}