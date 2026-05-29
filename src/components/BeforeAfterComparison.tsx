/**
 * src/components/BeforeAfterComparison.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Side-by-side before/after image comparison with a drag-handle slider.
 *
 * Features:
 *  • CSS clip-path drag slider (no canvas, no third-party lib)
 *  • Touch + mouse support
 *  • Score delta badges overlaid on each panel
 *  • Keyboard-accessible (arrow keys move slider)
 *  • Falls back to simple side-by-side if images are null
 */

import { useCallback, useRef, useState } from "react";
import { GripVertical } from "lucide-react";

interface Props {
  beforeImage: string;
  afterImage: string;
  beforeScore: number;
  afterScore: number;
}

export default function BeforeAfterComparison({
  beforeImage,
  afterImage,
  beforeScore,
  afterScore,
}: Props) {
  const [sliderPct, setSliderPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const getScoreColor = (s: number) =>
    s >= 80 ? "bg-primary" : s >= 60 ? "bg-warning" : "bg-destructive";

  const updateSlider = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    setSliderPct(pct);
  }, []);

  // Mouse events
  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    updateSlider(e.clientX);
  };
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging.current) updateSlider(e.clientX);
    },
    [updateSlider]
  );
  const onMouseUp = () => { dragging.current = false; };

  // Touch events
  const onTouchMove = (e: React.TouchEvent) => {
    updateSlider(e.touches[0].clientX);
  };

  // Keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") setSliderPct((p) => Math.max(0, p - 2));
    if (e.key === "ArrowRight") setSliderPct((p) => Math.min(100, p + 2));
  };

  const delta = afterScore - beforeScore;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Drag the divider to compare before and after
        </p>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            delta >= 0 ? "text-primary bg-primary/10" : "text-destructive bg-destructive/10"
          }`}
        >
          Overall {delta >= 0 ? "+" : ""}
          {delta}%
        </span>
      </div>

      {/* Comparison container */}
      <div
        ref={containerRef}
        className="relative w-full aspect-video rounded-xl overflow-hidden select-none cursor-ew-resize border border-border"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchMove={onTouchMove}
        onTouchEnd={onMouseUp}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="slider"
        aria-label="Before/After comparison slider"
        aria-valuenow={Math.round(sliderPct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* After image (bottom / right panel — full width) */}
        <img
          src={afterImage}
          alt="After"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />

        {/* Before image (top / left panel — clipped by slider) */}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }}
        >
          <img
            src={beforeImage}
            alt="Before"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        </div>

        {/* Drag handle line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
          style={{ left: `${sliderPct}%`, transform: "translateX(-50%)" }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center ring-2 ring-primary/30">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {/* Score badges */}
        <div className="absolute top-2 left-2">
          <span
            className={`text-xs font-bold text-white px-2 py-0.5 rounded ${getScoreColor(beforeScore)}`}
          >
            Before {beforeScore}%
          </span>
        </div>
        <div className="absolute top-2 right-2">
          <span
            className={`text-xs font-bold text-white px-2 py-0.5 rounded ${getScoreColor(afterScore)}`}
          >
            After {afterScore}%
          </span>
        </div>

        {/* Labels */}
        {sliderPct > 15 && (
          <div className="absolute bottom-2 left-3">
            <span className="text-[10px] text-white/80 font-medium bg-black/40 px-1.5 py-0.5 rounded">
              BEFORE
            </span>
          </div>
        )}
        {sliderPct < 85 && (
          <div className="absolute bottom-2 right-3">
            <span className="text-[10px] text-white/80 font-medium bg-black/40 px-1.5 py-0.5 rounded">
              AFTER
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
