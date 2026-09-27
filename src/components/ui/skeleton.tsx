import React from "react";

export function Skeleton({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-slate-200/70 dark:bg-slate-800/60 border border-slate-300/40 dark:border-slate-700/30 backdrop-blur-sm relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_2s_infinite] before:bg-gradient-to-r before:from-transparent before:via-slate-300/30 dark:before:via-slate-700/20 before:to-transparent ${className}`}
      {...props}
    />
  );
}

export function SquadTableSkeleton() {
  return (
    <div className="space-y-2 p-4 bg-white/90 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800/80 rounded-xl backdrop-blur-xl">
      <div className="flex justify-between items-center pb-3 border-b border-slate-200 dark:border-slate-800">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-8 w-32" />
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2">
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </div>
  );
}