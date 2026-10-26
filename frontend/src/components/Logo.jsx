export default function Logo({ size = 28, withText = true, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#1B2438" />
        <path d="M9 7h10l5 5v13H9z" fill="#FAF7F0" />
        <path d="M19 7v5h5" fill="#E4DCCB" />
        <path d="M12.5 19l2.5 2.5 5-6" stroke="#1F6F6B" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withText && <span className="font-serif text-xl font-semibold tracking-tight text-ink">PaperMind</span>}
    </span>
  );
}
