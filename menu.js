const menuBtn=document.getElementById("menuBtn");
const sidebar=document.querySelector(".sidebar");
const overlay=document.getElementById("overlay");
if(menuBtn&&sidebar){
  const closeMenu=()=>{
    sidebar.classList.remove("active");
    overlay?.classList.remove("active");
    menuBtn.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded","false");
    menuBtn.setAttribute("aria-label","Abrir menu");
    menuBtn.textContent="☰";
  };
  const openMenu=()=>{
    sidebar.classList.add("active");
    overlay?.classList.add("active");
    menuBtn.classList.add("is-open");
    menuBtn.setAttribute("aria-expanded","true");
    menuBtn.setAttribute("aria-label","Fechar menu");
    menuBtn.textContent="×";
  };
  menuBtn.setAttribute("aria-expanded","false");
  menuBtn.setAttribute("aria-label","Abrir menu");
  menuBtn.addEventListener("click",()=>sidebar.classList.contains("active")?closeMenu():openMenu());
  overlay?.addEventListener("click",closeMenu);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
  sidebar.querySelectorAll(".menu a").forEach(a=>a.addEventListener("click",closeMenu));
  window.addEventListener("resize",()=>{if(window.innerWidth>768)closeMenu()});
}
