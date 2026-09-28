import { translate } from '@xiro/shared';
import { useEffect, useState } from 'react';
import { useLanguage } from './lib/lang';
import { parseRoute } from './lib/route';
import { ManagePage } from './pages/ManagePage';
import { ProfilePage } from './pages/ProfilePage';

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
  const language = useLanguage();
  const route = parseRoute(pathname);

  if (route.name === 'not-found') {
    return (
      <div className="xp-empty" role="alert">
        <h1>{translate(language, 'pub_page_not_found_title')}</h1>
        <p>{translate(language, 'pub_page_not_found_text')}</p>
      </div>
    );
  }
  if (route.name === 'manage') return <ManagePage slug={route.slug} token={route.token} language={language} />;
  return <ProfilePage slug={route.slug} language={language} />;
}
