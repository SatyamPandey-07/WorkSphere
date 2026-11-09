/**
 * Monthly Workspace Budget & Team Expense Allocation Service
 * 
 * Provides automated tracking of workspace booking expenditures against monthly
 * budget limits, department / cost-center allocations, burn rate forecasting,
 * and expense report generation.
 */

export interface DepartmentAllocation {
  id: string;
  name: string;
  allocatedAmount: number;
  spentAmount: number;
  color: string;
}

export interface ExpenseRecord {
  id: string;
  bookingId?: string;
  venueName: string;
  category: string;
  department: string;
  costCenter?: string;
  amount: number;
  date: string;
  receiptUrl?: string;
}

export interface MonthlyBudgetConfig {
  userId: string;
  month: string; // "YYYY-MM"
  currency: string;
  monthlyLimit: number;
  warningThresholdPercentage: number; // e.g. 80%
  departments: DepartmentAllocation[];
  expenses: ExpenseRecord[];
  updatedAt: string;
}

export interface BudgetSummary {
  month: string;
  monthlyLimit: number;
  totalSpent: number;
  remainingBudget: number;
  utilizationPercentage: number;
  projectedMonthEndSpend: number;
  burnRatePerDay: number;
  isNearLimit: boolean;
  isOverLimit: boolean;
  departments: DepartmentAllocation[];
  recentExpenses: ExpenseRecord[];
}

// In-memory store for user monthly budgets
const budgetStore = new Map<string, MonthlyBudgetConfig>();

export class WorkspaceBudgetService {
  private getCurrentMonthKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  /**
   * Retrieves or initializes budget configuration for a user.
   */
  public getUserBudget(userId: string, monthKey?: string): MonthlyBudgetConfig {
    const month = monthKey || this.getCurrentMonthKey();
    const storeKey = `${userId}:${month}`;

    const existing = budgetStore.get(storeKey);
    if (existing) return existing;

    // Default configuration with sample initial allocations
    const defaultConfig: MonthlyBudgetConfig = {
      userId,
      month,
      currency: "USD",
      monthlyLimit: 500,
      warningThresholdPercentage: 80,
      departments: [
        { id: "dept_eng", name: "Engineering", allocatedAmount: 200, spentAmount: 145, color: "#3b82f6" },
        { id: "dept_des", name: "Design & Creative", allocatedAmount: 120, spentAmount: 85, color: "#a855f7" },
        { id: "dept_prod", name: "Product & Ops", allocatedAmount: 100, spentAmount: 60, color: "#10b981" },
        { id: "dept_general", name: "General / Client Visits", allocatedAmount: 80, spentAmount: 35, color: "#f59e0b" },
      ],
      expenses: [
        {
          id: "exp_1",
          venueName: "WeWork Downtown Hub",
          category: "Hot Desk",
          department: "Engineering",
          costCenter: "CC-101",
          amount: 45,
          date: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().split("T")[0],
        },
        {
          id: "exp_2",
          venueName: "Mindspace Mezzanine",
          category: "Meeting Room (2h)",
          department: "Product & Ops",
          costCenter: "CC-204",
          amount: 60,
          date: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString().split("T")[0],
        },
        {
          id: "exp_3",
          venueName: "Artisan Coffee Lab & Work",
          category: "Quiet Focus Pod",
          department: "Design & Creative",
          costCenter: "CC-302",
          amount: 35,
          date: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().split("T")[0],
        },
        {
          id: "exp_4",
          venueName: "TechHub Innovation Center",
          category: "Dedicated Standing Desk",
          department: "Engineering",
          costCenter: "CC-101",
          amount: 100,
          date: new Date(Date.now() - 11 * 24 * 3600 * 1000).toISOString().split("T")[0],
        },
      ],
      updatedAt: new Date().toISOString(),
    };

    budgetStore.set(storeKey, defaultConfig);
    return defaultConfig;
  }

  /**
   * Computes comprehensive budget summary metrics.
   */
  public getBudgetSummary(userId: string, monthKey?: string): BudgetSummary {
    const config = this.getUserBudget(userId, monthKey);
    const now = new Date();
    const currentDay = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const totalSpent = config.departments.reduce((acc, d) => acc + d.spentAmount, 0);
    const remainingBudget = Math.max(0, config.monthlyLimit - totalSpent);
    const utilizationPercentage = Math.round((totalSpent / (config.monthlyLimit || 1)) * 100);

    const burnRatePerDay = currentDay > 0 ? Math.round((totalSpent / currentDay) * 10) / 10 : 0;
    const projectedMonthEndSpend = Math.round(burnRatePerDay * daysInMonth);

    const isNearLimit = utilizationPercentage >= config.warningThresholdPercentage;
    const isOverLimit = totalSpent > config.monthlyLimit;

    return {
      month: config.month,
      monthlyLimit: config.monthlyLimit,
      totalSpent,
      remainingBudget,
      utilizationPercentage,
      projectedMonthEndSpend,
      burnRatePerDay,
      isNearLimit,
      isOverLimit,
      departments: config.departments,
      recentExpenses: config.expenses,
    };
  }

  /**
   * Updates monthly limit and department budget allocations.
   */
  public updateBudget(
    userId: string,
    updates: {
      monthlyLimit?: number;
      warningThresholdPercentage?: number;
      departments?: DepartmentAllocation[];
    },
  ): MonthlyBudgetConfig {
    const config = this.getUserBudget(userId);

    if (typeof updates.monthlyLimit === "number") {
      config.monthlyLimit = Math.max(0, updates.monthlyLimit);
    }
    if (typeof updates.warningThresholdPercentage === "number") {
      config.warningThresholdPercentage = Math.min(100, Math.max(10, updates.warningThresholdPercentage));
    }
    if (updates.departments && Array.isArray(updates.departments)) {
      config.departments = updates.departments;
    }

    config.updatedAt = new Date().toISOString();
    const storeKey = `${userId}:${config.month}`;
    budgetStore.set(storeKey, config);
    return config;
  }

  /**
   * Allocates a new workspace expense to a department / project.
   */
  public addExpense(
    userId: string,
    expense: {
      bookingId?: string;
      venueName: string;
      category: string;
      department: string;
      costCenter?: string;
      amount: number;
    },
  ): ExpenseRecord {
    const config = this.getUserBudget(userId);
    const newRecord: ExpenseRecord = {
      id: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      bookingId: expense.bookingId,
      venueName: expense.venueName,
      category: expense.category,
      department: expense.department,
      costCenter: expense.costCenter,
      amount: expense.amount,
      date: new Date().toISOString().split("T")[0],
    };

    config.expenses.unshift(newRecord);

    // Update department spent amount
    const dept = config.departments.find(
      (d) => d.name.toLowerCase() === expense.department.toLowerCase() || d.id === expense.department,
    );
    if (dept) {
      dept.spentAmount += expense.amount;
    } else {
      config.departments[0].spentAmount += expense.amount;
    }

    config.updatedAt = new Date().toISOString();
    const storeKey = `${userId}:${config.month}`;
    budgetStore.set(storeKey, config);
    return newRecord;
  }
}

export const workspaceBudgetService = new WorkspaceBudgetService();
