// Configuración pública de Mis Finanzas.
// La "anon key" de Supabase es pública por diseño: la seguridad la dan las reglas (RLS) de la base de datos.
// Déjalo vacío para usar la app en "modo local" (datos solo en el teléfono).
window.MF_CONFIG = {
  supabaseUrl: "",        // ej. https://abcdefgh.supabase.co
  supabaseAnonKey: "",    // Project Settings › API › anon public
  siteUrl: ""             // ej. https://TU_USUARIO.github.io/mis-finanzas/  (para correos de confirmación)
};
