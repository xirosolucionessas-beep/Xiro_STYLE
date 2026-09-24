/**
 * Contacto con el que se inició la recuperación, en memoria y de un solo uso: permite entrar directamente tras elegir la nueva
 * contraseña sin poner el correo/teléfono en la URL del paso final. No se guarda en ningún almacenamiento del navegador.
 */
let identifier: string | null = null;

export const setRecoveryIdentifier = (value: string) => {
  identifier = value;
};

export function takeRecoveryIdentifier(): string | null {
  const value = identifier;
  identifier = null;
  return value;
}
