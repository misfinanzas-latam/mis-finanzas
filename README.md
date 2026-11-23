# Mis Finanzas

App de finanzas personales con:
- foto del ticket leída en el teléfono, sin guardar la foto,
- ahorros por banco,
- ingresos y gastos fijos con cualquier frecuencia,
- hoja del mes,
- escenarios que se aplican como presupuesto.

- **Web:** se publica gratis en GitHub Pages.
- **Datos y cuentas de usuario:** Supabase (login con correo y base de datos con reglas por usuario).
- **iPhone:** proyecto de Capacitor listo en `ios/` para compilar en Xcode y subir al App Store.

```
www/                  La app (HTML/JS). Es lo que se publica y lo que va dentro de la app de iPhone.
  config.js           Datos de conexión a Supabase (URL y anon key).
  privacy.html        Política de privacidad (Apple la exige).
  ocr/                Lector de tickets local (Tesseract + idioma español).
  vendor/supabase.js  Cliente de Supabase.
supabase/migrations/  Tablas, reglas de seguridad y función para borrar la cuenta.
ios/                  Proyecto de Xcode (Capacitor).
.github/workflows/    Publicación automática en GitHub Pages.
```

Si `config.js` está vacío, la app funciona en **modo local**: los datos quedan solo en el teléfono y no pide login.

---

## 1. Base de datos (Supabase)

1. Crea una cuenta en https://supabase.com y luego un proyecto nuevo. La región más cercana es *East US*.
2. Ve a **SQL Editor**, pega el contenido de `supabase/migrations/0001_init.sql` y ejecútalo. Esto crea:
   - la tabla `docs`,
   - las reglas que hacen que cada usuario solo vea sus datos,
   - la función para eliminar la cuenta.
3. En **Authentication › Sign In / Providers › Email** deja activado **Confirm email**.
4. En **Authentication › URL Configuration**:
   - **Site URL:** `https://TU_USUARIO.github.io/mis-finanzas/`
   - **Redirect URLs:** agrega esa misma URL y `capacitor://localhost`.
5. Opcional: en **Authentication › Emails** traduce al español los correos de confirmación y de cambio de contraseña.
6. En **Project Settings › API** copia la **Project URL** y la **anon public key**.

> La *anon key* es pública por diseño. La seguridad la dan las reglas RLS de la tabla. Nunca pongas la *service_role key* en la app.

## 2. Conectar la app

Tienes dos opciones:

- **Opción A, con variables del repositorio (recomendada para la web):** en GitHub ve a **Settings › Secrets and variables › Actions › Variables** y crea:
  - `SUPABASE_URL` = la Project URL
  - `SUPABASE_ANON_KEY` = la anon public key
  - `SITE_URL` = `https://TU_USUARIO.github.io/mis-finanzas/`
- **Opción B:** escribe esos tres valores directamente en `www/config.js`. Esta es la que necesitas para la app de iPhone, porque el build de Xcode no usa las variables de GitHub.

## 3. Publicar en GitHub Pages

1. Crea el repositorio `mis-finanzas` en GitHub. Con el plan gratis, Pages solo funciona si el repositorio es **público**.
2. Sube el código:
   ```bash
   git remote add origin https://github.com/TU_USUARIO/mis-finanzas.git
   git push -u origin main
   ```
3. En el repositorio ve a **Settings › Pages › Build and deployment › Source** y elige **GitHub Actions**.
4. Cada `push` a `main` publica la app en `https://TU_USUARIO.github.io/mis-finanzas/`.

En el celular, al abrir esa dirección puedes usar **Compartir › Agregar a pantalla de inicio** y queda como app.

## 4. App Store (iPhone)

Necesitas:
- una **Mac** con **Xcode** (desde el App Store),
- **Node.js 20 o superior**,
- **CocoaPods**: `sudo gem install cocoapods` o `brew install cocoapods`,
- una cuenta de **Apple Developer** ($99 al año): https://developer.apple.com/programs/

Pasos:

```bash
npm install
npx cap sync ios      # copia www/ dentro del proyecto de iPhone e instala dependencias
npx cap open ios      # abre Xcode
```

En Xcode:
1. Selecciona **App** › **Signing & Capabilities** y elige tu **Team**.
2. Cambia el **Bundle Identifier** si quieres. El actual es `sv.misfinanzas.app`. Debe ser único y coincidir con `capacitor.config.json`.
3. Prueba en tu iPhone conectado por cable con ▶︎.
4. Para publicar: **Product › Archive › Distribute App › App Store Connect**.

En https://appstoreconnect.apple.com crea la app y completa:
- **Política de privacidad (URL):** `https://TU_USUARIO.github.io/mis-finanzas/privacy.html`
- **Privacidad de la app:**
  - **Datos recopilados:** correo electrónico (funcionalidad de la app) e información financiera (funcionalidad de la app).
  - Ambos están **vinculados al usuario** y **no se usan para rastreo**.
- **Cuenta de prueba para la revisión:** crea un usuario de prueba y pon su correo y contraseña en *App Review Information*.
- **Capturas de pantalla:** iPhone de 6.9" y 6.5", como mínimo.
- **Categoría:** Finanzas.

Ya está resuelto en el proyecto:
- textos de permiso para cámara y fotos en español,
- botón **Eliminar mi cuenta** (Apple lo exige),
- declaración de cifrado (`ITSAppUsesNonExemptEncryption = NO`),
- ícono de 1024 px.

Cada vez que cambies algo en `www/`: haz `npx cap sync ios`, sube el número de versión en Xcode y vuelve a archivar. La web, en cambio, se actualiza sola con cada `push`.

## 5. Antes de publicar

- [ ] Cambia el correo de contacto en `www/privacy.html` (aparece como `soporte@ejemplo.com`).
- [ ] Revisa que `config.js` tenga tu URL y anon key de Supabase.
- [ ] Haz una prueba completa: crear cuenta, confirmar el correo, entrar, escanear un ticket y eliminar la cuenta.

## Costos y límites

| Servicio | Gratis | Nota |
|---|---|---|
| GitHub Pages | Sí | El repositorio debe ser público en el plan gratis |
| Supabase | Plan Free: 500 MB, 50,000 usuarios activos al mes | Un proyecto gratis se pausa tras 7 días sin uso. Para producción conviene el plan Pro ($25 al mes) |
| Apple Developer | No | $99 al año |

## Android (después)

```bash
npm i @capacitor/android@7
npx cap add android
npx cap open android   # requiere Android Studio
```
