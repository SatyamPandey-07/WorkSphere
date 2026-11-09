/**
 * OrderStateMachine
 * Manages the strict lifecycle of a cafe order within the WorkSphere ecosystem.
 * Ensures that state transitions are valid, atomic, and properly logged for analytics.
 */

export enum OrderStatus {
  PLACED = 'PLACED',
  BREWING = 'BREWING',
  READY = 'READY',
  PICKED_UP = 'PICKED_UP',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED'
}

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  BARISTA = 'BARISTA',
  SYSTEM = 'SYSTEM',
  MANAGER = 'MANAGER'
}

export interface OrderTransitionRule {
  from: OrderStatus;
  to: OrderStatus;
  allowedRoles: UserRole[];
  description: string;
}

export interface OrderState {
  orderId: string;
  status: OrderStatus;
  updatedAt: number;
  history: OrderTransitionLog[];
}

export interface OrderTransitionLog {
  from: OrderStatus;
  to: OrderStatus;
  actor: UserRole;
  timestamp: number;
  metadata?: Record<string, any>;
}

const TRANSITION_RULES: OrderTransitionRule[] = [
  { from: OrderStatus.PLACED, to: OrderStatus.BREWING, allowedRoles: [UserRole.BARISTA, UserRole.SYSTEM], description: 'Barista starts preparation' },
  { from: OrderStatus.PLACED, to: OrderStatus.CANCELLED, allowedRoles: [UserRole.CUSTOMER, UserRole.BARISTA, UserRole.MANAGER], description: 'Order cancelled before brewing' },
  { from: OrderStatus.BREWING, to: OrderStatus.READY, allowedRoles: [UserRole.BARISTA, UserRole.SYSTEM], description: 'Order completed and ready for pickup' },
  { from: OrderStatus.BREWING, to: OrderStatus.CANCELLED, allowedRoles: [UserRole.MANAGER], description: 'Order cancelled during preparation' },
  { from: OrderStatus.READY, to: OrderStatus.PICKED_UP, allowedRoles: [UserRole.CUSTOMER, UserRole.BARISTA, UserRole.SYSTEM], description: 'Customer collected the order' },
  { from: OrderStatus.READY, to: OrderStatus.CANCELLED, allowedRoles: [UserRole.MANAGER], description: 'Order expired or returned' },
  { from: OrderStatus.PICKED_UP, to: OrderStatus.REFUNDED, allowedRoles: [UserRole.MANAGER], description: 'Post-pickup refund issued' },
  { from: OrderStatus.CANCELLED, to: OrderStatus.REFUNDED, allowedRoles: [UserRole.SYSTEM, UserRole.MANAGER], description: 'Refund processed for cancelled order' }
];

export class OrderStateMachine {
  private state: OrderState;

  constructor(initialState: OrderState) {
    this.state = { ...initialState };
  }

  public getState(): Readonly<OrderState> {
    return this.state;
  }

  public canTransition(to: OrderStatus, actor: UserRole): boolean {
    const rule = TRANSITION_RULES.find(
      (r) => r.from === this.state.status && r.to === to
    );
    return !!rule && rule.allowedRoles.includes(actor);
  }

  public transition(
    to: OrderStatus,
    actor: UserRole,
    metadata?: Record<string, any>
  ): OrderState {
    if (to === this.state.status) {
      return this.state;
    }

    const rule = TRANSITION_RULES.find(
      (r) => r.from === this.state.status && r.to === to
    );

    if (!rule) {
      throw new Error(
        `Invalid transition from ${this.state.status} to ${to}. No rule defined.`
      );
    }

    if (!rule.allowedRoles.includes(actor)) {
      throw new Error(
        `Unauthorized transition: Role '${actor}' cannot move order from ${this.state.status} to ${to}. Allowed: ${rule.allowedRoles.join(', ')}`
      );
    }

    const timestamp = Date.now();
    const logEntry: OrderTransitionLog = {
      from: this.state.status,
      to,
      actor,
      timestamp,
      metadata
    };

    this.state = {
      ...this.state,
      status: to,
      updatedAt: timestamp,
      history: [...this.state.history, logEntry]
    };

    return this.state;
  }

  public static createInitialOrder(orderId: string): OrderState {
    return {
      orderId,
      status: OrderStatus.PLACED,
      updatedAt: Date.now(),
      history: [
        {
          from: OrderStatus.PLACED,
          to: OrderStatus.PLACED,
          actor: UserRole.SYSTEM,
          timestamp: Date.now(),
          metadata: { action: 'INITIAL_CREATION' }
        }
      ]
    };
  }
}
