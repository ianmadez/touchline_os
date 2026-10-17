import type { ReactElement } from "react";
import type { IconProps } from "@/components/ui/icons";
import {
  IconCalendar,
  IconNote,
  IconPerson,
  IconSliders,
  IconTable,
  IconUserEntry,
  IconWallet,
  IconWhistle,
} from "@/components/ui/icons";
import type { AppTab } from "@/lib/session";

/**
 * One list of top-level tabs, shared by the desktop bar and the phone's bottom bar.
 *
 * Before this existed the list lived inside `Navbar`, so the only way to add a phone bar was to
 * repeat it, and the two would have drifted. The labels are the ones the desktop bar already uses;
 * `shortLabel` is only a reminder for the phone, which has room for about eight characters.
 */
export interface AppTabItem {
  id: AppTab;
  label: string;
  shortLabel: string;
  icon: (props: IconProps) => ReactElement;
}

export const APP_TAB_ITEMS: readonly AppTabItem[] = [
  // Setup is one-time: the portal disappears once a career exists.
  { id: "PORTAL", label: "Portal", shortLabel: "Setup", icon: IconUserEntry },
  { id: "DASHBOARD", label: "Dashboard", shortLabel: "Home", icon: IconTable },
  { id: "SEASON", label: "Season", shortLabel: "Season", icon: IconCalendar },
  { id: "DEBRIEF", label: "Debrief", shortLabel: "Debrief", icon: IconNote },
  { id: "SQUAD", label: "Squad", shortLabel: "Squad", icon: IconPerson },
  { id: "TACTICS", label: "Tactics", shortLabel: "Tactics", icon: IconWhistle },
  { id: "FINANCE", label: "Finances", shortLabel: "Money", icon: IconWallet },
  { id: "SETTINGS", label: "Settings", shortLabel: "Settings", icon: IconSliders },
] as const;

/**
 * The four tabs that get a permanent place in the bottom bar: the daily loop of checking the hub,
 * the season, logging a match and looking at the squad. Everything else lives behind More.
 */
export const PRIMARY_TAB_IDS: readonly AppTab[] = ["DASHBOARD", "SEASON", "DEBRIEF", "SQUAD"] as const;

export function appTabsFor(onboardingComplete: boolean): AppTabItem[] {
  return APP_TAB_ITEMS.filter((tab) => !onboardingComplete || tab.id !== "PORTAL");
}
