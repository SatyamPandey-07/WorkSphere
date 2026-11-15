/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { EmergencyMeshRouter, EmergencyMessage } from '../core/network/EmergencyMeshRouter';

interface WorkerMessage {
    type: 'CREATE_MSG' | 'RECEIVE_MSG' | 'GET_SYNC_PAYLOAD' | 'REGISTER_PEER';
    payload: any;
}

interface WorkerResponse {
    type: 'MSG_CREATED' | 'SYNC_PAYLOAD' | 'NEW_MSG_RECEIVED' | 'STORE_SIZE';
    payload: any;
}

const router = new EmergencyMeshRouter();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'CREATE_MSG':
            handleCreateMsg(payload);
            break;
        case 'RECEIVE_MSG':
            handleReceiveMsg(payload);
            break;
        case 'GET_SYNC_PAYLOAD':
            handleGetSyncPayload(payload.peerId);
            break;
        case 'REGISTER_PEER':
            router.registerPeer(payload.peerId);
            break;
    }
};

function handleCreateMsg(payload: { senderId: string; text: string; gps?: { lat: number; lng: number } }): void {
    // In a real app, payload.text would be encrypted here before routing
    const msg = router.createMessage(payload.senderId, payload.text, payload.gps);

    self.postMessage({
        type: 'MSG_CREATED',
        payload: msg
    } as WorkerResponse);
}

function handleReceiveMsg(msg: EmergencyMessage & { fromPeerId: string }): void {
    const isNew = router.receiveMessage(msg, msg.fromPeerId);

    if (isNew) {
        self.postMessage({
            type: 'NEW_MSG_RECEIVED',
            payload: msg
        } as WorkerResponse);
    }
}

function handleGetSyncPayload(peerId: string): void {
    router.registerPeer(peerId);
    const messages = router.getMessagesForPeer(peerId);

    self.postMessage({
        type: 'SYNC_PAYLOAD',
        payload: { peerId, messages }
    } as WorkerResponse);
}

setInterval(() => {
    self.postMessage({
        type: 'STORE_SIZE',
        payload: { size: router.getStoreSize() }
    } as WorkerResponse);
}, 5000);
