import type { Metadata } from "next";
import { FeatureBreakdown } from "@/components/ui/features/feature-breakdown";

export const metadata: Metadata = {
  title: "Full Feature Breakdown | TouchlineOS",
  description:
    "Every screen in TouchlineOS and what it does: the dashboard, campaign hub, debriefs, squad, tactics, finances and settings.",
};

/**
 * The long-form companion to the landing page's feature grid.
 *
 * A route of its own rather than a state inside `app/page.tsx`: it has a URL that can be shared and
 * linked to, and it needs none of the career state the single-page app carries, so it renders the
 * same in the local build and in the static browser export.
 */
export default function FeaturesPage() {
  return <FeatureBreakdown />;
}
