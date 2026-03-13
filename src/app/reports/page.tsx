import { getTrialBalance } from "@/agents/reporting";
import { db } from "@/db/index";
import ReportsClient from "./reports-client";

export default function ReportsPage() {
  let initialTrialBalance = null;
  try {
    initialTrialBalance = getTrialBalance(db);
  } catch {
    // Trial balance may fail if no journal entries exist yet.
    // The client component will fetch on demand with proper error handling.
  }

  return <ReportsClient initialTrialBalance={initialTrialBalance} />;
}
