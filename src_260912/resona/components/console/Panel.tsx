import type { ReactNode } from 'react';
import { cx } from '@/lib/util';

/** 레일에 놓이는 패널의 공통 틀. 머리말에 번호와 이름을 답니다. */
export function Panel({
  index,
  title,
  hint,
  children,
  className,
}: {
  index: string;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className="border border-rule bg-panel">
      <header className="flex items-center justify-between gap-2 border-b border-rule px-2.5 py-1.5">
        <h2 className="font-condensed text-[13px] uppercase tracking-[0.16em] text-bone">
          <span className="mr-2 text-dim">{index}</span>
          {title}
        </h2>
        {hint ? (
          <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-dim">
            {hint}
          </span>
        ) : null}
      </header>
      <div className={cx('p-2.5', className)}>{children}</div>
    </section>
  );
}

/** 아직 구현하지 않은 자리에 붙이는 표시. 어느 단계에서 채우는지 적습니다. */
export function Pending({ stage }: { stage: string }) {
  return (
    <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-dim">
      {stage}
    </p>
  );
}
