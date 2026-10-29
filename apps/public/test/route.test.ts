import { describe, expect, it } from 'vitest';
import { itemPath, managePath, parseRoute, profilePath } from '../src/lib/route';

describe('rutas de la página pública', () => {
  it('reconoce el perfil de un negocio', () => {
    expect(parseRoute('/reservar/mi-barberia')).toEqual({ name: 'profile', slug: 'mi-barberia' });
    expect(parseRoute('/reservar/mi-barberia/')).toEqual({ name: 'profile', slug: 'mi-barberia' });
  });

  it('reconoce el enlace directo a un servicio o producto (Fase 2)', () => {
    expect(parseRoute('/reservar/mi-barberia/articulo/11111111-1111-4111-8111-111111111111')).toEqual({ name: 'profile', slug: 'mi-barberia', itemId: '11111111-1111-4111-8111-111111111111' });
    expect(itemPath('mi negocio', 'abc')).toBe('/reservar/mi%20negocio/articulo/abc');
    expect(parseRoute('/reservar/mi-barberia/articulo')).toEqual({ name: 'not-found' });
  });

  it('reconoce el enlace de gestión de una cita', () => {
    expect(parseRoute('/reservar/mi-barberia/gestion/abc123')).toEqual({ name: 'manage', slug: 'mi-barberia', token: 'abc123' });
  });

  it('decodifica slugs y tokens con caracteres especiales', () => {
    expect(parseRoute('/reservar/mi%20negocio')).toEqual({ name: 'profile', slug: 'mi negocio' });
    expect(parseRoute('/reservar/x/gestion/a%2Fb')).toEqual({ name: 'manage', slug: 'x', token: 'a/b' });
  });

  it('cualquier otra forma es "no encontrado"', () => {
    expect(parseRoute('/')).toEqual({ name: 'not-found' });
    expect(parseRoute('/reservar')).toEqual({ name: 'not-found' });
    expect(parseRoute('/reservar/')).toEqual({ name: 'not-found' });
    expect(parseRoute('/reservar/x/y')).toEqual({ name: 'not-found' });
    expect(parseRoute('/reservar/x/gestion')).toEqual({ name: 'not-found' });
    expect(parseRoute('/otra-cosa')).toEqual({ name: 'not-found' });
  });

  it('arma las rutas con los caracteres especiales bien codificados', () => {
    expect(profilePath('mi negocio')).toBe('/reservar/mi%20negocio');
    expect(managePath('x', 'a/b+c')).toBe('/reservar/x/gestion/a%2Fb%2Bc');
  });
});
