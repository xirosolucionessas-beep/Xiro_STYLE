/**
 * Ruta "/" SOLO WEB (nativo: index.tsx, sin cambios). Panel de inicio: cabecera de cuenta, balance del día
 * (base inicial de caja; la API no registra ingresos del día, ver nota en el resumen de la fase), aviso de WhatsApp
 * del negocio y accesos rápidos. Presentación en src/web/screens/Home.tsx.
 */
import { useQueryClient } from '@tanstack/react-query';
import { actorOf, meets, type Requirement } from '@/lib/access';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { apiErrors } from '@/lib/forms';
import { keys, useCashToday } from '@/lib/queries';
import { useAuthed, useSession } from '@/lib/session';
import { Brand } from '@/ui/Brand';
import { useDialogs } from '@/ui/Dialogs';
import { Screen } from '@/ui/Screen';
import { localDateKey } from '@/web/date';
import { HomeView, type HomeAction } from '@/web/screens/Home';
import { photoToFormData } from '@/web/services/imageUpload.web';
import { useWebText } from '@/web/services/useWebText';
import { CashOpeningModal } from '@/web/ui/CashOpeningModal';
import { validatePhotoFile } from '@/web/ui/PhotoPicker';

const DISMISS_KEY = 'xiro.cashPrompt.dismissed';

function dismissedToday(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === localDateKey();
  } catch {
    return false;
  }
}
function dismissToday(): void {
  try {
    localStorage.setItem(DISMISS_KEY, localDateKey());
  } catch {
    /* almacenamiento bloqueado: se volverá a preguntar en la próxima carga, no es grave */
  }
}

export default function HomeWeb() {
  const router = useRouter();
  const { t } = useWebText();
  const { user, business } = useAuthed();
  const { setBusiness } = useSession();
  const { toast } = useDialogs();
  const queryClient = useQueryClient();
  const isOwner = user.role === 'owner';
  const cash = useCashToday(isOwner);
  const fileInput = useRef<HTMLInputElement>(null);

  const [manualCashOpen, setManualCashOpen] = useState(false);
  const [dismissed, setDismissed] = useState(dismissedToday);
  const [logoBusy, setLogoBusy] = useState(false);

  const opening = cash.data?.opening;
  const autoPrompt = isOwner && cash.isSuccess && !opening && !dismissed;
  const cashModalOpen = manualCashOpen || autoPrompt;

  const closeCashModal = () => {
    setManualCashOpen(false);
    if (!opening) {
      setDismissed(true);
      dismissToday();
    }
  };

  async function submitCashOpening(input: { amount: number; note: string }) {
    try {
      await api.openCash(input);
      await queryClient.invalidateQueries({ queryKey: keys.cash });
      setManualCashOpen(false);
      setDismissed(true);
      dismissToday();
      return { ok: true };
    } catch (error) {
      const result = apiErrors(error, t);
      return { ok: false, general: result.general ?? Object.values(result.fields)[0] };
    }
  }

  async function onLogoFile(file: File | undefined) {
    if (!file) return;
    const problem = validatePhotoFile(file);
    if (problem) return toast(t(problem));
    const uri = URL.createObjectURL(file);
    setLogoBusy(true);
    try {
      setBusiness(await api.uploadLogo(await photoToFormData({ uri }, 'logo')));
    } catch (error) {
      toast(apiErrors(error, t).general ?? t('unknown_error'));
    } finally {
      URL.revokeObjectURL(uri);
      setLogoBusy(false);
    }
  }

  const actor = actorOf(user);
  const allActions: Array<HomeAction & { requires?: Requirement }> = [
    { id: 'new_service', icon: 'plus', label: t('new_service'), href: '/item/form', requires: ['catalog_manage'] },
    { id: 'appointments', icon: 'calendar-days', label: t('appointments'), soon: true, requires: 'owner' },
    { id: 'catalog', icon: 'book-open', label: t('catalog'), href: '/catalog', requires: ['catalog_view'] },
    { id: 'inventory', icon: 'package', label: t('inventory'), href: '/inventory', requires: ['catalog_view'] },
    { id: 'cash_close', icon: 'receipt', label: t('cash_close'), soon: true, requires: 'owner' },
    { id: 'clients', icon: 'users', label: t('clients'), href: '/clients', requires: ['clients_view'] },
  ];
  const actions: HomeAction[] = allActions.filter((action) => meets(actor, action.requires)).map((action) => ({ id: action.id, icon: action.icon, label: action.label, href: action.href, soon: action.soon }));

  return (
    <>
      {/* Igual que el resto de pantallas: el scroll vive dentro de <Screen> (el body no hace scroll, ver dist/index.html). */}
      <Screen>
        <HomeView
          t={t}
          userName={user.name}
          businessSlug={business.slug}
          logo={<Brand size={56} logoUrl={business.logoUrl} />}
          onChangeLogo={() => fileInput.current?.click()}
          logoBusy={logoBusy}
          onEditProfile={() => router.push('/profile')}
          balanceAmount={opening ? opening.amount : null}
          currency={business.currency}
          onOpenCash={() => setManualCashOpen(true)}
          showBalance={isOwner}
          needsWhatsappSetup={isOwner && !business.whatsapp}
          onGoBusinessSettings={() => router.push('/business')}
          actions={actions}
          navigate={(href) => router.navigate(href)}
        />
      </Screen>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="xw-sr"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ''; // permite volver a elegir el mismo archivo
          void onLogoFile(file);
        }}
      />
      {isOwner ? <CashOpeningModal open={cashModalOpen} onClose={closeCashModal} currentAmount={opening?.amount ?? 0} currency={business.currency} t={t} onSubmit={submitCashOpening} onSkip={closeCashModal} /> : null}
    </>
  );
}
