/* Tailor service worker — caches the app shell so the agent installs like an app.
   AI calls always go to the network (Groq). */
const CACHE = "tailor-v3";
const SHELL = ["./","./index.html","./styles.css","./app.js","./manifest.webmanifest",
  "./icon-192.png","./icon-512.png","./apple-touch-icon.png","./favicon-48.png"];

self.addEventListener("install",(e)=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",(e)=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",(e)=>{
  const url=new URL(e.request.url);
  if(url.hostname.endsWith("groq.com"))return;          // never cache API calls
  if(e.request.method!=="GET")return;
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{
    if(res.ok&&url.origin===location.origin){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
    return res;
  }).catch(()=>caches.match("./index.html"))));
});
