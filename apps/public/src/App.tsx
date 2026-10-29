import { translate } from '@xiro/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useLanguage } from './lib/lang';
import { accountPath, navigate, parseRoute } from './lib/route';
import { useClientSession } from './lib/session';
import { useTheme } from './lib/theme';
import { ProfilePage } from './pages/ProfilePage';

// Fase 5 (carga diferida): la página del negocio va en el paquete principal; las demás vistas se descargan solo si se abren.
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const ManagePage = lazy(() => import('./pages/ManagePage').then((m) => ({ default: m.ManagePage })));
const MyAccountPage = lazy(() => import('./pages/MyAccountPage').then((m) => ({ default: m.MyAccountPage })));
const ReviewLinkPage = lazy(() => import('./pages/ReviewLinkPage').then((m) => ({ default: m.ReviewLinkPage })));
const WaitlistPage = lazy(() => import('./pages/WaitlistPage').then((m) => ({ default: m.WaitlistPage })));
import { TopBar } from './ui/TopBar';

function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const onChange = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return pathname;
}

export function App() {
  const pathname = usePathname();
  const [language, setLanguage] = useLanguage();
  const [theme, setTheme] = useTheme();
  const route = parseRoute(pathname);
  const slug = route.name === 'not-found' ? '' : route.slug;
  const session = useClientSession(slug);

  const topBar = (
    <TopBar
      language={language}
      onLanguageChange={setLanguage}
      theme={theme}
      onThemeChange={setTheme}
      account={slug ? session.account : null}
      onAccountNav={slug ? (view) => navigate(accountPath(slug, view)) : undefined}
    />
  );

  if (route.name === 'not-found') {
    return (
      <>
        {topBar}
        <div className="xp-empty" role="alert">
          <h1>{translate(language, 'pub_page_not_found_title')}</h1>
          <p>{translate(language, 'pub_page_not_found_text')}</p>
        </div>
      </>
    );
  }

  return (
    <>
      {topBar}
      <Suspense
        fallback={
          <div className="xp-empty" role="status">
            <span className="xp-spinner" aria-hidden="true" />
          </div>
        }>
      {route.name === 'manage' ? <ManagePage slug={route.slug} token={route.token} language={language} /> : null}
      {route.name === 'waitlist' ? <WaitlistPage slug={route.slug} token={route.token} language={language} /> : null}
      {route.name === 'review' ? <ReviewLinkPage slug={route.slug} token={route.token} language={language} /> : null}
      {route.name === 'profile' ? <ProfilePage slug={route.slug} itemId={route.itemId} language={language} account={session.account} /> : null}
      {route.name === 'account' && route.view !== 'cuenta' ? <AccountPage slug={route.slug} view={route.view} language={language} account={session.account} onAuthenticated={session.setAccount} /> : null}
      {route.name === 'account' && route.view === 'cuenta' ? <MyAccountPage slug={route.slug} language={language} account={session.account} onAccountChange={session.setAccount} onLogout={() => void session.logout()} /> : null}
      </Suspense>
    </>
  );
}
