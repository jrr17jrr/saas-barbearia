// Initialize after the full document is parsed (some pages put the overlay after scripts).
function initializeMobileMenu(){
 const menuBtn=document.getElementById("menuBtn");
 const sidebar=document.querySelector(".sidebar");
 const overlay=document.getElementById("overlay");
 if(!menuBtn||!sidebar)return;
 const close=()=>{
  sidebar.classList.remove("active");
  overlay?.classList.remove("active");
  menuBtn.classList.remove("is-open");
  menuBtn.setAttribute("aria-expanded","false");
  menuBtn.setAttribute("aria-label","Abrir menu");
  menuBtn.textContent="☰";
 };
 const open=()=>{
  sidebar.classList.add("active");
  overlay?.classList.add("active");
  menuBtn.classList.add("is-open");
  menuBtn.setAttribute("aria-expanded","true");
  menuBtn.setAttribute("aria-label","Fechar menu");
  menuBtn.textContent="×";
 };
 close();
 menuBtn.addEventListener("click",()=>sidebar.classList.contains("active")?close():open());
 overlay?.addEventListener("click",close);
 document.addEventListener("pointerdown",e=>{
  if(window.innerWidth<=768&&sidebar.classList.contains("active")&&!sidebar.contains(e.target)&&!menuBtn.contains(e.target))close();
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape")close()});
 sidebar.querySelectorAll(".menu a").forEach(a=>a.addEventListener("click",close));
 window.addEventListener("resize",()=>{if(window.innerWidth>768)close()});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initializeMobileMenu,{once:true});
else initializeMobileMenu();
