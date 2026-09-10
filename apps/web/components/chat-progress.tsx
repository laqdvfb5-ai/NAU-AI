'use client';

import { useEffect, useState } from 'react';
import {
  BrainCircuit,
  Check,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Unplug,
} from 'lucide-react';
import styles from './chat-progress.module.css';

const stages = {
  connecting: { label: 'Connecting', icon: Unplug },
  reasoning: { label: 'Reasoning', icon: BrainCircuit },
  searching: { label: 'Searching', icon: Search },
  checking: { label: 'Checking', icon: ShieldCheck },
  generating: { label: 'Making answer', icon: Sparkles },
  validating: { label: 'Validating', icon: ShieldCheck },
} as const;

export type ProgressStep = { stage: keyof typeof stages; message: string };

export function isProgressStage(stage: unknown): stage is ProgressStep['stage'] {
  return typeof stage === 'string' && Object.hasOwn(stages, stage);
}

export function ChatProgress({ steps, startedAt }: { steps: ProgressStep[]; startedAt: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    // Only the elapsed clock runs locally. Workflow steps come from server events.
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const active = steps.at(-1);

  return (
    <div className={styles.progress} data-testid="chat-progress">
      <div className={styles.heading}>
        <span className={styles.mark} aria-hidden="true">
          <Sparkles size={17} />
        </span>
        <strong>NAU AI đang xử lý</strong>
        <span className={styles.elapsed} aria-hidden="true">
          {seconds}s
        </span>
      </div>
      <ol className={styles.steps} aria-label="Tiến độ phản hồi AI">
        {steps.map((step, index) => {
          const current = index === steps.length - 1;
          const Icon = stages[step.stage].icon;
          return (
            <li
              key={`${step.stage}-${index}`}
              className={current ? styles.active : styles.done}
              aria-current={current ? 'step' : undefined}
              data-stage={step.stage}
              data-state={current ? 'active' : 'complete'}
            >
              {current ? (
                <Icon size={13} aria-hidden="true" />
              ) : (
                <Check size={13} aria-hidden="true" />
              )}
              <span>{stages[step.stage].label}</span>
              {current && <LoaderCircle className={styles.spinner} size={12} aria-hidden="true" />}
              <span className="sr-only">{current ? ': đang thực hiện' : ': hoàn tất'}</span>
            </li>
          );
        })}
      </ol>
      <p className={styles.detail} role="status" aria-live="polite" aria-atomic="true">
        {active?.message}
      </p>
    </div>
  );
}
