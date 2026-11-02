# Checklist de QA — CRM Nuevo Amanecer del Pacífico

Guía de pruebas manuales para el cliente. Marque cada casilla al verificarla.
Cada módulo incluye **caminos felices** (✅) y **rutas de fallo** (⛔), que deben ser rechazadas.

## Preparación

- [ ] Entorno de pruebas (o desarrollo) con el seed ejecutado. En desarrollo existen: Super Admin (`SEED_SUPERADMIN_EMAIL`), `gerente@…`, `asistente@…` y `colaborador@…` (dominio `SEED_DEV_EMAIL_DOMAIN`).
- [ ] Tenga a mano cuatro navegadores o ventanas privadas, una por rol.
- [ ] Para las pruebas de "forzar URL" use la barra de direcciones o las herramientas de desarrollador (pestaña Red / consola: `fetch('/api/…', { method: 'DELETE' })`).
- [ ] Ejecute antes `npm run audit:security`: debe terminar en **AUDITORÍA SUPERADA**.

---

## 1. Inicio de sesión y sesiones

✅ Caminos felices
- [ ] La pantalla de login se ve dividida 50/50 (panel azul con logo y mensaje; formulario a la derecha) sobre fondo azul claro. En celular se apila.
- [ ] Ingresar con credenciales válidas lleva al inicio según el rol.
- [ ] El botón **Cerrar sesión** del encabezado devuelve al login; al pulsar "Atrás" no se recupera la sesión.
- [ ] Tras 15 min de inactividad la sesión se renueva sola (no se pide login mientras el navegador siga abierto hasta 7 días).
- [ ] Perfil → **Cambiar contraseña** (mín. 12 caracteres): cierra todas las sesiones y pide ingresar de nuevo con la nueva.
- [ ] Perfil → **Cerrar todas las sesiones**: la sesión abierta en otro navegador deja de funcionar.

⛔ Rutas de fallo
- [ ] Contraseña errada, email inexistente y cuenta desactivada muestran **el mismo** mensaje: "Email o contraseña incorrectos".
- [ ] Cinco intentos fallidos seguidos: el **6.º**, incluso con la contraseña correcta, sigue mostrando el mismo mensaje (cuenta bloqueada 15 min).
- [ ] Un administrador ve la cuenta como **Bloqueada** en Usuarios y puede **Desbloquearla**; después el login funciona.
- [ ] Contraseña nueva de menos de 12 caracteres → rechazada.
- [ ] Cookies: en Herramientas de desarrollador → Aplicación → Cookies, las cookies de sesión son `HttpOnly`, `Secure`, `SameSite=Strict` y no son legibles con `document.cookie`.

## 2. Recuperación de contraseña

✅ Caminos felices
- [ ] "¿Olvidó su contraseña?" muestra un mensaje genérico; en Auditoría aparece "Solicitud de recuperación".
- [ ] Usuarios → **Restablecer contraseña** genera un enlace de un solo uso (60 min) y cierra las sesiones del usuario.
- [ ] Abrir el enlace, fijar una contraseña nueva e ingresar con ella.

⛔ Rutas de fallo
- [ ] Reusar el mismo enlace → "El enlace no es válido o ya expiró".
- [ ] La solicitud con un email inexistente muestra exactamente el mismo mensaje que con uno real.

## 3. Usuarios, roles y permisos

✅ Caminos felices
- [ ] Gerente/Super Admin: crear usuario (queda con "Clave temporal" y debe cambiarla al ingresar), editar nombre, cambiar rol, desactivar y reactivar.
- [ ] Cambiar el rol de un usuario conectado lo obliga a ingresar de nuevo.
- [ ] **Roles y permisos** muestra la matriz de `matrix.json` en solo lectura.

⛔ Rutas de fallo
- [ ] Gerente: no puede crear un Super Admin ni editar, desactivar o restablecer a un Super Admin (botones ausentes; vía API → 404).
- [ ] Nadie puede cambiar su propio rol ni desactivarse a sí mismo.
- [ ] Asistente/Colaborador: el menú no muestra Usuarios, Roles ni Auditoría; abrir `/usuarios` muestra "Página no encontrada" y `GET /api/users` → 403.

## 4. Catálogo: servicios, categorías y convenios

✅ Caminos felices
- [ ] Gerente: crear categoría, servicio (valor público, costo, puntos) y convenio con % de descuento por categoría; editar y desactivar/activar.
- [ ] Vista en tarjetas y en tabla; en celular la tabla se desplaza horizontalmente dentro de su tarjeta.

⛔ Rutas de fallo
- [ ] Nombre duplicado (aunque cambien mayúsculas) → "Ya existe un registro con ese nombre".
- [ ] Desactivar una categoría con servicios activos → rechazado.
- [ ] Descuento mayor a 100% → rechazado.
- [ ] Asistente: ve el catálogo pero sin botones de edición; `POST /api/categorias` → 403.
- [ ] **Asistente fuerza URL de borrado**: `fetch('/api/servicios/<id>', { method: 'DELETE' })` → 404 y el servicio sigue existiendo (solo hay desactivación lógica).
- [ ] Colaborador: ve servicios y categorías **sin valores en dinero**, no ve la pestaña Convenios; `GET /api/convenios` → 403.

## 5. Pacientes y registro de servicios (RF-08)

✅ Caminos felices
- [ ] **Registrar servicios**: la primera casilla es la cédula. Con una cédula nueva se habilitan nombre, apellido, teléfono y medio de origen (Redes Sociales, Televisión, Referido, Otro).
- [ ] Con una cédula existente aparece **"El paciente ya está registrado"**, los datos personales quedan deshabilitados y solo se pueden elegir servicios.
- [ ] Varios servicios en una misma atención, cada uno con colaborador y convenio. El valor a cobrar refleja el descuento del convenio para la categoría.
- [ ] **Otros (ingresar valor manual)** solo aparece tras hacer clic; exige valor y motivo.
- [ ] En "Registros de los últimos 7 días": **Editar** un registro y abrir **Historial** — aparece quién registró y quién modificó, con fecha y hora.
- [ ] Gerente: **Anular** un registro con motivo; deja de contar en el tablero.
- [ ] **Pacientes**: buscar por cédula o nombre, ver historial de servicios y citas, editar datos de contacto (la cédula no se puede cambiar).

⛔ Rutas de fallo
- [ ] Fecha de atención futura → rechazada.
- [ ] Valor manual sin motivo → rechazado.
- [ ] Seleccionar como colaborador a alguien que no tenga rol Colaborador (vía API) → rechazado.
- [ ] Crear paciente con cédula repetida → "El paciente ya está registrado".
- [ ] Asistente intenta anular (vía API `PATCH /api/servicios-realizados/<id>/anular`) → 403.
- [ ] Asistente fuerza `DELETE /api/servicios-realizados/<id>` → 404; el registro sigue en la lista.

## 6. Agenda

✅ Caminos felices
- [ ] Crear cita buscando al paciente por cédula (o creándolo), con servicio y colaborador opcionales; solo se ofrecen horarios libres de 30 min.
- [ ] Colores: **amarillo** (en 2 días), **naranja** (mañana u hoy), **rojo** (vencida sin cumplir). El panel "Alertas" las lista.
- [ ] Confirmar; marcar **Cumplida** con resultado y, opcionalmente, **agendar cita de control**.
- [ ] **Aplazar**: la cita queda "Aplazado", se crea la nueva y el horario original vuelve a estar libre.
- [ ] Marcar **Ausente** una cita de hoy o anterior.

⛔ Rutas de fallo
- [ ] Agendar dos citas a la misma fecha y hora → "El horario seleccionado ya está ocupado" (los horarios ocupados aparecen tachados).
- [ ] Agendar en el pasado o a una hora fuera de :00/:30 (vía API) → rechazado.
- [ ] Cambiar el estado de una cita ya Cumplida/Ausente/Aplazada → rechazado.
- [ ] Colaborador: no ve Agenda; `GET /api/citas/disponibilidad?fecha=…` → 403.

## 7. Inasistencias

✅ Caminos felices
- [ ] Gráficas de columnas del mes (cambiar con las flechas): estado de los seguimientos, motivos, canal con comunicación lograda (Llamada / WhatsApp), reagendó / no reagendó y responde / no responde. Cada gráfica tiene valores, tooltip al pasar el mouse y botón **Tabla**.
- [ ] La tabla "Seguimientos del mes" muestra la columna **Estado**: Pendiente (sin cerrar), Responde o No responde, y se filtra por estado. El teléfono permite llamar desde el celular.
- [ ] **Registrar** un seguimiento con canal Llamada o WhatsApp y "Responde": exige motivo (Imprevisto, Falta de dinero, Tiempo, No recordaba, Otros); opcionalmente "El paciente reagenda" abre el calendario y crea la nueva cita.
- [ ] Registrar "No responde": no pide motivo ni permite reagendar; queda con estado No responde.
- [ ] Las gráficas y el estado se actualizan al guardar.

⛔ Rutas de fallo
- [ ] Motivo "Otros" sin observación → rechazado.
- [ ] Cerrar dos veces la misma inasistencia → "La inasistencia ya fue cerrada".
- [ ] Canal distinto de Llamada/WhatsApp (vía API) → rechazado.

## 7b. Ajustes visuales
- [ ] Al crear o editar servicio, categoría o convenio, los botones Cancelar / Guardar tienen margen inferior y no tocan el borde del recuadro.
- [ ] Las tarjetas de Servicios, Categorías y Convenios son más compactas (más tarjetas por fila, menos alto).

## 8. Metas, comisiones y recurrencia

✅ Caminos felices
- [ ] **Metas y comisiones**: asignar a un colaborador meta en puntos, en dinero y valor del punto adicional. Se muestra la propuesta en 4 semanas; la semana 4 incluye los días 22 a fin de mes (29–31).
- [ ] Ajustar manualmente la distribución semanal (debe sumar la meta).
- [ ] Configurar puntos de recurrencia para los niveles ≥ 60% y ≥ 80%.
- [ ] Verificar la comisión en el tablero: con meta 40 pts, 70 pts logrados y $2.000 por punto → $60.000. Con menos de 40 pts → $0.

⛔ Rutas de fallo
- [ ] Distribución semanal que no suma la meta → rechazada.
- [ ] Nivel 80% con menos puntos que el nivel 60% → rechazado.
- [ ] Asistente: `PUT /api/metas` → 403.

## 9. Vista del Colaborador (privacidad)

✅ Caminos felices
- [ ] Al ingresar como Colaborador el inicio es **Mi progreso**: puntos acumulados (incluido el bono de recurrencia), meta, faltantes, % alcanzado y avance por semana.
- [ ] **Mis citas del mes**: solo cantidades por día (cumplidas / no cumplidas / programadas).
- [ ] Tasa de recurrencia global en porcentaje.

⛔ Rutas de fallo (no debe aparecer en ninguna pantalla ni respuesta)
- [ ] Ningún nombre, cédula ni teléfono de pacientes.
- [ ] Ninguna cifra en dinero: valores, costos, metas en dinero, comisiones, margen o rentabilidad. Revisar también la respuesta de `/api/mi-progreso` en la pestaña Red.
- [ ] No hay ocupación general de agenda.
- [ ] Forzar `/`, `/pacientes`, `/agenda`, `/registro`, `/metas` → "Página no encontrada" o su propio progreso; `GET /api/tablero`, `/api/pacientes?q=a`, `/api/servicios-realizados` → 403.

## 10. Tablero gerencial (Gerente y Super Admin)

✅ Caminos felices
- [ ] KPIs del mes: ingreso total, costo total, utilidad neta, margen %, servicios realizados, servicios agendados, pacientes nuevos y comisiones.
- [ ] Reporte por colaborador: puntos y dinero vs meta (mensual y por semana) y comisión.
- [ ] Reporte por servicio: ranking de más realizados, utilidad, margen y etiquetas "Más rentable" / "Menos rentable".
- [ ] Convenios más usados con el descuento otorgado; pacientes nuevos por medio de origen.
- [ ] Tasa de recurrencia: con ≥ 60% / ≥ 80% muestra el bono aplicado y el colaborador con meta lo ve sumado en sus puntos.
- [ ] Cambiar de mes con las flechas recalcula todo.

⛔ Rutas de fallo
- [ ] Asistente y Colaborador: `GET /api/tablero` → 403; su inicio no muestra cifras financieras.

## 11. Auditoría

✅ Caminos felices
- [ ] **Auditoría** lista inicios de sesión (éxito y fallo), bloqueos, cambios de rol, restablecimientos y cada creación/edición/anulación (servicios, citas, cierres, metas, catálogo).
- [ ] Filtrar por acción y "Cargar más".

⛔ Rutas de fallo
- [ ] Los registros no se pueden editar ni borrar (no hay botones; en BD los triggers lo impiden — cubierto por `npm run audit:security`).
- [ ] Asistente/Colaborador: `GET /api/audit-logs` → 403.

## 12. PWA, diseño y responsive

- [ ] En producción (https) el navegador ofrece **Instalar app**; abre a pantalla completa con ícono y color azul institucional.
- [ ] Sin conexión, la aplicación abre su estructura (app shell) y muestra un error de red amable al consultar datos.
- [ ] Al cerrar sesión se borran los datos de API cacheados (Herramientas → Aplicación → Cache Storage: `api-data` desaparece).
- [ ] Probar anchos 360, 768, 1024 y 1440 px: menú lateral fijo en escritorio y desplegable en móvil; botones de al menos 44 px; en iPhone el contenido respeta la muesca (safe area).
- [ ] Colores: azul #1E65D6 primario, rojo #D90429 para acciones destructivas y alertas, tarjetas KPI con ícono circular azul.

## 13. Cargos del personal clínico

- [ ] Como Gerente, **Usuarios → Nuevo usuario**: el selector **Rol** ofrece Odontólogo, Higienista, Auxiliar y Especialista (colaboradores), además de Asistente y Gerente. Super Admin solo aparece para un Super Admin.
- [ ] La lista de usuarios muestra el cargo de cada colaborador (p. ej. «Higienista» con «Colaborador» debajo).
- [ ] Cambiar el cargo de un colaborador no cierra sus sesiones; cambiar el rol sí.
- [ ] **Servicios y convenios → Servicios → Editar**: «Cargos que realizan el servicio» exige al menos uno; la lista muestra los cargos bajo el nombre del servicio.
- [ ] **Registrar servicios** y **Nueva cita**: al elegir un servicio, el selector de colaborador muestra solo a quienes tienen un cargo que lo realiza (nombre · cargo). Si el colaborador elegido no aplica, se limpia.
- [ ] La Asistente aparece como colaboradora (registro, metas, desempeño del tablero) y tiene **Mi progreso** en el menú.
- [ ] Como Colaborador, el catálogo muestra solo los servicios de su cargo.
