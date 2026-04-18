import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mt-24 md:mt-32 max-w-xl">
      <p className="eyebrow">Nothing here</p>
      <h1 className="mt-3 text-5xl font-black leading-[1.05]">
        We lost the trail.
      </h1>
      <p className="mt-4 text-lg text-[var(--color-ink-700)]">
        The page you&apos;re looking for isn&apos;t here. Let&apos;s get you
        back on course.
      </p>
      <div className="mt-8 flex gap-3">
        <Link href="/" className="btn-primary">
          Back home
        </Link>
        <Link href="/plan" className="btn-secondary">
          Plan a trip
        </Link>
      </div>
    </section>
  );
}
