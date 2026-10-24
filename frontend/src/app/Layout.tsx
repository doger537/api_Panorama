import type { ReactNode } from 'react';

export interface LayoutProps {
  header?: ReactNode;
  children: ReactNode;
  nav?: ReactNode;
  skipToContentId?: string;
}

export function Layout({ header, children, nav, skipToContentId = 'main-content' }: LayoutProps) {
  return (
    <>
      <a
        href={`#${skipToContentId}`}
        style={{
          position: 'absolute',
          left: '-9999px',
          top: 0,
          padding: '0.5rem 1rem',
          background: '#0F172A',
          color: '#F8FAFC',
          zIndex: 9999,
        }}
        onFocus={(e) => {
          e.currentTarget.style.left = '0';
        }}
        onBlur={(e) => {
          e.currentTarget.style.left = '-9999px';
        }}
      >
        Skip to content
      </a>
      {header && <header role="banner">{header}</header>}
      {nav && <nav role="navigation" aria-label="Main navigation">{nav}</nav>}
      <main role="main" id={skipToContentId}>
        {children}
      </main>
    </>
  );
}
