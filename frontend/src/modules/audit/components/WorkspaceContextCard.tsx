/**
 * src/modules/audit/components/WorkspaceContextCard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 2 of the audit wizard.
 * Auditor selects Zone, Workspace Type, and confirms Industry.
 * Emits context to parent via onContextChange when all fields are complete.
 */

import { useState, useEffect } from 'react';
import { MapPin, Building2, ChevronDown, CheckCircle2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ZONE_OPTIONS, WORKSPACE_TYPE_OPTIONS, type WorkspaceType } from '../constants/zoneKnowledge';
import ZonePreviewPanel from './ZonePreviewPanel';

export interface WorkspaceContext {
  selectedZone:  string;
  workspaceType: WorkspaceType;
  industry:      string;
}

interface Props {
  /** Pre-filled industry from employee profile */
  defaultIndustry?: string;
  onContextChange: (ctx: WorkspaceContext) => void;
}

export default function WorkspaceContextCard({ defaultIndustry = '', onContextChange }: Props) {
  const [zone,     setZone]     = useState<string>('');
  const [industry, setIndustry] = useState(defaultIndustry);

  // Notify parent whenever context is complete
  useEffect(() => {
    if (zone && industry.trim()) {
      onContextChange({ selectedZone: zone, workspaceType: 'General', industry: industry.trim() });
    }
  }, [zone, industry, onContextChange]);

  const isComplete = !!(zone && industry.trim());

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-5 py-4 border-b border-border bg-muted/20 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
            Step 2
          </p>
          <h3 className="text-sm font-black text-foreground flex items-center gap-2 mt-0.5">
            <MapPin className="h-4 w-4 text-primary" />
            Select Workplace Context
          </h3>
        </div>
        {isComplete && (
          <CheckCircle2 className="h-5 w-5 text-emerald-500 animate-fade-in" />
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* Zone selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            Audit Zone <span className="text-destructive">*</span>
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                id="zone-selector"
                className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-semibold transition-all outline-none
                  ${zone
                    ? 'border-primary/40 bg-primary/5 text-foreground'
                    : 'border-border bg-background text-muted-foreground hover:border-primary/30'
                  }`}
              >
                <span>{zone || 'Select zone to audit…'}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[280px] max-h-72 overflow-y-auto" align="start">
              {ZONE_OPTIONS.map((z) => (
                <DropdownMenuItem
                  key={z}
                  onClick={() => setZone(z)}
                  className={zone === z ? 'bg-primary/10 text-primary font-bold' : ''}
                >
                  {z}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Zone preview — animates in when zone selected */}
        {zone && <ZonePreviewPanel zone={zone} />}

        {/* Industry Sector Input (Aligned full-width like Audit Zone) */}
        <div className="space-y-2">
          <label
            htmlFor="industry-input"
            className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
          >
            <Building2 className="h-3.5 w-3.5 text-primary" />
            Industry / Sector <span className="text-destructive">*</span>
          </label>
          <input
            id="industry-input"
            type="text"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. Chemical Manufacturing"
            className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
          />
        </div>

        {/* Completion indicator */}
        {!isComplete && (
          <p className="text-[11px] text-muted-foreground italic">
            Complete all fields above to proceed to image upload.
          </p>
        )}
      </div>
    </div>
  );
}
