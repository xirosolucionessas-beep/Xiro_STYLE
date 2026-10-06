# Sistema de diseño propuesto (punto de partida; ajustar con el usuario)

**Lenguaje**: el libro de citas y el cartel de precios de la barbería. Renglones, columnas
de cifras alineadas, líneas finas, papel cálido, latón y cuero. La barbería aparece en los
materiales y en UN gesto por pantalla, no en adornos repartidos por todas partes.

## Color (contrastes calculados; todos cumplen 4.5:1 en texto)
| Token | Oscuro | Claro |
|---|---|---|
| fondo | #151311 | #F5F1E9 |
| superficie | #1D1A17 | #FFFFFF |
| superficie elevada | #26221E | #FBF8F2 |
| línea | #38322B | #E1D9CA |
| texto | #EDE7DB (15:1) | #1E1A15 (15:1) |
| texto secundario | #A39A8B (6.2:1) | #6A6154 (5.4:1) |
| acento (relleno de botón y marca) | #C6A25A | #C6A25A |
| texto sobre acento | #1A1610 (7.5:1) | #1A1610 (7.5:1) |
| acento como texto/enlace | #C6A25A (7.2:1) | #7A5C1B (5.5:1) |
| éxito | #6BAA7F | #2F7A4B |
| aviso (naranja, no amarillo) | #E58A52 | #9A4E1C |
| peligro | #E0705D | #B3402F |
| información | #7E9DB8 | #3E6786 |

Reglas de color:
- El acento ocupa menos del 10 % de la pantalla: botón primario, foco, marca, un dato clave.
- Éxito, aviso y peligro siempre con ícono o texto además del color.
- Rojo solo para errores y acciones destructivas; una caída en una métrica no es un error.
- Modo claro y oscuro con el mismo peso de diseño. Probar ambos antes de entregar.
- Si el usuario prefiere el dorado más vivo del logo, úsalo solo en el logo.

## Tipografía
Por defecto: **IBM Plex Sans** (cuerpo y datos, 400/500/600) + **IBM Plex Sans Condensed**
(titulares, 600/700). Tienen tildes y ñ, cifras tabulares y se ven sobrias, no de moda.
Alternativa: **Barlow** + **Barlow Semi Condensed**. Verifica los paquetes con
`npm view @expo-google-fonts/ibm-plex-sans-condensed` antes de instalar y pruébalas en
Android, iOS y web (pesos y carga).
- Escala: 12, 14, 16, 20, 24, 32. Cuerpo 14 o 15 en escritorio, 16 en móvil.
- Titular de página 28 a 32 en peso 600, sin tracking negativo exagerado.
- Cifras de dinero: `fontVariant: ['tabular-nums']`, alineadas a la derecha en listas.
- Etiquetas en minúscula normal, 12 a 13 px, color secundario. Nada de mayúsculas espaciadas.

## Forma
- Espaciado: 4, 8, 12, 16, 24, 32, 48.
- Radios: controles 8, contenedores 12, hojas y diálogos 16 arriba, avatares y estados circulares.
- Bordes de 1 px en el color línea. Sombra solo para menús, hojas y diálogos.
- Contenedor de página con ancho máximo de 1120 a 1200 px en escritorio, centrado, el mismo
  en todas las pantallas (hoy varía entre pantallas).
- Quitar el contorno dorado que aparece alrededor del área principal (parece el foco del
  navegador sobre el contenedor) y dejar el foco visible solo en controles.

## Componentes y cuándo usar cada uno
| Función | Componente |
|---|---|
| Secciones de una pantalla (Equipo/Actividad, Enlace/Información/Reglas…) | Pestañas con subrayado |
| Cambiar la vista (Día/Semana, periodo del reporte) | Control segmentado |
| Filtrar una lista (categoría, estado, profesional) | Chips pequeños, seleccionados con relleno de superficie elevada y texto fuerte |
| Estado de un registro (Disponible, Publicado, Activo) | Punto de color + texto |
| Permisos de un empleado | Texto en gris separado por comas |
| Acción principal | Botón relleno de acento (uno por vista) |
| Acción secundaria | Botón con contorno neutro |
| Acción menor | Botón de texto |
| Idioma, tema, notificaciones | Control segmentado / interruptor |
| Lista de datos | Filas con líneas finas; columnas numéricas a la derecha |
| Producto | Tarjeta con imagen 4:3, nombre, precio |
| Vacío | Texto corto + acción, sin borde punteado |

## Identidad de barbería
- **Materiales**: latón cepillado (el acento), cuero y carbón (superficies oscuras), hueso o
  papel (modo claro), azulejo y espejo como referencia de limpieza y orden.
- **Cartel de precios**: las listas de servicios (Catálogo, Reservas públicas, lista de
  beneficios de la bienvenida) pueden leerse como un cartel: nombre, línea de guía, precio con
  cifras tabulares. Es el gesto más propio de la marca.
- **Tira de poste**: una franja fina estática en rojo, hueso y gris azulado, solo en zonas de
  marca (bienvenida, cabecera del logo, impresión del catálogo). Nunca junto a mensajes de
  error ni en cada tarjeta, porque el rojo ya significa peligro.
- **Ilustración**: dibujos de línea simples (tijera, navaja, peine, silla) solo en estados
  vacíos y en imágenes de reemplazo, con el trazo del set de íconos.
- **Fotografía**: fotos reales de cortes y del local en catálogo y reservas; sin fondos de
  madera ni texturas de cuero como imagen de fondo.
- **Evitar clichés**: bigotes, tijeras cruzadas como logotipo de interfaz, tipografías
  "western" o vintage, marcos con adornos, el poste en cada botón.

## Estructura base (afecta a todas las pantallas; se hace primero)
- **Menú lateral**: logo y nombre del negocio arriba; elementos con ícono y texto; activo con
  superficie elevada; contraer al fondo. La alerta del plan pasa a franja compacta.
- **Barra superior**: buscador a la izquierda, campana, mensajes y cuenta a la derecha; la miga
  de pan en gris pequeño, sin subrayado dorado.
- **Asistente y WhatsApp**: acciones pequeñas y discretas que no tapan contenido. El asistente
  conserva su función y su `accessibilityLabel`, con ícono de conversación en vez de destellos.
  WhatsApp conserva el logo reconocible.

## Archivo semilla
`assets/tokens.ejemplo.ts` tiene los tokens como código; adáptalo al tema que ya exista en `src/`.
