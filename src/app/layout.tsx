import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Manrope } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
});

export const viewport: Viewport = {
  themeColor: '#f6f7f9',
};

export const metadata: Metadata = {
  title: 'NudgePay — Freelancer Invoice Chasing & Statutory Late Fees',
  description:
    'Automated invoice chasing and statutory late-fee recovery for freelancers billing via Stripe or PDFs—with smart promise-to-pay pausing and $15/mo or $1/recovery pricing.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen antialiased selection:bg-emerald-100 selection:text-emerald-950">
        {children}
      </body>
    </html>
  );
}
