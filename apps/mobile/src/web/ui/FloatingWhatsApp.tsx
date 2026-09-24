import { WhatsAppLogo } from '../brand/logos';
import { supportMessage, supportWhatsappUrl } from '../config/contact.web';
import { useWebStyles } from './shared';

/**
 * Botón flotante de soporte de Xiro (sección 4A): círculo verde fijo en la esquina inferior derecha, presente en toda
 * pantalla con sesión iniciada. Abre el WhatsApp OFICIAL de Xiro (no el del cliente; eso es "Enviar al cliente por
 * WhatsApp" en la ficha de servicio) con un mensaje prellenado que incluye el negocio cuando se conoce.
 */
export function FloatingWhatsApp({ language, businessName, label }: { language: 'es' | 'en'; businessName?: string | null; label: string }) {
  useWebStyles();
  return (
    <a
      className="xw-fab xw-fab--whatsapp"
      href={supportWhatsappUrl(supportMessage(language, businessName))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}>
      <WhatsAppLogo size={28} tone="white" />
    </a>
  );
}
