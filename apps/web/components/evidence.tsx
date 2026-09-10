'use client';
import { CheckCircle2, AlertCircle, HelpCircle, ExternalLink, ChevronDown } from 'lucide-react';
import type { AcademicResult, Citation } from '@nau/domain';
export const statusLabels = {
  passed: 'Đạt điều kiện',
  failed: 'Chưa đạt',
  insufficient: 'Thiếu dữ liệu',
  conflict: 'Cần đối soát',
};
export function Sources({ sources }: { sources: Citation[] }) {
  return (
    <div className="citations">
      {sources.map((s, i) => (
        <a
          key={s.id}
          href={s.url + (s.page ? '#page=' + s.page : '')}
          target="_blank"
          rel="noreferrer"
          className="citation"
        >
          <span className="citation-index">{i + 1}</span>
          <div>
            <b>{s.title}</b>
            <small>
              {s.article || s.version}
              {s.page ? ` · Trang PDF ${s.page}` : ''}
            </small>
          </div>
          <ExternalLink size={14} />
        </a>
      ))}
    </div>
  );
}
export function Evaluation({
  result,
  expanded = false,
}: {
  result: AcademicResult;
  expanded?: boolean;
}) {
  return (
    <details className={'evaluation ' + result.status} open={expanded || undefined}>
      <summary>
        <span className={'status-icon ' + result.status}>
          {result.status === 'passed' ? (
            <CheckCircle2 size={18} />
          ) : result.status === 'insufficient' ? (
            <HelpCircle size={18} />
          ) : (
            <AlertCircle size={18} />
          )}
        </span>
        <div>
          <strong>{result.courseName}</strong>
          <small>{statusLabels[result.status]}</small>
        </div>
        <ChevronDown size={17} />
      </summary>
      <div className="evaluation-body">
        <p className="recorded">
          Kết quả đang ghi nhận:{' '}
          <b>
            {result.recordedStatus === 'passed'
              ? 'Đạt'
              : result.recordedStatus === 'failed'
                ? 'Chưa đạt'
                : 'Chưa chốt'}
          </b>{' '}
          · Hồ sơ giả
        </p>
        <p>{result.explanation}</p>
        <div className="conditions">
          {result.conditions.map((c) => (
            <div className="condition" key={c.id}>
              <span className={'condition-marker ' + c.verdict}>
                {c.verdict === 'met' ? (
                  <CheckCircle2 size={16} />
                ) : c.verdict === 'unmet' ? (
                  <AlertCircle size={16} />
                ) : (
                  <HelpCircle size={16} />
                )}
              </span>
              <div>
                <b>{c.label}</b>
                <p>{c.evidence}</p>
                <small>{c.article}</small>
              </div>
            </div>
          ))}
        </div>
        <div className="next-steps">
          <b>Bạn có thể làm gì tiếp theo?</b>
          <ul>
            {result.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
        <p className="microcopy">
          Kết quả đối chiếu không thay đổi điểm do trường ghi nhận. Đề cương và hồ sơ trong bản này
          là giả lập.
        </p>
        <Sources sources={result.citations} />
      </div>
    </details>
  );
}
