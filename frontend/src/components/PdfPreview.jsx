import { useEffect, useState } from 'react';
import { errorMessage } from '../api';
import { Alert, Button, Card, Spinner } from './ui';

/**
 * Shows a PDF fetched with the auth header inside the page (an object URL in an iframe), with a download link.
 * `load` returns the object URL. Used for the answer key and for each student's combined answer sheet.
 */
export default function PdfPreview({ load, title, description, filename = 'document.pdf', bare = false, defaultOpen = false }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ url: null, loading: false, error: '' });

  // Release the object URL when the viewer goes away.
  useEffect(() => () => state.url && URL.revokeObjectURL(state.url), [state.url]);

  const show = async () => {
    setOpen(true);
    if (state.url) return;
    setState({ url: null, loading: true, error: '' });
    try {
      setState({ url: await load(), loading: false, error: '' });
    } catch (err) {
      setState({ url: null, loading: false, error: errorMessage(err) });
    }
  };
  useEffect(() => {
    if (defaultOpen) show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          {description && <p className="text-sm text-ink-soft">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {state.url && (
            <a href={state.url} download={filename} className="text-sm font-medium text-accent underline underline-offset-2">
              Download
            </a>
          )}
          <Button variant="secondary" size="sm" icon="file" onClick={() => (open ? setOpen(false) : show())}>
            {open ? 'Hide PDF' : 'View PDF'}
          </Button>
        </div>
      </div>
      {open && (
        <div className="mt-4">
          {state.loading && (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <Spinner /> Preparing the PDF…
            </div>
          )}
          {state.error && <Alert>{state.error}</Alert>}
          {state.url && <iframe title={title} src={state.url} className="h-[75vh] w-full rounded-md border border-line bg-white" />}
        </div>
      )}
    </>
  );

  return bare ? <div className="mt-4">{body}</div> : <Card className="p-4 sm:p-5">{body}</Card>;
}
