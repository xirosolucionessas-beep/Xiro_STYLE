/**
 * Envoltorio de RevenueCat (StoreKit 2 en iOS, Play Billing en Android detrás de un único SDK). Sufijo `.native.ts`:
 * Metro nunca lo incluye en el build web (ahí no existe este módulo nativo; la Web usa Stripe/PayPal en su lugar).
 *
 * El id de negocio (`businessId`) se usa como `appUserID` de RevenueCat: así el webhook que llega al backend
 * (`app_user_id`) ya identifica el negocio sin necesitar una tabla de mapeo aparte.
 *
 * Los planes deben configurarse en RevenueCat con los tipos de paquete predefinidos "$rc_monthly" / "$rc_annual"
 * (accesibles aquí como `offering.monthly` / `offering.annual`), y el producto correspondiente en App Store Connect
 * / Google Play Console debe llamarse `xiro_monthly` / `xiro_yearly` (así lo espera el webhook del backend).
 */
import type { SubscriptionPlan } from '@xiro/shared';
import Purchases, { LOG_LEVEL, type CustomerInfo, type PurchasesOffering, type PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';

let configured = false;

export const purchasesAvailable = (): boolean => Boolean(Platform.select({ ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY, android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY }));

/** Llamar una vez, con sesión iniciada, antes de mostrar cualquier paywall o de consultar ofertas. */
export async function configurePurchases(businessId: string): Promise<void> {
  if (configured) return;
  const apiKey = Platform.select({ ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY, android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY });
  if (!apiKey) {
    if (__DEV__) console.warn('[purchases] Falta EXPO_PUBLIC_REVENUECAT_IOS_API_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY — el paywall no podrá cargar ofertas.');
    return;
  }
  if (__DEV__) await Purchases.setLogLevel(LOG_LEVEL.WARN);
  Purchases.configure({ apiKey, appUserID: businessId });
  configured = true;
}

export async function currentOffering(): Promise<PurchasesOffering | null> {
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

export function packageForPlan(offering: PurchasesOffering, plan: SubscriptionPlan): PurchasesPackage | null {
  return plan === 'monthly' ? offering.monthly : offering.annual;
}

export async function purchasePlan(pkg: PurchasesPackage): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

export async function restore(): Promise<CustomerInfo> {
  return Purchases.restorePurchases();
}

/** true si `customerInfo` refleja algún derecho activo (cualquier suscripción vigente, del plan que sea). */
export function hasActiveEntitlement(customerInfo: CustomerInfo): boolean {
  return Object.keys(customerInfo.entitlements.active).length > 0;
}
