// Carga el idioma español empaquetado y luego el worker de Tesseract
importScripts("spa-data.js");
(function(){var _f=self.fetch?self.fetch.bind(self):null;
self.fetch=function(u,o){if(String(u).indexOf("spa.traineddata")>-1){var b=atob(self.SPA_GZ_B64),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return Promise.resolve(new Response(a,{status:200}))}return _f(u,o)};})();
importScripts("worker.min.js");
