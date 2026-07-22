# Portal DistriElectronicDelCaribe

Generación y gestión de los formatos de servicio en PDF, con historial y edición.

## Características

- **Autenticación** con usuario y contraseña (Supabase Auth). Roles: **Trabajador** y **Jefe**.
- **Generar**: 5 formatos reales de la empresa — Formato de Actividades, Mantenimiento de UPS,
  Mantenimiento de Plantas Eléctricas, Reporte Técnico A.A y Reporte Técnico CCTV.
  Formulario dinámico por formato, con fotos (compresión automática), firma en pantalla,
  tablas de ítems, checklists y vista previa del PDF.
- **Historial / Editar**: lista con búsqueda; edita solo lo que necesites y regenera el PDF.
- **Gestión de Usuarios**: solo los Jefes crean, editan y eliminan trabajadores.
- **RLS**: cada usuario ve solo sus documentos; el Jefe ve todos.

## Cómo se genera el PDF

Los PDF **no se dibujan desde cero**: se rellenan las plantillas originales de la empresa
(`plantillas/*.pdf`) con [pdf-lib](https://pdf-lib.js.org/), todo en el navegador.

- `js/plantillas.js` — mapa de coordenadas de cada formato, medido sobre la plantilla real:
  cada dato cae sobre su línea y las X van centradas en su casilla.
- `js/pdf.js` — motor de relleno (centrado, ajuste de letra, firmas, páginas de fotos).
- `node tools/audit-campos.js` — cruza los campos del formulario con los del PDF y avisa si
  alguno se quedó sin imprimir. Ejecutar desde la carpeta `portal/`.

Si se cambia una plantilla, hay que volver a medir sus coordenadas en `plantillas.js`.

## Modo demo

Mientras `js/config.js` no tenga credenciales de Supabase, el portal corre en **modo demo**
(datos en el localStorage del navegador):

- Jefe: `jefe@demo.com` / `demo1234`
- Trabajador: `trabajador@demo.com` / `demo1234`

**No usar en producción.**

## Puesta en producción

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, pega todo [`supabase/schema.sql`](supabase/schema.sql) y dale Run.
   El archivo es idempotente: cada vez que cambie, se pega completo otra vez. No borra datos.
3. Primer Jefe: **Authentication → Users → Add user** (marca *Auto Confirm User*), copia su UUID
   y ejecuta el `insert into public.profiles ...` que está comentado al final del schema.
4. Despliega la Edge Function de usuarios ([Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase link --project-ref TU_PROJECT_REF
   supabase secrets set ALLOWED_ORIGIN=https://tu-portal.netlify.app
   supabase functions deploy admin-users
   ```
5. Copia **Settings → API → Project URL** y **anon public key** a [`js/config.js`](js/config.js).

### 2. Netlify

Sube el repositorio; `netlify.toml` publica la carpeta `portal/` sin build.

### 3. Datos de la empresa

Edita `COMPANY` en [`js/config.js`](js/config.js).

## Seguridad — cómo está montado

- El bucket de imágenes es **privado**. El portal abre cada foto con una URL firmada temporal
  (1 hora). Un trabajador solo alcanza su propia carpeta; el Jefe, todas.
- La **service role key** vive solo en la Edge Function, nunca en el navegador.
  La anon key de `config.js` sí es pública por diseño: sin sesión no abre nada.
- El **número de documento** lo asigna el servidor (`siguiente_numero`), con índice único:
  no se puede repetir.
- Borrar un trabajador **no borra sus documentos**: quedan visibles para los Jefes.
- No se puede dejar el portal sin ningún Jefe (trigger en la base de datos).

## Estructura

```
portal/
├── index.html            # SPA: login + módulos
├── css/styles.css        # Diseño (amarillo / negro / blanco)
├── plantillas/*.pdf      # Formatos originales que se rellenan
├── js/
│   ├── config.js         # Credenciales Supabase + datos de la empresa
│   ├── formats.js        # Campos de cada uno de los 5 formatos
│   ├── plantillas.js     # Coordenadas de relleno de cada plantilla
│   ├── store.js          # Capa de datos (Supabase o demo/localStorage)
│   ├── pdf.js            # Motor de relleno de PDF (pdf-lib)
│   └── app.js            # Lógica de la interfaz
├── tools/audit-campos.js # Verifica que ningún campo se quede sin imprimir
├── supabase/
│   ├── schema.sql        # Tablas + RLS + Storage + migraciones
│   └── functions/admin-users/index.ts   # Edge Function (CRUD de usuarios)
└── netlify.toml
```

## Pendientes conocidos

- Los scripts de `pdf-lib` y `supabase-js` se cargan desde CDN sin `integrity`,
  y `supabase-js` no está fijado a una versión exacta.
- No hay borrador local: si falla el guardado sin señal, el formulario sigue en pantalla
  pero se pierde al cerrar la pestaña.
- El PDF no se archiva; se regenera desde la plantilla. Si la plantilla cambia,
  un documento viejo re-descargado sale distinto al que se entregó.
