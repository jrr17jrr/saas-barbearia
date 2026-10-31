const local=["localhost","127.0.0.1","[::1]"].includes(location.hostname);
export const swReady=("serviceWorker" in navigator&&(location.protocol==="https:"||local))
 ?navigator.serviceWorker.register("/sw.js",{scope:"/"}).then(()=>navigator.serviceWorker.ready).catch(error=>{console.warn("PWA:",error);return null;})
 :Promise.resolve(null);
