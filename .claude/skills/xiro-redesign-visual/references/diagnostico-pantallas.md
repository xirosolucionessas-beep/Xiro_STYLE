# Diagnóstico y plano por pantalla (según capturas web actuales)

Para cada pantalla: **Funciones que deben seguir existiendo** (checklist) y **Rediseño**.
Los datos de prueba ("sfaasf", "asfaf@gmail.com", localhost) son datos, no interfaz: no se tocan.
Textos y datos de otro rubro (no se cambian solos; avisar al usuario como pendientes): la
bienvenida dice "negocio de belleza" y las categorías iniciales incluyen "Tratamientos" y
"UÑAS", pero la app es solo para barberías. El texto visible se cambia en ES y EN con permiso;
las categorías son datos y quedan como pendiente.
Pantallas sin captura (Clientes, Fidelización, Registrar venta, Cierre de caja, editar cita,
nueva cita, Mis planes, Reservas públicas): pedir captura o leer el código antes de rediseñar.

## Orden de trabajo
1. Estructura base (menú lateral, barra superior, acciones flotantes, alerta del plan).
2. Inicio → Citas → Catálogo → Inventario → Empleados → Reportes → Mi página web → Ajustes → Bienvenida.
Cada pantalla reutiliza los componentes ya creados; si falta uno, se crea primero.

## Inicio
Funciones: saludo, 5 métricas (ventas hoy, servicios hoy, citas hoy, clientes nuevos hoy, base de
caja), accesos (Registrar venta, Citas, Catálogo, Inventario, Cierre de caja, Clientes), Próximas
citas + "Ver agenda", Resumen del día, Bajo inventario + "Ver inventario", Actividad reciente.
Rediseño: dominante = ventas y caja de hoy en una franja de métricas con la cifra de ventas más
grande; columna principal con Actividad reciente como libro de caja (hora, concepto, importe a la
derecha); columna lateral con Próximas citas, Resumen y Bajo inventario como listas simples con
líneas finas. Accesos como fila de botones de texto con ícono; "Registrar venta" es el botón
primario. Saludo corto con fecha ("Lunes 5 de octubre"), sin frase de relleno.

## Citas
Funciones: Nueva cita (dos lugares), día anterior/siguiente, Día/Semana, filtro Todos y por
profesional, selector de día de la semana, resumen (citas, por confirmar, ingresos del día),
estado vacío.
Rediseño: control segmentado Día/Semana a la izquierda y chips de profesionales (con iniciales)
separados visualmente; tira de fechas compacta con el día seleccionado en superficie elevada;
resumen como franja de tres cifras; el botón inferior pasa a ser la acción del estado vacío
("Aún no hay citas este día. Agenda la primera"), conservando ambos botones.

## Catálogo
Funciones: Categorías, Enviar catálogo, Descargar Catálogo PDF, Agregar al catálogo, 4 métricas,
filtro por categoría, tarjetas de producto (imagen, nombre, descripción, precio).
Rediseño: jerarquía de botones (primario "Agregar al catálogo"; "Enviar catálogo" y "Descargar
PDF" con contorno neutro; "Categorías" de texto). Métricas en una sola línea de franja. Tarjetas
con imagen 4:3, nombre en 600, descripción gris de una línea, precio con cifras tabulares. Sin
imagen: superficie elevada con un dibujo de línea simple (tijera, navaja o peine) o las iniciales, no un ícono dentro de un cuadro.

## Inventario
Funciones: Categorías, Agregar al inventario, 5 métricas, filtros por categoría y por estado,
nota de sincronización con el catálogo, contador de resultados, tabla (selección, artículo,
categoría, stock, estado, costo unitario, catálogo), Publicado/Despublicar, abrir detalle.
Rediseño: filtros en una sola barra con chips pequeños y etiquetas en gris; tabla con
encabezados en minúscula normal, cifras tabulares a la derecha, estado como punto + texto,
"Publicado" como texto con punto y "Despublicar" como botón de texto, fila completa clicable
con flecha discreta. La nota de sincronización va como texto auxiliar bajo el título.

## Empleados
Funciones: 3 métricas, pestañas Equipo/Actividad, Nuevo empleado, por empleado: avatar, nombre,
correo, estado, permisos, Editar, Desactivar.
Rediseño: lista tipo tabla con filas separadas por líneas: avatar, nombre y correo, permisos en
texto gris separados por comas, estado como punto + texto, Editar con contorno neutro y
Desactivar como texto. Métricas en una franja. Texto introductorio más corto y en gris.

## Reportes
Funciones: periodo (Hoy, Esta semana, Este mes, Este año, Rango personalizado), rango de fechas,
Descargar Reporte PDF, Exportar a Excel, 5 métricas, alerta de variación, Ventas por día,
Formas de pago, Rendimiento por profesional, estados vacíos.
Rediseño: control segmentado para el periodo; botones de exportar con contorno neutro; métricas en
franja con la variación como texto pequeño junto a la cifra, color según significado (sin
banner rojo gigante); gráficos con ejes discretos y una sola serie en el acento; vacíos con
texto corto, sin borde punteado.
Pendiente que requiere lógica (no tocar): la variación compara el periodo en curso (5 a 11 de
octubre, apenas empezado) con el anterior completo, y resulta "-100%" aunque no hay motivo de
alarma. Comparar con los mismos días transcurridos es un cambio de cálculo: preguntar.

## Mi página web
Funciones: volver, pestañas Enlace/Información/Reglas/Equipo/Reseñas, estado "página lista",
interruptor Página publicada, enlace con Copiar enlace, Abrir, WhatsApp, campo de dirección,
Ver si está libre, Cambiar dirección, Usar el nombre del negocio, nota sobre redirección.
Rediseño: pestañas con subrayado; el aviso de "Todo listo" y el interruptor de publicación en
un solo panel de estado (siguen siendo dos elementos); enlace como campo de solo lectura con
"Copiar enlace" como acción primaria pegada al campo, Abrir y WhatsApp secundarias; campo de
dirección con borde neutro y foco claro.

## Ajustes
Funciones: Cuenta y negocio (cuenta, datos del negocio, categorías, plan, fidelización, equipo),
Preferencias (idioma, modo oscuro), Notificaciones (interruptor), Ayuda y sesión (WhatsApp,
Cerrar sesión).
Rediseño: una lista de ajustes con ancho de lectura de unos 720 px, secciones con título pequeño,
filas con ícono sin cuadro, valor actual a la derecha y flecha; idioma como control segmentado;
interruptores con el acento; "Cerrar sesión" en color de peligro como único elemento rojo.

## Bienvenida / acceso
Funciones: ES/EN, cambio de tema, Iniciar sesión, Crear cuenta, Google y Apple (próximamente),
Términos y condiciones, contacto (teléfono y correo), lista de beneficios.
Rediseño: marca y titular sobrio sin palabra resaltada; beneficios como cartel de precios de barbería
(concepto, línea de guía y descripción corta) con la tira de poste fina como único adorno; panel de acceso sin resplandor; Google y Apple con el mismo estilo
que el botón secundario y "Próximamente" como texto auxiliar.
