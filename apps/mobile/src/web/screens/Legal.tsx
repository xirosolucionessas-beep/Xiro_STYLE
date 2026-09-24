import { supportMailtoUrl, supportWhatsappUrl, supportMessage, XIRO_CONTACT } from '../config/contact.web';
import { Ico } from '../icons';
import { Button } from '../ui';
import { useWebStyles } from '../ui/shared';

type T = (key: string) => string;

interface LegalPageViewProps {
  t: T;
  language: 'es' | 'en';
  /** Vuelve a la pantalla anterior (normalmente el registro). */
  onBack: () => void;
  /** Prefijo de las claves de traducción de este documento ('terms' o 'privacy'): ver src/web/strings/legal.ts. */
  prefix: 'terms' | 'privacy';
  sectionCount: number;
}

/** Página legal genérica: tarjetas numeradas + contacto + botón fijo para volver. Términos y Privacidad son documentos independientes que comparten esta presentación. */
function LegalPageView({ t, language, onBack, prefix, sectionCount }: LegalPageViewProps) {
  useWebStyles();
  const sections = Array.from({ length: sectionCount }, (_, i) => i + 1);
  return (
    <div className="xw-terms">
      <div className="xw-terms-scroll">
        <div className="xw-terms-in">
          <h1 className="xw-terms-title">{t(`${prefix}_page_title`)}</h1>
          <p className="xw-asub">{t(`${prefix}_page_sub`)}</p>
          <ol className="xw-terms-list">
            {sections.map((n) => (
              <li key={n} className="xw-tcard">
                <span className="xw-tcard-num" aria-hidden="true">
                  {n}
                </span>
                <div>
                  <h2 className="xw-tcard-title">{t(`${prefix}_${n}_title`)}</h2>
                  <p className="xw-tcard-body">{t(`${prefix}_${n}_body`)}</p>
                </div>
              </li>
            ))}
            <li className="xw-tcard">
              <span className="xw-tcard-num" aria-hidden="true">
                {sectionCount + 1}
              </span>
              <div>
                <h2 className="xw-tcard-title">{t(`${prefix}_contact_title`)}</h2>
                <p className="xw-tcard-body">
                  {t(`${prefix}_contact_pre`)}
                  <a className="xw-wlink xw-wlink--inline" href={supportWhatsappUrl(supportMessage(language))} target="_blank" rel="noopener noreferrer" aria-label={`${t('support_whatsapp_label')}: ${XIRO_CONTACT.whatsappDisplay} (${t('opens_new_tab')})`}>
                    <Ico name="message-circle" size={16} />
                    {XIRO_CONTACT.whatsappDisplay}
                  </a>
                  {t(`${prefix}_contact_mid`)}
                  <a className="xw-wlink xw-wlink--inline" href={supportMailtoUrl()} aria-label={`${t('support_email_label')}: ${XIRO_CONTACT.email}`}>
                    <Ico name="mail" size={16} />
                    {XIRO_CONTACT.email}
                  </a>
                  .
                </p>
              </div>
            </li>
          </ol>
        </div>
      </div>
      <div className="xw-terms-foot">
        <div className="xw-terms-foot-in">
          <Button fullWidth icon={<Ico name="arrow-left" size={18} />} onPress={onBack}>
            {t('legal_back')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface LegalDocProps {
  t: T;
  language: 'es' | 'en';
  onBack: () => void;
}

export function TermsView(props: LegalDocProps) {
  return <LegalPageView {...props} prefix="terms" sectionCount={6} />;
}

export function PrivacyView(props: LegalDocProps) {
  return <LegalPageView {...props} prefix="privacy" sectionCount={6} />;
}
