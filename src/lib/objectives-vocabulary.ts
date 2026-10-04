/**
 * The five board expectation categories, and the objectives the game actually hands out.
 *
 * Deliberately dependency-free like `settings-vocabulary`: the panel is a client component and the
 * service opens SQLite, so the shared vocabulary lives here where the browser can import it without
 * pulling the native driver in.
 *
 * The catalogue is a SUGGESTION LIST, not a constraint. It exists so the manager can record what he
 * was given in two clicks instead of retyping it, and because the save carries only a numeric
 * objective code with no wording at all - so if the app does not offer the wording, nobody has it.
 * He can always type his own.
 */

export type ObjectiveCategory = "DOMESTIC" | "CONTINENTAL" | "BRAND" | "FINANCIAL" | "YOUTH";

export const OBJECTIVE_CATEGORIES: readonly ObjectiveCategory[] = [
  "DOMESTIC",
  "CONTINENTAL",
  "BRAND",
  "FINANCIAL",
  "YOUTH",
];

export const CATEGORY_LABELS: Record<ObjectiveCategory, string> = {
  DOMESTIC: "Domestic Success",
  CONTINENTAL: "Continental Success",
  BRAND: "Brand Exposure",
  FINANCIAL: "Financial",
  YOUTH: "Youth Development",
};

/** What each category is actually about, so the picker is understandable without the manual. */
export const CATEGORY_HINTS: Record<ObjectiveCategory, string> = {
  DOMESTIC: "Your home league and domestic cup.",
  CONTINENTAL: "Only if you are in, or can qualify for, a continental competition.",
  BRAND: "Commercial pull: reputation, exposure, signings that draw attention.",
  FINANCIAL: "Stability: wages, profit, staying inside the money you were given.",
  YOUTH: "Scouting, recruiting and bringing through academy players.",
};

/**
 * The five priorities the board uses. 1 is the most demanding: a critical objective that fails is
 * usually what ends a job, which is why the tracker sorts on it rather than on category.
 */
export const PRIORITY_LABELS: Record<number, string> = {
  1: "Critical",
  2: "Very high",
  3: "High",
  4: "Medium",
  5: "Low",
};

export const PRIORITY_ORDER: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Priorities are the manager's to set, not the app's. The game scales them by club size, financial
 * health and history, so guessing one from the objective text would be inventing a fact the save
 * never carried.
 */
export const DEFAULT_PRIORITY = 3;

export const OBJECTIVE_CATALOGUE: Record<ObjectiveCategory, readonly string[]> = {
  DOMESTIC: [
    "Win the league",
    "Finish in the top 4",
    "Finish in the top half",
    "Avoid relegation",
    "Win the domestic cup",
    "Reach the domestic cup final",
    "Reach the domestic cup semi-final",
    "Set a club record points total",
    "Achieve promotion",
  ],
  CONTINENTAL: [
    "Qualify for continental competition",
    "Reach the continental knockout rounds",
    "Reach the continental quarter-final",
    "Reach the continental semi-final",
    "Win a continental competition",
  ],
  BRAND: [
    "Grow the club's brand exposure",
    "Sign a player with a set reputation",
    "Increase shirt sales",
    "Raise the club's star rating",
    "Grow the club's social following",
    "Improve the club's league reputation",
  ],
  FINANCIAL: [
    "Keep the wage bill under control",
    "Make a profit this season",
    "Stay within the transfer budget",
    "Reduce the wage-to-turnover ratio",
    "Increase club revenue",
    "Avoid going into debt",
  ],
  YOUTH: [
    "Promote a youth player to the first team",
    "Give youth players a set number of appearances",
    "Sign young players with high potential",
    "Improve the youth academy",
    "Develop a youth prospect into a first-team regular",
    "Sign a player under a set age",
  ],
};

export type ObjectiveStatus = "ON_TRACK" | "AT_RISK" | "ACHIEVED" | "FAILED";

export const OBJECTIVE_STATUSES: readonly ObjectiveStatus[] = [
  "ON_TRACK",
  "AT_RISK",
  "ACHIEVED",
  "FAILED",
];

export const STATUS_LABELS: Record<ObjectiveStatus, string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  ACHIEVED: "Achieved",
  FAILED: "Failed",
};

export const STATUS_STYLES: Record<ObjectiveStatus, string> = {
  ON_TRACK: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  AT_RISK: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  ACHIEVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  FAILED: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};
