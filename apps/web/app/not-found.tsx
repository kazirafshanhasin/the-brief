import Link from "next/link";

export default function NotFound() {
  return (
    <main className="empty">
      <p>This story is no longer available. Stories are kept for 7 days.</p>
      <p>
        <Link href="/">Back to your brief</Link>
      </p>
    </main>
  );
}
