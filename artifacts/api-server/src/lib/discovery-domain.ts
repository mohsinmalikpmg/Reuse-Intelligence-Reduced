/** Eligibility guard, not a recommendation or coverage score. Generic workflow
 * language can never make a domain-specific recipe eligible on its own. */
export function discoveryDomainEligible(sourceId:string,need:string):boolean {
  const positive=need.toLowerCase().split(/[.!?;\n]/).filter(part=>!/\b(no|not|without|exclude|unrelated)\b.{0,30}\b(invoices?|payables?|budgets?|forecasts?|financial|accounting)\b/.test(part)).join(" ");
  if(["invoice-finder","approval-desk","spend-tracker"].includes(sourceId))
    return /\b(invoices?|accounts? payable|supplier payments?|vendor payments?|invoice payments?|payables?)\b/.test(positive);
  if(["budget-and-forecast","management-reporting"].includes(sourceId))
    return /\b(budgets?|budgeting|financial|accounting|general ledger|profit and loss|p&l|balance sheet|cash flow)\b/.test(positive)||
      /\b(forecasts?|forecasting)\b.{0,60}\b(revenue|costs?|expenses?|financial actuals|dollars?|eur|usd)\b/.test(positive);
  return true;
}
