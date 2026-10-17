"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanFields } from "@/components/ui/debrief/scan-fields";
import { ScanOverlay } from "@/components/ui/debrief/scan-overlay";
import {
  type MatchStatDraft,
  type MatchStatKey,
  type StatSource,
} from "@/lib/ui/match-figures";import { matchStatLabel } from "@/lib/ui/labels";
import { admitImage, IMAGE_LIMITS, type TableRegion } from "@/lib/ocr/preprocess";
import { LOW_CONFIDENCE, shouldApply } from "@/lib/ocr/extract";
import { disposeOcrEngine, progressLabel } from "@/lib/ocr/engine";
import {
  crossScreenNotes,
  emptyFacts,
  factsAreEmpty,
  mergeScreenFacts,
  type MatchFacts,
} from "@/lib/ocr/facts";
import { defaultProfile, readableScreens, SCREENS } from "@/lib/ocr/layouts";
import type { BoxObservation } from "@/components/ui/debrief/scan-fields";
import type { DecodedImage } from "@/lib/ocr/read";

/**
 * The screenshot pane: choose a capture, read it, check the figures against the picture, keep what is right.
 *
 * This pane IS the review. There is no dialog, no focus trap and no second confirmation, because the figures
 * land in the same boxes the manual pane uses and the form's own Save button is still the only thing that
 * writes anything anywhere. A review step that could be skipped would be worse than no review step, and a
 * dialog over a form is exactly that.
 *
 * Everything heavy is behind the first click. `tesseract.js` and the whole read pipeline are pulled in by a
 * dynamic import inside `analyse`, so a manager who never scans never downloads a byte of it.
 *
 * Nothing leaves the machine. The engine, the language data and the wasm core are all served from this origin,
 * the pipeline makes no network call of its own, and the chosen files become object URLs that are revoked the
 * moment the image is removed or the pane unmounts.
 */

/** The file types a plain input offers. No File System Access API: the manager's browser does not need it. */
const ACCEPT = "image/png,image/jpeg,image/webp";

export interface ScanPanelProps {
  /** The figures as they stand, so the pane can obey the overwrite rule rather than its own. */
  draft: MatchStatDraft;
  /** Where each figure's current text came from. */
  sources: Record<MatchStatKey, StatSource>;
  /** The venue the manager chose, which is the strong side signal. */
  venue: "HOME" | "AWAY" | "NEUTRAL" | null;
  ourClub: string;
  opponent: string;
  /** Our goals from the scoreline, when there is one, for the cross-check. */
  goalsFor: number | null;
  /** Their goals, so a header that disagrees can be reported rather than written. */
  goalsAgainst: number | null;
  /** A figure the manager typed or corrected in this pane. */
  onChange: (key: MatchStatKey, value: string) => void;
  /** Figures a read produced, to be placed in their boxes and marked as read. */
  onApply: (values: Partial<Record<MatchStatKey, string>>, layoutId: string) => void;
  /** The screens' own figures, kept whole per screen, for the debrief to store with the match. */
  onFacts: (facts: MatchFacts) => void;
}

interface Chosen {
  id: string;
  name: string;
  file: File;
  url: string;
}

interface ReadNote {
  name: string;
  text: string;
}

/** The side a read settled on, and what a swap would mean. */
type SideChoice = "LEFT" | "RIGHT" | null;

/** Where the table sat in one image, so the highlight can be drawn on the manager's own picture. */
interface Geometry {
  index: number;
  width: number;
  height: number;
  region: TableRegion;
  scale: number;
}

export function ScanPanel({
  draft,
  sources,
  venue,
  ourClub,
  opponent,
  goalsFor,
  goalsAgainst,
  onChange,
  onApply,
  onFacts,
}: ScanPanelProps) {
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<{ label: string; fraction: number } | null>(null);
  const [refusals, setRefusals] = useState<string[]>([]);
  const [notes, setNotes] = useState<ReadNote[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [observations, setObservations] = useState<Map<MatchStatKey, BoxObservation>>(new Map());
  const [carried, setCarried] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** One line per screen that was read and refused, in the manager's own terms. */
  const [refused, setRefused] = useState<string[]>([]);
  /** The screens whose figures were kept, which is what makes the "kept with the match" line true. */
  const [kept, setKept] = useState<string[]>([]);
  /** Where two screens disagreed, which is reported and never a reason to drop either one. */
  const [disagreements, setDisagreements] = useState<string[]>([]);
  /** One line when the header's scoreline and the entered one disagree. Nothing is written while it is set. */
  const [scoreProblem, setScoreProblem] = useState<string | null>(null);
  /** The facts themselves, which travel with the match when the debrief is saved. */
  const [facts, setFacts] = useState<MatchFacts>(() => emptyFacts());
  /** The pixel size of each admitted image, counted from one, for the preview's aspect ratio. */
  const [sizes, setSizes] = useState<Record<number, { width: number; height: number }>>({});
  const [sideChoice, setSideChoice] = useState<SideChoice>(null);
  const [sideProblem, setSideProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  const [prepared, setPrepared] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [activeKey, setActiveKey] = useState<MatchStatKey | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Every object URL this pane has created, so they can all be revoked however the pane ends. */
  const urls = useRef<Set<string>>(new Set());

  /**
   * The screens the reader will read.
   *
   * A screen that is disabled in the layout tables is not offered as a way in: a manager who is invited to add a
   * Passing capture and told afterwards that nothing was read has been given a worse answer than not being asked.
   */
  const offered = useMemo(() => readableScreens(defaultProfile()), []);

  // Object URLs are revoked on unmount. They are also revoked when an image is removed or replaced, but a tab
  // closed mid scan never gets that far, and a live blob URL pins the whole file.
  useEffect(() => {
    const created = urls.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
  }, []);

  // A scan still running when the manager leaves must not keep a worker and a decoded image alive.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const refused: string[] = [];
      const accepted: Chosen[] = [];
      let count = chosen.length;
      for (const file of Array.from(incoming)) {
        const admission = admitImage({
          name: file.name,
          type: file.type,
          size: file.size,
          existingCount: count,
        });
        if (!admission.ok) {
          refused.push(`${file.name}: ${admission.reason}`);
          continue;
        }
        const url = URL.createObjectURL(file);
        urls.current.add(url);
        accepted.push({ id: url, name: file.name, file, url });
        count += 1;
      }
      if (accepted.length > 0) setChosen((current) => [...current, ...accepted]);
      setRefusals(refused);
    },
    [chosen.length]
  );

  /*
    Pasting a screenshot is the extra, not the way in: the file input above is the control the manager is offered,
    and this only helps the case where he has just pressed Print Screen. It is ignored inside a text field so it
    cannot swallow a paste that was meant for a box, and a paste carrying no image is left alone entirely.
  */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const removeAt = useCallback((id: string) => {
    setChosen((current) => {
      const gone = current.find((entry) => entry.id === id);
      if (gone) {
        URL.revokeObjectURL(gone.url);
        urls.current.delete(gone.url);
      }
      return current.filter((entry) => entry.id !== id);
    });
    setObservations(new Map());
    setCarried(new Set<string>());
    setRefused([]);
    setKept([]);
    setDisagreements([]);
    setScoreProblem(null);
    setFacts(emptyFacts());
    setNotes([]);
    setSummary(null);
    setSideProblem(null);
    setSideChoice(null);
    setPrepared(false);
    setGeometry(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    // The worker is torn down as well as the run loop, because a cancelled read is a manager who does not want
    // this scan, and leaving four megabytes of wasm resident for a scan he abandoned is not what Cancel means.
    // The next read warms it again from the browser's own HTTP cache, which costs no network round trip.
    disposeOcrEngine();
    setBusy(false);
    setStage(null);
    setSummary("Reading cancelled. Nothing was changed.");
    setPrepared(false);
  }, []);

  /**
   * Which of the five boxes a stored key feeds, if any.
   *
   * The five boxes are the manager's own figures and stay the source for them; this is only which screen figure
   * can offer a box a value, and shots and passes can come off either of two screens.
   */
  const boxForFact = (screenId: string, key: string): { box: MatchStatKey; text: string } | null => {
    if (screenId === "SUMMARY" && key === "shots") return { box: "shots", text: "shots" };
    if (screenId === "SHOOTING" && key === "totalShots") return { box: "shots", text: "total shots" };
    if (screenId === "SHOOTING" && key === "insideBox") return { box: "shotsInsideBox", text: "inside box" };
    if (screenId === "SUMMARY" && key === "expectedGoals") return { box: "expectedGoalsReported", text: "expected goals" };
    if (screenId === "SUMMARY" && key === "possessionPct") return { box: "possession", text: "possession" };
    if (screenId === "SUMMARY" && key === "passes") return { box: "passesCompleted", text: "passes" };
    if (screenId === "PASSING" && key === "totalPasses") return { box: "passesCompleted", text: "total passes" };
    return null;
  };

  const analyse = useCallback(
    async (override?: SideChoice) => {
      if (chosen.length === 0 || busy) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setStage({ label: "Preparing the reader", fraction: 0 });
      setNotes([]);
      setSummary(null);
      setRefusals([]);
      setObservations(new Map());
      setRefused([]);
      setKept([]);
      setDisagreements([]);
      setScoreProblem(null);
      setFacts(emptyFacts());
      setCarried(new Set<string>());
      setSideProblem(null);

      try {
        // The one place the reader is pulled in. tesseract.js ships as a normal package and its worker and core
        // are static files under /ocr, so only this import is bundled and only when it is first needed.
        const { readMatchFacts, decodeImageFile } = await import("@/lib/ocr/read");

        const ourSide: SideChoice =
          (override !== undefined ? override : sideChoice) ??
          (venue === "HOME" ? "LEFT" : venue === "AWAY" ? "RIGHT" : null);
        const effectiveVenue: "HOME" | "AWAY" | "NEUTRAL" =
          ourSide === null ? (venue ?? "NEUTRAL") : ourSide === "LEFT" ? "HOME" : "AWAY";

        const failures: ReadNote[] = [];
        const sizes: Record<number, { width: number; height: number }> = {};
        const boxObservations = new Map<MatchStatKey, BoxObservation>();
        const carriedKeys = new Set<string>();
        const refusedLines: string[] = [];
        const keptScreens: string[] = [];
        const missed: string[] = [];
        let folded = emptyFacts();
        let lastLayout: string | null = null;
        let conflict: string | null = null;
        let lastGeometry: Geometry | null = null;
        let scoreMismatch: string | null = null;

        for (let index = 0; index < chosen.length; index += 1) {
          const entry = chosen[index];
          if (controller.signal.aborted) return;
          setStage({ label: `Reading ${entry.name}`, fraction: index / chosen.length });
          let decoded: DecodedImage;
          try {
            decoded = await decodeImageFile(entry.file);
          } catch {
            failures.push({ name: entry.name, text: "That file could not be opened as an image." });
            continue;
          }
          sizes[index + 1] = { width: decoded.width, height: decoded.height };

          const outcome = await readMatchFacts(decoded.image, {
            imageIndex: index + 1,
            name: entry.name,
            venue: effectiveVenue,
            ourClub,
            opponent,
            onProgress: (fraction, status) => {
              const label = progressLabel(status);
              if (label !== null) setStage({ label, fraction });
            },
            signal: controller.signal,
          });

          if (!outcome.ok) {
            failures.push({ name: outcome.name, text: outcome.reason });
            continue;
          }

          if (outcome.side.kind !== "AGREED") {
            conflict =
              outcome.side.kind === "CONFLICT"
                ? "The club names in the header and the venue you chose point at different sides."
                : "No club name could be read from the header, so the columns cannot be told apart.";
            continue;
          }

          const result = outcome.result;
          const label = outcome.screenLabel ?? "That screen";

          // The header's own scoreline, and the one the manager already entered. They have to agree before
          // anything at all is written: a capture of another match looks exactly like a capture of this one.
          const scoreline = outcome.scoreline;
          if (
            scoreline !== null &&
            goalsFor !== null &&
            goalsAgainst !== null &&
            (scoreline.us !== goalsFor || scoreline.them !== goalsAgainst)
          ) {
            scoreMismatch = `${label} is a ${scoreline.us} : ${scoreline.them} match and the scoreline you entered says ${goalsFor} : ${goalsAgainst}. Nothing was written from this capture.`;
            continue;
          }

          /**
           * Which boxes the screen can offer, and the figure behind each.
           *
           * Taken from the READING rather than from the kept group, and that is the one place the two part
           * company on purpose: a group is only STORED when every required row and every sum holds, while the
           * boxes below are the manager's own figures and have always been filled from a read that he then
           * checks against the picture. A screen that fails its own sums therefore still fills what it read.
           */
          for (const value of outcome.reading.values.values()) {
            const mapping = boxForFact(result?.screen ?? "SUMMARY", value.key);
            if (mapping === null) continue;
            boxObservations.set(mapping.box, {
              value: value.us,
              confidence: value.confidence,
              derived: result?.derived.includes(value.key) ?? false,
              imageIndex: index + 1,
              words: value.usWords,
            });
          }
          for (const key of outcome.reading.unread) {
            const mapping = boxForFact(result?.screen ?? "SUMMARY", key);
            if (mapping !== null && !boxObservations.has(mapping.box)) {
              // A figure the screen carries and the read could not use. It is worth a note only while the box is
              // still empty at the end, which is the "Inside box is still empty" line below.
              missed.push(mapping.text);
            }
          }

          if (result === null || result.group === null) {
            refusedLines.push(
              `${label} did not read cleanly, so none of it was kept. ${result?.refusal ?? "No figure on it could be held."}`
            );
          } else {
            folded = mergeScreenFacts(folded, result);
            keptScreens.push(label);
            for (const key of result.derived) carriedKeys.add(key);
            for (const key of Object.keys(result.group)) carriedKeys.add(key);
          }

          lastLayout = outcome.profileId;
          lastGeometry = {
            index: index + 1,
            width: decoded.width,
            height: decoded.height,
            region: outcome.region,
            scale: outcome.scale,
          };
        }

        if (controller.signal.aborted) return;

        setFacts(folded);
        onFacts(folded);
        setObservations(boxObservations);
        setCarried(carriedKeys);
        setSizes(sizes);
        setGeometry(lastGeometry);
        setNotes(failures);
        setSideProblem(conflict);
        setScoreProblem(scoreMismatch);
        setRefused(refusedLines);
        setKept(keptScreens);
        setDisagreements(crossScreenNotes(folded));
        setShown((current) => (lastGeometry ? lastGeometry.index : current));

        // The overwrite rule, applied in the one place that knows both what was read and what is already in the
        // boxes. A low confidence read is never placed automatically; it is offered beside its reason instead.
        const values: Partial<Record<MatchStatKey, string>> = {};
        for (const [box, observation] of boxObservations) {
          if (observation.confidence < LOW_CONFIDENCE) continue;
          if (!shouldApply({ currentText: draft[box], currentSource: sources[box], force: false })) continue;
          values[box] = String(observation.value);
        }
        if (lastLayout !== null && Object.keys(values).length > 0) {
          onApply(values, lastLayout);
        }

        const landed = Object.keys(values).length;
        const from = chosen.length === 1 ? "one screenshot" : `${chosen.length} screenshots`;
        setSummary(
          conflict !== null || scoreMismatch !== null
            ? null
            : landed === 0
              ? `Nothing was filled from ${from}. Check the figures below against the picture.`
              : `Filled ${landed} ${landed === 1 ? "box" : "boxes"} from ${from}.`
        );
        setPrepared(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        setNotes([
          {
            name: "The screen reader",
            text:
              error instanceof Error
                ? error.message
                : "The screen reader could not start. Type the figures in by hand instead.",
          },
        ]);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
        setStage(null);
      }
    },
    [busy, chosen, draft, goalsAgainst, goalsFor, onApply, onFacts, opponent, ourClub, sideChoice, sources, venue]
  );

  const swapSides = useCallback(() => {
    // Swap is a correction, not a hint for next time, so the read runs again straight away with the other column.
    // The choice is passed in directly because state has not been committed yet at this point.
    const current: SideChoice =
      sideChoice ?? (venue === "HOME" ? "LEFT" : venue === "AWAY" ? "RIGHT" : null);
    const next: SideChoice = current === "RIGHT" ? "LEFT" : "RIGHT";
    setSideChoice(next);
    setSideProblem(null);
    void analyse(next);
  }, [analyse, sideChoice, venue]);

  const activeWords = activeKey === null ? [] : (observations.get(activeKey)?.words ?? []);
  const currentIndex = chosen.some((_, index) => index + 1 === shown) ? shown : chosen.length > 0 ? 1 : 0;
  const current = chosen.find((_, index) => index + 1 === currentIndex);
  const frame =
    geometry !== null && geometry.index === currentIndex && sizes[currentIndex] !== undefined
      ? {
          region: geometry.region,
          scale: geometry.scale,
          width: sizes[currentIndex].width,
          height: sizes[currentIndex].height,
        }
      : null;

  return (
    <div className="space-y-3">
      {/*
        A plain file input, in a drop area, with the paste event as an extra. Nothing here uses the File System
        Access API, which the manager's browser does not implement, and nothing reads the clipboard without a
        keypress.
      */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        className={`rounded-xl border border-dashed p-3 transition-colors duration-150 ${
          dragging
            ? "border-[#E11D48] bg-[#E11D48]/5"
            : "border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            id="debrief-scan-files"
            type="file"
            accept={ACCEPT}
            multiple
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
            className="block w-full max-w-sm cursor-pointer font-sans text-xs text-slate-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-sub file:text-[11px] file:font-bold file:uppercase file:tracking-wider file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-300 dark:file:bg-slate-800 dark:file:text-slate-200"
          />
          <button
            type="button"
            onClick={() => void analyse()}
            disabled={chosen.length === 0 || busy}
            className="cursor-pointer rounded-lg bg-[#E11D48] px-3 py-2 font-sub text-[11px] font-bold uppercase tracking-wider text-white transition-colors duration-150 hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700"
          >
            {busy ? "Reading" : prepared ? "Read again" : "Read the screenshots"}
          </button>
          {busy ? (
            <button
              type="button"
              onClick={cancel}
              className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 font-sub text-[11px] font-bold uppercase tracking-wider text-slate-600 transition-colors duration-150 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          ) : null}
        </div>
        <p className="mt-2 font-sans text-[11px] text-slate-500 dark:text-slate-400">
          Your screenshots stay on your machine. Nothing is uploaded, and nothing is saved until you save the
          debrief. Up to {IMAGE_LIMITS.maxImages} images, {Math.round(IMAGE_LIMITS.maxBytes / (1024 * 1024))} MB
          each. {offered.map((screen) => screen.label).join(", ")} can be read today.
        </p>
      </div>

      {refusals.length > 0 ? (
        <ul className="space-y-1">
          {refusals.map((text) => (
            <li key={text} className="font-sans text-[11px] leading-snug text-rose-600 dark:text-rose-400">
              {text}
            </li>
          ))}
        </ul>
      ) : null}

      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {chosen.map((entry, index) => (
            <li key={entry.id}>
              <span
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-sub text-[10px] uppercase tracking-wide ${
                  current?.id === entry.id
                    ? "border-[#E11D48] text-slate-700 dark:text-slate-200"
                    : "border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setShown(index + 1)}
                  className="cursor-pointer"
                  aria-label={`Show image ${index + 1}, ${entry.name}`}
                >
                  {index + 1}. {entry.name}
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(entry.id)}
                  className="cursor-pointer text-slate-400 hover:text-rose-600"
                  aria-label={`Remove image ${index + 1}, ${entry.name}`}
                >
                  <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true" fill="currentColor">
                    <path d="M4.3 3.3 3.3 4.3 7 8l-3.7 3.7 1 1L8 9l3.7 3.7 1-1L9 8l3.7-3.7-1-1L8 7 4.3 3.3Z" />
                  </svg>
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {stage !== null ? (
        <div className="space-y-1" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-[#E11D48] transition-[width] duration-200 ease-[var(--ease-brand)]"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, stage.fraction)) * 100)}%` }}
            />
          </div>
          <p className="font-sans text-[11px] text-slate-500 dark:text-slate-400">{stage.label}</p>
        </div>
      ) : null}

      {summary !== null ? (
        <p className="font-sans text-[11px] font-bold text-slate-700 dark:text-slate-200" aria-live="polite">
          {summary}
        </p>
      ) : null}

      {sideProblem !== null ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="font-sans text-[11px] leading-snug text-amber-800 dark:text-amber-300">
            {sideProblem} Nothing has been filled in, because the wrong column would look just as plausible as
            the right one.
          </p>
          <button
            type="button"
            onClick={swapSides}
            className="mt-2 cursor-pointer rounded-lg border border-amber-400 px-3 py-1.5 font-sub text-[11px] font-bold uppercase tracking-wider text-amber-800 transition-colors duration-150 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/40"
          >
            The other column is ours
          </button>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul className="space-y-1">
          {notes.map((note) => (
            <li key={`${note.name}-${note.text}`} className="font-sans text-[11px] leading-snug text-slate-600 dark:text-slate-300">
              <span className="font-bold">{note.name}</span>: {note.text}
            </li>
          ))}
        </ul>
      ) : null}

      {refused.length > 0 ? (
        <ul className="space-y-1">
          {refused.map((line) => (
            <li key={line} className="font-sans text-[11px] leading-snug text-slate-600 dark:text-slate-300">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {scoreProblem !== null ? (
        <p className="font-sans text-[11px] leading-snug text-amber-800 dark:text-amber-300">{scoreProblem}</p>
      ) : null}

      {disagreements.length > 0 ? (
        <ul className="space-y-1">
          {disagreements.map((line) => (
            <li key={line} className="font-sans text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              {line}.
            </li>
          ))}
        </ul>
      ) : null}

      {kept.length > 0 ? (
        <p className="font-sans text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          The rest of the {kept.join(" and the ")} {kept.length === 1 ? "screen" : "screens"} is kept with the
          match when you save, and it never overwrites a figure you typed.
        </p>
      ) : null}

      {prepared && factsAreEmpty(facts) === false && draft.shotsInsideBox.trim() === "" ? (
        <p className="font-sans text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          Inside box is still empty, and a Shooting capture is what fills it.
        </p>
      ) : null}

      {current ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <ScanOverlay
            src={current.url}
            frame={frame}
            words={activeWords}
            label={
              activeKey === null
                ? `Screenshot ${currentIndex}, ${current.name}`
                : `Screenshot ${currentIndex} with the words behind ${matchStatLabel(activeKey)} highlighted`
            }
          />
          <div>
            <ScanFields
              draft={draft}
              sources={sources}
              observations={observations}
              carried={carried}
              activeKey={activeKey}
              onFocusKey={setActiveKey}
              onChange={onChange}
              onUseRead={(key) => {
                const observation = observations.get(key);
                if (observation) onChange(key, String(observation.value));
              }}
            />
            <p className="mt-2 font-sans text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              A read figure only fills an empty box, and it never replaces something you typed. Hover or tab
              into a figure to see where its value came from.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="font-sans text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            Drop any Match Facts screens here. Summary on its own is fine.
          </p>
          <ul className="space-y-1">
            {SCREENS.map((screen) => (
              <li
                key={screen.id}
                className="font-sans text-[11px] leading-snug text-slate-500 dark:text-slate-400"
              >
                <span className="font-bold text-slate-700 dark:text-slate-200">{screen.label}</span>
                {" · "}
                {screen.id === "SUMMARY"
                  ? "shots, expected goals, possession, passes and more"
                  : screen.id === "SHOOTING"
                    ? "shots inside the box and the shot breakdown"
                    : screen.id === "PASSING"
                      ? "completion and pass types"
                      : "tackles, duels and discipline"}
                {screen.enabled ? "" : " · not read yet"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
