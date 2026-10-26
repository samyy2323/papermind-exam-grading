// Minimal stroke icon set (24px grid) so we don't pull in an icon library.
const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 4l9 16H3L12 4zM12 10v4.5M12 17.5v.01',
  shield: 'M12 3l7 3v5.5c0 4.4-3 8.1-7 9.5-4-1.4-7-5.1-7-9.5V6l7-3zM12 8.5v4M12 15.5v.01',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronUp: 'M6 15l6-6 6 6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  file: 'M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V7l-4-4zM14 3v4h4M9 13h6M9 17h6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  logout: 'M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 16l-4-4 4-4M6 12h10',
  book: 'M4 5a2 2 0 012-2h13v15H6a2 2 0 00-2 2V5zM4 20a2 2 0 002 1h13v-3',
  clipboard: 'M9 4h6v3H9zM9 5H6a1 1 0 00-1 1v14a1 1 0 001 1h12a1 1 0 001-1V6a1 1 0 00-1-1h-3M9 13l2 2 4-4',
  chart: 'M4 20h16M7 16v-5M12 16V7M17 16v-8',
  inbox: 'M4 13l2.5-8h11L20 13v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM4 13h5l1 2h4l1-2h5',
  camera: 'M4 8a1 1 0 011-1h3l1.5-2h5L16 7h3a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V8zM12 16.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5a1 1 0 100-.01',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  plus: 'M12 5v14M5 12h14',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8v.01',
  exam: 'M7 3h10a1 1 0 011 1v16a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM9 8h6M9 12h6M9 16h3',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
};

export default function Icon({ name, size = 18, className = '', strokeWidth = 1.8, title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name] || ''} />
    </svg>
  );
}
