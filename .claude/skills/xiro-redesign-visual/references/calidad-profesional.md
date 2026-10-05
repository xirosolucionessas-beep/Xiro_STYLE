# Estándares para que se vea profesional y moderno

## Sistema base
- **Espaciado**: escala de 4 px (4, 8, 12, 16, 24, 32, 48). Nada fuera de la escala.
- **Tipografía**: escala con razón fija (p. ej. 12, 14, 16, 20, 24, 32). Cuerpo mínimo 14 px
  en móvil. Interlineado 1.4 a 1.5 en cuerpo y 1.1 a 1.25 en titulares. Líneas de menos de 80 caracteres.
- **Dinero**: cifras tabulares, formato COP con separador de miles, alineado a la derecha en
  listas; moneda y signo con peso menor que el número.
- **Radios**: tres niveles como máximo (controles, contenedores, hojas) con proporciones
  distintas; no un único radio para todo.
- **Elevación**: separar con color de superficie y líneas finas antes que con sombras.
  Sombras solo para lo flotante (hojas, menús, botón de acción).
- **Íconos**: cuadrícula de 24 px, trazo constante, tamaño propio por contexto.
- **Contraste**: 4.5:1 texto normal, 3:1 texto grande e íconos funcionales, en ambos temas.
- **Táctil**: 44 px o más en móvil; separación entre objetivos de 8 px o más.
- **Densidad**: es una herramienta de trabajo diaria; prioriza lectura rápida de datos sobre decoración.

## Componentes
- Botón primario (uno por pantalla), secundario, de texto y destructivo; estados reposo,
  presionado, deshabilitado, cargando.
- Campo con etiqueta fija, ayuda y error debajo; foco claro; teclado adecuado al tipo de dato.
- Fila de lista con jerarquía de dos niveles y acción secundaria a la derecha.
- Hoja inferior (móvil) o panel lateral (web) para detalle y formularios cortos.
- Estados: vacío (qué falta y cómo crearlo), cargando (marcador del contenido real,
  sin brillos), error (qué pasó y qué hacer), sin conexión.
- Navegación: barra inferior en móvil con la acción central ya existente; menú lateral
  colapsable en escritorio. Título de pantalla siempre visible.

## Plano por pantalla
Ver `diagnostico-pantallas.md` (funciones a conservar y rediseño de cada pantalla) y
`sistema-de-diseno.md` (colores, tipografía, formas y qué componente usar para cada función).

## Paridad entre plataformas
Misma identidad (color, tipografía, formas) y distinto layout según convención: barra
inferior y hojas en móvil, menú lateral y paneles en web. iOS: títulos grandes y gestos
de retroceso respetados; Android: ripple/estado presionado visible y barra del sistema coherente.

## Cierre
Antes de entregar, quita un adorno por pantalla y revisa que lo memorable sea uno solo.
