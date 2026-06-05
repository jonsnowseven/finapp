import './globals.css';
import { ThemeProvider } from '../components/ThemeProvider';
import Navbar from '../components/Navbar'; // We will create this next!

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
    <html lang="en" suppressHydrationWarning>
      {/* Notice the body now holds the global background and text colors. 
        This applies the base theme to ALL pages instantly. 
      */}
      <body className="min-h-screen bg-gray-50 dark:bg-black text-gray-900 dark:text-gray-100 font-sans transition-colors duration-200">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* The Navbar will now appear on every page */}
          <Navbar />
          
          {/* The individual page content loads here */}
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
