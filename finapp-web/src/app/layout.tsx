import './globals.css';
import { Hanken_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '../components/ThemeProvider';
import Navbar from '../components/Navbar';
import MonthlyReminder from '../components/MonthlyReminder';

// Midnight Gold typography: Hanken Grotesk (display/numbers), Inter (body),
// JetBrains Mono (labels/ISINs). Self-hosted by next/font — no external CDN.
const display = Hanken_Grotesk({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display', display: 'swap' });
const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-mono', display: 'swap' });

export const metadata = {
  title: 'FinApp',
  description: 'Personal Financial Portfolio Monitor',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-gray-50 dark:bg-void text-gray-900 dark:text-ink font-sans antialiased transition-colors duration-200">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Navbar />
          <MonthlyReminder />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
