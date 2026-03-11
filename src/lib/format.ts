const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCurrency(cents: number): string {
  return usdFormatter.format(Math.abs(cents) / 100);
}

/*
 * Accounting convention: negative values use parentheses, e.g. ($1,234.56)
 */
export function formatAccountingCurrency(cents: number): string {
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainingCents = abs % 100;
  const dollarsFormatted = dollars.toLocaleString("en-US");
  const result = `$${dollarsFormatted}.${String(remainingCents).padStart(2, "0")}`;
  return isNegative ? `(${result})` : result;
}
