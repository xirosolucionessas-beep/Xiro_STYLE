import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { actorOf } from '@/lib/access';
import { useSession } from '@/lib/session';
import { useSettings } from '@/lib/settings';
import { useShellMode, usePersistentBool } from '@/web/shell/hooks';
import { describeRoute } from '@/web/shell/routes';
import { useFormEnhancements } from '@/web/shell/useFormEnhancements';
import { useInertHidden } from '@/web/shell/useInertHidden';
import { AssistantContext } from '@/web/shell/assistantContext';
import { HeaderSearchContainer, HeaderToolsContainer, SidebarPlan } from '@/web/shell/HeaderContainers';
import { ShellView } from '@/web/shell/ShellView';
import { useWebText } from '@/web/services/useWebText';
import { Brand } from '@/ui/Brand';
import { AssistantPanel } from '@/web/ui/AssistantPanel';
import { FloatingAssistant } from '@/web/ui/FloatingAssistant';
import { FloatingWhatsApp } from '@/web/ui/FloatingWhatsApp';
import { SubscriptionGate } from '@/web/ui/SubscriptionGate';
import { useQueryHealth } from './useQueryHealth.web';
import { applyTheme } from '@/web/styles';

/** Estructura de la web: sidebar/drawer, migas, <main>, títulos de página y foco al navegar. Solo web. */
export function WebShell({ children }: { children: ReactNode }) {
  const { status, business, user } = useSession();
  const { theme } = useSettings();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ id?: string }>();
  const router = useRouter();
  const mode = useShellMode();
  const [collapsed, toggleCollapsed] = usePersistentBool('xw.sidebar.collapsed', false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);
  useInertHidden(mainRef);

  const search = typeof params.id === 'string' ? '?id=1' : '';
  const route = useMemo(() => describeRoute(pathname, search), [pathname, search]);
  const { t, language } = useWebText();
  useFormEnhancements(mainRef);
  const dataStatus = useQueryHealth(t);

  useEffect(() => {
    applyTheme(theme);
    document.documentElement.lang = language;
  }, [theme, language]);

  useEffect(() => {
    const title = t(route.titleKey);
    document.title = `${title} · ${t('page_title_suffix')}`;
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    // SPA: anuncia la página nueva y mueve el foco al contenido (tras cerrar el drawer, si estaba abierto).
    setAnnouncement(title);
    const id = setTimeout(() => mainRef.current?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(id);
  }, [route.titleKey, pathname, t]);

  // El drawer solo existe en móvil: al ensanchar la ventana se descarta (ajuste de estado durante el render).
  if (mode !== 'mobile' && drawerOpen) setDrawerOpen(false);

  const openAssistant = useCallback(() => setAssistantOpen(true), []);
  const assistant = useMemo(() => ({ open: openAssistant }), [openAssistant]);
  const signedIn = status === 'signedIn';

  return (
    <AssistantContext.Provider value={assistant}>
      <ShellView
        mode={mode}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        route={route}
        t={t}
        signedIn={signedIn}
        actor={actorOf(user)}
        headerSearch={signedIn ? <HeaderSearchContainer mode={mode} /> : undefined}
        headerTools={signedIn ? <HeaderToolsContainer mode={mode} /> : undefined}
        sidebarExtra={signedIn ? <SidebarPlan navigate={(href) => router.navigate(href as never)} /> : undefined}
        brand={{ name: business?.name ?? t('app_name'), logo: <Brand size={40} logoUrl={business?.logoUrl} /> }}
        navigate={(href) => router.navigate(href)}
        drawerOpen={drawerOpen}
        onDrawerOpenChange={setDrawerOpen}
        announcement={announcement}
        mainRef={mainRef}
        status={dataStatus}
        floating={
          route.hideFloating ? null : (
            <>
              <FloatingWhatsApp language={language} businessName={business?.name} label={t('whatsapp_float_label')} />
              <FloatingAssistant label={t('assistant_float_label')} open={assistantOpen} onPress={() => setAssistantOpen((value) => !value)} />
              <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} t={t} />
            </>
          )
        }>
        {children}
      </ShellView>
      <SubscriptionGate t={t} language={language} />
    </AssistantContext.Provider>
  );
}
