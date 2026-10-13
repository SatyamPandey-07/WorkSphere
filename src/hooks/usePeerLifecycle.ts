/**
 * usePeerLifecycle.ts
 * React hook that wraps the PeerConnectionManager, ensuring proper cleanup 
 * on component unmount and exposing connection state to the UI.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { PeerConnectionManager, PeerConfig, ConnectionState } from '@/lib/p2p/PeerConnectionManager';

export function usePeerLifecycle(config: PeerConfig) {
    const [state, setState] = useState<ConnectionState>('new');
    const managerRef = useRef<PeerConnectionManager | null>(null);

    useEffect(() => {
        managerRef.current = new PeerConnectionManager(config);
        setState(managerRef.current.state);

        // Override the internal state change to update React state
        const originalTearDown = managerRef.current.tearDown.bind(managerRef.current);
        managerRef.current.tearDown = () => {
            setState('closed');
            originalTearDown();
        };

        // Monitor state changes
        const checkState = setInterval(() => {
            if (managerRef.current) {
                setState(managerRef.current.state);
            }
        }, 500);

        return () => {
            clearInterval(checkState);
            if (managerRef.current) {
                managerRef.current.tearDown();
                managerRef.current = null;
            }
        };
    }, [config.peerId]);

    const send = useCallback((data: string | ArrayBuffer | Blob) => {
        if (managerRef.current) {
            managerRef.current.send(data);
        }
    }, []);

    const recordHeartbeat = useCallback(() => {
        if (managerRef.current) {
            managerRef.current.recordHeartbeat();
        }
    }, []);

    return {
        state,
        send,
        recordHeartbeat,
        manager: managerRef.current,
    };
}
