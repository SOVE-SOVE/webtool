import { redirect } from "next/navigation";

/**
 * A client is a lead that converted — the list of them is now the "Won"
 * tab of the Leads page (with a link through to each client record and
 * its project). This route is kept, not deleted, so old links still
 * resolve. `/dashboard/clients/[id]` (the client detail page) is
 * unchanged and still the place to edit billing/contract and start
 * intake.
 */
export default function ClientsRedirect() {
  redirect("/dashboard/leads?tab=won");
}
