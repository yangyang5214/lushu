export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" strokeWidth="4" />
      <path
        className="brand-route"
        d="M16 40 C24 18, 40 50, 48 24"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="16" cy="40" r="4" fill="currentColor" />
      <circle cx="48" cy="24" r="4" fill="currentColor" />
    </svg>
  )
}
