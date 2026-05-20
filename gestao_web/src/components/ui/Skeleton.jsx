import React from 'react';
import { cn } from '../../lib/cn';

export default function Skeleton({ className }) {
  return (
    <div
      className={cn('animate-pulse rounded-xl bg-subtle', className)}
      aria-hidden="true"
    />
  );
}

Skeleton.Card = function SkeletonCard({ className }) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-border bg-card p-6 shadow-card space-y-4',
        className
      )}
    >
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
    </div>
  );
};

Skeleton.Row = function SkeletonRow({ className }) {
  return (
    <div className={cn('flex items-center gap-4 p-4', className)}>
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
};
