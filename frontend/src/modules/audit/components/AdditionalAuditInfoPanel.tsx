/**
 * src/modules/audit/components/AdditionalAuditInfoPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Interactive Completion Questionnaire for Non-Visual 5S Audit Questions.
 * Renders pending questions one at a time with rating and remarks inputs.
 */

import { useState } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle2, ClipboardList, Info } from 'lucide-react';
import type { AiRating } from '../pipeline/scoreUtils';

interface PendingQuestion {
  question_id: string;
  pillar: string;
  question: string;
  rating: string;
  score: number;
  reason: string;
  evidence: string;
}

interface Props {
  pendingQuestions: PendingQuestion[];
  onFinish: (answers: Array<{ questionId: string; rating: AiRating; remarks: string }>) => void;
}

const RATING_OPTIONS: Array<{ value: AiRating; label: string; description: string; colorClass: string; activeClass: string }> = [
  {
    value: 'VERY_GOOD',
    label: 'Very Good',
    description: 'Fully compliant, exemplary standard',
    colorClass: 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-50 bg-emerald-50/5',
    activeClass: 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/20',
  },
  {
    value: 'GOOD',
    label: 'Good',
    description: 'Minor areas to clean or organize',
    colorClass: 'border-teal-500/30 text-teal-600 hover:bg-teal-50 bg-teal-50/5',
    activeClass: 'bg-teal-600 text-white border-teal-600 shadow-sm shadow-teal-600/20',
  },
  {
    value: 'AVERAGE',
    label: 'Average',
    description: 'Moderate compliance, needs work',
    colorClass: 'border-amber-500/30 text-amber-600 hover:bg-amber-55 bg-amber-50/5',
    activeClass: 'bg-amber-500 text-white border-amber-500 shadow-sm shadow-amber-500/20',
  },
  {
    value: 'BAD',
    label: 'Bad',
    description: 'Unacceptable levels of disorder/dirt',
    colorClass: 'border-orange-500/30 text-orange-600 hover:bg-orange-50 bg-orange-50/5',
    activeClass: 'bg-orange-500 text-white border-orange-500 shadow-sm shadow-orange-500/20',
  },
  {
    value: 'VERY_BAD',
    label: 'Very Bad',
    description: 'Severe non-compliance or hazard',
    colorClass: 'border-red-500/30 text-red-600 hover:bg-red-50 bg-red-50/5',
    activeClass: 'bg-red-600 text-white border-red-600 shadow-sm shadow-red-600/20',
  },
];

export default function AdditionalAuditInfoPanel({ pendingQuestions, onFinish }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { rating: AiRating | ''; remarks: string }>>(() => {
    const initial: Record<string, { rating: AiRating | ''; remarks: string }> = {};
    pendingQuestions.forEach((q) => {
      initial[q.question_id] = { rating: '', remarks: '' };
    });
    return initial;
  });

  const currentQ = pendingQuestions[currentIndex];
  const currentAnswer = answers[currentQ.question_id] || { rating: '', remarks: '' };

  const handleSelectRating = (rating: AiRating) => {
    setAnswers((prev) => ({
      ...prev,
      [currentQ.question_id]: {
        ...prev[currentQ.question_id],
        rating,
      },
    }));
  };

  const handleChangeRemarks = (remarks: string) => {
    setAnswers((prev) => ({
      ...prev,
      [currentQ.question_id]: {
        ...prev[currentQ.question_id],
        remarks,
      },
    }));
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < pendingQuestions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const allAnswered = pendingQuestions.every((q) => answers[q.question_id]?.rating !== '');

  const handleFinish = () => {
    if (!allAnswered) return;
    const formatted = pendingQuestions.map((q) => ({
      questionId: q.question_id,
      rating: answers[q.question_id].rating as AiRating,
      remarks: answers[q.question_id].remarks,
    }));
    onFinish(formatted);
  };

  const progressPercentage = Math.round(((currentIndex + 1) / pendingQuestions.length) * 100);

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden animate-fade-in">
      {/* Header Panel */}
      <div className="px-5 py-4 border-b border-border bg-muted/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-primary/10 rounded-lg text-primary">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-foreground">
              Additional Audit Information
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Some questions cannot be verified from the image. Please assess manually.
            </p>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1 bg-primary/10 border border-primary/20 rounded-lg px-2.5 py-1 text-xs text-primary font-bold">
          <Info className="h-3.5 w-3.5" />
          <span>Question {currentIndex + 1} of {pendingQuestions.length}</span>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Info Callout */}
        {currentIndex === 0 && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex gap-3 text-xs text-foreground/90 leading-relaxed">
            <Info className="h-4.5 w-4.5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-primary mb-0.5">Workplace Audit Completion</p>
              <p className="text-muted-foreground">
                Additional information is required to complete the workplace audit.
                Some audit questions cannot be verified from the uploaded image.
                Please answer the following questions.
              </p>
            </div>
          </div>
        )}

        {/* Question Panel */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-muted border border-border text-muted-foreground font-extrabold uppercase px-2.5 py-1 rounded">
              {currentQ.pillar}
            </span>
            <span className="text-xs text-muted-foreground font-semibold">
              Question {currentIndex + 1} / {pendingQuestions.length}
            </span>
          </div>

          <h3 className="text-base sm:text-lg font-bold text-foreground leading-snug">
            {currentQ.question}
          </h3>
        </div>

        {/* Rating Options */}
        <div className="space-y-3">
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Select Rating <span className="text-destructive">*</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            {RATING_OPTIONS.map((opt) => {
              const isSelected = currentAnswer.rating === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelectRating(opt.value)}
                  className={`flex flex-col items-center justify-center p-3 rounded-lg border text-center transition-all cursor-pointer outline-none hover:scale-[1.01] active:scale-[0.99] ${
                    isSelected ? opt.activeClass : opt.colorClass
                  }`}
                >
                  <span className="text-sm font-bold">{opt.label}</span>
                  <span className="text-[9px] mt-1 opacity-80 line-clamp-2 leading-tight">
                    {opt.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Remarks Input */}
        <div className="space-y-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Remarks (Optional)
          </label>
          <textarea
            value={currentAnswer.remarks}
            onChange={(e) => handleChangeRemarks(e.target.value)}
            placeholder="Additional remarks (optional)"
            rows={3}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
          />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1 w-full bg-border">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      {/* Footer Navigation */}
      <div className="px-6 py-4 border-t border-border bg-muted/10 flex items-center justify-between">
        <button
          type="button"
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>

        {currentIndex < pendingQuestions.length - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinish}
            disabled={!allAnswered}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
          >
            <CheckCircle2 className="h-4.5 w-4.5" />
            Finish Audit
          </button>
        )}
      </div>
    </div>
  );
}
