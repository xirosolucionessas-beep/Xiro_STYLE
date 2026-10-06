import { translate } from '@xiro/shared';
import { useEffect, useState } from 'react';
import { useLanguage } from './lib/lang';
import { parseRoute } from './lib/route';
import { useTheme } from './lib/theme';
import { ManagePage } from './pages/ManagePage';
import { ProfilePage } from './pages/ProfilePage';
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

  const topBar = <TopBar language={language} onLanguageChange={setLanguage} theme={theme} onThemeChange={setTheme} />;

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
      {route.name === 'manage' ? <ManagePage slug={route.slug} token={route.token} language={language} /> : <ProfilePage slug={route.slug} language={language} />}
    </>
  );
}
