import Link from 'next/link';

const QUOTES = [
  { quote: "You shall not pass!", author: "Gandalf, probably also a bank's IT security team" },
  { quote: "I'm sorry Dave, I'm afraid I can't do that.", author: "HAL 9000, reviewing your access request" },
  { quote: "It's a trap!", author: "Admiral Ackbar, watching you try to log in" },
  { quote: "This is not the portfolio you are looking for.", author: "Obi-Wan Kenobi, Certified Financial Jedi" },
  { quote: "Hasta la vista, unauthorized user.", author: "The Terminator, Head of Security" },
];

export default function UnauthorizedPage() {
  const { quote, author } = QUOTES[Math.floor(Math.random() * QUOTES.length)];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-black px-4">
      <div className="w-full max-w-lg text-center">
        <div className="text-8xl mb-6">🚫</div>

        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-10 text-sm">
          Your account is not authorised to view this dashboard.
        </p>

        <div className="bg-white dark:bg-[#0a0a0a] rounded-2xl border border-gray-200 dark:border-gold-500/20 shadow-sm p-8 mb-8">
          <blockquote className="text-lg font-medium text-gray-900 dark:text-white italic mb-4">
            &ldquo;{quote}&rdquo;
          </blockquote>
          <cite className="text-sm text-gray-400 dark:text-gray-500 not-italic">— {author}</cite>
        </div>

        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-gray-300 dark:border-gold-500/30 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors"
        >
          Try a different account
        </Link>
      </div>
    </div>
  );
}
