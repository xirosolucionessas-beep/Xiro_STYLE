/** "Calle 10 #5-20, Bogotá, Colombia" a partir de los campos sueltos del negocio; omite los que estén vacíos. */
export function businessAddressLine(address: string, city: string, country: string): string {
  return [address, city, country].map((part) => part.trim()).filter(Boolean).join(', ');
}
