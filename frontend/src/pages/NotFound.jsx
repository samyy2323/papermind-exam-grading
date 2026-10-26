import { EmptyState, Button } from '../components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24">
      <EmptyState icon="file" title="Page not found" action={<Button to="/">Go to dashboard</Button>}>
        The page you were looking for doesn’t exist or has moved.
      </EmptyState>
    </div>
  );
}
