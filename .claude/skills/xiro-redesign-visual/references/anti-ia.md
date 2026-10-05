# Patrones de interfaz "hecha por IA" y cómo evitarlos

## Dos pruebas rápidas
1. **Cambio de industria**: cambia mentalmente "barbería" por "gimnasio" o "banco". Si el
   diseño sirve igual sin tocar nada, es genérico: falta algo propio de la barbería.
2. **Tapar el logo**: cubre logo y nombre. Si podría ser cualquier SaaS, falta identidad.

## Patrones genéricos (revisa cada uno)
**Color y superficie**
1. Fondo casi negro con UN acento brillante (dorado, verde ácido, bermellón) en todo.
2. Negro puro o teñido (#0B0B0B, #111) como "oscuro por defecto".
3. Degradados o resplandores de color alrededor de tarjetas y cabeceras.
4. Vidrio esmerilado, manchas de degradado borrosas al fondo.
5. Fondo crema con serif de alto contraste y acento terracota.

**Estructura**
6. Todo es tarjeta: mismo radio, mismo borde, mismo fondo, mismos márgenes.
7. Bloque de métrica repetido: ícono en cuadro + etiqueta + número grande + variación.
8. Rejillas simétricas de 2 a 5 elementos del mismo peso.
9. Encabezado de página con ícono en cuadro con borde + título + subtítulo, en TODAS las pantallas.
10. Píldoras para todo: pestañas, filtros, estados, permisos, idioma.
11. Insignias en píldora por todos lados ("Próximamente", "Activo", "Publicado").
12. Barra lateral con el elemento activo en relleno translúcido del color de acento.
13. Estado vacío con borde punteado, círculo con ícono y frase centrada.
14. Alerta fija con borde rojo y corona que acompaña toda la navegación.
15. Dos o más botones flotantes redondos fijos sobre el contenido.

**Botones y texto**
16. Varios botones con contorno del color de acento en la misma fila: no hay jerarquía.
17. Etiquetas pequeñas en MAYÚSCULAS con color de acento ("FILTRAR POR CATEGORÍA", "PERIODO",
    "TU ENLACE") y encabezados de tabla en mayúsculas.
18. Todo en negrita (800 en titulares, 700 en títulos de fila, 700 en botones).
19. Una palabra del titular en color de acento ("Todo bajo **control**").
20. Puntos medios entre datos, "→" y flechas en botones, numeración 01/02/03 sin secuencia.
21. Copys de relleno ("Hoy es un gran día para hacer crecer tu negocio", "Lo que más usas, a un clic").
22. Enlaces subrayados en color de acento (migas de pan, "Ver agenda").

**Iconografía y movimiento**
23. Ícono de destellos/chispas para el asistente o cualquier función "inteligente".
24. Emojis como íconos; mezcla de sets de íconos con distinto trazo.
25. Entradas animadas en cada sección, hover/rebote en cada tarjeta, brillos que pasan.
26. Botones de terceros (Google, Apple) con estilo fuera de la paleta.
27. Banners de alerta enormes con un porcentaje gigante en rojo para una variación de datos.
28. El extremo contrario, cliché de barbería: bigotes, tijeras cruzadas, fondo de madera,
    tipografía vintage y el poste de barbero en todas partes.

## Lectura de las capturas actuales (web)
- **Todas las pantallas**: #9 (encabezado ícono-en-cuadro), #12 (menú activo dorado), #14
  (tarjeta "Tu plan Xiro" roja fija), #15 (destellos + WhatsApp flotando), #22 (migas
  "Inicio" subrayadas en dorado), #1 y #2 (negro con dorado en todo), #18 (negritas).
- **Inicio**: #7/#6 (cinco tarjetas KPI), #8 (mosaico de accesos), #21 (saludo de relleno), #3.
- **Citas**: #10 (vista Día/Semana y profesionales en la misma fila de píldoras), #16 (dos
  botones "Nueva cita" en la misma vista), #13.
- **Catálogo**: #16 (cuatro botones de contorno dorado en el encabezado), #7, #17.
- **Inventario**: #17 (etiquetas de filtro y encabezados en mayúsculas doradas), #10/#11
  (filtros, estado y "Publicado" como píldoras), #7.
- **Empleados**: #7, #10/#11 (permisos y "Activo" como píldoras), #16 (Editar con contorno dorado).
- **Reportes**: #27 (banner "-100%" en rojo), #13, #17 ("PERIODO"), #16, #7.
- **Mi página web**: #10 (pestañas en píldoras), #17 ("TU ENLACE"), #16 (tres botones dorados).
- **Ajustes**: #9, #6 (filas con ícono en cuadro y tarjetas), #10.
- **Bienvenida**: #19, #3, #26, #11.
- Marca que se conserva: logo Xiro, nombre y el dorado del logo como referencia. El logo y el
  nombre de la barbería (DEREK) los pone cada cliente: el diseño debe funcionar con cualquier logo,
  y la identidad de barbería viene de los materiales y de un gesto por pantalla.

## Cómo reemplazarlos (resumen; detalle en `sistema-de-diseno.md`)
- **Jerarquía**: en cada pantalla UN elemento domina; el resto se ve más quieto.
- **Un componente por función**: pestañas (subrayado) para secciones, control segmentado para
  modo de vista, chips pequeños para filtros, punto + texto para estados, enlaces de texto para
  acciones menores. Nunca píldora para todo.
- **Jerarquía de botones**: uno primario relleno por vista; secundarios con contorno neutro;
  terciarios como texto. El acento no es el color de todos los contornos.
- **Métricas**: una franja con separadores finos (sin ícono por métrica), con una cifra
  dominante más grande. Alertas de variación dentro de la métrica, no como banner.
- **Encabezado de página**: título y subtítulo, acciones a la derecha, sin ícono en cuadro;
  la miga de pan en gris pequeño.
- **Menú activo**: fondo de superficie elevada y texto en peso 600; el acento queda para la
  acción primaria, el foco y la marca.
- **Acciones flotantes**: una sola zona discreta, pequeña y sin tapar contenido.
- **Alerta de plan**: franja compacta (punto de aviso + "Pago pendiente" + enlace "Ver mi plan").
- **Texto**: etiquetas en minúscula normal con color secundario; frases concretas; vacíos que
  invitan a actuar; sin saludo de relleno.
- **Movimiento**: solo respuesta a acciones; respeta "reducir movimiento".
