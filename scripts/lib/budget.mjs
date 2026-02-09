// scripts/lib/budget.mjs — Financial OS interface for PiaB v3
// Read-only coaching layer on top of Stice Financial Planner.

import sheets from './sheets.mjs';
import ledger from './ledger.mjs';
import { loadHousehold } from './yaml-loader.mjs';

export function getMoneyPulse() {
  // Read Budget vs Actual for category variances
  const bva = sheets.readBudgetVsActual();
  if (!bva.success) return { success: false, error: 'Could not read Budget vs Actual' };

  const rows = (bva.data?.values || []).slice(1); // skip header
  const overBudget = [];
  const underBudget = [];

  for (const row of rows) {
    if (!row[0]) continue;
    const category = row[0];
    const budget = parseFloat(row[1]) || 0;
    const actual = parseFloat(row[2]) || 0;
    const variance = parseFloat(row[3]) || 0;
    const status = row[4] || '';

    if (status.includes('OVER')) {
      overBudget.push({ category, budget, actual, variance: Math.abs(variance) });
    } else {
      underBudget.push({ category, budget, actual, variance });
    }
  }

  // Read dashboard KPIs
  const dash = sheets.readFinancialDashboard();
  let monthlyFCF = null;
  let savingsRate = null;
  if (dash.success) {
    const dashRows = dash.data?.values || [];
    for (const row of dashRows) {
      if (row[0] === 'Monthly FCF') monthlyFCF = parseFloat(row[1]);
      if (row[0] === 'Savings Rate') savingsRate = parseFloat(row[1]);
    }
  }

  // Read merchant budgets
  const merchants = sheets.readMerchantBudgets();
  const merchantOverages = [];
  if (merchants.success) {
    const mRows = (merchants.data?.values || []).slice(1);
    for (const row of mRows) {
      if (row[4]?.includes('OVER')) {
        merchantOverages.push({ merchant: row[0], budget: parseFloat(row[1]), actual: parseFloat(row[2]) });
      }
    }
  }

  // Determine pulse status
  let status = 'green';
  if (overBudget.length > 3 || (monthlyFCF && monthlyFCF < 0)) status = 'red';
  else if (overBudget.length > 0) status = 'yellow';

  return {
    success: true,
    status,
    monthly_fcf: monthlyFCF,
    savings_rate: savingsRate,
    savings_rate_pct: savingsRate ? `${Math.round(savingsRate * 100)}%` : null,
    over_budget: overBudget,
    under_budget: underBudget,
    merchant_overages: merchantOverages,
  };
}

export function getCapExUpcoming(monthsAhead = 3) {
  const result = sheets.readCapExPlanning();
  if (!result.success) return result;
  const rows = (result.data?.values || []).slice(2); // skip headers
  return {
    success: true,
    items: rows.filter(r => r[0] && parseFloat(r[2]) <= monthsAhead).map(r => ({
      item: r[0],
      cost: parseFloat(r[1]) || 0,
      months_away: parseFloat(r[2]) || 0,
      monthly_set_aside: parseFloat(r[3]) || 0,
    })),
  };
}

export function logManualTransaction(description, amount, category, person) {
  const household = loadHousehold();
  const ownerName = household.people?.[person]?.full_name || person;
  const date = new Date().toISOString().split('T')[0];

  const result = sheets.appendTransaction(
    date,
    description,
    category,
    'Manual entry',
    '',
    'Captured via PiaB',
    -Math.abs(amount), // expenses are negative in Raw Data
    ownerName
  );

  ledger.append('capture_ledger', {
    type: 'budget_capture',
    person,
    description,
    amount,
    category,
    success: result.success,
  });

  return result;
}

export function getDaysRemainingInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate();
}

export function getDailyBudgetRemaining(category) {
  const pulse = getMoneyPulse();
  if (!pulse.success) return null;
  const daysLeft = getDaysRemainingInMonth();
  if (daysLeft <= 0) return null;

  const allCategories = [...pulse.over_budget, ...pulse.under_budget];
  const cat = allCategories.find(c => c.category === category);
  if (!cat) return null;

  const remaining = cat.budget - cat.actual;
  return {
    category,
    budget: cat.budget,
    spent: cat.actual,
    remaining,
    daily_remaining: Math.round((remaining / daysLeft) * 100) / 100,
    days_left: daysLeft,
  };
}

export default { getMoneyPulse, getCapExUpcoming, logManualTransaction, getDaysRemainingInMonth, getDailyBudgetRemaining };
