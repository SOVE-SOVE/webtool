import { redirect } from "next/navigation";

/**
 * The pipeline board is now the "Board" view of the Leads view inside
 * the Sales workspace (same stage columns, same drag-to-restage). This
 * route is kept — not deleted — so old links and bookmarks still land
 * in the right place.
 */
export default function PipelineRedirect() {
  redirect("/dashboard/sales/leads?view=board");
}
