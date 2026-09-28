import { describe, expect, it } from 'vitest';
import { formatCoords, googleMapsDirectionsUrl, parseLocationInput, roundCoord, wazeUrl } from '../src/geo';

const ok = (input: string) => {
  const result = parseLocationInput(input);
  if ('error' in result) throw new Error(`"${input}" → ${result.error}`);
  return result;
};
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 5);

describe('parseLocationInput · decimales', () => {
  it.each([
    ['4.0833, -76.2', 4.0833, -76.2],
    ['4.0833,-76.2', 4.0833, -76.2],
    ['4.0833 -76.2', 4.0833, -76.2],
    ['4.0833; -76.2', 4.0833, -76.2],
    ['(4.0833, -76.2)', 4.0833, -76.2],
    ['  4.65330 , -74.08360  ', 4.6533, -74.0836],
    ['4,0833; -76,2', 4.0833, -76.2], // coma como separador decimal
    ['4,0833, -76,2', 4.0833, -76.2],
    ['-33.8688, 151.2093', -33.8688, 151.2093],
  ])('%s', (input, lat, lng) => {
    const result = ok(input);
    expect(result.source).toBe('decimal');
    near(result.point.lat, lat);
    near(result.point.lng, lng);
  });

  it('fuera de rango se dice, no se adivina', () => {
    expect(parseLocationInput('95.5, 10')).toEqual({ error: 'out_of_range' });
    expect(parseLocationInput('10, 190')).toEqual({ error: 'out_of_range' });
  });
});

describe('parseLocationInput · grados, minutos y segundos', () => {
  it('el formato del enunciado: 4°05\'00"N 76°12\'00"W', () => {
    const result = ok('4°05\'00"N 76°12\'00"W');
    expect(result.source).toBe('dms');
    near(result.point.lat, 4 + 5 / 60);
    near(result.point.lng, -(76 + 12 / 60));
  });

  it('con las comillas tipográficas que pega el navegador y O de "oeste"', () => {
    const result = ok('4° 05′ 30″ N, 76° 12′ 15″ O');
    near(result.point.lat, 4 + 5 / 60 + 30 / 3600);
    near(result.point.lng, -(76 + 12 / 60 + 15 / 3600));
  });

  it('sur y oeste dan negativo, norte y este positivo', () => {
    const result = ok('33°52\'S 151°12\'E');
    expect(result.point.lat).toBeLessThan(0);
    expect(result.point.lng).toBeGreaterThan(0);
  });

  it('grados decimales con hemisferio, y hemisferio antes del número', () => {
    const a = ok('4.0833° N, 76.2° W');
    near(a.point.lat, 4.0833);
    near(a.point.lng, -76.2);
    const b = ok('N 4°05\' W 76°12\'');
    near(b.point.lat, 4 + 5 / 60);
    near(b.point.lng, -(76 + 12 / 60));
  });

  it('el orden no importa: el hemisferio dice cuál es la latitud', () => {
    const result = ok('76°12\'W 4°05\'N');
    near(result.point.lat, 4 + 5 / 60);
    near(result.point.lng, -(76 + 12 / 60));
  });

  it('el caso del reporte: pegar solo "4° 05′ N" no es una ubicación (falta la longitud)', () => {
    expect(parseLocationInput('4° 05′ N')).toEqual({ error: 'invalid' });
  });

  it('minutos o segundos de 60 en adelante son un error, no una coordenada', () => {
    expect(parseLocationInput('4°75\'N 76°12\'W')).toEqual({ error: 'invalid' });
  });

  it('una dirección con letras N/E no se confunde con coordenadas', () => {
    expect(parseLocationInput('Calle 5 N # 4-20')).toEqual({ error: 'invalid' });
    expect(parseLocationInput('Carrera 10 Este 20')).toEqual({ error: 'invalid' });
  });
});

describe('parseLocationInput · enlaces de Google Maps', () => {
  it('@lat,lng (centro de la vista)', () => {
    const result = ok('https://www.google.com/maps/@4.0833,-76.2,17z');
    expect(result.source).toBe('url');
    near(result.point.lat, 4.0833);
    near(result.point.lng, -76.2);
  });

  it('!3d…!4d… (el pin del lugar) gana sobre @, que es solo la vista', () => {
    const url = 'https://www.google.com/maps/place/Mi+Local/@4.1,-76.1,17z/data=!3m1!4b1!4m6!3m5!1s0x8e3:0x1!8m2!3d4.0833!4d-76.2!16s%2Fg%2F1';
    const result = ok(url);
    near(result.point.lat, 4.0833);
    near(result.point.lng, -76.2);
  });

  it('?q=lat,lng, ?query= y ?ll=', () => {
    for (const url of ['https://maps.google.com/?q=4.0833,-76.2', 'https://www.google.com/maps/search/?api=1&query=4.0833%2C-76.2', 'https://www.google.com/maps?ll=4.0833,-76.2&z=15']) {
      const result = ok(url);
      near(result.point.lat, 4.0833);
      near(result.point.lng, -76.2);
    }
  });

  it('un enlace corto se reconoce como tal para pedir el largo', () => {
    expect(parseLocationInput('https://maps.app.goo.gl/AbCdEf123')).toEqual({ error: 'short_link' });
    expect(parseLocationInput('https://goo.gl/maps/xyz')).toEqual({ error: 'short_link' });
  });

  it('un enlace sin coordenadas o con coordenadas imposibles', () => {
    expect(parseLocationInput('https://www.google.com/maps/place/Bogota')).toEqual({ error: 'invalid' });
    expect(parseLocationInput('https://www.google.com/maps/@95.0,-76.2,17z')).toEqual({ error: 'out_of_range' });
  });
});

describe('parseLocationInput · lo demás', () => {
  it('vacío y texto normal de una dirección', () => {
    expect(parseLocationInput('   ')).toEqual({ error: 'empty' });
    expect(parseLocationInput('Carrera 7 # 71-21, Bogotá')).toEqual({ error: 'invalid' });
  });
});

describe('enlaces de "cómo llegar" y formato', () => {
  it('Google Maps con el lugar, y sin él cuando no hay place_id', () => {
    expect(googleMapsDirectionsUrl({ lat: 4.0833, lng: -76.2, placeId: 'ChIJ abc' })).toBe('https://www.google.com/maps/dir/?api=1&destination=4.0833,-76.2&destination_place_id=ChIJ%20abc');
    expect(googleMapsDirectionsUrl({ lat: 4.0833, lng: -76.2 })).toBe('https://www.google.com/maps/dir/?api=1&destination=4.0833,-76.2');
  });

  it('Waze', () => {
    expect(wazeUrl({ lat: 4.0833, lng: -76.2 })).toBe('https://waze.com/ul?ll=4.0833,-76.2&navigate=yes');
  });

  it('redondea a 6 decimales', () => {
    expect(roundCoord(4.08333333333)).toBe(4.083333);
    expect(formatCoords({ lat: 4.0833, lng: -76.2 })).toBe('4.083300, -76.200000');
    expect(wazeUrl({ lat: 4.08333333333, lng: -76.2 })).toContain('ll=4.083333,-76.2&');
  });
});
