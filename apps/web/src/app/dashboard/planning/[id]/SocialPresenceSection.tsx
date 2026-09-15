"use client";

import { api, type Planning, type SocialFieldSource, type UpdateSocialProfileRequest } from "@/lib/api";
import { AutoSaveInput } from "@/components/ui/AutoSaveInput";
import { AutoSaveTextarea } from "@/components/ui/AutoSaveTextarea";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const SOURCE_BADGE_TONE: Record<SocialFieldSource, BadgeTone> = {
  discovered_business: "muted",
  operator_entered: "success",
  meta_enrichment: "success",
};

function sourceLabel(platform: "Instagram" | "Facebook", source: SocialFieldSource | null): string {
  switch (source) {
    case "discovered_business":
      return `${platform} · Discovery search`;
    case "operator_entered":
      return "Confirmed by operator";
    case "meta_enrichment":
      return "Verified via Meta";
    default:
      return "Not on file";
  }
}

function SourceBadge({ platform, source }: { platform: "Instagram" | "Facebook"; source: SocialFieldSource | null }) {
  return <Badge tone={source ? SOURCE_BADGE_TONE[source] : "muted"}>{sourceLabel(platform, source)}</Badge>;
}

/**
 * Social Presence — Instagram/Facebook input for the website-plan agent
 * (docs/05_DECISIONS.md). Every value shown here is paired with where it
 * came from: Discovery's own Instagram-search results (never a live/
 * scraped fetch — see DiscoveredBusiness), or an operator's own entry.
 * Facebook has no automated source at all yet — operator-entered only,
 * until a real Meta enrichment integration exists. A profile image, when
 * present, is a reference link only: it is never copied, published, or
 * fed into the generated website — see the caption below it.
 */
export function SocialPresenceSection({ planning, onUpdated }: { planning: Planning; onUpdated: (p: Planning) => void }) {
  const social = planning.social_profile;

  async function save<K extends keyof UpdateSocialProfileRequest>(field: K, value: string) {
    onUpdated(
      await api.updateSocialProfile(planning.id, { [field]: value || null } as UpdateSocialProfileRequest)
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="card p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">Instagram</h3>
          <SourceBadge platform="Instagram" source={social.instagram_source} />
        </div>

        {social.instagram_profile_image_url && (
          <div className="mt-2 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={social.instagram_profile_image_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <p className="text-xs text-fg-subtle">Reference only — confirm rights before using on the generated website.</p>
          </div>
        )}

        <div className="mt-3 space-y-2">
          <div>
            <label className="text-xs font-medium text-fg-subtle">Handle</label>
            <AutoSaveInput
              defaultValue={social.instagram_handle ?? ""}
              placeholder="business_handle"
              onSave={(v) => save("instagram_handle", v)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-subtle">Profile URL</label>
            <AutoSaveInput
              defaultValue={social.instagram_profile_url ?? ""}
              placeholder="https://instagram.com/…"
              onSave={(v) => save("instagram_profile_url", v)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-subtle">Bio</label>
            <AutoSaveTextarea
              defaultValue={social.instagram_bio ?? ""}
              rows={2}
              onSave={(v) => save("instagram_bio", v)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-subtle">Bio link</label>
            <AutoSaveInput
              defaultValue={social.instagram_bio_link_url ?? ""}
              placeholder="https://…"
              onSave={(v) => save("instagram_bio_link_url", v)}
            />
          </div>
          {social.instagram_follower_count !== null && (
            <p className="text-xs text-fg-subtle">{social.instagram_follower_count.toLocaleString()} followers</p>
          )}
        </div>
      </div>

      <div className="card p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-fg">Facebook</h3>
          <SourceBadge platform="Facebook" source={social.facebook_source} />
        </div>
        <div className="mt-3 space-y-2">
          <div>
            <label className="text-xs font-medium text-fg-subtle">Page URL</label>
            <AutoSaveInput
              defaultValue={social.facebook_page_url ?? ""}
              placeholder="https://facebook.com/…"
              onSave={(v) => save("facebook_page_url", v)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-subtle">Page name</label>
            <AutoSaveInput
              defaultValue={social.facebook_page_name ?? ""}
              onSave={(v) => save("facebook_page_name", v)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-subtle">About</label>
            <AutoSaveTextarea
              defaultValue={social.facebook_bio ?? ""}
              rows={2}
              onSave={(v) => save("facebook_bio", v)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
