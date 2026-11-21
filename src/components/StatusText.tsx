import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, ShieldAlert, XCircle } from 'lucide-react';
import type { ResultFlag } from '../types/lims';

export function TatStatusLabel({
  status,
  label,
}: {
  status: 'Completed On Time' | 'Completed Late' | 'On Track' | 'At Risk' | 'Breached';
  label: string;
}) {
  if (status === 'Completed On Time') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 font-mono tabular-nums whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        {label}
      </span>
    );
  }
  if (status === 'Completed Late' || status === 'Breached') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 font-mono tabular-nums whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        {label}
      </span>
    );
  }
  if (status === 'At Risk') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 font-mono tabular-nums whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 font-mono tabular-nums whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
      {label}
    </span>
  );
}

export function ResultFlagLabel({ flag }: { flag: ResultFlag }) {
  switch (flag) {
    case 'CRITICAL_HIGH':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 font-mono">
          <ShieldAlert className="w-3.5 h-3.5" />
          CRIT HIGH
        </span>
      );
    case 'CRITICAL_LOW':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 font-mono">
          <ShieldAlert className="w-3.5 h-3.5" />
          CRIT LOW
        </span>
      );
    case 'CRITICAL':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 font-mono">
          <ShieldAlert className="w-3.5 h-3.5" />
          CRITICAL
        </span>
      );
    case 'HIGH_RISK':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-800 font-mono">
          <ShieldAlert className="w-3.5 h-3.5" />
          HIGH RISK
        </span>
      );
    case 'ABNORMAL':
      return <span className="text-xs font-semibold text-amber-700 font-mono">▲ ABNORMAL</span>;
    case 'HIGH':
      return <span className="text-xs font-semibold text-amber-700 font-mono">▲ HIGH</span>;
    case 'LOW':
      return <span className="text-xs font-semibold text-amber-700 font-mono">▼ LOW</span>;
    default:
      return <span className="text-xs font-medium text-emerald-700 font-mono">NORMAL</span>;
  }
}

export function CenterStatusLabel({ status }: { status: 'Active' | 'Credit Hold' | 'Suspended' }) {
  if (status === 'Active') {
    return <span className="text-xs font-semibold text-emerald-700">● Active</span>;
  }
  if (status === 'Credit Hold') {
    return <span className="text-xs font-semibold text-amber-700">▲ Credit Hold</span>;
  }
  return <span className="text-xs font-semibold text-rose-700">✖ Suspended</span>;
}
