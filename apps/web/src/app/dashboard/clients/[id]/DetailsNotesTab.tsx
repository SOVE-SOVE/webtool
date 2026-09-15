"use client";

import type { Business, BusinessUpdate, Client, ClientUpdate, User } from "@/lib/api";
import { AutoSaveInput } from "@/components/ui/AutoSaveInput";
import { AutoSaveTextarea } from "@/components/ui/AutoSaveTextarea";

function field(label: string, value: React.ReactNode) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  );
}

// Client.contract_signed_at is a full timestamp; <input type="date"> needs
// just the date portion, and round-trips back out as UTC midnight.
function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function DetailsNotesTab({
  clientRecord,
  business,
  users,
  saveClient,
  saveBusiness,
}: {
  clientRecord: Client;
  business: Business;
  users: User[];
  saveClient: (data: ClientUpdate) => Promise<void>;
  saveBusiness: (data: BusinessUpdate) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold text-fg">Business</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field(
              "Name",
              <AutoSaveInput
                key={`${business.id}-name`}
                defaultValue={business.name}
                onSave={(v) => saveBusiness({ name: v })}
              />,
            )}
            {field(
              "Industry",
              <AutoSaveInput
                key={`${business.id}-industry`}
                defaultValue={business.industry ?? ""}
                onSave={(v) => saveBusiness({ industry: v })}
              />,
            )}
            {field(
              "Website",
              <AutoSaveInput
                key={`${business.id}-website`}
                defaultValue={business.website_url ?? ""}
                onSave={(v) => saveBusiness({ website_url: v })}
              />,
            )}
            {field(
              "Phone",
              <AutoSaveInput
                key={`${business.id}-phone`}
                defaultValue={business.phone ?? ""}
                onSave={(v) => saveBusiness({ phone: v })}
              />,
            )}
            {field(
              "Email",
              <AutoSaveInput
                key={`${business.id}-email`}
                defaultValue={business.email ?? ""}
                onSave={(v) => saveBusiness({ email: v })}
              />,
            )}
            {field(
              "Location",
              <div className="flex gap-2">
                <AutoSaveInput
                  key={`${business.id}-suburb`}
                  defaultValue={business.suburb ?? ""}
                  placeholder="Suburb"
                  onSave={(v) => saveBusiness({ suburb: v })}
                />
                <AutoSaveInput
                  key={`${business.id}-state`}
                  defaultValue={business.state ?? ""}
                  placeholder="State"
                  onSave={(v) => saveBusiness({ state: v })}
                />
              </div>,
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-fg">Client</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field(
              "Billing email",
              <AutoSaveInput
                key={`${clientRecord.id}-billing-email`}
                defaultValue={clientRecord.billing_email ?? ""}
                onSave={(v) => saveClient({ billing_email: v || null })}
              />,
            )}
            {field(
              "Contract signed",
              <input
                type="date"
                defaultValue={toDateInputValue(clientRecord.contract_signed_at)}
                onBlur={(e) =>
                  saveClient({ contract_signed_at: e.target.value ? new Date(e.target.value).toISOString() : null })
                }
                className="input"
              />,
            )}
            {field(
              "Assigned to",
              <select
                value={clientRecord.assigned_user_id ?? ""}
                onChange={(e) => saveClient({ assigned_user_id: e.target.value || null })}
                className="input"
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "Client since",
              <span className="text-sm text-fg-muted">{new Date(clientRecord.created_at).toLocaleDateString()}</span>,
            )}
          </div>
        </section>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-fg">Internal notes</h2>
        <div className="mt-3">
          <AutoSaveTextarea
            key={`${business.id}-notes`}
            defaultValue={business.notes ?? ""}
            rows={6}
            onSave={(v) => saveBusiness({ notes: v })}
          />
        </div>
      </section>
    </div>
  );
}
