import { useState } from 'react';
import { errorMessage, openReferencePdf } from '../api';
import Icon from './Icon';

/**
 * "Reference PDF" link for a processed answer sheet: the uploaded photos combined into one file, for
 * review and archival only (it is never fed to the OCR model). Opens in a new tab.
 */
export default function ReferencePdfLink({ submissionId, label = false, className = '' }) {
  const [state, setState] = useState({ busy: false, error: '' });

  const open = async (e) => {
    e.preventDefault();
    e.stopPropagation(); // rows are clickable
    setState({ busy: true, error: '' });
    try {
      await openReferencePdf(submissionId);
      setState({ busy: false, error: '' });
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
      setTimeout(() => setState((s) => ({ ...s, error: '' })), 5000);
    }
  };

  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={open}
        disabled={state.busy}
        title="View reference PDF (all uploaded photos in one file)"
        aria-label="View reference PDF"
        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-ink-soft hover:bg-paper-2 hover:text-accent disabled:opacity-50"
      >
        <Icon name="file" size={15} />
        {label && 'Reference PDF'}
      </button>
      {state.error && (
        <span role="alert" className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md bg-ink px-3 py-2 text-xs font-normal leading-snug text-paper shadow-lg">
          {state.error}
        </span>
      )}
    </span>
  );
}
