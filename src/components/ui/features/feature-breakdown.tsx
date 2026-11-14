"use client";

import React, { useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { applyThemeClass, patchSession } from "@/lib/session";
import { LandingFooter } from "../landing/landing-footer";
import { LegalDocType, LegalModal } from "../landing/legal-modal";

/**
 * Whether the page is currently dark, read from the class the theme bootstrap script puts on <html>.
 *
 * Subscribed to rather than copied into state, so the toggle's icon is right on first paint and stays
 * in step if anything else flips the theme, with no setState inside an effect.
 */
function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const readDark = () => document.documentElement.classList.contains("dark");
const readDarkOnServer = () => false;

interface Shot {
  src: string;
  alt: string;
  width: number;
  height: number;
}

interface Feature {
  title: string;
  body: string;
  /** One line on what makes it worth having. Left off where the body already says it. */
  edge?: string;
  shot?: Shot;
  /** Takes the full width of the section, for wide screenshots that would be unreadable at half. */
  wide?: boolean;
}

interface Section {
  id: string;
  label: string;
  title: string;
  intro: string;
  features: Feature[];
}

const shot = (name: string, alt: string, width: number, height: number): Shot => ({
  src: `/features/${name}.png`,
  alt,
  width,
  height,
});

const SECTIONS: Section[] = [
  {
    id: "dashboard",
    label: "01 · Dashboard",
    title: "The Dashboard",
    intro:
      "The first screen you see when you walk in. It tells you what needs sorting, what the papers are saying, and what has changed since your last sync.",
    features: [
      {
        title: "Club News",
        body: "A newspaper about your club, written from what you log: match reports, the verdict after a bad run, opinion columns and player focus pieces. Headlines use your real scorelines, scorers and standouts, and the paper notices patterns, like the same weakness turning up three games running. Keep the stories you like and bin the rest. It holds the latest 30.",
        edge: "Every story is built from your debriefs and your save, so it never reports a result that didn't happen.",
        shot: shot("paper", "Club News front page with a top story, opinion columns and match reports", 1240, 805),
        wide: true,
      },
      {
        title: "What Matters Right Now",
        body: "Storylines open when something in your save needs a decision: a contract with a year left, a position down to one senior player, a board objective still open. Each one shows how many facts it rests on, opens the evidence behind it, and takes you straight to the screen where you deal with it.",
        edge: "Threads keep gathering evidence across syncs and debriefs, and close when you act, by tying the player down or signing cover.",
      },
      {
        title: "Sync On Launch",
        body: "Open the app and it reads your newest save, takes a snapshot and tells you what moved since the last one: arrivals, departures, contract changes. Prefer to sync when you choose? Switch it to manual in Settings.",
      },
    ],
  },
  {
    id: "season",
    label: "02 · Season",
    title: "The Campaign Hub",
    intro:
      "Everything about the season you are in and the ones behind you: the record, what the board wants, how the rest of the football world is getting on, and a vault for every finished campaign.",
    features: [
      {
        title: "Managerial Record",
        body: "Every season the save holds, oldest first: division, played, won-drawn-lost, goals, points and where you finished, with the current campaign marked in progress. The totals cover every competition, and the table says so instead of passing them off as league form.",
        shot: shot("record", "Managerial record table across three seasons", 1212, 323),
        wide: true,
      },
      {
        title: "Season Outlook",
        body: "Points per match, goal difference and your own objective sit beside the board's objective from the save, and the two are never merged. The save's league-position field can't be trusted, so you confirm your place a few times and after three readings it works it out on its own.",
      },
      {
        title: "Honours",
        body: "A trophy shelf for your division and every cup open to you. League titles fill in from the save by themselves. Cups you record yourself, because the save keeps no cup results. Switch to the whole country to see every trophy on offer.",
        shot: shot("honours", "Honours shelf with the Championship, FA Cup, EFL Cup and European trophies", 1212, 788),
      },
      {
        title: "Board Objectives",
        body: "Write down what the board handed you, set the priority they gave it, and mark each one on track, at risk, achieved or failed. The one they weigh heaviest goes to the top, so you always know which promise matters most in the boardroom.",
        shot: shot("board", "Board objectives with status counts and the heaviest objective flagged", 1240, 640),
      },
      {
        title: "Around The Divisions",
        body: "Full league tables for every other division in the save, as of your last sync. Keep an eye on the league below before a relegation scrap, or on who is chasing the European places abroad. Your own league isn't stored in full, so your place there comes from your debriefs.",
        shot: shot("divisions", "League table for another division read from the save", 1240, 560),
        wide: true,
      },
      {
        title: "Season Vault",
        body: "When a season ends, the vault reads it back: the record, objectives against outcomes, how the shape changed, who kept turning up in your notes, the academy and the money. Each card is tagged as coming from your save or from your notes, and you choose what carries into next season.",
        shot: shot("vault", "Season vault read-back with record, objectives, squad and money cards", 1212, 909),
        wide: true,
      },
      {
        title: "Head To Head",
        body: "Every meeting you've written up against each club, across all competitions: played, won, drawn, lost, goals, best win and unbeaten run. Bogey sides show up quickly.",
        shot: shot("h2h", "Head to head record against five clubs", 1240, 470),
        wide: true,
      },
    ],
  },
  {
    id: "debrief",
    label: "03 · Debrief",
    title: "Match Debriefs",
    intro:
      "Where you write the match up. Do it straight after the final whistle while it's fresh, or plan five fixtures at a time and report back when they're played.",
    features: [
      {
        title: "Log A Match",
        body: "Pick the opponent from your league, then fill in the table at kick-off, the scoreline and venue, when the goals went in, the shape you played and how closely the side stuck to the plan. Add scorers and assists, choose your standouts and note any weakness you spotted. Every match stays on the list beside the form, and you can star the ones worth remembering.",
        shot: shot("debrief-list", "List of logged debriefs with results and standouts", 368, 803),
      },
      {
        title: "Match Figures",
        body: "Optional, but the more you fill in, the more it tells you. Shots, shots in the box, xG, possession and passes turn into shot quality, finishing against xG and a clean-sheet record. If the numbers say you got lucky, it tells you, and the flag clears once a result goes your way.",
        shot: shot("figures", "Match figures form with shot quality and finishing worked out", 710, 397),
      },
      {
        title: "Match Facts Scan",
        body: "Screenshot the Match Facts screen after the game and drop it in. The reader pulls the numbers off the summary and fills the boxes for you to check before anything is saved. It runs on your machine, up to eight images at a time, and nothing is uploaded.",
        shot: shot("scan", "Screenshot reader for the Match Facts screen", 710, 555),
      },
      {
        title: "The Press",
        body: "Now and then a reporter wants a word after the match. Give them a quote and it runs in the paper under your name. Say no comment and the paper reports that too.",
        shot: shot("press", "A reporter's question with space for the manager's answer", 1152, 256),
      },
      {
        title: "Questions That Follow Your Form",
        body: "The follow-up questions change with your results. Leaking goals, a drought up front, a hammering, a player on a hot streak, an old weakness coming back: it only asks about what actually stood out.",
      },
      {
        title: "Group Debrief",
        body: "Set the points you want from each of your next five fixtures, a target band for the run, a dream total and the figure that would worry you. Report the scorelines back as they come in and you get the tally, the record and the goals, with your notes on every game.",
        shot: shot("block", "Five fixtures with targets, results and the points tally", 1152, 811),
        wide: true,
      },
      {
        title: "Review",
        body: "Reads a run of matches three ways: the scorelines, the figures behind them and what else might explain both. It picks out the key contrast, says how solid each finding is, and offers one thing to take into the next fixtures: a points target, a check to run again later, or a question to keep tracking. You take it or drop it.",
        edge: "Two results in a row aren't dressed up as a trend. Each finding says how much evidence is behind it.",
        shot: shot("review", "Review of five matches with findings and suggestions", 1152, 551),
        wide: true,
      },
    ],
  },
  {
    id: "squad",
    label: "04 · Squad",
    title: "Squad, Scouting & Academy",
    intro:
      "Your squad as the save has it, plus your own read on every player, the scouting operation, the transfer plan and the kids coming through.",
    features: [
      {
        title: "The Squad List",
        body: "Every senior player with position, overall, potential, age and fitness from the save, and faces for real players. Filter to the injured, the youngsters, the untouchables or the surplus, or switch to match stats to see what each player has done in the games you've logged.",
      },
      {
        title: "Manager's Assessment",
        body: "Flip any player's dossier and give your own verdict: override his position, mark him unavailable, give him a tactical role, set how far you trust him and where he sits in your plans, from untouchable to surplus. It's your call, and a re-sync never overwrites it.",
        shot: shot("assessment", "Manager's notebook side of a player dossier", 448, 620),
      },
      {
        title: "Your Shortlist",
        body: "Pin anyone from the scouting search and they land on your shortlist with rating, club, age and position already filled in. Move them through the stages, set a priority, and write down what you think of them and who else is sniffing around.",
        shot: shot("shortlist", "Shortlist of four pinned targets with stages and priorities", 808, 689),
      },
      {
        title: "Scouting Memory",
        body: "Turn a target down and record why, too expensive for example. The list then tells you when he's worth another look, like when similar players start going for less. Players knocked back for their age never come back, because nobody gets younger.",
        shot: shot("memory", "Scouting memory for targets set aside", 1216, 209),
        wide: true,
      },
      {
        title: "Transfers",
        body: "What signing your shortlist would cost against the budget you set, and what's left if you get every one of them over the line. Deals are done in the game, and you mark a player signed here afterwards.",
        shot: shot("transfers", "Transfer budget against shortlist commitment", 1240, 420),
        wide: true,
      },
      {
        title: "Youth Academy",
        body: "Every prospect with current ability, potential, scout tier, rating swing and time in the academy. When your scouts' reports disagree, you see the range instead of one report picked at random. Regens the save leaves nameless can be given a name, and it sticks for the whole career.",
        shot: shot("academy", "Academy prospects with ability, potential and scout tier", 1240, 520),
        wide: true,
      },
    ],
  },
  {
    id: "tactics",
    label: "05 · Tactics",
    title: "Tactics",
    intro: "The landing page shows the pitch. Here is what sits around it.",
    features: [
      {
        title: "Saved Formations",
        body: "Keep more than one shape: your first-choice XI, a cup side, a back three for when you're chasing a game. Name them, rename them, choose from 33 formations and fill each slot from a bench you can sort.",
      },
      {
        title: "Shape Changes Count",
        body: "Moving a player or changing a role is logged as an event. Your debriefs use the current shape by default, and the vault uses the shapes you recorded to show how your tactics changed across a season.",
      },
    ],
  },
  {
    id: "finances",
    label: "06 · Finances",
    title: "Finances",
    intro:
      "The money side, with every figure labelled: read from the save, worked out by TouchlineOS, or entered by you.",
    features: [
      {
        title: "Wage Health",
        body: "A banner at the top tells you whether the wage bill sits inside a safe share of turnover for your level. The warning line moves with your realism setting, and your transfer and wage budgets are yours to set because the save doesn't store them.",
      },
      {
        title: "Contract Commitment",
        body: "What you've already committed in wages for this season and the next two, from each player's contract end date, as a share of what a club at your level brings in. It only counts contracts the save shows, so treat it as the minimum.",
        shot: shot("commitment", "Wage commitment for the next three seasons", 1024, 262),
        wide: true,
      },
      {
        title: "Transfer Ledger",
        body: "Every deal your club is part of, with the fee the save recorded and two dates: when it was agreed and when the player actually moves, which is often the next window. Loans carry the wage split. Add anything the game never wrote down, and each row says whose figure it is.",
        shot: shot("ledger", "Transfer ledger with fees, dates and completion status", 1024, 530),
        wide: true,
      },
      {
        title: "League Rules",
        body: "Your country's financial rules, like the Championship's loss limit, alongside checks against your own transfer and wage budgets. Put realism on strict and they're judged against your numbers. Otherwise they sit there for reference.",
        shot: shot("rules", "League rules with the Championship sustainability limit", 1024, 556),
        wide: true,
      },
    ],
  },
  {
    id: "settings",
    label: "07 · Settings",
    title: "Settings & Your Data",
    intro: "How the app behaves, how ambitious it lets you be, and the full history of the career.",
    features: [
      {
        title: "Career Timeline",
        body: "Every event in the career in plain sentences, newest first: debriefs logged, seasons finished, storylines opened, the day you started. Filter by type, and every entry says where it came from.",
        shot: shot("timeline", "Career timeline filtered by event type", 768, 560),
      },
      {
        title: "Realism & Playstyle",
        body: "Realism runs from Chaos to Strict and decides how ambitious your targets can be and whether league rules are enforced. Playstyle sets the job you've given yourself: Moneyball, youth only, young signings, forgotten legends, veterans, or no limits beyond your own. Currency and weekly or annual wages are in here too.",
      },
      {
        title: "Your Data, Your Copy",
        body: "Export the whole career to a file and import it again whenever you need to. Snapshots are kept forever, so your history never thins out. The guided tours can be replayed, and a full reset is there if you want a fresh start.",
      },
    ],
  },
];

export function FeatureBreakdown() {
  const dark = useSyncExternalStore(subscribeToTheme, readDark, readDarkOnServer);
  const [legalDoc, setLegalDoc] = useState<LegalDocType | null>(null);

  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    patchSession({ theme: next });
    applyThemeClass(next);
  };

  return (
    <main className="min-h-dvh relative flex flex-col">
      {/* The same stadium backdrop as the landing page, so this reads as a page of the same site. */}
      <div className="fixed inset-0 bg-[url('/stadium-bg.jpg')] bg-cover bg-center opacity-30 dark:opacity-15 pointer-events-none" />

      <header className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/85 backdrop-blur-md px-4 py-3 max-md:px-3 text-slate-900 dark:text-white">
        <Link href="/" aria-label="TouchlineOS home" className="flex items-center gap-2 shrink-0">
          <span className="font-heading text-base sm:text-lg lg:text-xl tracking-wider">
            TOUCHLINE<span className="text-[#E11D48] dark:text-[#FF8C7A]">OS</span>
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/"
            className="hidden sm:inline-flex min-h-10 items-center rounded-xl px-3 font-sub text-xs font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            ← Back To Home
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle Light/Dark Theme"
            className="inline-flex items-center justify-center min-h-10 min-w-10 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-slate-600 transition-colors cursor-pointer"
          >
            {dark ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#E11D48] px-4 py-2 text-white font-heading text-xs font-bold uppercase shadow-md transition-[background-color,box-shadow,transform] duration-200 hover:scale-102 hover:bg-[#FF8C7A] active:scale-[0.96] max-md:min-h-10 max-md:px-3 max-md:py-0 max-md:text-[10px] max-md:tracking-wide"
          >
            <span>Open TouchlineOS</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      <div className="relative w-full max-w-6xl mx-auto px-4 py-12 sm:py-16 space-y-10 sm:space-y-12">
        {/* Intro */}
        <section className="text-center max-w-3xl mx-auto space-y-4">
          <span className="font-sub text-xs text-[#E11D48] dark:text-[#FF8C7A] uppercase tracking-widest font-bold block">
            Full Feature Breakdown
          </span>
          <h1 className="font-heading text-3xl sm:text-5xl text-slate-900 dark:text-slate-100 uppercase leading-tight">
            Every Screen, <span className="text-[#E11D48]">Every Feature</span>
          </h1>
          <p className="font-sans text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl mx-auto">
            The landing page shows the headline acts. This is the rest of the squad: what each screen in
            TouchlineOS does and why it&apos;s worth opening. Every screenshot comes from a real FC 25 career,
            three seasons into a job at Wigan Athletic.
          </p>
          <nav aria-label="Sections on this page" className="flex flex-wrap justify-center gap-x-5 gap-y-2 pt-2 font-sub text-xs uppercase tracking-widest font-semibold text-slate-600 dark:text-slate-300">
            {SECTIONS.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="hover:text-[#E11D48] dark:hover:text-[#FF8C7A] transition-colors">
                {section.label.split(" · ")[1]}
              </a>
            ))}
          </nav>
          <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Phone pairing and the save bridge are covered on the landing page:{" "}
            <Link href="/#phone" className="text-[#E11D48] dark:text-[#FF8C7A] hover:underline">
              your career on your phone
            </Link>{" "}
            and the{" "}
            <Link href="/#faq" className="text-[#E11D48] dark:text-[#FF8C7A] hover:underline">
              FAQ
            </Link>
            .
          </p>
        </section>

        {SECTIONS.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="scroll-mt-24 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-10 shadow-xl"
          >
            <div className="max-w-2xl mb-8">
              <span className="font-sub text-xs text-[#E11D48] dark:text-[#FF8C7A] uppercase tracking-widest font-bold block mb-1">
                {section.label}
              </span>
              <h2 className="font-heading text-2xl sm:text-4xl text-slate-900 dark:text-slate-100 uppercase">
                {section.title}
              </h2>
              <p className="font-sans text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-3 leading-relaxed">
                {section.intro}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {section.features.map((feature) => (
                <article
                  key={feature.title}
                  className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-5 flex flex-col gap-4 hover:border-rose-300 dark:hover:border-rose-500/60 transition-colors ${
                    feature.wide ? "md:col-span-2" : ""
                  }`}
                >
                  <div className="space-y-2">
                    <h3 className="font-heading text-base sm:text-lg text-slate-900 dark:text-slate-100 uppercase">
                      {feature.title}
                    </h3>
                    <p className="font-sans text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      {feature.body}
                    </p>
                    {feature.edge && (
                      <p className="font-sans text-xs text-slate-700 dark:text-slate-200 leading-relaxed border-l-2 border-[#E11D48] pl-3">
                        {feature.edge}
                      </p>
                    )}
                  </div>
                  {feature.shot && (
                    <div className="mt-auto rounded-2xl bg-slate-200/60 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 overflow-hidden flex items-center justify-center p-2 sm:p-3">
                      <Image
                        src={feature.shot.src}
                        alt={feature.shot.alt}
                        width={feature.shot.width}
                        height={feature.shot.height}
                        sizes={feature.wide ? "(min-width: 1152px) 1050px, 100vw" : "(min-width: 768px) 520px, 100vw"}
                        className={`w-auto h-auto max-w-full rounded-xl object-contain ${
                          feature.wide ? "" : "md:max-h-[620px]"
                        }`}
                      />
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}

        {/* Same closing banner as the landing page. */}
        <section className="bg-gradient-to-r from-slate-900 to-slate-950 text-white rounded-3xl p-8 sm:p-12 text-center shadow-2xl relative overflow-hidden">
          <h2 className="font-heading text-2xl sm:text-4xl uppercase tracking-wide mb-3">Bring Your Save In</h2>
          <p className="font-sans text-slate-300 text-sm max-w-lg mx-auto mb-6 leading-relaxed">
            Point it at the career you are already playing. First read takes a minute, and the history starts
            from there.
          </p>
          <Link
            href="/"
            className="inline-block px-8 py-3.5 bg-[#E11D48] hover:bg-[#FF8C7A] text-white font-heading text-sm font-bold uppercase rounded-xl transition-[background-color,transform,box-shadow] duration-200 shadow-lg hover:scale-[1.02] active:scale-[0.96]"
          >
            Enter TouchlineOS →
          </Link>
        </section>
      </div>

      <LandingFooter onOpenLegal={(doc) => setLegalDoc(doc)} />
      <LegalModal activeDoc={legalDoc} onClose={() => setLegalDoc(null)} />
    </main>
  );
}
