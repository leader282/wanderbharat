import Link from "next/link";

type NoticeLink = {
  href: string;
  label: string;
};

type PublicBetaNoticeProps = {
  eyebrow: string;
  body: string;
  title?: string;
  links?: readonly NoticeLink[];
  compact?: boolean;
  className?: string;
};

export default function PublicBetaNotice({
  eyebrow,
  title,
  body,
  links,
  compact = false,
  className,
}: PublicBetaNoticeProps) {
  return (
    <aside
      className={[
        "card border-[var(--color-brand-500)]/25 bg-[linear-gradient(180deg,rgba(184,136,31,0.08),rgba(255,255,255,0.96))]",
        compact ? "p-4 sm:p-5" : "p-5 sm:p-6",
        className ?? "",
      ].join(" ")}
    >
      <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--color-brand-700)]">
        {eyebrow}
      </p>
      {title ? (
        <p className="mt-2 text-lg font-bold text-[var(--color-ink-900)]">{title}</p>
      ) : null}
      <p
        className={[
          "leading-relaxed text-[var(--color-ink-700)]",
          compact ? "mt-2 text-sm" : "mt-3 text-[0.98rem]",
        ].join(" ")}
      >
        {body}
      </p>

      {links && links.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          {links.map((link) => (
            <Link
              key={`${link.href}-${link.label}`}
              href={link.href}
              className="text-sm font-semibold text-[var(--color-ink-800)] underline-offset-2 transition-colors hover:text-[var(--color-ink-900)] hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
