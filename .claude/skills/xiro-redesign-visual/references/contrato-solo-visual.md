# Contrato "solo visual"

## Se puede cambiar
- Colores, tipografías, tamaños, pesos, interlineado, radios, sombras, bordes, opacidades.
- Espaciado, alineación, orden y tamaño de elementos dentro de una pantalla, siempre que
  todos sigan presentes y con la misma acción.
- Íconos e ilustraciones (conservando significado y accesibilidad).
- Estilos de estados: presionado, enfocado, deshabilitado, vacío, cargando, error.
- Animaciones que respondan a una acción del usuario (abrir, expandir, confirmar).
- Texto visible de interfaz (valores en ES y EN) cuando mejora la claridad.
- Archivos de tema: CSS/SCSS, `StyleSheet`, `colors.xml`, `themes.xml`, `styles.xml`,
  `Assets.xcassets`, modificadores SwiftUI, fuentes.

## No se puede cambiar (pedir permiso antes)
- Funciones, hooks, estado, reductores, contextos, validaciones, cálculos.
- Llamadas a API, endpoints, consultas, esquemas, base de datos, autenticación, permisos.
- Rutas y estructura de navegación; qué pantalla abre cada botón.
- IDs, `testID`, `nativeID`, nombres de clase referenciados desde JS, claves de traducción.
- Orden de campos de formularios que afecte envío o validación.
- Configuración de ventana, barras del sistema y áreas seguras ya corregidas por dispositivo.
- Dependencias, versiones, `AndroidManifest.xml`, `Info.plist`, `.env` (salvo fuentes/íconos).

## Protocolo ante un conflicto
1. Detente en ese punto, no improvises una solución con lógica.
2. Describe el problema y la opción visual más cercana que respeta el contrato.
3. Si el usuario autoriza tocar lógica, hazlo aparte, en commit separado.

## Prueba rápida de cada cambio
"Si pego este cambio sobre la versión anterior, ¿algún botón hace algo distinto o deja de
existir?" Si la respuesta es sí o no estás seguro, no es un cambio visual.
