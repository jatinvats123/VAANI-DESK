import { Badge, Card, PageHeader } from "@/components/ui";
import {
  AgentConfigEditor,
  HoursEditor,
  PolicyEditor,
  ServicesEditor,
} from "@/components/settings-editors";
import { getBusiness, listServices } from "@/lib/data";
import { formatPaiseINR } from "@/lib/format";
import { requireBusiness } from "@/lib/session";

export const metadata = { title: "Settings" };

/**
 * Owners edit everything inline (the api enforces the role again — this gate
 * is UX, not security). Staff get the read-only view.
 */
export default async function SettingsPage() {
  const { business } = await requireBusiness();
  const [{ business: full }, { services }] = await Promise.all([
    getBusiness(business.id),
    listServices(business.id, true),
  ]);
  const isOwner = business.role === "owner";

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={
          isOwner
            ? `How Vaani answers for ${full.name}. Changes apply to the very next call.`
            : `How Vaani answers for ${full.name}. Ask the owner to change these.`
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-ink">Business</h2>
          <dl className="space-y-3 text-sm">
            <SettingRow label="Name" value={full.name} />
            <SettingRow
              label="VaaniDesk number"
              value={full.phoneNumber ?? "Not provisioned yet"}
            />
            <SettingRow label="Timezone" value={full.timezone} />
          </dl>
          {isOwner ? (
            <div className="mt-5 border-t border-border pt-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Booking policy
              </h3>
              <PolicyEditor business={full} />
            </div>
          ) : (
            <dl className="mt-3 space-y-3 text-sm">
              <SettingRow
                label="Booking policy"
                value={`${full.policy.slotGranularityMin}min slots · ${full.policy.minNoticeMin}min notice · ${full.policy.maxAdvanceDays}d ahead`}
              />
            </dl>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-ink">Opening hours</h2>
          {isOwner ? (
            <HoursEditor business={full} />
          ) : (
            <dl className="space-y-2 text-sm">
              {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((day) => {
                const intervals = full.hours.weekly[day];
                return (
                  <div key={day} className="flex items-center justify-between">
                    <dt className="capitalize text-ink-muted">{day}</dt>
                    <dd className="tabular-nums text-ink">
                      {intervals.length === 0
                        ? "Closed"
                        : intervals.map((i) => `${i.open}–${i.close}`).join(", ")}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-display text-sm font-semibold text-ink">Services</h2>
          {isOwner ? (
            <ServicesEditor businessId={business.id} services={services} />
          ) : (
            <ul className="divide-y divide-border">
              {services.map((service) => (
                <li key={service.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="flex-1 font-medium text-ink">{service.name}</span>
                  <span className="tabular-nums text-ink-muted">{service.durationMin} min</span>
                  <span className="w-20 text-right tabular-nums text-ink">
                    {formatPaiseINR(service.pricePaise)}
                  </span>
                  {service.active ? (
                    <Badge tone="positive">Active</Badge>
                  ) : (
                    <Badge tone="neutral">Hidden</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-display text-sm font-semibold text-ink">How Vaani speaks</h2>
          {isOwner ? (
            <AgentConfigEditor business={full} />
          ) : (
            <dl className="space-y-3 text-sm">
              <SettingRow label="Language" value={full.promptConfig.primaryLanguage} />
              <SettingRow label="FAQs configured" value={String(full.promptConfig.faqs.length)} />
              <SettingRow label="Transfer number" value={full.ownerPhone ?? "Not set"} />
            </dl>
          )}
        </Card>
      </div>
    </>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="truncate text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
