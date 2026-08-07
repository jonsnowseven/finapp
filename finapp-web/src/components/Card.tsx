import { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  accent?: string;   // hex color → 3px top-edge bar
  glow?: boolean;    // radial glow in `accent` color on hover
  hover?: boolean;   // lift + border-brighten on hover (default true)
}

export default function Card({ children, accent, glow, hover = true, className = '', style, ...rest }: CardProps) {
  return (
    <div
      className={`group relative overflow-hidden bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-line p-6 transition-all duration-200 ${
        hover ? 'hover:-translate-y-0.5 hover:shadow-lg dark:hover:shadow-black/40 hover:border-gray-300 dark:hover:border-line-2' : ''
      } ${className}`}
      style={accent ? ({ ...style, '--glow-color': accent } as React.CSSProperties) : style}
      {...rest}
    >
      {accent && (
        <span className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: accent }} />
      )}
      {glow && <span className="card-glow" aria-hidden="true" />}
      {children}
    </div>
  );
}
