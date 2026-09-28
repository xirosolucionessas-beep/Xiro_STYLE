import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom no implementa el desplazamiento de elementos; el flujo lo usa al cambiar de paso.
Element.prototype.scrollTo = function scrollTo() {};
