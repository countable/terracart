// A disposable save on a separate origin. No access to the normal game's save.
window.__JUNGLE_STUDY=true;window.__renderScaleCap=1;window.__DAYLIGHT=1;
window.__sandboxSkipStory=true;window.__sandboxSkipTutorial=true;
for(const name of ['localStorage','sessionStorage']) {
 const data=new Map();
 const store={get length(){return data.size;},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear()};
 Object.defineProperty(window,name,{value:store,configurable:true});
}
sessionStorage.setItem('terracart.safetySeen','1');
localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');
if('serviceWorker' in navigator)navigator.serviceWorker.register=async()=>({});
