"use client";

import React, { useMemo, useState } from "react";
import type { EnrichedPlayer } from "@/lib/services/squad-service";
import { SubTabs, type SubTabOption } from "@/components/ui/sub-tabs";
import { ScoutingMemoryPanel } from "@/components/ui/squad/scouting-memory-panel";
import { IconSearch } from "@/components/ui/icons";
import { SquadTable } from "./squad-table";
import { ScoutSearch } from "./scout-search";
import { TransferDesk } from "./transfer-desk";
import { YouthAcademyPanel } from "./youth-academy-panel";

/**
 * The Squad section.
 *
 * Squad is what you have; scouting is what you are looking at; transfers is what acting on it costs.
 * They sit together because a manager moves between the three in one thought, and because the
 * scouting board and the transfers desk are two views of the same shortlist rather than two lists.
 */
type SquadSubTab = "SQUAD" | "SCOUTING" | "TRANSFERS" | "YOUTH";

const SUB_TABS: ReadonlyArray<SubTabOption<SquadSubTab>> = [
  { id: "SQUAD", label: "Squad" },
  { id: "SCOUTING", label: "Scouting" },
  { id: "TRANSFERS", label: "Transfers" },
  { id: "YOUTH", label: "Youth" },
];

/** The box narrows the squad list, the scouting board and the academy. */
const SEARCH_PLACEHOLDERS: Record<Exclude<SquadSubTab, "TRANSFERS">, string> = {
  SQUAD: "Search your squad by name or position",
  SCOUTING: "Search the board by name, club or position",
  YOUTH: "Search academy prospects by name or position",
};

export function SquadView({
  careerId,
  players,
  onSelectPlayer,
  currencySymbol = "£",
}: {
  careerId: string | null;
  players: EnrichedPlayer[];
  onSelectPlayer: (player: EnrichedPlayer) => void;
  currencySymbol?: string;
}) {
  const [subTab, setSubTab] = useState<SquadSubTab>("SQUAD");
  const [query, setQuery] = useState("");

  // The search lives up here, opposite the tabs, rather than inside one of them. It holds its place
  // as you move between the three, and each tab reads the same needle - so narrowing to a name on
  // the squad list and then switching to the board does not silently start from scratch.
  const visiblePlayers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return players;
    return players.filter((player) =>
      [player.name, player.primaryPosition]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    );
  }, [players, query]);

  return (
    <div className="space-y-6">
      <SubTabs
        tabs={SUB_TABS}
        active={subTab}
        onChange={setSubTab}
        action={
          // No box on the transfers desk: nothing there is a list of players to filter, so the
          // field could be typed into and would never change a thing on screen.
          subTab === "TRANSFERS" ? undefined : (
            <label className="relative w-full sm:w-72">
              <span className="sr-only">Search</span>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={SEARCH_PLACEHOLDERS[subTab]}
                className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-xs text-slate-900 focus:border-[#E11D48] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </label>
          )
        }
      />

      {subTab === "SQUAD" && (
        <>
          {query.trim() !== "" && (
            <p className="font-sub text-[10px] uppercase tracking-wider text-slate-400 tabular-nums">
              {visiblePlayers.length} of {players.length} players match
            </p>
          )}
          <SquadTable players={visiblePlayers} onSelectPlayer={onSelectPlayer} />
        </>
      )}

      {subTab === "SCOUTING" &&
        (careerId ? (
          <>
            <ScoutSearch careerId={careerId} query={query} />
            <ScoutingMemoryPanel careerId={careerId} />
          </>
        ) : (
          <NeedsCareer body="Sync a career from the Portal to search the players in your save." />
        ))}

      {subTab === "TRANSFERS" &&
        (careerId ? (
          <TransferDesk careerId={careerId} currencySymbol={currencySymbol} />
        ) : (
          <NeedsCareer body="Sync a career from the Portal to see what your shortlist costs." />
        ))}

      {/* The academy reads the SAVE's own academy table, not the squad filtered by age. A prospect
          filtered out by the squad box would look like a missing player, and a 15-year-old is not in
          the squad at all, so the squad list could never have shown him. */}
      {subTab === "YOUTH" &&
        (careerId ? (
          <YouthAcademyPanel careerId={careerId} query={query} />
        ) : (
          <NeedsCareer body="Sync a career from the Portal to see your academy." />
        ))}
    </div>
  );
}

function NeedsCareer({ body }: { body: string }) {
  return (
    <p className="rounded-2xl border border-slate-200 bg-white p-6 font-sans text-xs text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
      {body}
    </p>
  );
}
