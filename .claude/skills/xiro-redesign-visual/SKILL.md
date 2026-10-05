---
name: rediseno-visual-seguro
description: Rediseña SOLO la capa visual (colores, tipografía, espaciado, íconos, componentes, jerarquía, textos de interfaz) de la plataforma Xiro Style / Derekcell / DEREK en web, Android e iOS (proyecto Expo / React Native con TypeScript), para que se vea profesional, moderna y sin los patrones típicos de interfaces hechas por IA, sin eliminar ni modificar la lógica ya programada. Úsala siempre que el usuario pida rediseñar, modernizar, "mejorar el diseño", "que se vea profesional", "que no parezca hecho por IA", cambiar el estilo, tema o look de cualquier pantalla (bienvenida, login, inicio, citas, catálogo, inventario, clientes, caja, reservas), o igualar el aspecto entre web, Android e iOS, aunque no diga la palabra "skill" ni nombre la plataforma.
---

# Rediseño visual seguro (Xiro Style / Derekcell)

## Regla de oro

**Cambia lo que se ve; no cambies lo que hace.** Si una mejora visual exige tocar lógica
(estado, llamadas a API, navegación, validaciones, permisos, base de datos), NO se hace:
se anota en "Pendientes que requieren lógica" y se le pregunta al usuario.

Lee `references/contrato-solo-visual.md` antes de editar cualquier archivo.

## Archivos de apoyo
| Archivo | Cuándo leerlo |
|---|---|
| `references/contrato-solo-visual.md` | Siempre, antes de editar |
| `references/plataformas.md` | Paso 1: estructura del proyecto Expo y dónde vive cada cosa |
| `references/anti-ia.md` | Pasos 2 y 3: 27 patrones genéricos, dónde aparecen hoy y cómo reemplazarlos |
| `references/diagnostico-pantallas.md` | Pasos 2, 4 y 5: funciones a conservar y rediseño de cada pantalla |
| `references/sistema-de-diseno.md` | Pasos 3 y 4: color con contrastes, tipografía, formas y qué componente usar |
| `references/calidad-profesional.md` | Paso 3 y 4: escalas, componentes, estados y paridad entre plataformas |
| `assets/tokens.ejemplo.ts` | Paso 4: semilla del archivo de tokens |
| `scripts/inventario.py` | Pasos 0 y 5: foto de las funciones antes y después |
| `scripts/verificar_solo_visual.py` | Paso 5: revisión del diff de git |

## Flujo (sigue el orden)

### 0. Congelar el estado actual
- Revisa `git status`. Si hay cambios sin guardar (en este proyecto había más de 200),
  pide al usuario hacer un commit "estado antes del rediseño" para que el verificador
  compare solo el rediseño. Luego crea la rama `rediseno-visual`.
- Genera la foto funcional:
  `python scripts/inventario.py --repo . --out REDISENO_antes.json`
  Registra handlers, `testID`, rutas/navegación, endpoints, claves de traducción y funciones.
- Haz también la línea base técnica: `npx tsc --noEmit`, `npm test` y `npx eslint src`.
  Anota lo que ya falla antes de tu cambio para no cargarlo al rediseño.

### 1. Leer el proyecto
Sigue `references/plataformas.md`. El proyecto es Expo (React Native + TypeScript) con
salida web, Android (`android/` generado) e iOS (por EAS). Recorre `src/` para ubicar
pantallas, componentes, tema, navegación e i18n. Si no existe un archivo de tokens, créalo
en un solo lugar (`src/theme/`) y haz que los componentes lo consuman.

### 2. Diagnóstico visual
Mira capturas o corre la app (`npx expo start`, tecla `w` para web). Compara pantalla por
pantalla contra `references/anti-ia.md` y `references/diagnostico-pantallas.md`. Distingue lo
que es **marca** (logo Xiro, nombre, color del logo) de lo que es **decoración por defecto**.

Contexto del producto: Xiro Style es una aplicación de gestión EXCLUSIVAMENTE para
barberías. Cada barbería pone su propio nombre y logo (la cuenta "DEREK" de las capturas es
una de ellas), así que el diseño debe verse bien con cualquier logo, pero su identidad sí
puede y debe hablar de barbería (ver "Identidad de barbería" en `sistema-de-diseno.md`),
evitando los clichés. Una pantalla sin captura se rediseña solo después de verla corriendo
o de leer su código.

### 3. Plan de diseño y revisión
Antes de escribir código redacta el plan, siguiendo `references/calidad-profesional.md`:
- **Color**: 4 a 6 colores con nombre y hex, en modo oscuro y claro.
- **Tipografía**: una o dos familias con roles, escala definida, tildes y ñ.
- **Forma y espaciado**: escala de espaciado, radios por jerarquía, tratamiento de bordes.
- **Layout**: por pantalla clave, wireframe ASCII y cuál elemento domina.
- **Principios**: qué hace único este diseño y en qué UN lugar se concentra lo memorable.

Punto de partida: `references/sistema-de-diseno.md` (libro de citas y cartel de precios de barbería,
paleta con contrastes verificados, IBM Plex Sans + Sans Condensed). Ajústalo con el usuario,
no lo apliques a ciegas. Aplica las dos pruebas de `anti-ia.md` (cambio de industria y tapar
el logo); si falla, reemplaza esa parte y di qué cambiaste. Si hay duda de gusto, ofrece
2 direcciones.

### 4. Implementar por capas (de menos a más riesgo)
1. **Tokens y tema** (colores, tipografía, radios, sombras, espaciado), claro y oscuro.
2. **Componentes base** (botón, campo, tarjeta, chip, barra inferior, menú lateral,
   encabezado, lista, hoja inferior, estados vacíos y de carga).
3. **Estructura base** (menú lateral, barra superior, acciones flotantes, franja del plan):
   afecta a todas las pantallas, por eso va antes que ellas.
4. **Pantallas**, en el orden de `diagnostico-pantallas.md`, una por una.
5. **Responsivo por plataforma**: móvil (Android/iOS) y escritorio (web) con su convención.

Reglas de edición:
- Agrega estilos nuevos; no renombres ni borres IDs, clases, `testID`, `nativeID`,
  `accessibilityLabel` ni claves de traducción que el código use. Haz `grep` antes.
- Conserva cada handler (`onPress`, `onClick`, listeners) exactamente igual; cambia solo el
  contenedor visual que lo rodea.
- Si cambias un texto visible, cambia el **valor** en ES y EN, nunca la clave.
- Los hallazgos de datos o cálculos (por ejemplo la variación "-100%" de Reportes) se anotan
  en "Pendientes que requieren lógica"; solo se cambia cómo se ven.
- Todo botón o sección existente sigue existiendo y haciendo lo mismo aunque cambie de forma
  o de lugar dentro de la pantalla. Si algo debe pasar a otra pantalla, es navegación: pregunta.
- Zonas sensibles ya corregidas: barra de navegación y áreas seguras en Huawei/Xiaomi/Infinix,
  scroll del Inicio, recuperar cuenta, botón de WhatsApp, catálogo público. Solo cambia su apariencia.
- No edites carpetas generadas (`dist/`, `android/app/build`, `.expo/`, `node_modules/`).
- Recarga y revisa después de cada pantalla. Un cambio por vez.

### 5. Verificar que fue solo visual
```bash
python scripts/inventario.py --repo . --compare REDISENO_antes.json
python scripts/verificar_solo_visual.py --repo . --base <commit-base>
npx tsc --noEmit && npm test && npx eslint src
npx expo export --platform web
```
- `inventario.py --compare` dice qué handler, `testID`, ruta, endpoint, clave de traducción
  o función existía antes y ya no. Cada alerta se resuelve o se justifica.
- El verificador revisa el diff: cambios en carpetas de lógica, tests, configuración.
- Los tests y el tipado deben quedar igual que en la línea base.
- Recorre la app en web y en un dispositivo/emulador Android; en iOS usa Expo Go o un build
  de EAS si hay acceso a un iPhone.

Revisión visual mínima: 360 px de ancho y pantalla grande, oscuro y claro, ES y EN (textos
largos no rompen), teclado abierto, zona segura/notch, contraste, foco visible en web,
objetivos táctiles de 44 px o más, y lectura con texto del sistema agrandado.

### 6. Entrega
Informa por plataforma: qué cambió, qué NO se tocó, alertas pendientes y "Pendientes que
requieren lógica". Sin adjetivos de venta: hechos y capturas antes/después.

## Qué NO hacer
- No reescribir la app ni migrar de framework.
- No añadir librerías salvo fuentes e íconos, y avisando.
- No cambiar textos de errores del servidor, validaciones ni reglas de negocio.
- No usar íconos de destellos ni lenguaje de "IA" en la interfaz salvo que el usuario lo
  pida; el asistente conserva su función con otra apariencia.
