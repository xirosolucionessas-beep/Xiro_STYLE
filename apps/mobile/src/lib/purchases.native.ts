/**
 * Envoltorio de RevenueCat (StoreKit 2 en iOS, Play Billing en Android detrás de un único SDK). Sufijo `.native.ts`:
 * Metro nunca lo incluye en el build web (ahí no existe este módulo nativo; la Web usa Stripe/PayPal en su lugar).
 *
 * El SDK se carga BAJO DEMANDA y nunca en Expo Go: Expo Go no trae el módulo nativo de RevenueCat y, con solo importarlo,
 * la app no arranca ("There was a problem running the project"). Fuera de Expo Go (build de desarrollo o producción)
 * funciona igual que siempre. En Expo Go el paywall queda en su estado "no disponible" (precios indicativos y sin
 * compra), que es el mismo que ya muestra cuando faltan las claves de RevenueCat.
 *
 * El id de negocio (`businessId`) se usa como `appUserID` de RevenueCat: así el webhook que llega al backend
 * (`app_user_id`) ya identifica el negocio sin necesitar una tabla de mapeo aparte.
 *
 * Los planes deben configurarse en RevenueCat con los tipos de paquete predefinidos "$rc_monthly" / "$rc_annual"
 * (accesibles aquí como `offering.monthly` / `offering.annual`), y el producto correspondiente en App Store Connect
 * / Google Play Console debe llamarse `xiro_monthly` / `xiro_yearly` (así lo espera el webhook del backend).
 */
import type { SubscriptionPlan } from '@xiro/shared';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type { CustomerInfo, PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { PurchasesUnavailableError, purchasesUsable } from './purchasesGuard';

type Sdk = typeof import('react-native-purchases');

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const apiKey = () => Platform.select({ ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY, android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY });

let configured = false;
let loadFailed = false;
let loading: Promise<Sdk | null> | null = null;

export const purchasesAvailable = (): boolean => purchasesUsable({ inExpoGo, apiKey: apiKey(), loadFailed });

/** Carga el SDK una sola vez. Devuelve `null` (sin lanzar) si no se puede: Expo Go, sin claves o sin módulo nativo. */
function loadSdk(): Promise<Sdk | null> {
  if (!purchasesAvailable()) return Promise.resolve(null);
  loading ??= import('react-native-purchases').catch((error: unknown) => {
    loadFailed = true;
    if (__DEV__) console.warn('[purchases] No se pudo cargar RevenueCat (¿falta el módulo nativo en esta compilación?):', error);
    return null;
  });
  return loading;
}

/** Llamar una vez, con sesión iniciada, antes de mostrar cualquier paywall o de consultar ofertas. Nunca lanza. */
export async function configurePurchases(businessId: string): Promise<void> {
  if (configured) return;
  const key = apiKey();
  if (!key) {
    if (__DEV__ && !inExpoGo) console.warn('[purchases] Falta EXPO_PUBLIC_REVENUECAT_IOS_API_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY — el paywall no podrá cargar ofertas.');
    return;
  }
  const sdk = await loadSdk();
  if (!sdk) return;
  try {
    if (__DEV__) await sdk.default.setLogLevel(sdk.LOG_LEVEL.WARN);
    sdk.default.configure({ apiKey: key, appUserID: businessId });
    configured = true;
  } catch (error) {
    loadFailed = true;
    if (__DEV__) console.warn('[purchases] RevenueCat no se pudo configurar:', error);
  }
}

/** Oferta vigente, o `null` si RevenueCat no está disponible aquí (la pantalla lo muestra como "no disponible"). */
export async function currentOffering(): Promise<PurchasesOffering | null> {
  const sdk = await loadSdk();
  if (!sdk || !configured) return null;
  const offerings = await sdk.default.getOfferings();
  return offerings.current;
}

export function packageForPlan(offering: PurchasesOffering, plan: SubscriptionPlan): PurchasesPackage | null {
  return plan === 'monthly' ? offering.monthly : offering.annual;
}

export async function purchasePlan(pkg: PurchasesPackage): Promise<CustomerInfo> {
  const sdk = await loadSdk();
  if (!sdk || !configured) throw new PurchasesUnavailableError();
  const { customerInfo } = await sdk.default.purchasePackage(pkg);
  return customerInfo;
}

export async function restore(): Promise<CustomerInfo> {
  const sdk = await loadSdk();
  if (!sdk || !configured) throw new PurchasesUnavailableError();
  return sdk.default.restorePurchases();
}

/** true si `customerInfo` refleja algún derecho activo (cualquier suscripción vigente, del plan que sea). */
export function hasActiveEntitlement(customerInfo: CustomerInfo): boolean {
  return Object.keys(customerInfo.entitlements.active).length > 0;
}
