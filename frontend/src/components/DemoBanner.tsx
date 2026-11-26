import Link from "next/link";
import type { GuestInfo } from "@/lib/api";

// "ends in 23h" / "ends in 40 min"
function timeLeft(expiresAt: string): string {
  const minutes = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h` : `${minutes} min`;
}

// Shown to "Try the demo" guests: questions left, when the account ends, and a way to sign up.
export default function DemoBanner({ guest }: { guest: GuestInfo }) {
  const out = guest.questions_left <= 0;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm ${
        out ? "bg-warning-soft text-warning" : "bg-info-soft text-info"
      }`}
    >
      <span className="font-semibold">Demo account</span>
      <span>
        {guest.questions_left} of {guest.question_limit} questions left today
      </span>
      <span className="opacity-80">· deleted in {timeLeft(guest.expires_at)}</span>
      <Link
        href="/login"
        className="ml-auto font-semibold underline-offset-4 hover:underline"
      >
        Create a free account →
      </Link>
    </div>
  );
}
