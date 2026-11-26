// Mis Finanzas: caché sin conexión. Cambia VERSION al publicar cambios grandes.
const VERSION="mf-v51";
const SHELL=["./","index.html","config.js","vendor/supabase.js","manifest.webmanifest","icons/icon-192.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.origin!==location.origin)return; // Supabase y otros: siempre en línea
  const heavy=/\/(ocr|vendor|icons)\//.test(u.pathname);
  if(heavy){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{const cp=res.clone();caches.open(VERSION).then(c=>c.put(e.request,cp));return res})));return}
  e.respondWith(fetch(e.request).then(res=>{const cp=res.clone();caches.open(VERSION).then(c=>c.put(e.request,cp));return res}).catch(()=>caches.match(e.request).then(r=>r||caches.match("index.html"))));
});
// Notificaciones del sistema (recordatorios)
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(_){d={title:"Mis Finanzas",body:e.data?e.data.text():""}}
  e.waitUntil(self.registration.showNotification(d.title||"Mis Finanzas",{body:d.body||"",icon:"icons/icon-192.png",badge:"icons/icon-192.png",tag:d.tag||"mf",data:{url:d.url||"./"}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();const url=(e.notification.data&&e.notification.data.url)||"./";
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{for(const c of cs){if("navigate" in c){return c.navigate(url).then(w=>w&&w.focus())}}return self.clients.openWindow(url)}))});
