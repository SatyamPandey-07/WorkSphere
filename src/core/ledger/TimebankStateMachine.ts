/**
 * TimebankStateMachine.ts
 * Defines the strict lifecycle of a barter agreement (PROPOSED -> ACCEPTED -> IN_PROGRESS -> SETTLED).
 */

export enum BarterState {
    PROPOSED = 'PROPOSED',
    ACCEPTED = 'ACCEPTED',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    SETTLED = 'SETTLED',
    DISPUTED = 'DISPUTED',
    CANCELLED = 'CANCELLED',
}

export interface BarterAgreement {
    id: string;
    providerId: string;
    receiverId: string;
    skillOffered: string;
    skillRequested: string;
    durationMinutes: number;
    state: BarterState;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    iouSignature?: string;
}

export interface StateTransition {
    from: BarterState;
    to: BarterState;
    actorId: string; // Who is allowed to trigger this transition
    validate?: (agreement: BarterAgreement) => boolean;
}

export class TimebankStateMachine {
    private transitions: StateTransition[] = [
        { from: BarterState.PROPOSED, to: BarterState.ACCEPTED, actorId: 'receiver' },
        { from: BarterState.PROPOSED, to: BarterState.CANCELLED, actorId: 'provider' },
        { from: BarterState.PROPOSED, to: BarterState.CANCELLED, actorId: 'receiver' },

        { from: BarterState.ACCEPTED, to: BarterState.IN_PROGRESS, actorId: 'provider' },
        { from: BarterState.ACCEPTED, to: BarterState.IN_PROGRESS, actorId: 'receiver' },
        { from: BarterState.ACCEPTED, to: BarterState.CANCELLED, actorId: 'provider' },
        { from: BarterState.ACCEPTED, to: BarterState.CANCELLED, actorId: 'receiver' },

        { from: BarterState.IN_PROGRESS, to: BarterState.COMPLETED, actorId: 'provider' },
        { from: BarterState.IN_PROGRESS, to: BarterState.COMPLETED, actorId: 'receiver' },
        { from: BarterState.IN_PROGRESS, to: BarterState.DISPUTED, actorId: 'provider' },
        { from: BarterState.IN_PROGRESS, to: BarterState.DISPUTED, actorId: 'receiver' },

        { from: BarterState.COMPLETED, to: BarterState.SETTLED, actorId: 'system' },
        { from: BarterState.DISPUTED, to: BarterState.SETTLED, actorId: 'system' },
        { from: BarterState.DISPUTED, to: BarterState.CANCELLED, actorId: 'system' },
    ];

    public canTransition(agreement: BarterAgreement, targetState: BarterState, actorId: string): boolean {
        const validTransition = this.transitions.find(
            (t) =>
                t.from === agreement.state &&
                t.to === targetState &&
                (t.actorId === actorId || t.actorId === 'system' || this.isParticipant(agreement, actorId))
        );

        if (!validTransition) return false;

        if (validTransition.validate) {
            return validTransition.validate(agreement);
        }

        return true;
    }

    public transition(agreement: BarterAgreement, targetState: BarterState, actorId: string): BarterAgreement {
        if (!this.canTransition(agreement, targetState, actorId)) {
            throw new Error(
                `Invalid transition from ${agreement.state} to ${targetState} by actor ${actorId}`
            );
        }

        const updatedAgreement: BarterAgreement = {
            ...agreement,
            state: targetState,
            updatedAt: Date.now(),
        };

        if (targetState === BarterState.COMPLETED) {
            updatedAgreement.completedAt = Date.now();
        }

        return updatedAgreement;
    }

    private isParticipant(agreement: BarterAgreement, actorId: string): boolean {
        return agreement.providerId === actorId || agreement.receiverId === actorId;
    }

    public getAvailableTransitions(agreement: BarterAgreement, actorId: string): BarterState[] {
        return this.transitions
            .filter(
                (t) =>
                    t.from === agreement.state &&
                    (t.actorId === actorId || t.actorId === 'system' || this.isParticipant(agreement, actorId))
            )
            .map((t) => t.to);
    }

    public calculateTimeDebt(userId: string, agreements: BarterAgreement[]): number {
        let debt = 0;
        for (const ag of agreements) {
            if (ag.state === BarterState.SETTLED || ag.state === BarterState.CANCELLED) continue;

            if (ag.providerId === userId && ag.state === BarterState.COMPLETED) {
                // User provided service, owes them time
                debt -= ag.durationMinutes;
            } else if (ag.receiverId === userId && ag.state === BarterState.COMPLETED) {
                // User received service, they owe time
                debt += ag.durationMinutes;
            }
        }
        return debt; // Positive means they owe time, negative means they are owed time
    }
}
