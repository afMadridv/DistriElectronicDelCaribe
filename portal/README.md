# Portal DistriElectronicDelCaribe

Plataforma de generación y gestión de cotizaciones en PDF con historial y edición.

## Características

- **Autenticación** con usuario y contraseña (Supabase Auth). Roles: **Trabajador** y **Jefe**.
- **Generar Cotización**: 5 formatos predefinidos (Cotización de Equipos, Revisión Técnica, Mantenimiento UPS, Visita Técnica, Acta de Entrega). Formulario dinámico según formato, con imágenes (compresión automática), firma digital en pantalla, tabla de ítems con totales e IVA, y **vista previa del PDF en vivo**.
- **Historial / Editar**: lista de cotizaciones con búsqueda; edita solo los campos que necesites y regenera el PDF. Cada cambio queda guardado con timestamp.
- **Gestión de Usuarios**: solo los Jefes crean, editan y eliminan trabajadores.
- **RLS**: cada usuario ve solo sus cotizaciones; el Jefe ve todas.

## Modo demo

Mientras `js/config.js` no tenga las credenciales de Supabase, el portal corre en **modo demo** (datos en localStorage del navegador):

- Jefe: `jefe@demo.com` / `demo1234`
- Trabajador: `trabajador@demo.com` / `demo1234`

Sirve para probar todo el flujo sin configurar nada. **No usar en producción.**

## Puesta en producción

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Abre **SQL Editor** y ejecuta todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) (crea tablas, RLS y el bucket de imágenes).
3. Crea el primer Jefe: **Authentication → Users → Add user** (marca *Auto Confirm User*), copia su UUID y ejecuta el `insert into public.profiles ...` que está comentado al final del schema.
4. Despliega la Edge Function de gestión de usuarios (necesita [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase link --project-ref TU_PROJECT_REF
   supabase functions deploy admin-users
   ```
5. Copia **Settings → API → Project URL** y **anon public key** y pégalas en [`js/config.js`](js/config.js).

### 2. Netlify

1. Sube esta carpeta (`portal/`) a un repositorio de GitHub o arrástrala en [app.netlify.com/drop](https://app.netlify.com/drop).
2. No requiere build: es un sitio estático (`netlify.toml` ya está configurado).

### 3. Datos de la empresa

Edita `COMPANY` en [`js/config.js`](js/config.js) (nombre, NIT, dirección, teléfono, correo). Aparecen en el encabezado y pie de cada PDF.

## Estructura

```
portal/
├── index.html            # SPA: login + módulos
├── css/styles.css        # Diseño (amarillo / negro / blanco)
├── js/
│   ├── config.js         # Credenciales Supabase + datos de la empresa
│   ├── formats.js        # Definición de los 5 formatos y sus campos
│   ├── store.js          # Capa de datos (Supabase o demo/localStorage)
│   ├── pdf.js            # Generador de PDFs (jsPDF, en el navegador)
│   └── app.js            # Lógica de la interfaz
├── supabase/
│   ├── schema.sql        # Tablas + RLS + Storage
│   └── functions/admin-users/index.ts   # Edge Function (CRUD de usuarios)
└── netlify.toml
```

## Notas técnicas

- Los PDFs se generan **100% en el navegador** con jsPDF: sin backend ni costos de servidor.
- Las imágenes se comprimen a JPEG máx. 1200px antes de subirse a Supabase Storage.
- La creación/edición/eliminación de usuarios pasa por la Edge Function `admin-users`, que valida que quien llama sea Jefe y usa la service role key solo en el servidor.
